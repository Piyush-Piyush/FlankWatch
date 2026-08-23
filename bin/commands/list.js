import { loadCollectors, loadSchedules } from "../../lib/collectorStore.js";
import { listPendingCollectors } from "../../api/services/collectorService.js";
import { formatCompetitor } from "../lib/formatCompetitor.js";

function row(cols, widths) {
  return cols.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
}

const MAX_PENDING_ERROR_CHARS = 150;

/** bdata create/heal failures embed the full CLI transcript in .error — collapse to one short line for the table. */
function summarizeError(error) {
  if (!error) return "";
  const oneLine = error.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_PENDING_ERROR_CHARS ? `${oneLine.slice(0, MAX_PENDING_ERROR_CHARS - 3)}...` : oneLine;
}

export function listCommand(options) {
  const collectors = loadCollectors();
  const schedules = loadSchedules();
  const pending = listPendingCollectors();
  const competitors = Object.entries(collectors).map(([name, config]) => formatCompetitor(name, config));

  if (options.json) {
    console.log(JSON.stringify({ competitors, pending, schedules }, null, 2));
    return;
  }

  if (competitors.length === 0) {
    console.log("No competitors tracked yet. Add one with: flankwatch add <name> <url>");
  } else {
    const widths = [16, 20, 16, 12, 8, 8, 16, 24];
    console.log(row(["NAME", "COLLECTOR ID", "CATEGORY", "STATUS", "UPTIME", "STREAK", "OPEN HEAL", "LAST RUN"], widths));
    for (const c of competitors) {
      console.log(
        row(
          [
            c.name,
            c.collectorId,
            c.category,
            c.latestRun?.status ?? "no runs yet",
            c.resilience.uptimePct != null ? `${c.resilience.uptimePct}%` : "-",
            c.resilience.currentStreak,
            c.openHeal ? c.openHeal.status : "-",
            c.latestRun?.runTimestamp ?? "-",
          ],
          widths
        )
      );
    }
  }

  if (pending.length > 0) {
    console.log("\nPending builds:");
    for (const p of pending) {
      const error = summarizeError(p.error);
      console.log(`  #${p.id}  ${p.name}  ${p.status}${error ? `  (${error})` : ""}`);
    }
    console.log("  (full error text: flank list --json)");
  }

  const scheduleEntries = Object.entries(schedules);
  if (scheduleEntries.length > 0) {
    console.log("\nSchedules:");
    for (const [category, cron] of scheduleEntries) {
      console.log(`  ${category}: ${cron}`);
    }
  }
}
