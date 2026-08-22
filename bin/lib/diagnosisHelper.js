import { getLatestRun } from "../../api/db/queries.js";
import { generateDiagnosis } from "../../monitor/evaluateRun.js";

/**
 * Same resolution logic as the POST /:name/heal route in api/server.js:
 * an explicit diagnosis wins, otherwise pull the latest run's degraded
 * reasons/raw result and let generateDiagnosis() write one.
 */
export async function resolveDiagnosis(competitor, explicitDiagnosis, { aiEnabled = false, aiApiKey = null } = {}) {
  if (explicitDiagnosis) return explicitDiagnosis;

  const latestRun = getLatestRun(competitor);
  const reasons = latestRun ? JSON.parse(latestRun.reasons || "[]") : [];
  const rawResult = latestRun ? JSON.parse(latestRun.raw_json) : null;

  return (await generateDiagnosis(reasons, { rawResult, aiEnabled, aiApiKey })) || null;
}
