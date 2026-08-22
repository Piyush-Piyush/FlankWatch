const POLL_INTERVAL_MS = 4000;

const groupsEl = document.getElementById("groups");
const healLogPanel = document.getElementById("heal-log-panel");
const topbarMeta = document.getElementById("topbar-meta");
const digestSection = document.getElementById("digest-section");
const digestPanel = document.getElementById("digest-panel");
const statRow = document.getElementById("stat-row");
const categoryOptions = document.getElementById("category-options");

const addToggle = document.getElementById("add-toggle");
const addFormWrap = document.getElementById("add-form-wrap");
const addForm = document.getElementById("add-form");
const addCancel = document.getElementById("add-cancel");
const addSubmit = document.getElementById("add-submit");

const inFlight = new Set(); // competitor names currently mid-action, to disable their buttons

// Human-friendly cadence presets mapped to cron expressions. A whole
// segment (category) shares one schedule.
const SCHEDULE_PRESETS = [
  { label: "Not scheduled", cron: "" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily · 9am", cron: "0 9 * * *" },
  { label: "Weekly · Mon 9am", cron: "0 9 * * 1" },
];

function money(obj) {
  if (obj && typeof obj.value === "number") return `${obj.symbol || "$"}${obj.value}`;
  if (typeof obj === "number") return `$${obj}`;
  return null;
}

// Mirrors the monitor's any-of price handling: different sites structure
// price as a single value or a monthly/annual split. Show whatever's there
// (monthly preferred), with a "/yr" hint when only annual exists.
function formatMoney(tier) {
  const single = money(tier.price);
  if (single) return single;
  const monthly = money(tier.price_monthly);
  if (monthly) return `${monthly}/mo`;
  const annual = money(tier.price_annual);
  if (annual) return `${annual}/yr`;
  return "—";
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const HEAL_STATUS_LABEL = {
  healing: "Healing…",
  awaiting_approval: "Ready to approve",
  approving: "Approving…",
  rejecting: "Rejecting…",
  needs_review: "Needs review",
};

// Single source of truth for a competitor's overall state — drives both
// the status pill and the card's left-border accent color.
function competitorState(competitor) {
  const { latestRun, openHeal } = competitor;
  if (openHeal && openHeal.status === "needs_review") return "review";
  if (openHeal) return "healing";
  if (!latestRun) return "healing"; // "no data yet" reads as pending, not an error
  return latestRun.status === "degraded" ? "degraded" : "healthy";
}

const STATE_PILL_LABEL = {
  healthy: "Healthy",
  degraded: "Degraded",
  healing: "Healing",
  review: "Needs review",
};

function statusPill(competitor) {
  const state = competitorState(competitor);
  const text = !competitor.latestRun && !competitor.openHeal ? "No data yet" : STATE_PILL_LABEL[state];
  return `<span class="pill pill-${state}"><span class="pill-dot"></span>${text}</span>`;
}

function pricingTable(latestRun) {
  if (!latestRun) return `<p class="empty-note">No run yet.</p>`;
  const record = Array.isArray(latestRun.result) ? latestRun.result[0] : latestRun.result;
  const tiers = record?.pricing_tiers || [];
  if (tiers.length === 0) return `<p class="empty-note">No tiers extracted.</p>`;

  const rows = tiers
    .map(
      (t) => `
      <tr>
        <td class="plan-name">${escapeHtml(t.plan_name ?? "—")}</td>
        <td class="plan-price">${formatMoney(t)}</td>
        <td class="plan-period">${escapeHtml(t.billing_period ?? "—")}</td>
      </tr>`
    )
    .join("");

  return `
    <table class="pricing-table">
      <thead><tr><th>Plan</th><th>Price</th><th>Billing</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function diffPanel(diff) {
  if (!diff || diff.length === 0) return "";
  const rows = diff
    .map((c) => {
      if (c.type === "price_changed") {
        return `<div class="diff-row"><span>${escapeHtml(c.plan_name)}:</span> <span class="diff-old">$${c.from}</span> → <span class="diff-new">$${c.to}</span></div>`;
      }
      if (c.type === "added") return `<div class="diff-row">+ new tier: <span class="diff-new">${escapeHtml(c.plan_name)}</span></div>`;
      if (c.type === "removed") return `<div class="diff-row">− removed tier: <span class="diff-old">${escapeHtml(c.plan_name)}</span></div>`;
      return "";
    })
    .join("");
  return `<div class="diff-panel"><div class="diff-panel-title">Changed since last check</div>${rows}</div>`;
}

function healBanner(competitor) {
  const { name, openHeal } = competitor;
  if (!openHeal) return "";

  const label = HEAL_STATUS_LABEL[openHeal.status] || openHeal.status;
  const busy = inFlight.has(name);

  let actions = "";
  if (openHeal.status === "awaiting_approval") {
    actions = `
      <div class="heal-banner-actions">
        <button class="btn btn-primary" data-action="approve" data-name="${escapeHtml(name)}" ${busy ? "disabled" : ""}>Approve</button>
        <button class="btn btn-reject" data-action="reject" data-name="${escapeHtml(name)}" ${busy ? "disabled" : ""}>Reject</button>
      </div>`;
  }

  const errorLine = openHeal.status === "needs_review" && openHeal.error ? `<div class="heal-banner-diagnosis">${escapeHtml(openHeal.error)}</div>` : "";

  return `
    <div class="heal-banner state-${openHeal.status}">
      <div class="heal-banner-title">${label}</div>
      <div class="heal-banner-diagnosis">${escapeHtml(openHeal.diagnosis || "")}</div>
      ${errorLine}
      ${actions}
    </div>`;
}

function resilienceLine(resilience) {
  if (!resilience || resilience.totalRuns === 0) return `<span class="resilience-line">No runs recorded yet</span>`;
  const parts = [`${resilience.uptimePct}% uptime`, `${resilience.healCount} heal${resilience.healCount === 1 ? "" : "s"}`];
  if (resilience.avgRecoverySeconds != null) parts.push(`avg recovery ${formatDuration(resilience.avgRecoverySeconds)}`);
  if (resilience.currentStreak > 0) parts.push(`streak ${resilience.currentStreak}`);
  return `<span class="resilience-line">${parts.join(" · ")}</span>`;
}

function statTiles(competitors) {
  const withRuns = competitors.filter((c) => c.resilience && c.resilience.totalRuns > 0);
  const avgUptime = withRuns.length ? Math.round((withRuns.reduce((sum, c) => sum + c.resilience.uptimePct, 0) / withRuns.length) * 10) / 10 : null;
  const totalHeals = competitors.reduce((sum, c) => sum + (c.resilience?.healCount || 0), 0);
  const activeCount = competitors.filter((c) => {
    const s = competitorState(c);
    return s === "degraded" || s === "healing" || s === "review";
  }).length;

  const tiles = [
    { label: "Competitors tracked", value: competitors.length, cls: "" },
    { label: "Avg uptime", value: avgUptime != null ? `${avgUptime}%` : "—", cls: "good" },
    { label: "Heals to date", value: totalHeals, cls: "accent" },
    { label: "Needs attention", value: activeCount, cls: activeCount > 0 ? "warning" : "" },
  ];

  return tiles
    .map((t) => `<div class="stat-tile"><span class="stat-value ${t.cls}">${t.value}</span><span class="stat-label">${t.label}</span></div>`)
    .join("");
}

function competitorCard(competitor) {
  const { name, url, latestRun, openHeal } = competitor;
  const busy = inFlight.has(name);
  const canHeal = latestRun && latestRun.status === "degraded" && !openHeal;
  const state = competitorState(competitor);

  return `
    <article class="card card--${state}" data-name="${escapeHtml(name)}">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-title">${escapeHtml(name)}</span>
          <span class="card-url">${escapeHtml(url)}</span>
        </div>
        ${statusPill(competitor)}
      </div>

      ${pricingTable(latestRun)}
      ${diffPanel(competitor.diff)}
      ${healBanner(competitor)}

      <div class="card-footer">
        ${resilienceLine(competitor.resilience)}
        <div style="display:flex; gap:8px;">
          ${canHeal ? `<button class="btn btn-primary" data-action="heal" data-name="${escapeHtml(name)}" ${busy ? "disabled" : ""}>Heal now</button>` : ""}
          <button class="btn btn-ghost" data-action="run" data-name="${escapeHtml(name)}" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Run now"}</button>
        </div>
      </div>
    </article>`;
}

function pendingCard(p) {
  if (p.status === "failed") {
    return `
      <article class="card card--review" data-name="${escapeHtml(p.name)}">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-title">${escapeHtml(p.name)}</span>
            <span class="card-url">${escapeHtml(p.url)}</span>
          </div>
          <span class="pill pill-review"><span class="pill-dot"></span>Build failed</span>
        </div>
        <div class="heal-banner state-needs_review">
          <div class="heal-banner-title">Scraper build failed</div>
          <div class="heal-banner-diagnosis">${escapeHtml(p.error || "unknown error")}</div>
          <div class="heal-banner-actions">
            <button class="btn btn-ghost" data-action="dismiss-pending" data-id="${p.id}">Dismiss</button>
          </div>
        </div>
      </article>`;
  }

  return `
    <article class="card card--healing" data-name="${escapeHtml(p.name)}">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-title">${escapeHtml(p.name)}</span>
          <span class="card-url">${escapeHtml(p.url)}</span>
        </div>
        <span class="pill pill-healing"><span class="pill-dot"></span>Building…</span>
      </div>
      <div class="building-note">
        <span class="spinner" aria-hidden="true"></span>
        Bright Data's AI is building this scraper — usually a few minutes.
      </div>
    </article>`;
}

function scheduleControl(category, schedules) {
  const current = schedules[category] || "";
  const options = SCHEDULE_PRESETS.map((p) => {
    // Mark a matching preset selected; a custom/unknown cron shows as its raw value.
    const selected = p.cron === current ? "selected" : "";
    return `<option value="${escapeHtml(p.cron)}" ${selected}>${escapeHtml(p.label)}</option>`;
  }).join("");
  const isKnown = SCHEDULE_PRESETS.some((p) => p.cron === current);
  const customOption = !isKnown && current ? `<option value="${escapeHtml(current)}" selected>Custom: ${escapeHtml(current)}</option>` : "";

  return `
    <label class="schedule-control">
      <span class="schedule-label">Schedule group:</span>
      <select data-schedule-category="${escapeHtml(category)}">${options}${customOption}</select>
    </label>`;
}

function groupSection(category, competitors, pending, schedules) {
  const cards = [...competitors.map(competitorCard), ...pending.map(pendingCard)].join("");
  return `
    <section class="group">
      <div class="group-header">
        <h2 class="group-title">${escapeHtml(category)}</h2>
        ${scheduleControl(category, schedules)}
      </div>
      <div class="competitor-grid">${cards}</div>
    </section>`;
}

function digestEntry(entry) {
  return `
    <div class="digest-entry">
      <span class="digest-competitor">${escapeHtml(entry.competitor)}</span>
      <span class="digest-summary">${escapeHtml(entry.summary)}</span>
    </div>`;
}

function healLogEntry(heal) {
  return `
    <div class="heal-log-entry">
      <div class="heal-log-top">
        <span class="heal-log-time">${formatTime(heal.triggered_at)}</span>
        <span class="heal-log-competitor">${escapeHtml(heal.competitor)}</span>
        <span class="heal-log-status status-${heal.status}">${heal.status.replace(/_/g, " ")}</span>
      </div>
      <div class="heal-log-diagnosis">${escapeHtml(heal.diagnosis)}</div>
    </div>`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

function groupByCategory(competitors, pending) {
  const groups = new Map(); // category -> { competitors: [], pending: [] }
  const ensure = (category) => {
    if (!groups.has(category)) groups.set(category, { competitors: [], pending: [] });
    return groups.get(category);
  };
  for (const c of competitors) ensure(c.category || "Uncategorized").competitors.push(c);
  for (const p of pending) ensure(p.category || "Uncategorized").pending.push(p);
  return groups;
}

async function refresh() {
  try {
    const [{ competitors, pending, schedules, aiEnabled }, { heals }, { digest }] = await Promise.all([
      fetchJson("/api/competitors"),
      fetchJson("/api/heals"),
      fetchJson("/api/digest"),
    ]);

    const lastChecked = competitors
      .map((c) => c.latestRun?.runTimestamp)
      .filter(Boolean)
      .sort()
      .at(-1);
    topbarMeta.textContent = `AI review: ${aiEnabled ? "on" : "off"} · Last checked: ${lastChecked ? formatTime(lastChecked) : "—"}`;

    statRow.innerHTML = statTiles(competitors);

    const groups = groupByCategory(competitors, pending);
    if (groups.size === 0) {
      groupsEl.innerHTML = `<p class="empty-note">No competitors yet. Click “Add competitor” to build your first scraper.</p>`;
    } else {
      groupsEl.innerHTML = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, { competitors: gc, pending: gp }]) => groupSection(category, gc, gp, schedules))
        .join("");
    }

    // Feed existing categories into the add-form's datalist for quick reuse.
    const categories = [...new Set(competitors.map((c) => c.category).filter(Boolean))].sort();
    categoryOptions.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");

    if (digest.length > 0) {
      digestSection.hidden = false;
      digestPanel.innerHTML = digest.map(digestEntry).join("");
    } else {
      digestSection.hidden = true;
    }

    healLogPanel.innerHTML = heals.length
      ? heals.map(healLogEntry).join("")
      : `<div class="heal-log-entry"><span class="heal-log-diagnosis">No heal attempts yet.</span></div>`;
  } catch (err) {
    console.error("refresh failed:", err);
  }
}

groupsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, name, id } = btn.dataset;

  if (action === "dismiss-pending") {
    await fetchJson(`/api/collectors/pending/${id}`, { method: "DELETE" }).catch((err) => console.error("dismiss failed:", err));
    refresh();
    return;
  }

  inFlight.add(name);
  refresh();

  try {
    if (action === "run") {
      await fetchJson(`/api/competitors/${encodeURIComponent(name)}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } else if (action === "heal") {
      await fetchJson(`/api/competitors/${encodeURIComponent(name)}/heal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } else if (action === "approve") {
      await fetchJson(`/api/competitors/${encodeURIComponent(name)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } else if (action === "reject") {
      await fetchJson(`/api/competitors/${encodeURIComponent(name)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reject: true }),
      });
    }
  } catch (err) {
    console.error(`${action} failed:`, err);
    alert(`${action} failed: ${err.message}`);
  } finally {
    inFlight.delete(name);
    refresh();
  }
});

groupsEl.addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-schedule-category]");
  if (!select) return;
  const category = select.dataset.scheduleCategory;
  const cron = select.value || null;
  try {
    await fetchJson(`/api/schedules/${encodeURIComponent(category)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron }),
    });
  } catch (err) {
    console.error("schedule update failed:", err);
    alert(`Couldn't update schedule: ${err.message}`);
  }
  refresh();
});

// ---- add-competitor form ----

function toggleAddForm(show) {
  addFormWrap.hidden = !show;
  if (show) addForm.querySelector('input[name="name"]').focus();
}

addToggle.addEventListener("click", () => toggleAddForm(addFormWrap.hidden));
addCancel.addEventListener("click", () => {
  addForm.reset();
  toggleAddForm(false);
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(addForm));
  addSubmit.disabled = true;
  addSubmit.textContent = "Starting…";
  try {
    await fetchJson("/api/collectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name, url: data.url, category: data.category }),
    });
    addForm.reset();
    toggleAddForm(false);
    refresh();
  } catch (err) {
    alert(`Couldn't start build: ${err.message}`);
  } finally {
    addSubmit.disabled = false;
    addSubmit.textContent = "Build scraper";
  }
});

refresh();
setInterval(refresh, POLL_INTERVAL_MS);
