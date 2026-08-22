import { test } from "node:test";
import assert from "node:assert/strict";
import { runRuleChecks, generateDiagnosis, generateTemplateDiagnosis } from "./evaluateRun.js";
import { PRICING_SCHEMA } from "./schemaConfig.js";

const goodRun = [
  {
    pricing_tiers: [
      { plan_name: "Free", price: { value: 0 }, billing_period: "per month", features: ["a", "b", "c"] },
      { plan_name: "Solo", price: { value: 9 }, billing_period: "per month", features: ["a", "b", "c"] },
      { plan_name: "Team", price: { value: 19 }, billing_period: "per month", features: ["a", "b", "c"] },
      { plan_name: "Enterprise", price: { value: 49 }, billing_period: "per month", features: ["a", "b", "c"] },
    ],
  },
];

test("healthy run against itself produces no reasons", () => {
  const { status, reasons } = runRuleChecks(goodRun, goodRun, PRICING_SCHEMA);
  assert.equal(status, "healthy");
  assert.deepEqual(reasons, []);
});

test("first-ever run with no last-known-good still passes if data looks sane", () => {
  const { status } = runRuleChecks(goodRun, null, PRICING_SCHEMA);
  assert.equal(status, "healthy");
});

test("accepts a monthly/annual price split (different site, same schema)", () => {
  // A page that lists both cadences — the AI names them price_monthly /
  // price_annual instead of a single price. The any-of paths should accept it.
  const splitPrice = [
    {
      pricing_tiers: [
        { plan_name: "Creator", price_monthly: { value: 35 }, price_annual: { value: 24 }, features: ["a", "b"] },
        { plan_name: "Business", price_monthly: { value: 50 }, price_annual: { value: 40 }, features: ["a", "b"] },
      ],
    },
  ];
  const { status, reasons } = runRuleChecks(splitPrice, null, PRICING_SCHEMA);
  assert.equal(status, "healthy", reasons.join("; "));
});

test("empty tiers with no last-known-good is flagged", () => {
  const broken = [{ pricing_tiers: [] }];
  const { status, reasons } = runRuleChecks(broken, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("No pricing tiers were extracted")));
});

test("tier count drop vs last-known-good is flagged", () => {
  const broken = [{ pricing_tiers: [goodRun[0].pricing_tiers[0]] }];
  const { status, reasons } = runRuleChecks(broken, goodRun, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("Expected ~4 pricing tiers, got 1")));
});

test("null price is flagged", () => {
  const broken = [
    {
      pricing_tiers: [{ plan_name: "Free", price: { value: null }, billing_period: "per month", features: ["a"] }],
    },
  ];
  const { status, reasons } = runRuleChecks(broken, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("price")));
});

test("a $0 price appearing AFTER a paid tier is flagged as suspicious", () => {
  // Empirically observed: a heal can "fix" a missing price into a
  // technically-valid-but-wrong $0 (e.g. Enterprise, positioned after paid
  // tiers). Positional, not name-based — real free tiers are named all
  // sorts of things ("Essentials", "Starter"), so guessing off the name
  // is unreliable, but a $0 appearing after an already-paid tier isn't.
  const suspicious = [
    {
      pricing_tiers: [
        { plan_name: "Solo", price: { value: 9 }, features: ["a"] },
        { plan_name: "Enterprise", price: { value: 0 }, features: ["a"] },
      ],
    },
  ];
  const { status, reasons } = runRuleChecks(suspicious, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("$0") && r.includes("Enterprise")));
});

test("a $0 price on the first tier (typical free tier) is NOT flagged, whatever it's named", () => {
  // Mirrors a real case: Insomnia's actual free tier is named "Essentials",
  // not "Free" — name-guessing would get this wrong.
  const fine = [
    {
      pricing_tiers: [
        { plan_name: "Essentials", price: { value: 0 }, features: ["a"] },
        { plan_name: "Pro", price: { value: 12 }, features: ["a"] },
      ],
    },
  ];
  const { status, reasons } = runRuleChecks(fine, null, PRICING_SCHEMA);
  assert.equal(status, "healthy", reasons.join("; "));
});

test("numeric-string prices are coerced and accepted (different site, string shape)", () => {
  // Insomnia's scraper returned price_value as a string ("0", "12", "45"),
  // not a number under price.value. Real numeric strings should coerce;
  // non-numeric text like "Contact us" must NOT.
  const stringPrices = [
    { pricing_tiers: [{ plan_name: "Essentials", price_value: "0", features: ["a"] }, { plan_name: "Pro", price_value: "12", features: ["a"] }] },
  ];
  const { status, reasons } = runRuleChecks(stringPrices, null, PRICING_SCHEMA);
  assert.equal(status, "healthy", reasons.join("; "));
});

test("non-numeric price text is still a failure, not silently coerced", () => {
  const textPrice = [{ pricing_tiers: [{ plan_name: "Enterprise", price_value: "Contact us", features: ["a"] }] }];
  const { status, reasons } = runRuleChecks(textPrice, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("Enterprise") && r.includes("no numeric price")));
});

test("missing price across many tiers groups into one sentence, staying under the heal CLI's 1000-char limit", () => {
  // A page with several tiers all missing a price used to repeat a full
  // paragraph per tier and blow past bdata scraper heal's 1000-char cap,
  // landing the collector in needs_review before ever reaching Bright Data.
  const manyBroken = [
    {
      pricing_tiers: [
        { plan_name: "Essentials", features: ["a"] },
        { plan_name: "Pro 15% savings", features: ["a"] },
        { plan_name: "Enterprise", features: ["a"] },
        { plan_name: "Team", features: ["a"] },
        { plan_name: "Business", features: ["a"] },
      ],
    },
  ];
  const { status, reasons } = runRuleChecks(manyBroken, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  const diagnosis = generateTemplateDiagnosis(reasons);
  assert.ok(diagnosis.length <= 1000, `diagnosis was ${diagnosis.length} chars`);
  assert.ok(diagnosis.includes("Essentials") && diagnosis.includes("Enterprise"));
});

test("generateDiagnosis falls back to the template when AI is disabled (no network call, no key needed)", async () => {
  const { reasons } = runRuleChecks([{ pricing_tiers: [] }], null, PRICING_SCHEMA);
  const diagnosis = await generateDiagnosis(reasons, { aiEnabled: false });
  assert.equal(diagnosis, generateTemplateDiagnosis(reasons));
});

test("generateDiagnosis falls back to the template if aiEnabled but no rawResult given", async () => {
  const { reasons } = runRuleChecks([{ pricing_tiers: [] }], null, PRICING_SCHEMA);
  const diagnosis = await generateDiagnosis(reasons, { aiEnabled: true, aiApiKey: "fake-key" });
  assert.equal(diagnosis, generateTemplateDiagnosis(reasons));
});

test("empty feature list is flagged", () => {
  const broken = [
    {
      pricing_tiers: [{ plan_name: "Free", price: { value: 0 }, billing_period: "per month", features: [] }],
    },
  ];
  const { status, reasons } = runRuleChecks(broken, null, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("features")));
});

test("missing field vs last-known-good (schema drift) is flagged", () => {
  const drifted = [
    {
      pricing_tiers: [{ plan_name: "Free", price: { value: 0 }, features: ["a"] }], // billing_period key dropped entirely
    },
  ];
  const { status, reasons } = runRuleChecks(drifted, goodRun, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("billing_period") || r.includes("missing")));
});
