# FlankWatch — Demo Targets

## Verified collector

### Postman — https://www.getpostman.com/pricing

- **Collector ID:** `c_mt4mvrmkhsc3u8scr`
- **Status:** verified, in active use (`collectors.json`)
- Captures all 4 tiers (Free/Solo/Team/Enterprise) cleanly: numeric prices, billing period, feature-bullet lists.
- Already run through the full `detect → diagnose → heal → preview → approve → verify` loop live — added `currency_symbol` and `is_popular` fields via heal, confirmed persisted after approve.

## Attempted, not currently working

Tried to get to 2-3 collectors per the roadmap. Real results, for an honest record:

- **Linear** (linear.app/pricing) — 2 attempts, both failed during AI generation itself (`code_generator` step), not just extraction. First attempt failed fast with an ambiguous `status: undefined`; second got much further (207 poll attempts) before erroring. Markup uses CSS-module hashed class names, which was flagged as a moderate risk in the initial Phase 0 check.
- **Retool** (retool.com/pricing) — 2 attempts. Both **built successfully** (`status: done`) but returned `pricing_tiers: []` on every real run — the AI-Flow preview apparently sees data that a fresh run doesn't. Tried once with a generic description, once with an explicit `data-test-id="pricing-tier-*"` hint; same empty result both times. This is the one worth revisiting first if picking collector-building back up — it's closest to working.
- **Resend** (resend.com/pricing) — 1 attempt, failed at `code_generator`, same failure point as Linear's second attempt.
- **Cal.com** (cal.com/pricing) — 1 attempt, ~188 poll attempts through `user_intent_analyzer` and `output_schema_generator`, then failed with `status: undefined`. Found while live-testing the CLI (`flankwatch add`); same account-wide load pattern noted below rather than a markup-specific issue.

3 of 4 non-Postman attempts failed at generation time, across otherwise-unrelated sites, within the same session that had already run ~7 prior AI-Flow generations. Reads more like transient account/session load than per-site difficulty — worth retrying fresh rather than assuming these targets are permanently unworkable.

## Rejected before attempting (Phase 0 screening)

- **Neon** (neon.tech/pricing) — usage-based pricing calculator, 30+ distinct dollar amounts on the page, no fixed tier structure.
- **Clerk** (clerk.com/pricing) — same issue as Neon.

## Verification method (Phase 0 screening)

Checked via raw `curl` fetch (not rendered browser) against each candidate URL: confirmed `$`-prefixed prices appear in the initial HTML response, searched for `price`/`plan`/`tier` substrings in `class="..."` attributes, checked for `application/ld+json` structured data blocks.
