import type { ChartDose } from "./immunizationSchedules.ts";
import { IMMUNIZATION_SAFETY_NOTICE } from "./immunizationSchedules.ts";

export interface ImmunizationPrintLetterhead {
  clinicName: string;
  tagline?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  regId?: string;
}

export interface ImmunizationPrintChart {
  patientName: string;
  uhid?: string;
  dateOfBirth: string;
  species?: string;
  breed?: string;
  ownerName?: string;
  scheduleTitle: string;
  scheduleVersion: string;
  citation: string;
  doses: ChartDose[];
}

const STATUS_LABEL: Record<string, string> = {
  given: "Given",
  due: "Due",
  overdue: "Overdue",
  upcoming: "Upcoming",
  skipped: "Skipped",
  contraindicated: "Contraindicated",
  not_indicated: "Not indicated",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string): string {
  if (!value) return "";
  return `<p><span class="label">${esc(label)}</span> ${esc(value)}</p>`;
}

/**
 * Printable immunization chart on the clinic letterhead.
 * Vertical blocks only, so a phone print preview does not need a sideways table.
 */
export function buildImmunizationPrintHtml(
  letterhead: ImmunizationPrintLetterhead,
  chart: ImmunizationPrintChart
): string {
  const clinic = [letterhead.address, letterhead.city].filter(Boolean).join(", ");
  const contact = [letterhead.phone, letterhead.email].filter(Boolean).join(" · ");
  const doses = chart.doses
    .map((dose) => {
      const bits = [
        row("Status", STATUS_LABEL[dose.status] || dose.status),
        row("Due", dose.dueOn),
        dose.status === "given" ? row("Given", dose.givenOn) : "",
        dose.brand ? row("Brand", dose.brand) : "",
        dose.batchNo ? row("Batch", dose.batchNo) : "",
        dose.givenByName ? row("Given by", dose.givenByName) : "",
        dose.reason ? row("Reason", dose.reason) : "",
        dose.catchUp ? row("Catch-up", dose.catchUpNote) : "",
        dose.notes ? row("Note", dose.notes) : "",
      ]
        .filter(Boolean)
        .join("");
      return `<section class="dose"><h2>${esc(dose.antigen)} — ${esc(dose.doseLabel)}</h2>${bits}</section>`;
    })
    .join("");
  const identity = [
    row("Patient", chart.patientName),
    chart.uhid ? row("UHID", chart.uhid) : "",
    row("Date of birth", chart.dateOfBirth),
    chart.species ? row("Species", chart.species) : "",
    chart.breed ? row("Breed", chart.breed) : "",
    chart.ownerName ? row("Owner", chart.ownerName) : "",
  ]
    .filter(Boolean)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(letterhead.clinicName || "Clinic")} immunization chart</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #1c1917; margin: 24px; }
    header { border-bottom: 2px solid #1c1917; padding-bottom: 12px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 0 0 6px; }
    .muted { color: #44403c; font-size: 13px; margin: 2px 0; }
    .label { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #57534e; }
    .dose { border: 1px solid #d6d3d1; border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; break-inside: avoid; }
    .safety { font-size: 12px; margin-top: 16px; }
    @media print { body { margin: 12mm; } .dose { break-inside: avoid; } }
  </style>
</head>
<body>
  <header>
    <h1>${esc(letterhead.clinicName || "Clinic")}</h1>
    ${letterhead.tagline ? `<p class="muted">${esc(letterhead.tagline)}</p>` : ""}
    ${clinic ? `<p class="muted">${esc(clinic)}</p>` : ""}
    ${contact ? `<p class="muted">${esc(contact)}</p>` : ""}
    ${letterhead.regId ? `<p class="muted">Reg. ${esc(letterhead.regId)}</p>` : ""}
  </header>
  <p><strong>${esc(chart.scheduleTitle)}</strong></p>
  <p class="muted">Schedule version ${esc(chart.scheduleVersion)}</p>
  ${identity}
  ${doses || "<p>No doses on this chart.</p>"}
  <p class="safety">${esc(IMMUNIZATION_SAFETY_NOTICE)}</p>
  <p class="muted">${esc(chart.citation)}</p>
</body>
</html>`;
}
