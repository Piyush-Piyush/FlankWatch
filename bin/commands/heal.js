import { triggerHeal } from "../../api/services/healService.js";
import { resolveDiagnosis } from "../lib/diagnosisHelper.js";

export async function healCommand(name, options) {
  const aiEnabled = process.env.AI_ENABLED === "true";
  const aiApiKey = process.env.GEMINI_API_KEY || null;

  const diagnosis = await resolveDiagnosis(name, options.diagnosis, { aiEnabled, aiApiKey });
  if (!diagnosis) {
    console.error("No diagnosis available — no degraded reasons on file for this competitor, and none was supplied via --diagnosis.");
    process.exitCode = 1;
    return;
  }

  console.log(`Diagnosis: ${diagnosis}\n`);
  const result = await triggerHeal(name, diagnosis);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "awaiting_approval") process.exitCode = 1;
}
