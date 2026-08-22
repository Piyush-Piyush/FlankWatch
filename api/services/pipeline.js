import { db } from "../db/index.js";
import { getCollector } from "../../lib/collectorStore.js";
import { runCollector } from "../../collectors/runCollector.js";
import { evaluateRun, generateDiagnosis } from "../../monitor/evaluateRun.js";
import { PRICING_SCHEMA } from "../../monitor/schemaConfig.js";

function countFields(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + countFields(v), 0);
  if (typeof value === "object") return Object.values(value).reduce((sum, v) => sum + countFields(v), 0);
  return 1;
}

function getLastGoodRun(competitor) {
  const row = db
    .prepare("SELECT raw_json FROM runs WHERE competitor = ? AND status = 'healthy' ORDER BY run_timestamp DESC LIMIT 1")
    .get(competitor);
  return row ? JSON.parse(row.raw_json) : null;
}

/**
 * Given a saved collector, fetches fresh data, evaluates it, and writes a
 * row to storage. This is what both a scheduler and the "simulate
 * redesign" demo trigger call.
 */
export async function runCollectorForCompetitor(competitor, { aiEnabled = false, aiApiKey = null, url } = {}) {
  const config = getCollector(competitor);

  const targetUrl = url || config.url;
  const result = await runCollector(config.collector_id, targetUrl);
  const lastGood = getLastGoodRun(competitor);
  const { status, reasons } = await evaluateRun(result, lastGood, {
    schema: PRICING_SCHEMA,
    aiEnabled,
    aiApiKey,
  });
  const diagnosis = generateDiagnosis(reasons);

  db.prepare(
    `INSERT INTO runs (competitor, collector_id, run_timestamp, status, reasons, raw_json, field_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(competitor, config.collector_id, new Date().toISOString(), status, JSON.stringify(reasons), JSON.stringify(result), countFields(result));

  return { competitor, status, reasons, diagnosis, result };
}
