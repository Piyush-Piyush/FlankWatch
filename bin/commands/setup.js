import spawn from "cross-spawn";
import { askText, askYesNo } from "../lib/prompt.js";
import { upsertEnvVar } from "../lib/envFile.js";

function runBdataLogin() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-p", "@brightdata/cli", "bdata", "login"], { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`bdata login exited ${code}`))));
  });
}

export async function setupCommand() {
  console.log("FlankWatch setup\n");

  console.log("1/2 — Bright Data login (opens a browser, stores your own token in the bdata CLI's own config):");
  await runBdataLogin();

  console.log("\n2/2 — Gemini API key (optional — powers the AI diagnosis/anomaly/digest features; everything");
  console.log("works fine without it, purely rule-based). Get a free-tier key at https://aistudio.google.com/apikey\n");

  const key = await askText("Gemini API key (leave blank to skip): ");
  if (!key) {
    console.log("\nSkipped — FlankWatch will run pure rule-based (AI_ENABLED stays off).");
    return;
  }

  upsertEnvVar("GEMINI_API_KEY", key);
  const enable = await askYesNo("Enable AI features now?", true);
  if (enable) upsertEnvVar("AI_ENABLED", "true");

  console.log(`\nSaved GEMINI_API_KEY to .env${enable ? " and set AI_ENABLED=true" : " (AI_ENABLED left as-is — set it to true in .env when ready)"}.`);
}
