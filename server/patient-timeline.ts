import { getDb, mapAppointment, mapInvoice, mapPrescription } from "./db.ts";
import { isReceptionRole } from "./patient-access.ts";
import { consentMethodLabel } from "../src/lib/healthDocumentNotice.ts";
import { formatINR } from "../src/lib/currency.ts";

export type PatientTimelineType = "visit" | "prescription" | "invoice" | "upload" | "consent" | "whatsapp" | "vitals";

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

function phoneLast10(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function samePatientPhone(left: string, right: string): boolean {
  const a = phoneLast10(left);
  const b = phoneLast10(right);
  return Boolean(a) && a === b;
}

function clip(value: string, max = 140): string {
  const text = asText(value).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function vitalsSummary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const vitals = raw as Record<string, unknown>;
  const parts: string[] = [];
  const systolic = asText(vitals.bloodPressureSystolic);
  const diastolic = asText(vitals.bloodPressureDiastolic);
  if (systolic && diastolic) parts.push(`BP ${systolic}/${diastolic}`);
  if (asText(vitals.heartRate)) parts.push(`HR ${asText(vitals.heartRate)}`);
  if (asText(vitals.spO2)) parts.push(`SpO2 ${asText(vitals.spO2)}%`);
  if (asText(vitals.temperature)) parts.push(`${asText(vitals.temperature)}°F`);
  if (asText(vitals.weightKg)) parts.push(`${asText(vitals.weightKg)} kg`);
  return parts.join(" · ");
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
  const patientView = role === "patient";

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
    const vitals = vitalsSummary(visit.vitals);
    if (vitals) {
      items.push({
        id: `vitals:${visit.id}`,
        type: "vitals",
        at,
        title: "Vitals recorded",
        summary: vitals,
        linkView: "appointments",
      });
    }
  }

  // Issued rows only. Autosaved drafts live in prescription_drafts and are never read here.
  const prescriptions = db
    .prepare(`SELECT * FROM prescriptions WHERE tenant_id = ? AND patient_id = ? AND TRIM(COALESCE(rx_number, '')) != ''`)
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
      summary: [invoice.paymentStatus, formatINR(Number(invoice.totalAmount || 0)), invoice.date].filter(Boolean).join(" · "),
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

  const patient = db.prepare("SELECT phone FROM patients WHERE id = ? AND tenant_id = ?").get(patientId, tenantId) as
    | { phone?: string }
    | undefined;
  const patientPhone = asText(patient?.phone);
  if (patientPhone) {
    const inbound = db
      .prepare(
        `SELECT id, sender, content, created_at, patient_phone FROM whatsapp_messages
         WHERE tenant_id = ? AND sender IN ('user', 'patient')`
      )
      .all(tenantId) as Record<string, unknown>[];
    for (const row of inbound) {
      if (!samePatientPhone(patientPhone, asText(row.patient_phone))) continue;
      items.push({
        id: `whatsapp-in:${asText(row.id)}`,
        type: "whatsapp",
        at: asText(row.created_at),
        title: "WhatsApp message received",
        summary: clip(asText(row.content)),
      });
    }
    const templates = db
      .prepare(
        `SELECT id, event_type, details, action_payload, sent_at, patient_phone FROM whatsapp_outbound_events
         WHERE tenant_id = ?`
      )
      .all(tenantId) as Record<string, unknown>[];
    for (const row of templates) {
      if (!samePatientPhone(patientPhone, asText(row.patient_phone))) continue;
      if (patientView) {
        items.push({
          id: `whatsapp-out:${asText(row.id)}`,
          type: "whatsapp",
          at: asText(row.sent_at),
          title: "WhatsApp template sent",
          summary: "",
        });
        continue;
      }
      const kind = asText(row.event_type).replace(/_/g, " ");
      items.push({
        id: `whatsapp-out:${asText(row.id)}`,
        type: "whatsapp",
        at: asText(row.sent_at),
        title: "WhatsApp template sent",
        summary: [kind, clip(asText(row.details))].filter(Boolean).join(" · "),
      });
    }
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
