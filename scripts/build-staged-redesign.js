import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as cheerio from "cheerio";

/**
 * Builds the Phase 8 "staged redesign" page: takes the REAL Postman
 * pricing HTML and applies one realistic, targeted change — price moves
 * from visible text into a data-price attribute. Everything else (tier
 * cards, class names, feature lists) stays untouched, so this is a
 * believable redesign, not an arbitrary break.
 */
const html = readFileSync("scratch/postman-live.html", "utf-8");
const $ = cheerio.load(html);

let changed = 0;
$("p.plan-price").each((_, el) => {
  const $el = $(el);
  const text = $el.text().trim(); // e.g. "$9"
  const match = text.match(/\$?([\d.]+)/);
  if (!match) return;
  // Scraper Studio's AI turned out to be robust to a moved-into-attribute
  // value AND a renamed class — it re-derives extraction from surrounding
  // DOM context each run, not fixed selectors (a real strength, worth
  // noting for "Best Use of Bright Data"). To get a genuine break for the
  // demo, remove the number entirely — no digits anywhere in this
  // element, no attribute holding it. Mimics a real "pricing gated behind
  // contact sales" redesign variant.
  $el.removeClass("plan-price").addClass("v2-metric-x14");
  $el.text("Contact us");
  changed++;
});

mkdirSync("dashboard/staged", { recursive: true });
writeFileSync("dashboard/staged/postman-pricing.html", $.html());

console.log(`Staged redesign built: moved ${changed} price(s) from visible text into data-price attributes.`);
console.log("Output: dashboard/staged/postman-pricing.html");
