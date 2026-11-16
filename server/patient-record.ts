import crypto from "node:crypto";
import { getDb } from "./db.ts";
import { isReceptionRole } from "./patient-access.ts";

const NOTE_MAX = 4000;

export type ChartNote = {
  id: string;
  at: string;
  appointmentId: string;
  authorName?: string;
  body?: string;
  redacted?: true;
};

export type ChartDiagnosis = {
  id: string;
  label: string;
  icd10: string;
  at: string;
  doctorName: string;
  prescriptionId: string;
};

export type ChartVitalsEntry = {
  id: string;
  appointmentId: string;
  at: string;
  date: string;
  summary: string;
};

type NoteRow = {
  id: string;
  appointment_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function cleanNoteBody(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) throw httpError(400, "Write the note before saving.");
  if (text.length > NOTE_MAX) throw httpError(400, "A note can be 4000 characters or less.");
  return text;
}

export function vitalsSummary(raw: unknown): string {
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

function parseVitals(raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/** Reception sees that a note exists. The words stay with the prescriber and the patient. */
export function presentNote(row: NoteRow, role: string): ChartNote {
  const base = {
    id: row.id,
    at: row.created_at,
    appointmentId: asText(row.appointment_id),
  };
  if (isReceptionRole(role)) return { ...base, redacted: true };
  return { ...base, authorName: asText(row.author_name), body: row.body };
}

export function listChartNotes(tenantId: string, patientId: string, role: string): ChartNote[] {
  const rows = getDb()
    .prepare(
      `SELECT id, appointment_id, author_name, body, created_at
       FROM clinical_notes
       WHERE tenant_id = ? AND patient_id = ?
       ORDER BY created_at DESC`
    )
    .all(tenantId, patientId) as NoteRow[];
  return rows.map((row) => presentNote(row, role));
}

export function listChartNoteRows(tenantId: string, patientId: string): NoteRow[] {
  try {
    return getDb()
      .prepare(
        `SELECT id, appointment_id, author_name, body, created_at
         FROM clinical_notes
         WHERE tenant_id = ? AND patient_id = ?
         ORDER BY created_at DESC`
      )
      .all(tenantId, patientId) as NoteRow[];
  } catch (err) {
    if (/no such table/i.test(err instanceof Error ? err.message : String(err))) return [];
    throw err;
  }
}

/** Issued prescriptions only. Draft rows never become a diagnosis on the chart. */
export function listChartDiagnoses(tenantId: string, patientId: string, role: string): ChartDiagnosis[] {
  if (isReceptionRole(role)) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, diagnosis, icd10_code, doctor_name, date, created_at
       FROM prescriptions
       WHERE tenant_id = ? AND patient_id = ? AND TRIM(COALESCE(rx_number, '')) != ''
       ORDER BY date DESC, created_at DESC`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  const seen = new Set<string>();
  const diagnoses: ChartDiagnosis[] = [];
  for (const row of rows) {
    const label = asText(row.diagnosis);
    if (!label) continue;
    const icd10 = asText(row.icd10_code);
    const key = `${label.toLowerCase()}|${icd10.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnoses.push({
      id: `dx:${asText(row.id)}`,
      label,
      icd10,
      at: asText(row.created_at) || asText(row.date),
      doctorName: asText(row.doctor_name),
      prescriptionId: asText(row.id),
    });
  }
  return diagnoses;
}

export function listChartVitals(tenantId: string, patientId: string): ChartVitalsEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, date, created_at, vitals
       FROM appointments
       WHERE tenant_id = ? AND patient_id = ? AND vitals IS NOT NULL AND TRIM(vitals) != '' AND TRIM(vitals) != 'null'
       ORDER BY date DESC, created_at DESC`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  const entries: ChartVitalsEntry[] = [];
  for (const row of rows) {
    const summary = vitalsSummary(parseVitals(row.vitals));
    if (!summary) continue;
    entries.push({
      id: `vitals:${asText(row.id)}`,
      appointmentId: asText(row.id),
      at: asText(row.created_at) || asText(row.date),
      date: asText(row.date),
      summary,
    });
  }
  return entries;
}

export function presentChartRecord(tenantId: string, patientId: string, role: string) {
  return {
    notes: listChartNotes(tenantId, patientId, role),
    diagnoses: listChartDiagnoses(tenantId, patientId, role),
    vitalsHistory: listChartVitals(tenantId, patientId),
  };
}

export function insertClinicalNote(
  tenantId: string,
  patientId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string; role: string }
): ChartNote {
  const patient = getDb()
    .prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as { id?: string } | undefined;
  if (!patient?.id) throw httpError(404, "Patient not found");
  const text = cleanNoteBody(body.body ?? body.note);
  const appointmentId = asText(body.appointmentId ?? body.appointment_id);
  if (appointmentId) {
    const visit = getDb()
      .prepare("SELECT id FROM appointments WHERE id = ? AND tenant_id = ? AND patient_id = ?")
      .get(appointmentId, tenantId, patientId) as { id?: string } | undefined;
    if (!visit?.id) throw httpError(400, "That visit is not on this chart.");
  }
  const id = `note-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO clinical_notes (
        id, tenant_id, patient_id, appointment_id, author_id, author_name, author_role, body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, tenantId, patientId, appointmentId, actor.id, actor.name, actor.role, text, now);
  return presentNote(
    {
      id,
      appointment_id: appointmentId,
      author_name: actor.name,
      body: text,
      created_at: now,
    },
    actor.role
  );
}
