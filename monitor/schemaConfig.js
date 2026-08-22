/**
 * Generic schema config for evaluateRun(). The rule engine is field-name
 * agnostic — swap this config to monitor a different kind of scraped page
 * (job listings, product catalogs) without touching monitor logic.
 *
 * A field with `paths` (plural) passes if ANY candidate path yields a
 * valid value. Different pricing pages structure the same fact
 * differently — a single `price`, or a monthly/annual split — and a
 * scraper the AI built for one site shouldn't be judged against another
 * site's exact key names. `billing_period` is intentionally not required:
 * some pages omit it on free tiers.
 */
export const PRICING_SCHEMA = {
  recordsPath: "pricing_tiers",
  minRecordCountRatio: 0.5,
  fields: {
    plan_name: { path: "plan_name", type: "string", required: true },
    price: {
      paths: ["price.value", "price_monthly.value", "price_annual.value", "price_value", "price"],
      type: "number",
      required: true,
    },
    features: { path: "features", type: "list", minItems: 1 },
  },
};
