import { aiSecondPass } from "./aiSecondPass.js";

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// A field may declare a single `path` or several `paths` (any-of). Returns
// the first defined value across the candidate paths — lets one schema
// accept the same fact under different key shapes across sites.
function getFieldValue(record, fieldSpec) {
  const candidates = fieldSpec.paths || [fieldSpec.path];
  for (const p of candidates) {
    const v = getPath(record, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function unwrap(result) {
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Deterministic sanity checks against a schema config. This is the floor —
 * it always runs, never depends on network/API availability, and alone is
 * enough to drive the heal loop.
 */
export function runRuleChecks(current, lastKnownGood, schema) {
  const reasons = [];
  const currentRoot = unwrap(current);
  const lastGoodRoot = lastKnownGood ? unwrap(lastKnownGood) : null;

  const records = getPath(currentRoot, schema.recordsPath) || [];
  const lastGoodRecords = lastGoodRoot ? getPath(lastGoodRoot, schema.recordsPath) || [] : null;

  if (lastGoodRecords && lastGoodRecords.length > 0) {
    const ratio = records.length / lastGoodRecords.length;
    if (ratio < schema.minRecordCountRatio) {
      reasons.push(
        `Expected ~${lastGoodRecords.length} pricing tiers, got ${records.length} — the page's list of plan cards may have been restructured. Re-examine the page and find every plan/tier card currently there.`
      );
    }
  } else if (records.length === 0) {
    reasons.push(
      "No pricing tiers were extracted at all — the repeating plan-card container likely changed. Find the current markup for the list of pricing plans."
    );
  }

  // Reason text below is written for an AI that will re-visit the live page
  // to fix a scraper — a hypothesis about what's on the page and what to
  // capture, not a JSON-validation complaint. Vague reasons ("not a valid
  // number") produce heals that change nothing, since there's no concrete
  // page-content hint to act on.
  records.forEach((record, idx) => {
    const label = record.plan_name ? `"${record.plan_name}" tier` : `tier ${idx}`;

    for (const [fieldName, fieldSpec] of Object.entries(schema.fields)) {
      const value = getFieldValue(record, fieldSpec);

      if (fieldSpec.type === "number") {
        const isPriceField = fieldName.toLowerCase().includes("price");

        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          if (isPriceField) {
            reasons.push(
              `The ${label} has no numeric price. If this tier displays non-numeric pricing text instead of a dollar amount ` +
                `(e.g. "Contact us", "Custom", "Talk to sales"), capture that text in a dedicated field (e.g. price_text) rather ` +
                `than leaving the tier without a price. Otherwise, the price element's location or markup for this tier may have changed.`
            );
          } else {
            reasons.push(`The ${label}'s "${fieldName}" field did not parse as a number (got ${JSON.stringify(value)}) — its markup or position on the page may have changed.`);
          }
        } else if (isPriceField && value === 0 && !/free|trial/i.test(record.plan_name || "")) {
          // A $0 price technically satisfies "is it a number", but $0 on a
          // tier not named Free/Trial is almost always a mis-extraction
          // (commonly the price element was misread as empty and defaulted
          // to 0), not a real price. Caught this empirically: a heal on
          // Descript's Enterprise tier "fixed" a missing price into a $0
          // that passed validation but was clearly wrong.
          reasons.push(
            `The ${label} shows a $0 price, which is unusual for a tier not named "Free" — this likely means the price wasn't ` +
              `really found and defaulted to zero. If this tier uses custom/contact pricing, capture that as text instead of $0.`
          );
        }
      } else if (fieldSpec.type === "string") {
        if (fieldSpec.required && (typeof value !== "string" || value.trim() === "")) {
          reasons.push(`The ${label} is missing its required "${fieldName}" — check whether this field moved to a different element or attribute for this tier.`);
        }
      } else if (fieldSpec.type === "list") {
        const minItems = fieldSpec.minItems || 0;
        if (!Array.isArray(value) || value.length < minItems) {
          reasons.push(
            `The ${label} has no "${fieldName}" items (expected at least ${minItems}). Check whether this tier's list markup differs from ` +
              `the other tiers — e.g. nested differently, hidden behind a toggle, or a different HTML structure.`
          );
        }
      }
    }
  });

  if (lastGoodRecords && lastGoodRecords.length > 0 && records.length > 0) {
    const currentKeys = new Set(Object.keys(records[0]));
    const lastGoodKeys = new Set(Object.keys(lastGoodRecords[0]));
    const missingKeys = [...lastGoodKeys].filter((k) => !currentKeys.has(k));
    if (missingKeys.length > 0) {
      reasons.push(`These fields were present in the last successful run but are missing now: ${missingKeys.join(", ")} — the page structure for them likely changed.`);
    }
  }

  return { status: reasons.length > 0 ? "degraded" : "healthy", reasons };
}

export function generateDiagnosis(reasons) {
  if (reasons.length === 0) return "";
  // Each reason is already a full, actionable sentence (see runRuleChecks) —
  // join as a short list rather than folding into one run-on clause.
  return reasons.join(" ");
}

/**
 * Rule checks always run first and are authoritative. The AI pass is
 * advisory and one-directional: it can only escalate a "healthy" rule
 * verdict to "degraded" if it spots something the rules missed — it can
 * never downgrade a rule-flagged "degraded" back to "healthy", and any
 * failure (network, bad key, malformed response) silently falls back to
 * the rule verdict rather than blocking the pipeline.
 */
export async function evaluateRun(current, lastKnownGood, { schema, aiEnabled = false, aiApiKey = null } = {}) {
  const ruleVerdict = runRuleChecks(current, lastKnownGood, schema);

  if (ruleVerdict.status === "degraded" || !aiEnabled || !aiApiKey) {
    return ruleVerdict;
  }

  try {
    const aiVerdict = await aiSecondPass(current, aiApiKey);
    if (aiVerdict.anomaly_detected) {
      return {
        status: "degraded",
        reasons: [...ruleVerdict.reasons, `AI review: ${aiVerdict.reason}`],
      };
    }
  } catch {
    // AI advisory pass failing must never block the rule-based verdict.
  }

  return ruleVerdict;
}
