const POLL_INTERVAL_MS = 4000;

const grid = document.getElementById("competitor-grid");
const healLogPanel = document.getElementById("heal-log-panel");
const topbarMeta = document.getElementById("topbar-meta");
const digestSection = document.getElementById("digest-section");
const digestPanel = document.getElementById("digest-panel");

const inFlight = new Set(); // competitor names currently mid-action, to disable their buttons

function formatMoney(price) {
  if (!price || typeof price.value !== "number") return "—";
  const symbol = price.symbol || "$";
  return `${symbol}${price.value}`;
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

function statusPill(competitor) {
  const { latestRun, openHeal } = competitor;

  if (openHeal && openHeal.status === "needs_review") {
    return `<span class="pill pill-review"><span class="pill-dot"></span>Needs review</span>`;
  }
  if (openHeal) {
    return `<span class="pill pill-healing"><span class="pill-dot"></span>Healing</span>`;
  }
  if (!latestRun) {
    return `<span class="pill pill-healing"><span class="pill-dot"></span>No data yet</span>`;
  }
  if (latestRun.status === "degraded") {
    return `<span class="pill pill-degraded"><span class="pill-dot"></span>Degraded</span>`;
  }
  return `<span class="pill pill-healthy"><span class="pill-dot"></span>Healthy</span>`;
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
        <td class="plan-price">${formatMoney(t.price)}</td>
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

function competitorCard(competitor) {
  const { name, url, latestRun, openHeal } = competitor;
  const busy = inFlight.has(name);
  const canHeal = latestRun && latestRun.status === "degraded" && !openHeal;

  return `
    <article class="card" data-name="${escapeHtml(name)}">
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

async function refresh() {
  try {
    const [{ competitors, aiEnabled }, { heals }, { digest }] = await Promise.all([
      fetchJson("/api/competitors"),
      fetchJson("/api/heals"),
      fetchJson("/api/digest"),
    ]);

    topbarMeta.textContent = `AI review: ${aiEnabled ? "on" : "off"}`;

    grid.innerHTML = competitors.length ? competitors.map(competitorCard).join("") : `<p class="empty-note">No competitors configured yet.</p>`;

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

grid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, name } = btn.dataset;

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

refresh();
setInterval(refresh, POLL_INTERVAL_MS);
