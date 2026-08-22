import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db } from "../db/index.js";
import { healCollector } from "../../heal-orchestrator/healCollector.js";
import { approveCollector } from "../../heal-orchestrator/approveCollector.js";
import { runCollectorForCompetitor } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTORS_PATH = path.join(__dirname, "..", "..", "collectors", "collectors.json");

function loadCollectors() {
  return JSON.parse(readFileSync(COLLECTORS_PATH, "utf-8"));
}

function getCollectorConfig(competitor) {
  const collectors = loadCollectors();
  const config = collectors[competitor];
  if (!config) throw new Error(`Unknown competitor: ${competitor}`);
  return config;
}

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
  return healId;
}

export async function runHealJob(healId, competitor, diagnosis) {
  const config = getCollectorConfig(competitor);
  try {
    const response = await healCollector(config.collector_id, config.url, diagnosis);
    db.prepare("UPDATE heals SET status = ?, preview_result = ? WHERE id = ?").run(
      response.status,
      JSON.stringify(response.preview_result ?? null),
      healId
    );
  } catch (err) {
    db.prepare("UPDATE heals SET status = 'needs_review', error = ? WHERE id = ?").run(String(err.message ?? err), healId);
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
  return heal;
}

export async function runApproveJob(healId, competitor, { reject = false } = {}) {
  const config = getCollectorConfig(competitor);
  try {
    const response = await approveCollector(config.collector_id, config.url, { reject });

    if (reject) {
      db.prepare("UPDATE heals SET status = 'rejected', approved_at = ? WHERE id = ?").run(new Date().toISOString(), healId);
      return;
    }

    db.prepare("UPDATE heals SET status = ?, approved_at = ? WHERE id = ?").run(response.status, new Date().toISOString(), healId);
    // Verify recovery: re-run the collector and let evaluate_run confirm it's healthy again.
    await runCollectorForCompetitor(competitor);
  } catch (err) {
    db.prepare("UPDATE heals SET status = 'needs_review', error = ? WHERE id = ?").run(String(err.message ?? err), healId);
  }
}

/** Synchronous variant for CLI/test use — awaits the full approve+verify cycle. */
export async function approveHeal(competitor, { reject = false } = {}) {
  const heal = markHealPending(competitor, { reject });
  await runApproveJob(heal.id, competitor, { reject });
  const row = db.prepare("SELECT * FROM heals WHERE id = ?").get(heal.id);
  return { healId: heal.id, status: row.status, error: row.error };
}
