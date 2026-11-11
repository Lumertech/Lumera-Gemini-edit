/**
 * In-browser teleconsult signaling. Media is peer-to-peer WebRTC.
 * This server only stores short-lived offer, answer, and ICE payloads.
 * Production needs HTTPS and a self-hosted TURN server such as coturn.
 * The public STUN server used by the page is stun:stun.l.google.com:19302.
 */
import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";
import { nextTokenNumber } from "./queue-tokens.ts";

const SIGNAL_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PAYLOAD = 20_000;

export function ensureTeleconsultTables(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teleconsult_signals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_teleconsult_signals_visit ON teleconsult_signals(tenant_id, appointment_id, created_at)");
}

export type TeleconsultBooking = {
  id: string;
  tokenNumber: number;
  consultationFee: number;
  type: "Teleconsult";
  doctorName: string;
  date: string;
  timeSlot: string;
};

export function bookTeleconsultAppointment(
  db: SqlDatabase,
  input: { tenantId: string; patientId: string; doctorId: string; date: string; timeSlot: string }
): TeleconsultBooking {
  const patient = db
    .prepare("SELECT id, name, phone, uhid FROM patients WHERE id = ? AND tenant_id = ?")
    .get(input.patientId, input.tenantId) as { id: string; name: string; phone: string; uhid: string } | undefined;
  if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
  const doctor = db
    .prepare(
      `SELECT d.id, d.name, d.specialty, d.consultation_fee
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = ? AND u.tenant_id = ?`
    )
    .get(input.doctorId, input.tenantId) as
    | { id: string; name: string; specialty: string; consultation_fee: number }
    | undefined;
  if (!doctor) throw Object.assign(new Error("Doctor not found"), { status: 404 });
  const date = String(input.date || "").trim();
  const timeSlot = String(input.timeSlot || "").trim() || "09:00 AM";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("date is required"), { status: 400 });
  const token = nextTokenNumber(db, input.tenantId, date, doctor.id);
  const id = `apt-${crypto.randomBytes(6).toString("hex")}`;
  const fee = Number(doctor.consultation_fee || 0);
  db.prepare(
    `INSERT INTO appointments (
       id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
       specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Teleconsult', 'Waiting', 'Front Desk', ?, 0, ?)`
  ).run(
    id,
    input.tenantId,
    token,
    patient.id,
    patient.name,
    patient.phone,
    patient.uhid,
    doctor.id,
    doctor.name,
    doctor.specialty || "General Medicine",
    date,
    timeSlot,
    fee,
    new Date().toISOString()
  );
  return { id, tokenNumber: token, consultationFee: fee, type: "Teleconsult", doctorName: doctor.name, date, timeSlot };
}

export function appendTeleconsultSignal(
  db: SqlDatabase,
  input: { tenantId: string; appointmentId: string; senderRole: "doctor" | "patient"; kind: string; payload: string }
): { id: string } {
  ensureTeleconsultTables(db);
  const visit = db
    .prepare("SELECT id, type FROM appointments WHERE id = ? AND tenant_id = ?")
    .get(input.appointmentId, input.tenantId) as { id: string; type: string } | undefined;
  if (!visit || visit.type !== "Teleconsult") throw Object.assign(new Error("Video visit not found"), { status: 404 });
  const kind = String(input.kind || "").trim();
  if (!["offer", "answer", "ice"].includes(kind)) throw Object.assign(new Error("Unknown signal"), { status: 400 });
  const payload = String(input.payload || "");
  if (!payload || payload.length > MAX_PAYLOAD) throw Object.assign(new Error("Signal payload is empty or too large"), { status: 400 });
  const id = `sig-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO teleconsult_signals (id, tenant_id, appointment_id, sender_role, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.tenantId, input.appointmentId, input.senderRole, kind, payload, new Date().toISOString());
  return { id };
}

export function listTeleconsultSignals(
  db: SqlDatabase,
  tenantId: string,
  appointmentId: string,
  after = ""
): Array<{ id: string; senderRole: string; kind: string; payload: string; createdAt: string }> {
  ensureTeleconsultTables(db);
  const cutoff = new Date(Date.now() - SIGNAL_TTL_MS).toISOString();
  try {
    db.prepare("DELETE FROM teleconsult_signals WHERE created_at < ?").run(cutoff);
  } catch {
    /* keep going if the delete dialect differs */
  }
  const rows = db
    .prepare(
      `SELECT id, sender_role, kind, payload, created_at
       FROM teleconsult_signals
       WHERE tenant_id = ? AND appointment_id = ? AND created_at > ?
       ORDER BY created_at ASC
       LIMIT 100`
    )
    .all(tenantId, appointmentId, after || "1970-01-01T00:00:00.000Z") as Array<Record<string, string>>;
  return rows.map((row) => ({
    id: row.id,
    senderRole: row.sender_role,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}
