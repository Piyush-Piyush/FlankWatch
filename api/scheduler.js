import cron from "node-cron";
import { loadSchedules, loadCollectorsByCategory } from "../lib/collectorStore.js";
import { runCollectorForCompetitor } from "./services/pipeline.js";
import { autoHealAndApprove } from "./services/healService.js";
import { isAiEnabled } from "../lib/aiState.js";
import { log, debugLog, logError } from "../lib/logger.js";

const active = new Map(); // category -> scheduled cron task

/**
 * Per-category scheduling: a user schedules a whole segment ("check the
 * API-tools group every night"), and every collector in that category
 * runs on that cadence. Reads schedules.json and reconciles the live cron
 * tasks against it — call reloadSchedules() after any schedule change.
 */
export function reloadSchedules({ aiApiKey = null } = {}) {
  const schedules = loadSchedules();
  debugLog("scheduler", "reloading schedules", schedules);

  // Drop tasks whose category no longer has a schedule.
  for (const [category, entry] of active) {
    if (!schedules[category]) {
      entry.task.stop();
      active.delete(category);
      log("scheduler", `unscheduled category "${category}"`);
    }
  }

  for (const [category, expression] of Object.entries(schedules)) {
    if (!cron.validate(expression)) {
      logError("scheduler", `skipping invalid cron for "${category}"`, new Error(expression));
      continue;
    }
    const existing = active.get(category);
    if (existing) {
      if (existing.expression === expression) continue; // unchanged
      existing.task.stop();
    }

    const task = cron.schedule(expression, async () => {
      // Read fresh on every tick, not captured from reloadSchedules()'s
      // closure — a long-running scheduler must see a `flank ai on/off`
      // toggle on its very next firing, not just after the next schedule
      // edit happens to re-run reloadSchedules().
      const aiEnabled = isAiEnabled();
      const groups = loadCollectorsByCategory();
      const collectors = groups[category] || [];
      log("scheduler", `firing for category "${category}"`, { competitorCount: collectors.length });
      for (const c of collectors) {
        try {
          const result = await runCollectorForCompetitor(c.name, { aiEnabled, aiApiKey });
          if (result.status !== "healthy") {
            // Fire-and-forget: heal+approve is multi-minute, don't block the
            // rest of this category's run on it.
            autoHealAndApprove(c.name, result.reasons, result.result, { aiEnabled, aiApiKey, diagnosis: result.diagnosis }).catch((err) =>
              logError("scheduler", `auto-heal failed for ${c.name}`, err)
            );
          }
        } catch (err) {
          logError("scheduler", `scheduled run failed for ${c.name}`, err);
        }
      }
    });

    active.set(category, { task, expression });
    log("scheduler", `scheduled category "${category}" @ ${expression}`);
  }
}
