import cron from "node-cron";
import { loadSchedules, loadCollectorsByCategory } from "../lib/collectorStore.js";
import { runCollectorForCompetitor } from "./services/pipeline.js";

const active = new Map(); // category -> scheduled cron task

/**
 * Per-category scheduling: a user schedules a whole segment ("check the
 * API-tools group every night"), and every collector in that category
 * runs on that cadence. Reads schedules.json and reconciles the live cron
 * tasks against it — call reloadSchedules() after any schedule change.
 */
export function reloadSchedules({ aiEnabled = false, aiApiKey = null } = {}) {
  const schedules = loadSchedules();

  // Drop tasks whose category no longer has a schedule.
  for (const [category, entry] of active) {
    if (!schedules[category]) {
      entry.task.stop();
      active.delete(category);
    }
  }

  for (const [category, expression] of Object.entries(schedules)) {
    if (!cron.validate(expression)) {
      console.error(`Skipping invalid cron for "${category}": ${expression}`);
      continue;
    }
    const existing = active.get(category);
    if (existing) {
      if (existing.expression === expression) continue; // unchanged
      existing.task.stop();
    }

    const task = cron.schedule(expression, async () => {
      const groups = loadCollectorsByCategory();
      const collectors = groups[category] || [];
      for (const c of collectors) {
        try {
          await runCollectorForCompetitor(c.name, { aiEnabled, aiApiKey });
        } catch (err) {
          console.error(`Scheduled run failed for ${c.name}:`, err.message);
        }
      }
    });

    active.set(category, { task, expression });
    console.log(`Scheduled category "${category}" @ ${expression}`);
  }
}
