import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCollectorForCompetitor } from "./services/pipeline.js";
import { insertPendingHeal, runHealJob, markHealPending, runApproveJob, dismissHeal } from "./services/healService.js";
import { startCollectorCreation, runCreateJob, listPendingCollectors, dismissPending } from "./services/collectorService.js";
import { getLatestRun, getPreviousHealthyRun, getOpenHeal, getRecentHeals, getResilienceStats } from "./db/queries.js";
import { loadCollectors, loadSchedules, setSchedule } from "../lib/collectorStore.js";
import { reloadSchedules } from "./scheduler.js";
import { diffPricingRuns } from "../lib/diffPricing.js";
import { generateDigest } from "../lib/digest.js";
import { generateDiagnosis } from "../monitor/evaluateRun.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.join(__dirname, "..", "dashboard");

const app = express();
app.use(express.json());
app.use(express.static(DASHBOARD_DIR));

const aiEnabled = process.env.AI_ENABLED === "true";
const aiApiKey = process.env.ANTHROPIC_API_KEY || null;

function buildCompetitor(name, config) {
  const latestRun = getLatestRun(name);
  const previousGood = latestRun ? getPreviousHealthyRun(name, latestRun.run_timestamp) : null;
  const openHeal = getOpenHeal(name);

  return {
    name,
    url: config.url,
    category: config.category || "Uncategorized",
    collectorId: config.collector_id,
    latestRun: latestRun
      ? {
          status: latestRun.status,
          reasons: JSON.parse(latestRun.reasons || "[]"),
          runTimestamp: latestRun.run_timestamp,
          result: JSON.parse(latestRun.raw_json),
        }
      : null,
    diff: latestRun && previousGood ? diffPricingRuns(JSON.parse(latestRun.raw_json), JSON.parse(previousGood.raw_json)) : [],
    openHeal: openHeal
      ? { id: openHeal.id, diagnosis: openHeal.diagnosis, previewResult: JSON.parse(openHeal.preview_result || "null"), status: openHeal.status }
      : null,
    resilience: getResilienceStats(name),
  };
}

app.get("/api/competitors", (req, res) => {
  const collectors = loadCollectors();
  const competitors = Object.entries(collectors).map(([name, config]) => buildCompetitor(name, config));
  const schedules = loadSchedules();
  const pending = listPendingCollectors().map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    category: p.category,
    status: p.status,
    error: p.error,
    requestedAt: p.requested_at,
  }));

  res.json({ competitors, pending, schedules, aiEnabled });
});

app.get("/api/digest", async (req, res) => {
  try {
    const collectors = loadCollectors();
    const competitorDiffs = [];

    for (const name of Object.keys(collectors)) {
      const latestRun = getLatestRun(name);
      if (!latestRun) continue;
      const previousGood = getPreviousHealthyRun(name, latestRun.run_timestamp);
      if (!previousGood) continue;
      const diff = diffPricingRuns(JSON.parse(latestRun.raw_json), JSON.parse(previousGood.raw_json));
      competitorDiffs.push({ competitor: name, diff });
    }

    const digest = await generateDigest(competitorDiffs, { aiEnabled, aiApiKey });
    res.json({ digest });
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

app.get("/api/heals", (req, res) => {
  const heals = getRecentHeals(50).map((h) => ({
    ...h,
    preview_result: h.preview_result ? JSON.parse(h.preview_result) : null,
  }));
  res.json({ heals });
});

app.post("/api/competitors/:name/run", async (req, res) => {
  try {
    const result = await runCollectorForCompetitor(req.params.name, { aiEnabled, aiApiKey, url: req.body?.url });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// Heal and approve kick off multi-minute Bright Data AI-Flow jobs, so both
// respond immediately with a pending state and finish the work in the
// background — the dashboard polls /api/competitors for the result.
app.post("/api/competitors/:name/heal", (req, res) => {
  try {
    const competitor = req.params.name;
    const latestRun = getLatestRun(competitor);
    const reasons = latestRun ? JSON.parse(latestRun.reasons || "[]") : [];
    const diagnosis = req.body?.diagnosis || generateDiagnosis(reasons) || null;
    if (!diagnosis) {
      res.status(400).json({ error: "diagnosis is required (no degraded reasons on file to auto-generate one)" });
      return;
    }

    const healId = insertPendingHeal(competitor, diagnosis);
    res.status(202).json({ healId, status: "healing" });
    runHealJob(healId, competitor, diagnosis).catch((err) => console.error(`heal job ${healId} failed:`, err));
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

app.post("/api/competitors/:name/approve", (req, res) => {
  try {
    const competitor = req.params.name;
    const reject = Boolean(req.body?.reject);
    const heal = markHealPending(competitor, { reject });
    res.status(202).json({ healId: heal.id, status: reject ? "rejecting" : "approving" });
    runApproveJob(heal.id, competitor, { reject }).catch((err) => console.error(`approve job ${heal.id} failed:`, err));
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// Clears a stuck needs_review heal so the card stops blocking on it —
// the row stays in the heal log (status "dismissed"), just no longer
// counted as "open".
app.post("/api/competitors/:name/dismiss-heal", (req, res) => {
  try {
    dismissHeal(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

// On-demand collector build. Like heal, `bdata scraper create` is a
// multi-minute AI-Flow job, so this returns a pending state immediately and
// finishes in the background; the dashboard polls /api/competitors.
app.post("/api/collectors", (req, res) => {
  try {
    const { name, url, category, description } = req.body || {};
    const { pendingId, name: slug } = startCollectorCreation({ name, url, category, description });
    res.status(202).json({ pendingId, name: slug, status: "creating" });
    runCreateJob(pendingId).catch((err) => console.error(`create job ${pendingId} failed:`, err));
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

app.delete("/api/collectors/pending/:id", (req, res) => {
  dismissPending(Number(req.params.id));
  res.json({ ok: true });
});

// Per-category schedule. Body: { cron: "0 9 * * *" } to set, { cron: null } to clear.
app.put("/api/schedules/:category", (req, res) => {
  try {
    const schedules = setSchedule(req.params.category, req.body?.cron || null);
    reloadSchedules({ aiEnabled, aiApiKey });
    res.json({ schedules });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FlankWatch dashboard running at http://localhost:${PORT}`);
  reloadSchedules({ aiEnabled, aiApiKey });
});
