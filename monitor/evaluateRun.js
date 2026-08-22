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
        `Expected ~${lastGoodRecords.length} records, got ${records.length} (below ${Math.round(schema.minRecordCountRatio * 100)}% of last known-good count)`
      );
    }
  } else if (records.length === 0) {
    reasons.push("No records extracted");
  }

  records.forEach((record, idx) => {
    for (const [fieldName, fieldSpec] of Object.entries(schema.fields)) {
      const value = getFieldValue(record, fieldSpec);

      if (fieldSpec.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          reasons.push(`Record ${idx} (${record.plan_name ?? "unknown"}): "${fieldName}" is not a valid number (got ${JSON.stringify(value)})`);
        }
      } else if (fieldSpec.type === "string") {
        if (fieldSpec.required && (typeof value !== "string" || value.trim() === "")) {
          reasons.push(`Record ${idx}: required field "${fieldName}" is missing or empty`);
        }
      } else if (fieldSpec.type === "list") {
        const minItems = fieldSpec.minItems || 0;
        if (!Array.isArray(value) || value.length < minItems) {
          reasons.push(`Record ${idx}: "${fieldName}" has ${Array.isArray(value) ? value.length : 0} items, expected at least ${minItems}`);
        }
      }
    }
  });

  if (lastGoodRecords && lastGoodRecords.length > 0 && records.length > 0) {
    const currentKeys = new Set(Object.keys(records[0]));
    const lastGoodKeys = new Set(Object.keys(lastGoodRecords[0]));
    const missingKeys = [...lastGoodKeys].filter((k) => !currentKeys.has(k));
    if (missingKeys.length > 0) {
      reasons.push(`Fields present in last known-good run but missing now: ${missingKeys.join(", ")}`);
    }
  }

  return { status: reasons.length > 0 ? "degraded" : "healthy", reasons };
}

export function generateDiagnosis(reasons) {
  if (reasons.length === 0) return "";
  return `Scrape output failed sanity checks: ${reasons.join("; ")}. Field structure may have changed.`;
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
