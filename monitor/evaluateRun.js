import { aiSecondPass } from "./aiSecondPass.js";
import { generateAiDiagnosis } from "../lib/aiDiagnosis.js";
import { debugLog, logError } from "../lib/logger.js";

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

// Different scrapers return numbers as actual numbers or as numeric
// strings ("12", "0") depending on the site. Coerce only unambiguous
// numeric strings — never coerce non-numeric text like "Contact us" or
// "Custom", which must stay a failure so it gets caught and healed.
function toNumberIfNumeric(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return value;
}

// A price that isn't a number isn't automatically broken — a genuinely
// free tier ("Free", "No cost") or a custom/contact-sales tier are both
// real, valid states a pricing page can be in. This is the other half of
// the instruction the diagnosis text already gives healers ("capture that
// text in a dedicated field like price_text") — without this check, even
// a perfect heal that follows that instruction could never pass, because
// nothing ever recognized the result as valid. Keep the pattern narrow
// (exact free-tier phrases only) — anything else genuinely non-numeric
// still needs a human-readable price_text field to count as resolved,
// rather than accepting arbitrary text as "close enough".
const FREE_TIER_TEXT = /^(free|no cost|complimentary)$/i;
const PRICE_TEXT_FIELD_CANDIDATES = ["price_text", "price_note", "pricing_note"];

function isRecognizedNonNumericPrice(record, rawValue) {
  if (typeof rawValue === "string" && FREE_TIER_TEXT.test(rawValue.trim())) return true;
  return PRICE_TEXT_FIELD_CANDIDATES.some((key) => typeof record[key] === "string" && record[key].trim() !== "");
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
  //
  // Per-field failures that can repeat across many tiers (missing price,
  // suspicious $0) are collected here and rendered as ONE grouped sentence
  // naming every affected tier, instead of repeating a full paragraph per
  // tier — a page with 4 tiers all missing a price used to produce a
  // diagnosis over 1000 chars, which the heal CLI rejects outright before
  // ever reaching Bright Data.
  const missingPriceTiers = [];
  const zeroPriceTiers = [];
  let sawNonZeroPrice = false;

  records.forEach((record, idx) => {
    const label = record.plan_name ? `"${record.plan_name}"` : `tier ${idx}`;

    for (const [fieldName, fieldSpec] of Object.entries(schema.fields)) {
      const rawValue = getFieldValue(record, fieldSpec);
      const value = fieldSpec.type === "number" ? toNumberIfNumeric(rawValue) : rawValue;

      if (fieldSpec.type === "number") {
        const isPriceField = fieldName.toLowerCase().includes("price");
        const isValid = typeof value === "number" && Number.isFinite(value) && value >= 0;

        if (!isValid) {
          if (isPriceField) {
            if (!isRecognizedNonNumericPrice(record, rawValue)) {
              missingPriceTiers.push(label);
            }
          } else {
            reasons.push(`The ${label} tier's "${fieldName}" field did not parse as a number (got ${JSON.stringify(rawValue)}) — its markup or position on the page may have changed.`);
          }
        } else if (isPriceField) {
          if (value === 0 && sawNonZeroPrice) {
            // A $0 price technically satisfies "is it a number", but a tier
            // priced at $0 *after* other tiers already showed a real price
            // is almost always a mis-extraction (the real value wasn't
            // found and defaulted to zero) — pricing pages are conventionally
            // ordered cheapest-first, so a free tier belongs at the start,
            // not appearing after paid ones. Positional, not name-based:
            // empirically, real free tiers are named all sorts of things
            // ("Essentials", "Starter", "Community"), so guessing off the
            // name is unreliable — but seeing $0 *after* a paid tier isn't.
            zeroPriceTiers.push(label);
          } else if (value > 0) {
            sawNonZeroPrice = true;
          }
        }
      } else if (fieldSpec.type === "string") {
        if (fieldSpec.required && (typeof value !== "string" || value.trim() === "")) {
          reasons.push(`The ${label} tier is missing its required "${fieldName}" — check whether this field moved to a different element or attribute for this tier.`);
        }
      } else if (fieldSpec.type === "list") {
        const minItems = fieldSpec.minItems || 0;
        if (!Array.isArray(value) || value.length < minItems) {
          reasons.push(
            `The ${label} tier has no "${fieldName}" items (expected at least ${minItems}). Check whether this tier's list markup differs from ` +
              `the other tiers — e.g. nested differently, hidden behind a toggle, or a different HTML structure.`
          );
        }
      }
    }
  });

  if (missingPriceTiers.length > 0) {
    reasons.push(
      `These tiers have no numeric price: ${missingPriceTiers.join(", ")}. If any of them displays non-numeric pricing text instead of a ` +
        `dollar amount (e.g. "Contact us", "Custom", "Talk to sales"), capture that text in a dedicated field (e.g. price_text) for that ` +
        `tier rather than leaving it without a price. Otherwise, the price element's location or markup may have changed for these tiers.`
    );
  }
  if (zeroPriceTiers.length > 0) {
    reasons.push(
      `These tiers show a $0 price after another tier already showed a real price: ${zeroPriceTiers.join(", ")}. Pricing pages are usually ` +
        `ordered cheapest-first, so a $0 value appearing after a paid tier likely means the real price wasn't found and defaulted to zero. ` +
        `If any of these use custom/contact pricing, capture that as text instead of $0.`
    );
  }

  const verdict = { status: reasons.length > 0 ? "degraded" : "healthy", reasons };
  debugLog("evaluate", `rule check verdict: ${verdict.status}`, reasons.length ? { reasonCount: reasons.length } : undefined);
  return verdict;
}

