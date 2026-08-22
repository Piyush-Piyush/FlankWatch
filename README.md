# FlankWatch

A competitor pricing monitor that **survives the website changing.** It scrapes competitor pricing pages via Bright Data Scraper Studio, detects when the extracted data looks wrong, diagnoses what likely broke, and triggers Bright Data's AI self-healing — the whole `detect → diagnose → heal → approve → verify` loop runs unattended, with every step visible on a live dashboard as it happens.

Competitors are organized into **groups/segments** (API tools, video editing, smartphones, …), each with its own schedule. New competitors are added **on demand from the dashboard** — type a name + pricing URL + group, and Bright Data's AI builds the scraper in the background; nothing is hardcoded to a specific site.

When any run — scheduled, manual "Run now", or CI — comes back degraded, the fix is **fully automatic**: diagnose → heal → approve → verify, no click required. See "Self-healing is automatic" below.

Built for a hackathon judged on Best Use of Bright Data, Best UI, and Best Clean Code.

## Adding, grouping, and removing competitors (on-demand, no code change)

Click **+ Add competitor**, give it a name and a pricing-page URL. The **Group / segment** field
is a dropdown of existing groups plus a **+ New group…** option — pick one or type a brand new
group name inline. Submitting fires `bdata scraper create` in the background — the new
competitor appears in its group as **Building…** while Bright Data's AI generates the scraper (a
few minutes), then flips to a live card once it's built and verified.

Each group has a **schedule** dropdown (hourly / daily / weekly) that runs every collector in
that segment on a cron via `node-cron`. Click the **×** on any card to stop tracking that
competitor — it's a confirm-gated destructive action: it removes the collector from the registry
and wipes its run/heal history. Groups aren't a separate stored entity, so a group with no
collectors left in it just stops appearing on its own; if it had a schedule, that's cleared too
(a cron for zero collectors is meaningless clutter, not something to leave orphaned). Note: Bright
Data has no programmatic delete for the scraper template itself, so this only stops FlankWatch
from tracking it — the underlying collector still exists on Bright Data's side.

The registry lives in `collectors/collectors.json`; the store module (`lib/collectorStore.js`) is
the only writer.

## Debug mode

