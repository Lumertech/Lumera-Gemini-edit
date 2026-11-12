import { escapeHtml } from "./letterhead.ts";
import { formatQueueToken, type QueueSnapshot } from "./patient-queue-status.ts";
import type { VisitChart } from "./patient-visit-records.ts";

const PAGE_CSS = `
  html, body { margin: 0; max-width: 100%; overflow-x: hidden; }
  body { overflow-y: auto; min-height: 100%; background: #f8fafc; color: #0f172a;
    font: 16px/1.45 system-ui, sans-serif; }
  main { width: 100%; max-width: 28rem; margin: 0 auto; padding: 1rem 1rem 2.5rem; box-sizing: border-box; }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  p, li { overflow-wrap: anywhere; }
  .muted { color: #475569; font-size: 0.875rem; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.875rem 1rem; margin-top: 0.75rem; }
  .row { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.35rem 0; border-bottom: 1px solid #f1f5f9; }
  .row span:last-child { font-weight: 650; text-align: right; }
  .open { color: #047857; }
  .closed { color: #b45309; }
  label { display: block; font-size: 0.875rem; font-weight: 650; margin-bottom: 0.35rem; }
  input { width: 100%; box-sizing: border-box; font-size: 1.125rem; letter-spacing: 0.2em; padding: 0.7rem 0.8rem;
    border: 1px solid #cbd5e1; border-radius: 10px; }
  button, .btn { display: inline-block; margin-top: 0.75rem; background: #0f766e; color: #fff; border: 0;
    border-radius: 10px; padding: 0.7rem 1rem; font-weight: 650; text-decoration: none; }
  .err { background: #fff7ed; color: #9a3412; border-radius: 10px; padding: 0.6rem 0.75rem; margin: 0.75rem 0; }
  ul { padding-left: 1.1rem; margin: 0.25rem 0; }
`;

export const PATIENT_VISIT_SCRIPT = `
(function () {
  var root = document.querySelector("[data-visit-root]");
  if (!root) return;
  var id = root.getAttribute("data-link-id");
  if (!id) return;
  var fields = ["your-token", "current-token", "ahead", "eta", "open"];
  function text(name, value) {
    var node = root.querySelector('[data-field="' + name + '"]');
    if (node) node.textContent = value;
  }
  function tick() {
    fetch("/api/public/visit/" + encodeURIComponent(id), { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (!body || !body.queue) return;
        var q = body.queue;
        text("your-token", q.yourTokenLabel || "—");
        text("current-token", q.currentTokenLabel || "—");
        text("ahead", String(q.peopleAhead));
        text("eta", q.etaLabel || "—");
        text("open", q.clinicOpen ? "Open" : "Closed");
        var open = root.querySelector('[data-field="open"]');
        if (open) open.className = q.clinicOpen ? "open" : "closed";
      })
      .catch(function () {});
  }
  setInterval(tick, 20000);
})();
`;

function queueCard(queue: QueueSnapshot | null): string {
  if (!queue) {
    return `<section class="card"><p class="muted">No live token is attached to this link.</p></section>`;
  }
  const eta =
    queue.etaMinutes == null ? (queue.visitIsToday ? "when the clinic is open" : queue.visitDate) : queue.etaMinutes === 0 ? "now" : `${queue.etaMinutes} min`;
  const openClass = queue.clinicOpen ? "open" : "closed";
  return `<section class="card" aria-label="Live queue">
    <p class="muted">${escapeHtml(queue.clinicName)} · ${escapeHtml(queue.doctorName)}</p>
    <div class="row"><span>Your token</span><span data-field="your-token">${escapeHtml(formatQueueToken(queue.yourToken))}</span></div>
    <div class="row"><span>Now serving</span><span data-field="current-token">${escapeHtml(formatQueueToken(queue.currentToken))}</span></div>
    <div class="row"><span>People ahead</span><span data-field="ahead">${queue.peopleAhead}</span></div>
    <div class="row"><span>ETA</span><span data-field="eta">${escapeHtml(eta)}</span></div>
    <div class="row"><span>Clinic</span><span data-field="open" class="${openClass}">${queue.clinicOpen ? "Open" : "Closed"}</span></div>
  </section>`;
}

