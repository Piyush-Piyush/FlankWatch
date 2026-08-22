import { runBdata, assertSafeCollectorId, assertSafeUrl } from "../lib/bdataCli.js";

/**
 * Thin wrapper around the Bright Data Scraper Studio CLI.
 * This file's only job is shelling out to `bdata` — no scraping logic,
 * no storage, no diagnosis. Keeps the "required technology" boundary
 * visible: everything under /collectors is a CLI invocation, nothing more.
 */
export async function runCollector(collectorId, url, { timeoutSeconds = 600 } = {}) {
  assertSafeCollectorId(collectorId);
  assertSafeUrl(url);

  return runBdata(["scraper", "run", collectorId, url, "--json", "--timeout", String(timeoutSeconds)]);
}
