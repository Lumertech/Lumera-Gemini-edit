import { getDb, mapAppointment, mapInvoice, mapPrescription } from "./db.ts";
import { isReceptionRole } from "./patient-access.ts";
import { consentMethodLabel } from "../src/lib/healthDocumentNotice.ts";
import { formatInr } from "../src/lib/money.ts";

export type PatientTimelineType = "visit" | "prescription" | "invoice" | "upload" | "consent";

export type PatientTimelineItem = {
  id: string;
  type: PatientTimelineType;
  at: string;
  title: string;
  summary: string;
  linkView?: "appointments" | "rx" | "billing";
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function sortKey(value: string): string {
  const raw = asText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  return raw || "1970-01-01T00:00:00.000Z";
}

export function presentPrescriptionForRole(row: Record<string, unknown>, role: string) {
  const mapped = mapPrescription(row);
  if (!isReceptionRole(role)) return mapped;
  return {
    id: mapped.id,
    rxNumber: mapped.rxNumber,
    patientId: mapped.patientId,
    patientName: mapped.patientName,
    doctorName: mapped.doctorName,
    date: mapped.date,
    redacted: true as const,
  };
}

export function buildPatientTimeline(tenantId: string, patientId: string, role: string): PatientTimelineItem[] {
  const db = getDb();
  const items: PatientTimelineItem[] = [];
  const reception = isReceptionRole(role);

  const visits = db
    .prepare(
      `SELECT * FROM appointments WHERE tenant_id = ? AND patient_id = ?`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  for (const row of visits) {
    const visit = mapAppointment(row);
    const at = asText(row.created_at) || asText(visit.date);
    items.push({
      id: `visit:${visit.id}`,
      type: "visit",
      at,
      title: visit.type || "Visit",
      summary: [visit.date, visit.timeSlot, visit.status, visit.doctorName].filter(Boolean).join(" · "),
      linkView: "appointments",
    });
  }

  const prescriptions = db
    .prepare(`SELECT * FROM prescriptions WHERE tenant_id = ? AND patient_id = ?`)
    .all(tenantId, patientId) as Record<string, unknown>[];
  for (const row of prescriptions) {
    const rx = mapPrescription(row);
    const at = asText(row.created_at) || asText(rx.date);
    if (reception) {
      items.push({
        id: `rx:${rx.id}`,
        type: "prescription",
        at,
        title: "Rx issued",
        summary: [rx.doctorName, rx.date].filter(Boolean).join(", "),
      });
      continue;
    }
    items.push({
      id: `rx:${rx.id}`,
      type: "prescription",
      at,
      title: rx.rxNumber || "Prescription",
      summary: [rx.doctorName, rx.date, rx.diagnosis].filter(Boolean).join(" · "),
      linkView: "rx",
    });
  }

  const invoices = db
    .prepare(`SELECT * FROM invoices WHERE tenant_id = ? AND patient_id = ?`)
    .all(tenantId, patientId) as Record<string, unknown>[];
  for (const row of invoices) {
    const invoice = mapInvoice(row);
    const at = asText(row.created_at) || asText(invoice.date);
    items.push({
      id: `invoice:${invoice.id}`,
      type: "invoice",
      at,
      title: invoice.invoiceNumber || "Invoice",
      summary: [invoice.paymentStatus, formatInr(Number(invoice.totalAmount || 0)), invoice.date].filter(Boolean).join(" · "),
      linkView: "billing",
    });
  }

  const documents = db
    .prepare(
      `SELECT id, title, doc_type, document_date, created_at FROM patient_documents
       WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  for (const row of documents) {
    items.push({
      id: `upload:${asText(row.id)}`,
      type: "upload",
      at: asText(row.created_at) || asText(row.document_date),
      title: asText(row.title) || "Report",
      summary: [asText(row.doc_type).replace(/_/g, " "), asText(row.document_date)].filter(Boolean).join(" · "),
    });
  }

  const consents = db
    .prepare(
      `SELECT id, event, method, captured_at, language FROM patient_health_document_consents
       WHERE tenant_id = ? AND patient_id = ?`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  for (const row of consents) {
    const withdrawn = asText(row.event) === "withdrawn";
    items.push({
      id: `consent:${asText(row.id)}`,
      type: "consent",
      at: asText(row.captured_at),
      title: withdrawn ? "Consent withdrawn" : "Consent recorded",
      summary: withdrawn
        ? "New reports will not be stored. Existing reports stay for the retention period."
        : [consentMethodLabel(asText(row.method)), asText(row.language).toUpperCase()].filter(Boolean).join(" · "),
    });
  }

  items.sort((a, b) => sortKey(b.at).localeCompare(sortKey(a.at)));
  return items;
}
