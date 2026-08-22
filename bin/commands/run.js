import { runCollectorForCompetitor } from "../../api/services/pipeline.js";
import { autoHealAndApprove } from "../../api/services/healService.js";

export async function runCommand(name, options) {
  const aiEnabled = process.env.AI_ENABLED === "true";
  const aiApiKey = process.env.GEMINI_API_KEY || null;

  const result = await runCollectorForCompetitor(name, { aiEnabled, aiApiKey, url: options.url });
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "healthy" && options.heal !== false) {
    console.log("\nDegraded — auto-healing...");
    const healResult = await autoHealAndApprove(name, result.reasons, result.result, { aiEnabled, aiApiKey });
    console.log(`\nFinal status: ${healResult.status}`);
    if (healResult.status === "needs_review") process.exitCode = 1;
  }
}
