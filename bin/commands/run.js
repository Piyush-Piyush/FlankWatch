import cron from "node-cron";
import { runCollectorForCompetitor } from "../../api/services/pipeline.js";
import { autoHealAndApprove } from "../../api/services/healService.js";
import { getCollector, setSchedule } from "../../lib/collectorStore.js";
import { isAiEnabled } from "../../lib/aiState.js";

export async function runCommand(name, options) {
  // Validate before doing any real work — no point burning a real bdata
  // run only to reject the schedule afterward.
  if (options.schedule && !cron.validate(options.schedule)) {
    console.error(`"${options.schedule}" is not a valid cron expression.`);
    process.exitCode = 1;
    return;
  }

  const aiEnabled = isAiEnabled();
  const aiApiKey = process.env.GEMINI_API_KEY || null;

  const result = await runCollectorForCompetitor(name, { aiEnabled, aiApiKey, url: options.url });
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "healthy" && options.heal !== false) {
    console.log("\nDegraded — auto-healing...");
    const healResult = await autoHealAndApprove(name, result.reasons, result.result, { aiEnabled, aiApiKey, diagnosis: result.diagnosis });
    console.log(`\nFinal status: ${healResult.status}`);
    if (healResult.status === "needs_review") process.exitCode = 1;
  }

  if (options.schedule) {
    const { category } = getCollector(name);
    setSchedule(category, options.schedule);
    console.log(`\nScheduled "${category}" @ ${options.schedule} — takes effect next time the dashboard server (re)starts.`);
  }
}