const AI_SECOND_PASS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const lastAiSecondPassAt = new Map(); // competitor -> timestamp, in-process only

const AI_DIAGNOSIS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const lastAiDiagnosisAt = new Map(); // competitor -> timestamp, in-process only

const HEAL_PROMPT_MAX_CHARS = 1000; // bdata scraper heal's own hard limit

/**
 * Deterministic template diagnosis — the floor, always available, no
 * network dependency. Reasons are already full sentences (see
 * runRuleChecks); join and defensively cap at the CLI's prompt limit.
 */
export function generateTemplateDiagnosis(reasons) {
  if (reasons.length === 0) return "";
  const full = reasons.join(" ");
  if (full.length <= HEAL_PROMPT_MAX_CHARS) return full;

  // Defensive cap: even with grouping, enough distinct issues could still
  // exceed the CLI's limit. Truncating silently here (at a word boundary)
  // beats the alternative we hit in practice — the heal call rejecting the
  // whole diagnosis outright and landing the collector in needs_review
  // with nothing sent to Bright Data at all.
  const cut = full.slice(0, HEAL_PROMPT_MAX_CHARS - 3).replace(/\s+\S*$/, "");
  return `${cut}...`;
}

/**
 * Writes the heal prompt. Same one-way-advisory discipline as the AI
 * second pass: an AI-written diagnosis is used only when it succeeds and
 * there's raw data to give it context — any failure (disabled, no key,
 * network, bad response) falls straight back to the deterministic
 * template. A heal must never be blocked on the AI diagnosis writer.
 *
 * Same cooldown reasoning as the second pass: a competitor stuck degraded
 * (especially past the auto-heal retry cap, where this diagnosis text
 * never even gets used) shouldn't cost a fresh Gemini call on every single
 * scheduled tick. `competitor` is optional and only used for this cooldown
 * key — omitting it just means every call runs uncooled.
 */
export async function generateDiagnosis(reasons, { rawResult, aiEnabled = false, aiApiKey = null, competitor = null } = {}) {
  if (reasons.length === 0) return "";

  let withinCooldown = false;
  if (competitor) {
    const lastCalledAt = lastAiDiagnosisAt.get(competitor);
    withinCooldown = Boolean(lastCalledAt && Date.now() - lastCalledAt < AI_DIAGNOSIS_COOLDOWN_MS);
  }

  if (aiEnabled && aiApiKey && rawResult && !withinCooldown) {
    if (competitor) lastAiDiagnosisAt.set(competitor, Date.now());
    debugLog("evaluate", "requesting AI-written diagnosis from Gemini");
    try {
      const diagnosis = await generateAiDiagnosis(reasons, rawResult, aiApiKey);
      debugLog("evaluate", `AI diagnosis generated (${diagnosis.length} chars)`);
      return diagnosis;
    } catch (err) {
      logError("evaluate", "AI diagnosis generation failed, falling back to template", err);
      // fall through to the template — never block a heal on AI availability
    }
  } else {
    debugLog("evaluate", withinCooldown ? `AI diagnosis skipped for ${competitor} — cooldown active, using template` : "AI diagnosis skipped (disabled, no key, or no raw result) — using template");
  }

  return generateTemplateDiagnosis(reasons);
}

/**
 * Rule checks always run first and are authoritative. The AI pass is
 * advisory and one-directional: it can only escalate a "healthy" rule
 * verdict to "degraded" if it spots something the rules missed — it can
 * never downgrade a rule-flagged "degraded" back to "healthy", and any
 * failure (network, bad key, malformed response) silently falls back to
 * the rule verdict rather than blocking the pipeline.
 *
 * Cooldown: this pass has no correctness reason to run more than once
 * every few minutes for the same competitor — a tight run schedule
 * (testing, or just an aggressive cron) would otherwise call Gemini on
 * every single tick even when nothing changed, burning free-tier quota
 * for no benefit. `competitor` is optional and only used for this
 * cooldown key; omitting it just means every call runs uncooled.
 */
export async function evaluateRun(current, lastKnownGood, { schema, aiEnabled = false, aiApiKey = null, competitor = null } = {}) {
  const ruleVerdict = runRuleChecks(current, lastKnownGood, schema);

  if (ruleVerdict.status === "degraded" || !aiEnabled || !aiApiKey) {
    return ruleVerdict;
  }

  if (competitor) {
    const lastCalledAt = lastAiSecondPassAt.get(competitor);
    if (lastCalledAt && Date.now() - lastCalledAt < AI_SECOND_PASS_COOLDOWN_MS) {
      debugLog("evaluate", `AI second pass skipped for ${competitor} — cooldown active (last call ${Math.round((Date.now() - lastCalledAt) / 1000)}s ago)`);
      return ruleVerdict;
    }
    lastAiSecondPassAt.set(competitor, Date.now());
  }

  debugLog("evaluate", "rules say healthy — running AI second pass (Gemini) for a subtler check");
  try {
    const aiVerdict = await aiSecondPass(current, aiApiKey);
    if (aiVerdict.anomaly_detected) {
      debugLog("evaluate", `AI second pass escalated to degraded: ${aiVerdict.reason}`);
      return {
        status: "degraded",
        reasons: [...ruleVerdict.reasons, `AI review: ${aiVerdict.reason}`],
      };
    }
    debugLog("evaluate", "AI second pass found nothing — staying healthy");
  } catch (err) {
    logError("evaluate", "AI second pass failed, keeping rule verdict", err);
    // AI advisory pass failing must never block the rule-based verdict.
  }

  return ruleVerdict;
}
