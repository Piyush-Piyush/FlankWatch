import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCollectorForCompetitor } from "./services/pipeline.js";
import { insertPendingHeal, runHealJob, markHealPending, runApproveJob } from "./services/healService.js";
import { getLatestRun, getPreviousHealthyRun, getOpenHeal, getRecentHeals, getResilienceStats } from "./db/queries.js";
import { diffPricingRuns } from "../lib/diffPricing.js";
import { generateDigest } from "../lib/digest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTORS_PATH = path.join(__dirname, "..", "collectors", "collectors.json");
const DASHBOARD_DIR = path.join(__dirname, "..", "dashboard");

function loadCollectors() {
  return JSON.parse(readFileSync(COLLECTORS_PATH, "utf-8"));
}

const app = express();
app.use(express.json());
app.use(express.static(DASHBOARD_DIR));

const aiEnabled = process.env.AI_ENABLED === "true";
const aiApiKey = process.env.ANTHROPIC_API_KEY || null;

app.get("/api/competitors", (req, res) => {
  const collectors = loadCollectors();
  const competitors = Object.entries(collectors).map(([name, config]) => {
    const latestRun = getLatestRun(name);
    const previousGood = latestRun ? getPreviousHealthyRun(name, latestRun.run_timestamp) : null;
    const openHeal = getOpenHeal(name);
    const stats = getResilienceStats(name);

    return {
      name,
      url: config.url,
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
      resilience: stats,
    };
  });

  res.json({ competitors, aiEnabled });
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
    const diagnosis = req.body?.diagnosis || (reasons.length > 0 ? `Scrape output failed sanity checks: ${reasons.join("; ")}.` : null);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FlankWatch dashboard running at http://localhost:${PORT}`);
});
