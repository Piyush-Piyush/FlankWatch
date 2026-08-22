import { runBdata, assertSafeCollectorId, assertSafeUrl } from "../lib/bdataCli.js";

/**
 * Thin CLI wrapper — triggers AI self-healing on an existing scraper.
 * Deliberately never passes --auto-approve: the preview/approve step must
 * stay visible for the demo's human-in-the-loop story.
 * No orchestration logic here; see api/services/healService.js for that.
 */
export async function healCollector(collectorId, url, diagnosis, { timeoutSeconds = 600 } = {}) {
  assertSafeCollectorId(collectorId);
  assertSafeUrl(url);
  if (!diagnosis || diagnosis.length > 1000) {
    throw new Error("diagnosis must be a non-empty string of at most 1000 chars");
  }

  return runBdata(["scraper", "heal", collectorId, diagnosis, "--url", url, "--json", "--timeout", String(timeoutSeconds)]);
}
