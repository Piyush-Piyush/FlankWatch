import { runBdata, assertSafeUrl } from "../lib/bdataCli.js";

/**
 * Thin CLI wrapper — builds a new scraper from a natural-language
 * description via Scraper Studio's AI. Returns the create envelope
 * ({ collector_id, name, status, ... }). AI generation takes several
 * minutes; callers run this in the background, never inline in a request.
 *
 * No storage, no persistence here — that's collectorService.js. This file
 * stays a pure `bdata` invocation like everything else in /collectors.
 */
export async function createCollector(url, description, { name, timeoutSeconds = 600 } = {}) {
  assertSafeUrl(url);
  if (!description || description.length > 500) {
    throw new Error("description must be a non-empty string of at most 500 chars");
  }

  const args = ["scraper", "create", url, description, "--json", "--timeout", String(timeoutSeconds)];
  if (name) args.push("--name", name);

  return runBdata(args);
}
