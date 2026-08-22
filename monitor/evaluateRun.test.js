import { test } from "node:test";
import assert from "node:assert/strict";
import { runRuleChecks } from "./evaluateRun.js";
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
  assert.ok(reasons.some((r) => r.includes("No records extracted")));
});

test("tier count drop vs last-known-good is flagged", () => {
  const broken = [{ pricing_tiers: [goodRun[0].pricing_tiers[0]] }];
  const { status, reasons } = runRuleChecks(broken, goodRun, PRICING_SCHEMA);
  assert.equal(status, "degraded");
  assert.ok(reasons.some((r) => r.includes("Expected ~4 records, got 1")));
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
