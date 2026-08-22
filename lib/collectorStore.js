import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTORS_PATH = path.join(__dirname, "..", "collectors", "collectors.json");
const SCHEDULES_PATH = path.join(__dirname, "..", "collectors", "schedules.json");

/**
 * Single source of truth for the collector registry and per-category
 * schedules. Everything that used to read collectors.json directly now
 * goes through here — one place that knows the file shape, and the only
 * place that writes it (on-demand collector creation appends here).
 *
 * A collector entry:
 *   { url, collector_id, description, category, status, created_at }
 * `category` groups collectors into segments a user compares together
 * (e.g. "API tools", "Video editing", "Smartphones").
 */

export function loadCollectors() {
  if (!existsSync(COLLECTORS_PATH)) return {};
  return JSON.parse(readFileSync(COLLECTORS_PATH, "utf-8"));
}

export function getCollector(name) {
  const collectors = loadCollectors();
  const entry = collectors[name];
  if (!entry) throw new Error(`Unknown competitor: ${name}`);
  return entry;
}

export function addCollector(name, entry) {
  const collectors = loadCollectors();
  if (collectors[name]) throw new Error(`Competitor "${name}" already exists`);
  collectors[name] = {
    url: entry.url,
    collector_id: entry.collector_id,
    description: entry.description || "",
    category: entry.category || "Uncategorized",
    status: entry.status || "verified",
    created_at: new Date().toISOString(),
  };
  writeFileSync(COLLECTORS_PATH, JSON.stringify(collectors, null, 2) + "\n");
  return collectors[name];
}

/**
 * Removes a collector from the registry. Returns the removed entry (so the
 * caller knows its category, to check whether that category is now empty)
 * or null if it didn't exist. Note: this only stops FlankWatch tracking
 * it — Bright Data doesn't expose programmatic deletion of the scraper
 * template itself, so the collector still exists on their side.
 */
export function removeCollector(name) {
  const collectors = loadCollectors();
  const entry = collectors[name];
  if (!entry) return null;
  delete collectors[name];
  writeFileSync(COLLECTORS_PATH, JSON.stringify(collectors, null, 2) + "\n");
  return entry;
}

/** Unique category names currently in use, sorted — for populating the "add competitor" group picker. */
export function listCategories() {
  const collectors = loadCollectors();
  return [...new Set(Object.values(collectors).map((c) => c.category || "Uncategorized"))].sort();
}

/** Returns collectors grouped by category, in a stable, display-friendly shape. */
export function loadCollectorsByCategory() {
  const collectors = loadCollectors();
  const groups = {};
  for (const [name, entry] of Object.entries(collectors)) {
    const category = entry.category || "Uncategorized";
    (groups[category] ||= []).push({ name, ...entry });
  }
  return groups;
}

export function loadSchedules() {
  if (!existsSync(SCHEDULES_PATH)) return {};
  return JSON.parse(readFileSync(SCHEDULES_PATH, "utf-8"));
}

/** Store (or clear, with cron=null) a cron expression for a whole category. */
export function setSchedule(category, cron) {
  const schedules = loadSchedules();
  if (cron) schedules[category] = cron;
  else delete schedules[category];
  writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2) + "\n");
  return schedules;
}