`npm run debug` (vs. plain `npm start`) sets `DEBUG=true` and prints a full step-by-step trace to
the terminal: every HTTP request/response, every `bdata` CLI spawn with timing, rule-check
verdicts, Gemini calls with prompt/response sizes, and heal/approve/create job transitions.
`npm start` stays quiet — the dashboard polls every 4 seconds, so full tracing there is noisy by
default. The logger (`lib/logger.js`) is shared everywhere: `debugLog()` (gated, verbose),
`log()` (always-on lifecycle events), `logError()` (always-on, with the real error object).

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
cp .env.example .env                 # optional: set AI_ENABLED=true + GEMINI_API_KEY for the AI toggle
npm start                            # http://localhost:3000
```

Requires Node ≥ 22.13 (the `bdata` CLI's dependencies reject older versions).

## The AI toggle

Uses Google Gemini (`gemini-3.5-flash-lite` — free-tier friendly, fast, cheap; get a key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)), gated everywhere behind one
`AI_ENABLED` + `GEMINI_API_KEY` pair, three touchpoints:

- **Anomaly second pass** (`monitor/aiSecondPass.js`) — `evaluate_run()` is rule-based and
  deterministic by default, never depending on an external API being up. When enabled, this can
  *escalate* a `healthy` verdict to `degraded` if it spots something the rules missed (e.g. a
  price that technically parses as a number but is clearly wrong). It can never downgrade a
  rule-flagged `degraded` back to `healthy`.
- **AI-written heal diagnoses** (`lib/aiDiagnosis.js`) — writing a good heal prompt is a language
  task, not a rule-matching one (see "Honest status notes" below for exactly why this exists).
  Given the raw broken records — not just the rule engine's summarized reasons — a model can
  notice things a template can't: literal "Custom" text, a discount badge merged into a plan
  name, a price nested under an unanticipated key.
- **Weekly digest summary** (`lib/digest.js`) — turns a pricing diff into a plain-English sentence.

Every one of these falls back to deterministic behavior (the rule verdict, the template
diagnosis, a template digest sentence) on any failure — disabled, missing key, network error, bad
response. AI is additive everywhere; nothing in the core loop depends on it being available.

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

## Self-healing is automatic

Detect → diagnose → heal → approve → verify runs unattended, everywhere: a scheduled group run, a
manual "Run now" click, and the CI monitor (below) all funnel into the same
`autoHealAndApprove()` (`api/services/healService.js`) the instant a run comes back degraded —
no click needed to fix it. The dashboard's heal log still shows every step live (diagnosis,
preview, approve, verify) as it happens, and the per-card **Heal** button stays available for a
manual retry (e.g. a heal that landed in `needs_review`). One function, one place the
diagnose-heal-approve-verify sequence is written, called by the scheduler, the `/run` route, and
`scripts/ci-monitor.js` alike — no duplicated orchestration logic across those three trigger
sources.

Capped at **3 auto-heal attempts** since the last healthy run — a site whose AI-Flow fix didn't
stick twice in a row isn't likely fixed by identical attempt #4, and every attempt is a real
Bright Data job. Past the cap, auto-heal stops burning attempts and leaves a `needs_review` row
(`countHealAttemptsSinceLastHealthy()` in `api/db/queries.js`) for a human — same dashboard
Dismiss/manual-Heal path as any other stuck heal. The counter resets naturally the moment the
competitor is healthy again.

## Continuous monitoring (GitHub Actions)

`.github/workflows/self-heal-monitor.yml` runs `scripts/ci-monitor.js` on a daily cron (plus a
manual "Run workflow" button for demos). It checks every collector in `collectors.json` and relies
on the same automatic heal-and-approve path described above — unattended, no human in the loop.
The job exits non-zero only when a heal doesn't reach `awaiting_approval` or an approve lands in
`needs_review` — i.e. the green checkmark itself is evidence the self-healing loop is working, not
just that the job ran.

Requires two repo secrets:
- `BRIGHT_DATA_API_KEY` — from the Bright Data dashboard (Settings → API key), used with
  `bdata login -k` since the normal browser OAuth flow doesn't work in CI.
- `GEMINI_API_KEY` — optional, only needed if the `AI_ENABLED` repo variable is set to `true`.

## Honest status notes

A few things worth knowing if picking this back up:

- **Collectors built on demand, live, more than once.** Descript and Insomnia were both built
  through the real "+ Add competitor" flow (not seeded), proving the create path isn't hardcoded
  to Postman. Descript's page lists monthly *and* annual prices, so Bright Data's AI produced
  `price_monthly` / `price_annual` instead of Postman's single `price`; Insomnia's scraper
  returned price as a plain numeric *string* under a third field name (`price_value`). Rather
  than special-case either, the monitor's price check accepts several candidate `paths` and
  coerces unambiguous numeric strings (see `monitor/schemaConfig.js` / `monitor/evaluateRun.js`)
  — the correct de-coupling from any one site's exact key names or types. Descript was later
  deleted while testing the delete feature (see the delete confirm-dialog copy above for exactly
  what that does) — it's reproducible any time via the same on-demand flow. Earlier attempts at
  Linear, Retool, and Resend failed during AI generation; see `TARGETS.md`.
- **AI-written diagnoses can catch gaps the rules don't know about.** Live-tested on Descript: an
  earlier heal had already added a `price_text` field capturing "Custom" for its Enterprise tier
  — genuinely fixed — but the rule schema didn't know `price_text` counts as a valid price
  representation, so it kept flagging Enterprise as broken. Gemini, given the raw record directly,
  noticed `price_text: "Custom"` was already there and said so. `price_text` isn't yet added to
  the schema's accepted price paths — a good next fix, deliberately left alone here to keep this
  note honest about what's actually been done vs. observed.
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
