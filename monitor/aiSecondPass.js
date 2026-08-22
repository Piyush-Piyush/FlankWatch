import Anthropic from "@anthropic-ai/sdk";

const ANOMALY_SCHEMA = {
  type: "object",
  properties: {
    anomaly_detected: {
      type: "boolean",
      description: "true if the data looks subtly wrong despite passing field-level checks",
    },
    reason: {
      type: "string",
      description: "short explanation; empty string if no anomaly",
    },
  },
  required: ["anomaly_detected", "reason"],
  additionalProperties: false,
};

/**
 * Advisory-only anomaly check. Looks for problems the rule engine's
 * field-type checks can't catch — e.g. a price that parses as a number
 * but is clearly wrong, garbled feature text, a placeholder-looking plan
 * name. Called only when the rule verdict is already "healthy".
 */
export async function aiSecondPass(currentResult, apiKey) {
  const client = new Anthropic({ apiKey });

  const prompt = `You are reviewing scraped competitor pricing data for subtle extraction errors that automated field-type checks would miss (e.g. a price field that technically parses as a number but is clearly wrong, garbled or truncated feature text, a plan name that looks like placeholder/boilerplate text rather than a real plan name).

Data:
${JSON.stringify(currentResult, null, 2)}

Does this data show signs of a subtle extraction problem?`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 512,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANOMALY_SCHEMA },
    },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? JSON.parse(textBlock.text) : { anomaly_detected: false, reason: "" };
}
