import { GoogleGenAI } from "@google/genai";
import { debugLog } from "./logger.js";

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_DIAGNOSIS_CHARS = 1000;
/**
 * AI-written alternative to the template-based diagnosis in
 * monitor/evaluateRun.js. Writing a good heal prompt is fundamentally a
 * language task, not a rule-matching one — every hand-coded heuristic
 * we've added (price shape, $0-suspicious, length capping) came from a
 * real site breaking an assumption the last one didn't. Given the raw
 * broken records directly, a model can notice things a template can't:
 * literal "Custom" text, a discount badge merged into a plan name, etc.
 *
 * Advisory only, same as aiSecondPass: the caller is expected to fall
 * back to the deterministic template on any failure — this must never be
 * the only way to produce a diagnosis.
 */
export async function generateAiDiagnosis(reasons, rawResult, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are writing an instruction for an AI (Bright Data Scraper Studio) that will re-visit a live pricing page and fix a broken web scraper.

A rule-based check found these problems:
${reasons.map((r) => `- ${r}`).join("\n")}

Here is the raw scraped data exactly as extracted, including tiers that extracted fine (for comparison):
${JSON.stringify(rawResult, null, 2)}

Write a short, concrete, actionable diagnosis of what's likely wrong on the page and what the scraper should capture instead. Reference specific tier names. Look at the raw data yourself for clues the rule check couldn't see — literal text like "Custom" or "Contact us", a discount badge accidentally merged into a plan name, a price nested under an unexpected key. Do not just restate the rule-check text.

Respond with ONLY the diagnosis text, under ${MAX_DIAGNOSIS_CHARS} characters, no preamble.`;

  debugLog("ai-diagnosis", `calling Gemini (${GEMINI_MODEL}) with ${reasons.length} reason(s), prompt ${prompt.length} chars`);
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  const text = (response.text || "").trim();
  if (!text) throw new Error("Gemini returned an empty diagnosis");

  const truncated = text.length > MAX_DIAGNOSIS_CHARS;
  const result = truncated ? text.slice(0, MAX_DIAGNOSIS_CHARS - 3).replace(/\s+\S*$/, "") + "..." : text;
  debugLog("ai-diagnosis", `Gemini responded with ${text.length} chars${truncated ? " (truncated to fit heal's limit)" : ""}`);
  return result;
}
