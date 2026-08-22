import { askText, askYesNo } from "../lib/prompt.js";
import { upsertEnvVar } from "../lib/envFile.js";

/** Overwrites GEMINI_API_KEY in .env — safe to run repeatedly, each call replaces the previous value. */
export async function setGeminiKeyCommand(key) {
  const value = key || (await askText("Gemini API key: "));
  if (!value) {
    console.error("No key provided.");
    process.exitCode = 1;
    return;
  }

  upsertEnvVar("GEMINI_API_KEY", value);
  console.log("Saved GEMINI_API_KEY to .env.");

  const enable = await askYesNo("Enable AI features now?", true);
  if (enable) {
    upsertEnvVar("AI_ENABLED", "true");
    console.log("Set AI_ENABLED=true.");
  }
}
