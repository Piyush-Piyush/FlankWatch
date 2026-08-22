import { db } from "../db/index.js";
import { createCollector } from "../../collectors/createCollector.js";
import { addCollector, loadCollectors } from "../../lib/collectorStore.js";
import { runCollectorForCompetitor } from "./pipeline.js";

// The extraction phrasing that reliably captured every tier for the first
// verified collector — "ALL tiers, not just one" was the difference between
// getting 1 tier and getting the full set. Reused as the default so a user
// adding a competitor doesn't have to know that lesson.
const DEFAULT_DESCRIPTION =
  "Extract ALL pricing tiers shown on the page (every plan card, not just one). " +
  "For each tier: plan name, price value, currency, billing period (monthly/annual), " +
  "full list of feature bullets.";

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function listPendingCollectors() {
  return db.prepare("SELECT * FROM pending_collectors WHERE status IN ('creating','failed') ORDER BY requested_at DESC").all();
}

/**
 * Kicks off an on-demand collector build. Validates and inserts a
 * "creating" row synchronously (so the caller can return immediately and
 * the dashboard shows it right away), then the real multi-minute
 * `bdata scraper create` runs in the background via runCreateJob().
 */
export function startCollectorCreation({ name, url, category, description }) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("name is required");
  const slug = slugify(trimmed);
  if (!slug) throw new Error("name must contain at least one letter or number");

  const existing = loadCollectors();
  if (existing[slug]) throw new Error(`A competitor named "${slug}" already exists`);

  const dupPending = db.prepare("SELECT id FROM pending_collectors WHERE name = ? AND status = 'creating'").get(slug);
  if (dupPending) throw new Error(`A build for "${slug}" is already in progress`);

  const info = db
    .prepare(
      `INSERT INTO pending_collectors (name, url, category, description, requested_at, status)
       VALUES (?, ?, ?, ?, ?, 'creating')`
    )
    .run(slug, url, (category || "Uncategorized").trim() || "Uncategorized", description || DEFAULT_DESCRIPTION, new Date().toISOString());

  return { pendingId: info.lastInsertRowid, name: slug };
}

export async function runCreateJob(pendingId) {
  const row = db.prepare("SELECT * FROM pending_collectors WHERE id = ?").get(pendingId);
  if (!row) return;

  try {
    const response = await createCollector(row.url, row.description, { name: `flankwatch-${row.name}` });

    if (response.status !== "done" || !response.collector_id) {
      throw new Error(response.error || `AI generation did not complete (status: ${response.status ?? "unknown"})`);
    }

    // Persist into the registry, then do one verification run so the new
    // card shows real data (and a first "known good" baseline) immediately.
    addCollector(row.name, {
      url: row.url,
      collector_id: response.collector_id,
      description: row.description,
      category: row.category,
      status: "verified",
    });

    db.prepare("UPDATE pending_collectors SET status = 'done', collector_id = ? WHERE id = ?").run(response.collector_id, pendingId);

    await runCollectorForCompetitor(row.name).catch(() => {
      // A failed first run doesn't undo creation — the collector exists and
      // can be re-run from the dashboard; don't roll back over it.
    });
  } catch (err) {
    db.prepare("UPDATE pending_collectors SET status = 'failed', error = ? WHERE id = ?").run(String(err.message ?? err), pendingId);
  }
}

export function dismissPending(pendingId) {
  db.prepare("DELETE FROM pending_collectors WHERE id = ? AND status = 'failed'").run(pendingId);
}
