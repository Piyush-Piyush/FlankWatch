# FlankWatch

A competitor pricing monitor that **survives the website changing.** It scrapes competitor pricing pages via Bright Data Scraper Studio, detects when the extracted data looks wrong, diagnoses what likely broke, triggers Bright Data's AI self-healing, and shows a human the proposed fix before anything is approved — the whole `detect → diagnose → heal → preview → approve → verify` loop, visible on a live dashboard.

Competitors are organized into **groups/segments** (API tools, video editing, smartphones, …), each with its own schedule. New competitors are added **on demand from the dashboard** — type a name + pricing URL + group, and Bright Data's AI builds the scraper in the background; nothing is hardcoded to a specific site.

Built for a hackathon judged on Best Use of Bright Data, Best UI, and Best Clean Code.

## Adding competitors & groups (on-demand, no code change)

Click **+ Add competitor**, give it a name, pricing-page URL, and a group name (e.g. "Video editing"). That fires `bdata scraper create` in the background — the new competitor appears in its group as **Building…** while Bright Data's AI generates the scraper (a few minutes), then flips to a live card once it's built and verified. Each group has a **schedule** dropdown (hourly / daily / weekly) that runs every collector in that segment on a cron via `node-cron`. The registry lives in `collectors/collectors.json`; the store module (`lib/collectorStore.js`) is the only writer.

## Architecture

```
/collectors        Scraper Studio CLI invocations ONLY (create/run) — no orchestration,
                     no storage. Plus collectors.json (the registry) + schedules.json.
/heal-orchestrator  heal_collector() / approve_collector() — CLI invocations ONLY.
/monitor            evaluate_run() — rule-based sanity checks + optional AI advisory pass.
/lib                Shared logic: safe CLI spawning, the collector store (only writer of
                     collectors.json / schedules.json), pricing diff, weekly digest.
/api
  /db               SQLite schema + queries (runs, heals, pending_collectors tables).
  /services         Orchestration: run a collector + store + evaluate; heal/approve +
                     verify; build a new collector on demand and persist it.
  scheduler.js      node-cron per category — runs a whole group on a cadence.
  server.js         Express app — REST API + serves /dashboard statically.
/dashboard          Vanilla HTML/CSS/JS. No framework — full control over the visual design,
                     zero build step.
/scripts            Manual verification tools (see "Reproducing the demo" below) plus the
                     CI entrypoint (ci-monitor.js) run by the GitHub Actions workflow.
```

**Why /collectors and /heal-orchestrator are separate from /api:** those two folders are
strictly thin wrappers around the `bdata` CLI — nothing else lives there. That's the visible
boundary between "genuinely uses Bright Data" and "our own engineering" (judge Q8). Everything
that isn't a direct CLI call — storage, evaluation, the fire-and-forget job handling for
multi-minute heal calls — lives in `/api/services`, not spread across the CLI-wrapper folders.

**Why vanilla JS, not React:** no dashboard existed yet when Phase 5 started, so introducing a
framework would have been pure overhead. Hand-written HTML/CSS gave full control over avoiding
generic AI-generated-website patterns (gradients, glow, bento grids, floating 3D shapes,
buzzword copy) in favor of a warm, minimal, data-dense layout.

## Setup

```bash
npm install
npx -p @brightdata/cli bdata login   # opens a browser, stores credentials in the CLI's own config
cp .env.example .env                 # optional: set AI_ENABLED=true + ANTHROPIC_API_KEY for the AI toggle
npm start                            # http://localhost:3000
```

