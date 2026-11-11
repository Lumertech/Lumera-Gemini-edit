import { HIDDEN_AMBIENT_SOURCES, hiddenVisitSourceSql, isHiddenVisitSource } from "./ambient-walkin.ts";
import { getDb, mapAppointment, mapPatient, writeAudit } from "./db.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import {
  appointmentPhoneFromPatient,
  getTenantAppointment,
  getTenantPatient,
  insertAppointment,
  insertPatient,
  tenantTimezone,
  updateAppointment,
} from "./clinical.ts";
import { findDoctor, findPatientByPhoneInTenant } from "./whatsapp-tenant-resolve.ts";
import {
  formatMinutesToTime,
  getClinicScheduleSettings,
  istClockMinutes,
  parseTimeToMinutes,
  scheduleSlotFreeStatusSql,
} from "./clinic-schedule.ts";

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

const ACTIVE_APPOINTMENT_SQL = `status NOT IN ('Completed', 'Cancelled', 'No-Show') AND ${hiddenVisitSourceSql()}`;

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
    const named = getTenantAppointment(opts.tenantId, opts.appointmentId);
    if (!named || isHiddenVisitSource(named.source)) return undefined;
    return withLivePatientPhone(opts.tenantId, named);
  }

  const db = getDb();
  if (opts.patientId) {
    if (opts.date) {
      const row = opts.doctorId
        ? (db
            .prepare(
              `SELECT * FROM appointments
               WHERE tenant_id = ? AND patient_id = ? AND date = ? AND doctor_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
               ORDER BY created_at DESC LIMIT 1`
            )
            .get(opts.tenantId, opts.patientId, opts.date, opts.doctorId, ...HIDDEN_AMBIENT_SOURCES) as Record<string, unknown> | undefined)
        : (db
            .prepare(
              `SELECT * FROM appointments
               WHERE tenant_id = ? AND patient_id = ? AND date = ? AND ${ACTIVE_APPOINTMENT_SQL}
               ORDER BY created_at DESC LIMIT 1`
            )
            .get(opts.tenantId, opts.patientId, opts.date, ...HIDDEN_AMBIENT_SOURCES) as Record<string, unknown> | undefined);
      if (row) return withLivePatientPhone(opts.tenantId, row);
      return undefined;
    }

    const row = opts.doctorId
      ? (db
          .prepare(
            `SELECT * FROM appointments
             WHERE tenant_id = ? AND patient_id = ? AND doctor_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
             ORDER BY date ASC, created_at DESC LIMIT 1`
          )
          .get(opts.tenantId, opts.patientId, opts.doctorId, ...HIDDEN_AMBIENT_SOURCES) as Record<string, unknown> | undefined)
      : (db
          .prepare(
            `SELECT * FROM appointments
             WHERE tenant_id = ? AND patient_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
             ORDER BY date ASC, created_at DESC LIMIT 1`
          )
          .get(opts.tenantId, opts.patientId, ...HIDDEN_AMBIENT_SOURCES) as Record<string, unknown> | undefined);
    if (row) return withLivePatientPhone(opts.tenantId, row);
  }

  if (opts.patientPhone) {
    const dateClause = opts.date ? "AND date = ?" : "";
    const params = opts.date
      ? [opts.tenantId, opts.date, ...HIDDEN_AMBIENT_SOURCES]
      : [opts.tenantId, ...HIDDEN_AMBIENT_SOURCES];
    const rows = db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? ${dateClause} AND ${ACTIVE_APPOINTMENT_SQL}
         ORDER BY date ASC, created_at DESC`
      )
      .all(...params) as Record<string, unknown>[];
    const bySnapshot = rows.find(
      (row) =>
        phonesMatch(String(row.patient_phone || ""), opts.patientPhone || "") &&
        (!opts.doctorId || String(row.doctor_id || "") === opts.doctorId)
    );
    if (bySnapshot) return withLivePatientPhone(opts.tenantId, bySnapshot);
    const patient = findPatientByPhoneInTenant(opts.tenantId, opts.patientPhone);
    if (!patient?.id) return undefined;
    const byPatient = rows.find(
      (row) =>
        String(row.patient_id || "") === String(patient.id) &&
        (!opts.doctorId || String(row.doctor_id || "") === opts.doctorId)
    );
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
  const requestedDate = String(opts.date || "").trim() || clinicCalendarDate(new Date(), tenantTimezone(tenantId));
  const explicitSlot = String(opts.timeSlot || "").trim();
  const found = explicitSlot
    ? { date: requestedDate, timeSlot: explicitSlot }
    : findNextBookableSlot({
        tenantId,
        doctorId: doctor ? String(doctor.id) : opts.doctorId,
        doctorName: doctor ? String(doctor.name) : opts.doctorName,
        date: requestedDate,
      });
  if (!found) {
    throw Object.assign(new Error("No open clinic slot"), { status: 409 });
  }
  const date = found.date;
  const timeSlot = found.timeSlot;

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

function addDaysIso(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

function isSunday(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() === 0;
}

function clockTokenMinutes(timing: string | undefined, which: "start" | "end"): number | null {
  const matches = [...String(timing || "").matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi)];
  const match = which === "start" ? matches[0] : matches[1];
  if (!match) return null;
  return parseTimeToMinutes(`${match[1]}:${match[2]} ${match[3]}`);
}

function slotOnClinicDate(opts: {
  tenantId: string;
  doctorId?: string;
  doctorName?: string;
  date: string;
  now: Date;
  today: string;
}): string | null {
  const db = getDb();
  const tenantId = opts.tenantId;
  const date = opts.date;
  const doctor = findDoctor({
    tenantId,
    doctorId: opts.doctorId,
    doctorName: opts.doctorName,
  });
  const docId = doctor ? String(doctor.id) : "";
  const scheduleSettings = getClinicScheduleSettings(db, tenantId, docId);
  const duration = Math.max(1, scheduleSettings.slotDurationMinutes || 15);
  const maxOverlap = Math.max(1, scheduleSettings.slotOverlapMax || 1);

  let bookedSlots: Array<{ time_slot?: string }> = [];
  try {
    bookedSlots = db
      .prepare(
        `SELECT time_slot FROM appointments
         WHERE tenant_id = ? AND date = ? AND (doctor_id = ? OR doctor_name = ?)
           AND ${scheduleSlotFreeStatusSql("status")}`
      )
      .all(tenantId, date, docId, String(doctor?.name || opts.doctorName || "")) as Array<{ time_slot?: string }>;
  } catch {
    bookedSlots = [];
  }

  const slotCountMap = new Map<string, number>();
  for (const booked of bookedSlots) {
    const raw = String(booked.time_slot || "").trim();
    if (!raw) continue;
    const mins = parseTimeToMinutes(raw, -1);
    const key = mins >= 0 ? formatMinutesToTime(mins) : raw;
    slotCountMap.set(key, (slotCountMap.get(key) || 0) + 1);
  }

  let startMinutes = 540;
  const doctorStart = clockTokenMinutes(String(doctor?.opd_timing || ""), "start");
  if (doctorStart != null) startMinutes = doctorStart;
  else if (scheduleSettings.opdStartTime) startMinutes = parseTimeToMinutes(scheduleSettings.opdStartTime, 540);

  const clinicEnd = parseTimeToMinutes(scheduleSettings.opdEndTime, 1020);
  const doctorEnd = clockTokenMinutes(String(doctor?.opd_timing || ""), "end");
  let endMinutes = clinicEnd;
  if (doctorEnd != null && doctorEnd > startMinutes && startMinutes >= clinicEnd) {
    // Evening (or any) hours that start after the clinic close keep the doctor's own end.
    endMinutes = doctorEnd;
  } else if (doctorEnd != null && doctorEnd > startMinutes) {
    endMinutes = Math.min(clinicEnd, doctorEnd);
  } else if (startMinutes >= clinicEnd) {
    endMinutes = Math.min(startMinutes + 8 * 60, 24 * 60);
  }
  if (endMinutes <= startMinutes) return null;

  let cursor = startMinutes;
  if (date === opts.today) {
    const nowMins = istClockMinutes(opts.now);
    if (nowMins >= endMinutes) return null;
    while (cursor <= nowMins) {
      cursor += duration;
      if (cursor >= endMinutes) return null;
    }
  }

  for (; cursor < endMinutes; cursor += duration) {
    const candidate = formatMinutesToTime(cursor);
    if ((slotCountMap.get(candidate) || 0) < maxOverlap) return candidate;
  }
  return null;
}

/** Next open chair on the requested day, or the next Mon–Sat day when that day is full or already over. */
export function findNextBookableSlot(opts: {
  tenantId: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  now?: Date;
  horizonDays?: number;
}): { date: string; timeSlot: string } | null {
  const tenantId = String(opts.tenantId || "").trim();
  const now = opts.now ?? new Date();
  const today = clinicCalendarDate(now, "Asia/Kolkata");
  let date = String(opts.date || "").trim() || today;
  const horizon = Math.max(1, opts.horizonDays ?? 14);
  for (let i = 0; i < horizon; i++) {
    if (!isSunday(date)) {
      const timeSlot = slotOnClinicDate({
        tenantId,
        doctorId: opts.doctorId,
        doctorName: opts.doctorName,
        date,
        now,
        today,
      });
      if (timeSlot) return { date, timeSlot };
    }
    date = addDaysIso(date, 1);
  }
  return null;
}

export function getNextAvailableDoctorSlot(opts: {
  tenantId: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  now?: Date;
}): string {
  return findNextBookableSlot(opts)?.timeSlot || "";
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
       WHERE tenant_id = ? AND doctor_id = ? AND date = ? AND status = 'Waiting' AND token_number < ?
         AND ${hiddenVisitSourceSql()}`
    )
    .get(opts.tenantId, mapped.doctorId, mapped.date, mapped.tokenNumber, ...HIDDEN_AMBIENT_SOURCES) as { count: number };
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