function recordsHtml(chart: VisitChart, linkId: string): string {
  const visits = chart.visits
    .map(
      (visit) =>
        `<li>${escapeHtml(visit.date)} · ${escapeHtml(visit.doctorName)} · token ${visit.tokenNumber} · ${escapeHtml(visit.status)} · ${escapeHtml(visit.feeLabel)}</li>`
    )
    .join("");
  const rxs = chart.prescriptions
    .map((rx) => {
      const meds = rx.medicines
        .map((med) => {
          const directions = [med.dosage, med.frequency, med.timing, med.instructions].filter(Boolean).join(" · ");
          return `<li><strong>${escapeHtml(med.drugName)}</strong>${directions ? ` — ${escapeHtml(directions)}` : ""}</li>`;
        })
        .join("");
      return `<article class="card">
        <p><strong>${escapeHtml(rx.rxNumber)}</strong> · ${escapeHtml(rx.date)} · ${escapeHtml(rx.doctorName)}</p>
        <p>${escapeHtml(rx.diagnosis)}</p>
        <ul>${meds || "<li>No medicine lines</li>"}</ul>
        ${rx.followUpDate ? `<p class="muted">Next visit: ${escapeHtml(rx.followUpDate)}</p>` : ""}
      </article>`;
    })
    .join("");
  const docs = chart.documents
    .map(
      (doc) =>
        `<li><a href="/api/public/visit/${encodeURIComponent(linkId)}/documents/${encodeURIComponent(doc.id)}">${escapeHtml(doc.title)}</a> <span class="muted">${escapeHtml(doc.documentDate)}</span></li>`
    )
    .join("");
  const labs = chart.labReports
    .map((lab) => `<li>${escapeHtml(lab.date)} · ${escapeHtml(lab.labName)} · ${escapeHtml(lab.category)}</li>`)
    .join("");
  return `<h2>Visits</h2><ul>${visits || "<li>No visits yet</li>"}</ul>
    <h2>Prescriptions</h2>${rxs || "<p class='muted'>No prescription yet.</p>"}
    <h2>Reports</h2><ul>${docs || "<li>No uploaded reports</li>"}</ul>
    <h2>Lab results</h2><ul>${labs || "<li>No lab results</li>"}</ul>`;
}

function shell(title: string, linkId: string, body: string): string {
  const script = linkId ? `<script src="/patient-visit.js" defer></script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main data-visit-root data-link-id="${escapeHtml(linkId)}">
    ${body}
    <p class="muted">This link expires. It does not stay signed in. Reply TOKEN on WhatsApp if you need a new code.</p>
  </main>
  ${script}
</body>
</html>`;
}

export function renderMissingVisitPage(): string {
  return shell("Visit link", "", `<h1>This link is not valid</h1><p>Ask the clinic on WhatsApp for a new visit link.</p>`);
}

export function renderExpiredVisitPage(): string {
  return shell("Visit link expired", "", `<h1>This link has expired</h1><p>Reply TOKEN on WhatsApp and the clinic will send a new one.</p>`);
}

export function renderVisitPage(input: {
  linkId: string;
  queue: QueueSnapshot | null;
  chart: VisitChart | null;
  otpError?: string;
}): string {
  const clinic = input.queue?.clinicName || "Your visit";
  const error = input.otpError ? `<p class="err">${escapeHtml(input.otpError)}</p>` : "";
  const form = input.chart
    ? ""
    : `<form method="post" action="/v/${encodeURIComponent(input.linkId)}">
        <label for="otp">Code from WhatsApp</label>
        <input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
        <button type="submit">Open records</button>
      </form>`;
  const chart = input.chart
    ? `<h2>${escapeHtml(input.chart.patient.name)}</h2>${recordsHtml(input.chart, input.linkId)}`
    : `<p class="muted">Enter the 6-digit code from WhatsApp to open visits, prescriptions, and reports. The queue above does not need the code.</p>`;
  return shell(
    clinic,
    input.linkId,
    `<h1>${escapeHtml(clinic)}</h1>${queueCard(input.queue)}${error}${form}${chart}`
  );
}

export function queueJson(queue: QueueSnapshot | null): Record<string, unknown> | null {
  if (!queue) return null;
  const eta =
    queue.etaMinutes == null
      ? queue.visitIsToday
        ? "when the clinic is open"
        : queue.visitDate
      : queue.etaMinutes === 0
        ? "now"
        : `${queue.etaMinutes} min`;
  return {
    yourToken: queue.yourToken,
    yourTokenLabel: formatQueueToken(queue.yourToken),
    currentToken: queue.currentToken,
    currentTokenLabel: formatQueueToken(queue.currentToken),
    peopleAhead: queue.peopleAhead,
    etaMinutes: queue.etaMinutes,
    etaLabel: eta,
    clinicOpen: queue.clinicOpen,
    clinicName: queue.clinicName,
    doctorName: queue.doctorName,
    visitDate: queue.visitDate,
  };
}
