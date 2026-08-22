import spawn from "cross-spawn";

const COLLECTOR_ID_RE = /^c_[a-zA-Z0-9]+$/;

export function assertSafeCollectorId(collectorId) {
  if (!COLLECTOR_ID_RE.test(collectorId)) {
    throw new Error(`Invalid collector id: ${collectorId}`);
  }
}

export function assertSafeUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL protocol: ${url}`);
  }
}

/**
 * Shared low-level `bdata` CLI runner used by both /collectors and
 * /heal-orchestrator. Uses cross-spawn instead of shell:true — Windows
 * .cmd shims can't be exec'd directly, but naive shell:true also doesn't
 * quote multi-word args (a diagnosis string with spaces silently split
 * into extra argv entries and broke the heal call). cross-spawn handles
 * Windows argument quoting correctly without a shell.
 */
export function runBdata(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-p", "@brightdata/cli", "bdata", ...args], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`bdata ${args[0]} exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Failed to parse bdata JSON output: ${err.message}\n${stdout}`));
      }
    });
  });
}