Requires Node ≥ 22.13 (the `bdata` CLI's dependencies reject older versions).

## The AI toggle

`evaluate_run()` is rule-based and deterministic by default — it never depends on an external
API being up. If `AI_ENABLED=true` and `ANTHROPIC_API_KEY` is set, a second advisory pass
(Claude Opus 4.8, low effort) can *escalate* a `healthy` verdict to `degraded` if it spots
something the rules missed. It can never downgrade a rule-flagged `degraded` back to `healthy`,
and any failure of the AI call (bad key, network, rate limit) silently falls back to the rule
verdict — the detection floor never depends on AI availability. The same toggle also gates the
weekly digest's AI-written summary (falls back to a plain template sentence otherwise).

## Reproducing the demo locally

```bash
node scripts/run-pipeline-manually.js      # trigger a real collector run, store + evaluate the result
node scripts/run-heal-manually.js "<diagnosis text>"   # trigger a real heal, then approve it, then verify recovery
```

Both hit real Bright Data AI-Flow jobs — a `create`/`heal` call typically takes 5-10 minutes,
a plain `run` a few seconds to a minute. Watch progress live at the `view_url` the CLI prints,
or in the dashboard's heal log once the server is running.

To verify the dashboard itself renders and behaves correctly (used during development, not
required to run the app): `node scripts/screenshot.js http://localhost:3000 out.png` —
launches headless Chromium, screenshots the page, and reports any console errors.

## Continuous monitoring (GitHub Actions)

`.github/workflows/self-heal-monitor.yml` runs `scripts/ci-monitor.js` on a daily cron (plus a
manual "Run workflow" button for demos). It checks every collector in `collectors.json`; if one
comes back degraded, it triggers heal and **approves automatically** — unattended, no human in
the loop. That's the one place auto-approve is the right call: the live demo keeps approval
manual on purpose (Phase 4's human-in-the-loop story), but a 3am cron job has no one to click
"Approve". The job exits non-zero only when a heal doesn't reach `awaiting_approval` or an
approve lands in `needs_review` — i.e. the green checkmark itself is evidence the self-healing
loop is working, not just that the job ran.

Requires two repo secrets:
- `BRIGHT_DATA_API_KEY` — from the Bright Data dashboard (Settings → API key), used with
  `bdata login -k` since the normal browser OAuth flow doesn't work in CI.
- `ANTHROPIC_API_KEY` — optional, only needed if the `AI_ENABLED` repo variable is set to `true`.

## Honest status notes

A few things worth knowing if picking this back up:

- **Two live collectors in two groups (Postman + Descript).** Descript was built through the
  on-demand "+ Add competitor" flow, live — proof the create path works end to end and isn't
  hardcoded to Postman. Descript also surfaced a genuinely useful case: its page lists monthly
  *and* annual prices, so Bright Data's AI produced `price_monthly` / `price_annual` instead of
  Postman's single `price`. Rather than special-case it, the monitor's price check now accepts
  any of those shapes (see `monitor/schemaConfig.js` — a field can list several candidate
  `paths`), which is the correct de-coupling from one site's exact key names. Descript still
  reads **degraded** for two honest reasons the monitor correctly catches: its Enterprise tier
  has no numeric price ("contact sales") and its Free tier's feature list didn't extract — a
  real, non-staged heal candidate. Earlier attempts at Linear, Retool, and Resend failed during
  AI generation; see `TARGETS.md`.
- **`bdata scraper run <id> <url>` appears to ignore the URL argument.** Tested against three
  increasingly-mutated staged pages and even `https://example.com` — identical output every
  time, matching whatever the collector returned when first created. Bright Data's own docs
  don't describe this as expected behavior. This affects the "detect when the site changes"
  story: periodic `run` calls may not reflect the page's true current state. Worth filing with
  Bright Data or digging into the raw REST API (`/dca/trigger` + `/dca/dataset`) as an
  alternative to the CLI's `run` subcommand.
- **Phase 8's staged-redesign approach was built but parked.** `scripts/build-staged-redesign.js`
  mutates a real copy of Postman's HTML (moves price out of visible text) and serves it via
  `dashboard/staged/`; a Cloudflare quick tunnel exposes it publicly so Bright Data's crawler can
  reach it (`npx cloudflared tunnel --url http://localhost:3000`). It works mechanically, but
  because the mutated page still carries all of Postman's real branding/meta/nav, Scraper
  Studio's AI extraction seemed confident enough recognizing the page that it returned
  plausible-but-stale values instead of reflecting the actual (broken) content — combined with
  the `run`-ignores-URL finding above, this couldn't be fully verified as a true live break. The
  demo plan instead relies on Phase 4's heal loop directly (already proven live, twice, with real
  field additions) rather than a detected-live-break narrative.
