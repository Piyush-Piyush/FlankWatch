import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCollectorForCompetitor } from "./services/pipeline.js";
import { insertPendingHeal, runHealJob, markHealPending, runApproveJob, dismissHeal, autoHealAndApprove } from "./services/healService.js";
import { startCollectorCreation, runCreateJob, listPendingCollectors, dismissPending, deleteCollector } from "./services/collectorService.js";
import { getLatestRun, getPreviousHealthyRun, getOpenHeal, getRecentHeals, getResilienceStats } from "./db/queries.js";
import { loadCollectors, loadSchedules, setSchedule } from "../lib/collectorStore.js";
import { reloadSchedules } from "./scheduler.js";
import { diffPricingRuns } from "../lib/diffPricing.js";
import { generateDigest } from "../lib/digest.js";
import { generateDiagnosis } from "../monitor/evaluateRun.js";
import { log, debugLog, logError, isDebug } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.join(__dirname, "..", "dashboard");

const app = express();
app.use(express.json());

// Request tracing — only in debug mode (npm run debug), keeps normal
// `npm start` output quiet since the dashboard polls every few seconds.
app.use((req, res, next) => {
  const startedAt = Date.now();
  debugLog("http", `--> ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    debugLog("http", `<-- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
});

app.use(express.static(DASHBOARD_DIR));

const aiEnabled = process.env.AI_ENABLED === "true";
const aiApiKey = process.env.GEMINI_API_KEY || null;

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
    logError("http", "GET /api/digest failed", err);
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
    if (result.status !== "healthy") {
      // Respond first — heal+approve is multi-minute; the dashboard picks
      // up progress via its usual polling, same as a scheduled run.
      autoHealAndApprove(req.params.name, result.reasons, result.result, { aiEnabled, aiApiKey }).catch((err) =>
        logError("http", `auto-heal failed for ${req.params.name}`, err)
      );
    }
  } catch (err) {
    logError("http", `POST /api/competitors/${req.params.name}/run failed`, err);
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// Heal and approve kick off multi-minute Bright Data AI-Flow jobs, so both
// respond immediately with a pending state and finish the work in the
// background — the dashboard polls /api/competitors for the result.
app.post("/api/competitors/:name/heal", async (req, res) => {
  try {
    const competitor = req.params.name;
    const latestRun = getLatestRun(competitor);
    const reasons = latestRun ? JSON.parse(latestRun.reasons || "[]") : [];
    const rawResult = latestRun ? JSON.parse(latestRun.raw_json) : null;
    const diagnosis = req.body?.diagnosis || (await generateDiagnosis(reasons, { rawResult, aiEnabled, aiApiKey })) || null;
    if (!diagnosis) {
      res.status(400).json({ error: "diagnosis is required (no degraded reasons on file to auto-generate one)" });
      return;
    }

    const healId = insertPendingHeal(competitor, diagnosis);
    res.status(202).json({ healId, status: "healing" });
    runHealJob(healId, competitor, diagnosis).catch((err) => logError("heal", `heal job ${healId} failed`, err));
  } catch (err) {
    logError("http", `POST /api/competitors/${req.params.name}/heal failed`, err);
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

app.post("/api/competitors/:name/approve", (req, res) => {
  try {
    const competitor = req.params.name;
    const reject = Boolean(req.body?.reject);
    const heal = markHealPending(competitor, { reject });
    res.status(202).json({ healId: heal.id, status: reject ? "rejecting" : "approving" });
    runApproveJob(heal.id, competitor, { reject }).catch((err) => logError("approve", `approve job ${heal.id} failed`, err));
  } catch (err) {
    logError("http", `POST /api/competitors/${req.params.name}/approve failed`, err);
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
    logError("http", `POST /api/competitors/${req.params.name}/dismiss-heal failed`, err);
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
    runCreateJob(pendingId).catch((err) => logError("create", `create job ${pendingId} failed`, err));
  } catch (err) {
    logError("http", "POST /api/collectors failed", err);
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

app.delete("/api/collectors/pending/:id", (req, res) => {
  dismissPending(Number(req.params.id));
  res.json({ ok: true });
});

// Stops tracking a competitor and wipes its history. Bright Data has no
// programmatic delete for the scraper template itself — this only removes
// it from FlankWatch. If it was the last one in its category, that
// category's schedule is cleared too (see deleteCollector).
app.delete("/api/competitors/:name", (req, res) => {
  try {
    deleteCollector(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    logError("http", `DELETE /api/competitors/${req.params.name} failed`, err);
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

// Per-category schedule. Body: { cron: "0 9 * * *" } to set, { cron: null } to clear.
app.put("/api/schedules/:category", (req, res) => {
  try {
    const schedules = setSchedule(req.params.category, req.body?.cron || null);
    reloadSchedules({ aiEnabled, aiApiKey });
    res.json({ schedules });
  } catch (err) {
    logError("http", `PUT /api/schedules/${req.params.category} failed`, err);
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log("server", `FlankWatch dashboard running at http://localhost:${PORT}`);
  log("server", `debug logging: ${isDebug ? "ON" : "off (run 'npm run debug' to enable)"}, AI: ${aiEnabled ? "on (Gemini)" : "off"}`);
  reloadSchedules({ aiEnabled, aiApiKey });
});
