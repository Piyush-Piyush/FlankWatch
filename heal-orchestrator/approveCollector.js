import { runBdata, assertSafeCollectorId, assertSafeUrl } from "../lib/bdataCli.js";

/**
 * Thin CLI wrapper — approves (or rejects) a heal that's awaiting approval.
 * No orchestration logic here; see api/services/healService.js for that.
 *
 * autoSave defaults to true (persists the healed template) but this flag
 * has been observed failing with a 400 "Invalid ide automation" error on
 * this account — see FLANKWATCH notes. approveHeal() in healService.js
 * catches that and marks the heal "needs_review" rather than swallowing it.
 */
export async function approveCollector(collectorId, url, { reject = false, autoSave = true, timeoutSeconds = 600 } = {}) {
  assertSafeCollectorId(collectorId);
  assertSafeUrl(url);

  const args = ["scraper", "approve", collectorId, "--url", url, "--json", "--timeout", String(timeoutSeconds)];
  if (reject) args.push("--reject");
  if (autoSave && !reject) args.push("--auto-save");

  return runBdata(args);
}
