import { getLatestRun, getPreviousHealthyRun, getOpenHeal, getResilienceStats } from "../../api/db/queries.js";
import { diffPricingRuns } from "../../lib/diffPricing.js";

/**
 * Same composition as api/server.js's private buildCompetitor() — kept as
 * a separate, small copy here rather than importing server internals
 * (buildCompetitor isn't exported, and reaching into server.js from the
 * CLI would couple two things that should stay independent).
 */
export function formatCompetitor(name, config) {
  const latestRun = getLatestRun(name);
  const previousGood = latestRun ? getPreviousHealthyRun(name, latestRun.run_timestamp) : null;
  const openHeal = getOpenHeal(name);

  return {
    name,
    url: config.url,
    category: config.category || "Uncategorized",
    collectorId: config.collector_id,
    latestRun: latestRun
      ? {
          status: latestRun.status,
          reasons: JSON.parse(latestRun.reasons || "[]"),
          runTimestamp: latestRun.run_timestamp,
          result: JSON.parse(latestRun.raw_json),
        }
      : null,
    diff: latestRun && previousGood ? diffPricingRuns(JSON.parse(latestRun.raw_json), JSON.parse(previousGood.raw_json)) : [],
    openHeal: openHeal
      ? { id: openHeal.id, diagnosis: openHeal.diagnosis, previewResult: JSON.parse(openHeal.preview_result || "null"), status: openHeal.status }
      : null,
    resilience: getResilienceStats(name),
  };
}
