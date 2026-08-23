import "dotenv/config";
import { loadCollectors } from "../lib/collectorStore.js";
import { runCollectorForCompetitor } from "../api/services/pipeline.js";
import { autoHealAndApprove } from "../api/services/healService.js";
import { isAiEnabled } from "../lib/aiState.js";

/**
 * Unattended monitor for CI: run each collector, and if it comes back
 * degraded, heal and approve automatically — no human in the loop. This
 * is the one place --auto-approve-equivalent behavior is correct; the
 * live demo keeps that step manual on purpose, but a 3am cron job has no
 * one to click "Approve".
 *
 * Exit code is the CI signal: 0 means every competitor is healthy (either
 * it already was, or a break got healed and verified). 1 means something
 * needs a human — a heal that didn't reach awaiting_approval, or an
 * approve that landed in needs_review.
 */
const collectors = loadCollectors();

const aiEnabled = isAiEnabled();
const aiApiKey = process.env.GEMINI_API_KEY || null;

let hadUnrecoveredFailure = false;

for (const competitor of Object.keys(collectors)) {
  console.log(`\n=== ${competitor} ===`);

  const result = await runCollectorForCompetitor(competitor, { aiEnabled, aiApiKey });
  console.log(`status: ${result.status}`);

  if (result.status === "healthy") continue;

  console.log(`degraded: ${result.reasons.join("; ")}`);
  console.log("auto-healing...");
  const approveResult = await autoHealAndApprove(competitor, result.reasons, result.result, { aiEnabled, aiApiKey, diagnosis: result.diagnosis });
  console.log(`final status: ${approveResult.status}`);

  if (approveResult.status === "needs_review") {
    console.error(`heal did not fully recover (status "${approveResult.status}"): ${approveResult.error ?? ""}`);
    hadUnrecoveredFailure = true;
  } else {
    console.log(`${competitor} healed and verified recovered.`);
  }
}

if (hadUnrecoveredFailure) {
  console.error("\nOne or more competitors need human review.");
  process.exit(1);
}

console.log("\nAll competitors healthy.");
