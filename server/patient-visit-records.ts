/**
 * Chart shown on the visit link after the WhatsApp code. Scoped to the link's tenant and patient.
 * Report bytes are a separate request. This payload has no storage keys.
 */
import type { SqlDatabase } from "./sql-engine.ts";
import { formatINR } from "../src/lib/currency.ts";
import { HIDDEN_AMBIENT_SOURCES, hiddenVisitSourceSql } from "./ambient-walkin.ts";
import { queueSnapshotFromAppointment, type QueueSnapshot } from "./patient-queue-status.ts";
import type { PatientVisitLinkRow } from "./patient-visit-token.ts";

export type VisitChart = {
  patient: { name: string; age: number; gender: string };
  queue: QueueSnapshot | null;
  visits: Array<{ id: string; date: string; doctorName: string; status: string; type: string; tokenNumber: number; feeLabel: string }>;
  prescriptions: Array<{
    id: string;
    rxNumber: string;
    date: string;
    doctorName: string;
    diagnosis: string;
    advice: string[];
    followUpDate: string;
    medicines: Array<{ drugName: string; dosage: string; frequency: string; timing: string; instructions: string }>;
  }>;
  documents: Array<{ id: string; title: string; docType: string; documentDate: string }>;
  labReports: Array<{ id: string; date: string; labName: string; category: string }>;
};

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadVisitChart(db: SqlDatabase, link: PatientVisitLinkRow): VisitChart | null {
  const patient = db
    .prepare("SELECT id, name, age, gender FROM patients WHERE id = ? AND tenant_id = ?")
    .get(link.patient_id, link.tenant_id) as { id: string; name: string; age: number; gender: string } | undefined;
  if (!patient) return null;

  let queue: QueueSnapshot | null = null;
  if (link.appointment_id) {
    const appointment = db
      .prepare("SELECT * FROM appointments WHERE id = ? AND tenant_id = ? AND patient_id = ?")
      .get(link.appointment_id, link.tenant_id, link.patient_id) as Record<string, unknown> | undefined;
    if (appointment) queue = queueSnapshotFromAppointment(db, appointment);
  }

  const visitRows = db
    .prepare(
      `SELECT id, date, doctor_name, status, type, token_number, consultation_fee
       FROM appointments
       WHERE tenant_id = ? AND patient_id = ? AND ${hiddenVisitSourceSql()}
       ORDER BY date DESC, created_at DESC
       LIMIT 30`
    )
    .all(link.tenant_id, link.patient_id, ...HIDDEN_AMBIENT_SOURCES) as Array<Record<string, unknown>>;

  const rxRows = db
    .prepare(
      `SELECT id, rx_number, date, doctor_name, diagnosis, advice, follow_up_date, medicines
       FROM prescriptions
       WHERE tenant_id = ? AND patient_id = ?
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all(link.tenant_id, link.patient_id) as Array<Record<string, unknown>>;

  let documents: VisitChart["documents"] = [];
  try {
    documents = (
      db
        .prepare(
          `SELECT id, title, doc_type, document_date
           FROM patient_documents
           WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT 30`
        )
        .all(link.tenant_id, link.patient_id) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id || ""),
      title: String(row.title || "Report"),
      docType: String(row.doc_type || "other"),
      documentDate: String(row.document_date || ""),
    }));
  } catch {
    documents = [];
  }

  let labReports: VisitChart["labReports"] = [];
  try {
    labReports = (
      db
        .prepare(
          `SELECT id, date, lab_name, category FROM lab_reports
           WHERE tenant_id = ? AND patient_id = ?
           ORDER BY created_at DESC LIMIT 30`
        )
        .all(link.tenant_id, link.patient_id) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id || ""),
      date: String(row.date || ""),
      labName: String(row.lab_name || ""),
      category: String(row.category || ""),
    }));
  } catch {
    labReports = [];
  }

  return {
    patient: {
      name: String(patient.name || ""),
      age: Number(patient.age || 0),
      gender: String(patient.gender || ""),
    },
    queue,
    visits: visitRows.map((row) => ({
      id: String(row.id || ""),
      date: String(row.date || ""),
      doctorName: String(row.doctor_name || ""),
      status: String(row.status || ""),
      type: String(row.type || ""),
      tokenNumber: Number(row.token_number || 0),
      feeLabel: formatINR(Number(row.consultation_fee || 0)),
    })),
    prescriptions: rxRows.map((row) => ({
      id: String(row.id || ""),
      rxNumber: String(row.rx_number || ""),
      date: String(row.date || ""),
      doctorName: String(row.doctor_name || ""),
      diagnosis: String(row.diagnosis || ""),
      advice: parseJsonArray(row.advice).map((item) => String(item)),
      followUpDate: String(row.follow_up_date || ""),
      medicines: parseJsonArray(row.medicines).map((item) => {
        const med = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          drugName: String(med.drugName || med.drug_name || ""),
          dosage: String(med.dosage || ""),
          frequency: String(med.frequency || ""),
          timing: String(med.timing || ""),
          instructions: String(med.instructions || ""),
        };
      }),
    })),
    documents,
    labReports,
  };
}
