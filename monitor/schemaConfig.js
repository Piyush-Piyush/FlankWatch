/**
 * Generic schema config for evaluateRun(). The rule engine is field-name
 * agnostic — swap this config to monitor a different kind of scraped page
 * (job listings, product catalogs) without touching monitor logic.
 */
export const PRICING_SCHEMA = {
  recordsPath: "pricing_tiers",
  minRecordCountRatio: 0.5,
  fields: {
    plan_name: { path: "plan_name", type: "string", required: true },
    price: { path: "price.value", type: "number", required: true },
    billing_period: { path: "billing_period", type: "string", required: true },
    features: { path: "features", type: "list", minItems: 1 },
  },
};
