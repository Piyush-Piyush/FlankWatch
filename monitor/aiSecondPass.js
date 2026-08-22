import { GoogleGenAI, Type } from "@google/genai";

const GEMINI_MODEL = "gemini-2.5-flash-lite"; // fast/cheap — appropriate for a lightweight advisory check

const ANOMALY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    anomaly_detected: {
      type: Type.BOOLEAN,
      description: "true if the data looks subtly wrong despite passing field-level checks",
    },
    reason: {
      type: Type.STRING,
      description: "short explanation; empty string if no anomaly",
    },
  },
  required: ["anomaly_detected", "reason"],
};

/**
 * Advisory-only anomaly check. Looks for problems the rule engine's
 * field-type checks can't catch — e.g. a price that parses as a number
 * but is clearly wrong, garbled feature text, a placeholder-looking plan
 * name. Called only when the rule verdict is already "healthy".
 */
export async function aiSecondPass(currentResult, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are reviewing scraped competitor pricing data for subtle extraction errors that automated field-type checks would miss (e.g. a price field that technically parses as a number but is clearly wrong, garbled or truncated feature text, a plan name that looks like placeholder/boilerplate text rather than a real plan name).

Data:
${JSON.stringify(currentResult, null, 2)}

Does this data show signs of a subtle extraction problem?`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: ANOMALY_SCHEMA,
    },
  });

  const text = (response.text || "").trim();
  return text ? JSON.parse(text) : { anomaly_detected: false, reason: "" };
}
