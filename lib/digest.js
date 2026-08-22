import Anthropic from "@anthropic-ai/sdk";

function templateDigestSummary(competitor, diff) {
  const parts = diff
    .map((c) => {
      if (c.type === "price_changed") return `${c.plan_name} tier price changed from $${c.from} to $${c.to}`;
      if (c.type === "added") return `added a new "${c.plan_name}" tier`;
      if (c.type === "removed") return `removed the "${c.plan_name}" tier`;
      return null;
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join("; ")}.`;
}

async function aiDigestSummary(competitor, diff, apiKey) {
  const client = new Anthropic({ apiKey });
  const prompt = `Summarize this competitor pricing change in 1-2 plain-English sentences for a product manager. Be specific and concrete, no fluff, no preamble.

Competitor: ${competitor}
Changes: ${JSON.stringify(diff)}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 300,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text?.trim() || null;
}

/**
 * Turns a set of per-competitor diffs into digest entries. Uses the AI
 * toggle when available for a sharper sentence; falls back to a plain
 * template summary otherwise (or if the AI call fails) — same
 * never-block-on-AI principle as the monitor's second pass.
 */
export async function generateDigest(competitorDiffs, { aiEnabled = false, aiApiKey = null } = {}) {
  const entries = [];

  for (const { competitor, diff } of competitorDiffs) {
    if (!diff || diff.length === 0) continue;

    let summary = null;
    if (aiEnabled && aiApiKey) {
      try {
        summary = await aiDigestSummary(competitor, diff, aiApiKey);
      } catch {
        // fall through to template
      }
    }
    if (!summary) summary = templateDigestSummary(competitor, diff);
    if (summary) entries.push({ competitor, summary, diff });
  }

  return entries;
}
