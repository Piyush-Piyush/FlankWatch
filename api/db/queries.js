import { db } from "./index.js";

export function getLatestRun(competitor) {
  return db.prepare("SELECT * FROM runs WHERE competitor = ? ORDER BY run_timestamp DESC LIMIT 1").get(competitor);
}

export function getPreviousHealthyRun(competitor, beforeTimestamp) {
  return db
    .prepare("SELECT * FROM runs WHERE competitor = ? AND status = 'healthy' AND run_timestamp < ? ORDER BY run_timestamp DESC LIMIT 1")
    .get(competitor, beforeTimestamp);
}

const OPEN_HEAL_STATUSES = ["healing", "awaiting_approval", "approving", "rejecting", "needs_review"];

export function getOpenHeal(competitor) {
  const placeholders = OPEN_HEAL_STATUSES.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM heals WHERE competitor = ? AND status IN (${placeholders}) ORDER BY triggered_at DESC LIMIT 1`)
    .get(competitor, ...OPEN_HEAL_STATUSES);
}

export function getRecentHeals(limit = 50) {
  return db.prepare("SELECT * FROM heals ORDER BY triggered_at DESC LIMIT ?").all(limit);
}

export function getResilienceStats(competitor) {
  const totals = db
    .prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='healthy' THEN 1 ELSE 0 END) as healthy FROM runs WHERE competitor = ?")
    .get(competitor);
  const healCount = db.prepare("SELECT COUNT(*) as count FROM heals WHERE competitor = ?").get(competitor).count;
  const avgRecoveryRow = db
    .prepare(
      "SELECT AVG((julianday(approved_at) - julianday(triggered_at)) * 86400) as avgSeconds FROM heals WHERE competitor = ? AND status = 'done' AND approved_at IS NOT NULL"
    )
    .get(competitor);

  const recentRuns = db.prepare("SELECT status FROM runs WHERE competitor = ? ORDER BY run_timestamp DESC").all(competitor);
  let currentStreak = 0;
  for (const r of recentRuns) {
    if (r.status === "healthy") currentStreak++;
    else break;
  }

  return {
    uptimePct: totals.total > 0 ? Math.round((totals.healthy / totals.total) * 1000) / 10 : null,
    totalRuns: totals.total,
    healCount,
    avgRecoverySeconds: avgRecoveryRow.avgSeconds != null ? Math.round(avgRecoveryRow.avgSeconds) : null,
    currentStreak,
  };
}
