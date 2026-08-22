import { db } from "../db/index.js";
import { getCollector as getCollectorConfig } from "../../lib/collectorStore.js";
import { healCollector } from "../../heal-orchestrator/healCollector.js";
import { approveCollector } from "../../heal-orchestrator/approveCollector.js";
import { runCollectorForCompetitor } from "./pipeline.js";
import { log, debugLog, logError } from "../../lib/logger.js";

function getMostRecentHeal(competitor) {
  return db.prepare("SELECT * FROM heals WHERE competitor = ? ORDER BY triggered_at DESC LIMIT 1").get(competitor);
}

/**
 * Heal and approve both run multi-minute Bright Data AI-Flow jobs, so
 * everything here is fire-and-forget from the HTTP layer's perspective:
 * a DB row is written synchronously (status "healing" / "approving") so
 * the dashboard has something to poll immediately, then the real CLI
 * call runs in the background and updates that row when it settles.
 */
export function insertPendingHeal(competitor, diagnosis) {
  const config = getCollectorConfig(competitor);
  const { lastInsertRowid: healId } = db
    .prepare(
      `INSERT INTO heals (collector_id, competitor, triggered_at, diagnosis, preview_result, approved_at, status)
       VALUES (?, ?, ?, ?, NULL, NULL, 'healing')`
    )
    .run(config.collector_id, competitor, new Date().toISOString(), diagnosis);
  log("heal", `[${competitor}] heal #${healId} queued`, { diagnosis });
  return healId;
}

export async function runHealJob(healId, competitor, diagnosis) {
  const config = getCollectorConfig(competitor);
  debugLog("heal", `[${competitor}] heal #${healId} calling bdata scraper heal...`);
  try {
    const response = await healCollector(config.collector_id, config.url, diagnosis);
    db.prepare("UPDATE heals SET status = ?, preview_result = ? WHERE id = ?").run(
      response.status,
      JSON.stringify(response.preview_result ?? null),
      healId
    );
    log("heal", `[${competitor}] heal #${healId} -> ${response.status}`);
  } catch (err) {
    db.prepare("UPDATE heals SET status = 'needs_review', error = ? WHERE id = ?").run(String(err.message ?? err), healId);
    logError("heal", `[${competitor}] heal #${healId} failed, marked needs_review`, err);
  }
}

/** Synchronous variant for CLI/test use — awaits the full heal cycle before returning. */
export async function triggerHeal(competitor, diagnosis) {
  const healId = insertPendingHeal(competitor, diagnosis);
  await runHealJob(healId, competitor, diagnosis);
  const row = db.prepare("SELECT * FROM heals WHERE id = ?").get(healId);
  return { healId, status: row.status, preview_result: row.preview_result ? JSON.parse(row.preview_result) : null, error: row.error };
}

/**
 * Marks the most recent heal as approving/rejecting. Throws if there's no
 * heal actually sitting at "awaiting_approval" — a heal still generating
 * ("healing") can't be approved yet.
 */
export function markHealPending(competitor, { reject = false } = {}) {
  const heal = getMostRecentHeal(competitor);
  if (!heal || heal.status !== "awaiting_approval") {
    throw new Error(`No heal awaiting approval for ${competitor} (current: ${heal?.status ?? "none"})`);
  }
  db.prepare("UPDATE heals SET status = ? WHERE id = ?").run(reject ? "rejecting" : "approving", heal.id);
  log("approve", `[${competitor}] heal #${heal.id} marked ${reject ? "rejecting" : "approving"}`);
  return heal;
}

export async function runApproveJob(healId, competitor, { reject = false } = {}) {
  const config = getCollectorConfig(competitor);
  debugLog("approve", `[${competitor}] heal #${healId} calling bdata scraper approve (reject=${reject})...`);
  try {
    const response = await approveCollector(config.collector_id, config.url, { reject });

    if (reject) {
      db.prepare("UPDATE heals SET status = 'rejected', approved_at = ? WHERE id = ?").run(new Date().toISOString(), healId);
      log("approve", `[${competitor}] heal #${healId} rejected`);
      return;
    }

    db.prepare("UPDATE heals SET status = ?, approved_at = ? WHERE id = ?").run(response.status, new Date().toISOString(), healId);
    log("approve", `[${competitor}] heal #${healId} approved -> ${response.status}; verifying recovery with a fresh run`);
    // Verify recovery: re-run the collector and let evaluate_run confirm it's healthy again.
    await runCollectorForCompetitor(competitor);
  } catch (err) {
    db.prepare("UPDATE heals SET status = 'needs_review', error = ? WHERE id = ?").run(String(err.message ?? err), healId);
    logError("approve", `[${competitor}] heal #${healId} approve failed, marked needs_review`, err);
  }
}

/** Synchronous variant for CLI/test use — awaits the full approve+verify cycle. */
export async function approveHeal(competitor, { reject = false } = {}) {
  const heal = markHealPending(competitor, { reject });
  await runApproveJob(heal.id, competitor, { reject });
  const row = db.prepare("SELECT * FROM heals WHERE id = ?").get(heal.id);
  return { healId: heal.id, status: row.status, error: row.error };
}

/**
 * Clears a stuck needs_review heal so the competitor's card stops
 * blocking on it. Keeps the row (status "dismissed") for the heal log's
 * history instead of deleting it — only needs_review can be dismissed;
 * an in-flight heal must resolve on its own first.
 */
export function dismissHeal(competitor) {
  const heal = getMostRecentHeal(competitor);
  if (!heal || heal.status !== "needs_review") {
    throw new Error(`No needs_review heal to dismiss for ${competitor} (current: ${heal?.status ?? "none"})`);
  }
  db.prepare("UPDATE heals SET status = 'dismissed' WHERE id = ?").run(heal.id);
  return heal;
}
