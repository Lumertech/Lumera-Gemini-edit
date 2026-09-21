import { getDb, mapAppointment, mapPatient, writeAudit } from "./db.ts";
import {
  appointmentPhoneFromPatient,
  getTenantAppointment,
  getTenantPatient,
  insertAppointment,
  insertPatient,
  updateAppointment,
} from "./clinical.ts";
import { findDoctor, findPatientByPhoneInTenant } from "./whatsapp-tenant-resolve.ts";

export function normalizePhoneDigits(phone: string): string {
  let digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.slice(-10) === right.slice(-10) && Math.min(left.length, right.length) >= 10;
}

function tenantExists(tenantId: string): boolean {
  if (!tenantId) return false;
  try {
    return Boolean(getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId));
  } catch {
    return false;
  }
}

function findPatientsByPhone(phone: string): Record<string, unknown>[] {
  try {
    const rows = getDb().prepare("SELECT * FROM patients").all() as Record<string, unknown>[];
    return rows.filter((row) => phonesMatch(String(row.phone || ""), phone));
  } catch {
    return [];
  }
}

export function findOrCreateWhatsAppPatient(opts: {
  tenantId: string;
  phone: string;
  name?: string;
}): Record<string, unknown> {
  const existing = findPatientByPhoneInTenant(opts.tenantId, opts.phone);
  if (existing) return existing;

  const elsewhere = findPatientsByPhone(opts.phone).find(
    (row) => String(row.tenant_id || "").trim() && String(row.tenant_id) !== opts.tenantId
  );
  if (elsewhere) {
    throw Object.assign(new Error("Patient phone is registered to another clinic"), { status: 409 });
  }

  return insertPatient(opts.tenantId, {
    name: String(opts.name || "").trim() || "WhatsApp Patient",
    phone: opts.phone,
    gender: "Other",
  });
}

const ACTIVE_APPOINTMENT_SQL = `status NOT IN ('Completed', 'Cancelled', 'No-Show')`;

function withLivePatientPhone(
  tenantId: string,
  row: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const status = String(row.status || "");
  if (status === "Completed" || status === "Cancelled" || status === "No-Show") return row;
  const patientId = String(row.patient_id || "");
  if (!patientId || !getTenantPatient(tenantId, patientId)) return row;
  const next = appointmentPhoneFromPatient(tenantId, patientId, String(row.patient_phone || ""));
  const snapshot = String(row.patient_phone || "").trim();
  if (!next || next === snapshot) return row;
  getDb()
    .prepare("UPDATE appointments SET patient_phone = ? WHERE id = ? AND tenant_id = ?")
    .run(next, String(row.id), tenantId);
  row.patient_phone = next;
  return row;
}

export function findActiveAppointment(opts: {
  tenantId: string;
  patientId?: string;
  patientPhone?: string;
  doctorId?: string;
  date?: string;
  appointmentId?: string;
}): Record<string, unknown> | undefined {
  if (opts.appointmentId) {
    return withLivePatientPhone(opts.tenantId, getTenantAppointment(opts.tenantId, opts.appointmentId));
  }

  const db = getDb();
  if (opts.patientId && opts.date) {
    const row = opts.doctorId
      ? (db
          .prepare(
            `SELECT * FROM appointments
             WHERE tenant_id = ? AND patient_id = ? AND date = ? AND doctor_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(opts.tenantId, opts.patientId, opts.date, opts.doctorId) as Record<string, unknown> | undefined)
      : (db
          .prepare(
            `SELECT * FROM appointments
             WHERE tenant_id = ? AND patient_id = ? AND date = ? AND ${ACTIVE_APPOINTMENT_SQL}
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(opts.tenantId, opts.patientId, opts.date) as Record<string, unknown> | undefined);
    if (row) return withLivePatientPhone(opts.tenantId, row);
  }

  if (opts.patientId) {
    const row = db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? AND patient_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
         ORDER BY date ASC, created_at DESC LIMIT 1`
      )
      .get(opts.tenantId, opts.patientId) as Record<string, unknown> | undefined;
    return withLivePatientPhone(opts.tenantId, row);
  }

  if (opts.patientPhone) {
    const rows = db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
         ORDER BY date ASC, created_at DESC`
      )
      .all(opts.tenantId) as Record<string, unknown>[];
    const bySnapshot = rows.find((row) => phonesMatch(String(row.patient_phone || ""), opts.patientPhone || ""));
    if (bySnapshot) return withLivePatientPhone(opts.tenantId, bySnapshot);
    const patient = findPatientByPhoneInTenant(opts.tenantId, opts.patientPhone);
    if (!patient?.id) return undefined;
    const byPatient = rows.find((row) => String(row.patient_id || "") === String(patient.id));
    return withLivePatientPhone(opts.tenantId, byPatient);
  }

  return undefined;
}

