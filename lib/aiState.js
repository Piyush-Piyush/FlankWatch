import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_STATE_PATH = path.join(__dirname, "..", "collectors", "ai-state.json");

/**
 * Whether AI features (second pass, diagnosis writer, digest) are on.
 * Defaults to true when no state file exists yet. Persisted to a small
 * JSON file (same pattern as collectors/schedules.json) instead of an
 * env var — env vars are only read once at process startup, so an env-var
 * toggle silently goes stale the moment you edit it while the dashboard
 * is already running. Reading this file fresh on every call means
 * `flank ai on/off` takes effect immediately, no restart, and the
 * dashboard's next poll (every 4s) reflects it automatically.
 */
export function isAiEnabled() {
  if (!existsSync(AI_STATE_PATH)) return true;
  try {
    return JSON.parse(readFileSync(AI_STATE_PATH, "utf-8")).enabled !== false;
  } catch {
    return true;
  }
}

export function setAiEnabled(enabled) {
  writeFileSync(AI_STATE_PATH, JSON.stringify({ enabled: Boolean(enabled) }, null, 2) + "\n");
}
