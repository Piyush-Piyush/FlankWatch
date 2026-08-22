import cron from "node-cron";
import { setSchedule } from "../../lib/collectorStore.js";

export function scheduleCommand(category, cronExpression, options) {
  if (options.clear) {
    setSchedule(category, null);
    console.log(`Cleared the schedule for "${category}".`);
    return;
  }

  if (!cronExpression) {
    console.error("A cron expression is required (or pass --clear to remove the schedule).");
    process.exitCode = 1;
    return;
  }

  if (!cron.validate(cronExpression)) {
    console.error(`"${cronExpression}" is not a valid cron expression.`);
    process.exitCode = 1;
    return;
  }

  setSchedule(category, cronExpression);
  console.log(`Scheduled "${category}" @ ${cronExpression} — takes effect next time the dashboard server (re)starts.`);
}