export function bookWhatsAppAppointment(opts: {
  tenantId: string;
  patientPhone: string;
  patientName?: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  timeSlot?: string;
  type?: string;
}): { appointment: ReturnType<typeof mapAppointment>; reused: boolean; patient: ReturnType<typeof mapPatient> } {
  const tenantId = String(opts.tenantId || "").trim();
  if (!tenantId) {
    throw Object.assign(new Error("tenantId is required to book a WhatsApp appointment"), { status: 400 });
  }
  if (!tenantExists(tenantId)) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }

  const doctor = findDoctor({
    tenantId,
    doctorId: opts.doctorId,
    doctorName: opts.doctorName,
  });
  if (opts.doctorId && !doctor) {
    throw Object.assign(new Error("Doctor not found"), { status: 404 });
  }

  const patient = findOrCreateWhatsAppPatient({
    tenantId,
    phone: opts.patientPhone,
    name: opts.patientName,
  });
  const mappedPatient = mapPatient(patient);
  const date = String(opts.date || new Date().toISOString().slice(0, 10));
  const timeSlot = String(opts.timeSlot || "").trim() || defaultTimeSlot();

  const existing = findActiveAppointment({
    tenantId,
    patientId: mappedPatient.id,
    doctorId: doctor ? String(doctor.id) : undefined,
    date,
  });
  if (existing) {
    return { appointment: mapAppointment(existing), reused: true, patient: mappedPatient };
  }

  const row = insertAppointment(
    tenantId,
    {
      patientId: mappedPatient.id,
      doctorId: doctor ? String(doctor.id) : "",
      doctorName: doctor ? String(doctor.name) : opts.doctorName || "",
      specialty: doctor ? String(doctor.specialty) : "General Medicine",
      date,
      timeSlot,
      type: opts.type || "New Consultation",
      source: "WhatsApp Bot",
      status: "Waiting",
      consultationFee: doctor ? Number(doctor.consultation_fee || 0) : 0,
      isPaid: false,
    },
    { name: "WhatsApp Bot" }
  );
  const appointment = mapAppointment(row);
  writeAudit(
    getDb(),
    null,
    "WhatsApp Bot",
    "Appointment created",
    `${appointment.patientName} token ${appointment.tokenNumber} via WhatsApp`
  );
  return { appointment, reused: false, patient: mappedPatient };
}

function defaultTimeSlot(): string {
  return "09:00 AM";
}

export function patchWhatsAppAppointment(opts: {
  tenantId: string;
  appointmentId?: string;
  patientPhone?: string;
  patientId?: string;
  body: Record<string, unknown>;
}): ReturnType<typeof mapAppointment> {
  const existing = findActiveAppointment({
    tenantId: opts.tenantId,
    appointmentId: opts.appointmentId,
    patientPhone: opts.patientPhone,
    patientId: opts.patientId,
  });
  if (!existing) {
    throw Object.assign(new Error("Appointment not found"), { status: 404 });
  }
  const row = updateAppointment(opts.tenantId, String(existing.id), opts.body);
  return mapAppointment(row);
}

export function getWhatsAppQueue(opts: {
  tenantId: string;
  patientPhone?: string;
  patientId?: string;
}): {
  hasAppointment: boolean;
  appointment?: ReturnType<typeof mapAppointment> & { patientsAhead: number; estimatedWaitMins: number };
  message?: string;
} {
  const current = findActiveAppointment({
    tenantId: opts.tenantId,
    patientPhone: opts.patientPhone,
    patientId: opts.patientId,
  });
  if (!current) {
    return { hasAppointment: false, message: "No active OPD booking found for today." };
  }
  const mapped = mapAppointment(current);
  const ahead = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM appointments
       WHERE tenant_id = ? AND doctor_id = ? AND date = ? AND status = 'Waiting' AND token_number < ?`
    )
    .get(opts.tenantId, mapped.doctorId, mapped.date, mapped.tokenNumber) as { count: number };
  const patientsAhead = Number(ahead?.count || 0);
  return {
    hasAppointment: true,
    appointment: {
      ...mapped,
      patientsAhead,
      estimatedWaitMins: patientsAhead * 12 + 5,
    },
  };
}

export function httpErrorStatus(err: unknown): number {
  if (typeof err === "object" && err && "status" in err) {
    const status = Number((err as { status: number }).status);
    if (Number.isFinite(status) && status >= 400) return status;
  }
  return 500;
}
