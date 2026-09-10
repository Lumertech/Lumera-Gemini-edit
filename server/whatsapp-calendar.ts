import { DEMO_TENANT_ID, getDb, mapAppointment, mapPatient, writeAudit } from "./db.ts";
import {
  getTenantAppointment,
  insertAppointment,
  insertPatient,
  updateAppointment,
} from "./clinical.ts";
import {
  dispatchWhatsAppCloudMessage,
  isCloudDispatchFailure,
  sandboxBanner,
  sendAppointmentReminder,
  sendBookConfirmation,
  type CloudDispatchResult,
} from "./graph-whatsapp.ts";
import { isProduction } from "./runtime.ts";

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "No-Show"]);
const REMINDABLE_STATUSES = new Set(["Waiting", "Confirmed"]);
const REMINDER_WINDOWS = ["24h", "2h"] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

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

export function resolveWhatsAppTenantId(opts: {
  tenantId?: string;
  sessionTenantId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  patientPhone?: string;
}): string | null {
  const explicit = String(opts.tenantId || "").trim();
  if (explicit && tenantExists(explicit)) return explicit;

  const session = String(opts.sessionTenantId || "").trim();
  if (session && tenantExists(session)) return session;

  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  if (phoneNumberId) {
    try {
      const row = getDb()
        .prepare("SELECT id FROM tenants WHERE phone_number_id = ?")
        .get(phoneNumberId) as { id?: string } | undefined;
      if (row?.id) return String(row.id);
    } catch {
      /* ignore */
    }
  }

  const wabaId = String(opts.wabaId || "").trim();
  if (wabaId) {
    try {
      const row = getDb()
        .prepare("SELECT id FROM tenants WHERE waba_id = ?")
        .get(wabaId) as { id?: string } | undefined;
      if (row?.id) return String(row.id);
    } catch {
      /* ignore */
    }
  }

  const phone = String(opts.patientPhone || "").trim();
  if (phone) {
    const matches = findPatientsByPhone(phone);
    const tenantIds = [...new Set(matches.map((row) => String(row.tenant_id || "").trim()).filter(Boolean))];
    if (tenantIds.length === 1) return tenantIds[0];
  }

  if (!isProduction() && tenantExists(DEMO_TENANT_ID)) return DEMO_TENANT_ID;
  return null;
}

function findPatientsByPhone(phone: string): Record<string, unknown>[] {
  try {
    const rows = getDb().prepare("SELECT * FROM patients").all() as Record<string, unknown>[];
    return rows.filter((row) => phonesMatch(String(row.phone || ""), phone));
  } catch {
    return [];
  }
}

export function findPatientByPhoneInTenant(tenantId: string, phone: string): Record<string, unknown> | undefined {
  const rows = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ?")
    .all(tenantId) as Record<string, unknown>[];
  return rows.find((row) => phonesMatch(String(row.phone || ""), phone));
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

function findDoctor(opts: { tenantId: string; doctorId?: string; doctorName?: string }) {
  const db = getDb();
  const doctorId = String(opts.doctorId || "").trim();
  if (doctorId) {
    const byId = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId) as Record<string, unknown> | undefined;
    if (byId) return byId;
  }

  const doctorName = String(opts.doctorName || "").trim().toLowerCase();
  if (doctorName) {
    const named = db
      .prepare("SELECT * FROM doctors WHERE lower(name) LIKE ? LIMIT 1")
      .get(`%${doctorName}%`) as Record<string, unknown> | undefined;
    if (named) return named;
  }

  const tenantDoctor = db
    .prepare(
      `SELECT d.* FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE u.tenant_id = ? AND d.active = 1
       ORDER BY d.name ASC LIMIT 1`
    )
    .get(opts.tenantId) as Record<string, unknown> | undefined;
  if (tenantDoctor) return tenantDoctor;

  return db.prepare("SELECT * FROM doctors WHERE active = 1 ORDER BY name ASC LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
}

const ACTIVE_APPOINTMENT_SQL = `status NOT IN ('Completed', 'Cancelled', 'No-Show')`;

export function findActiveAppointment(opts: {
  tenantId: string;
  patientId?: string;
  patientPhone?: string;
  doctorId?: string;
  date?: string;
  appointmentId?: string;
}): Record<string, unknown> | undefined {
  if (opts.appointmentId) {
    return getTenantAppointment(opts.tenantId, opts.appointmentId);
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
    if (row) return row;
  }

  if (opts.patientId) {
    return db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? AND patient_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
         ORDER BY date ASC, created_at DESC LIMIT 1`
      )
      .get(opts.tenantId, opts.patientId) as Record<string, unknown> | undefined;
  }

  if (opts.patientPhone) {
    const rows = db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? AND ${ACTIVE_APPOINTMENT_SQL}
         ORDER BY date ASC, created_at DESC`
      )
      .all(opts.tenantId) as Record<string, unknown>[];
    return rows.find((row) => phonesMatch(String(row.patient_phone || ""), opts.patientPhone || ""));
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

export function tenantUtcOffsetMinutes(timezone: string): number {
  const match = String(timezone || "").match(/UTC\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  }
  if (/IST|Asia\/Kolkata|India/i.test(timezone || "")) return 330;
  return 330;
}

export function parseTimeSlot(slot: string): { hours: number; minutes: number } {
  const text = String(slot || "").trim();
  const ampm = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const mer = ampm[3].toUpperCase();
    if (mer === "PM" && hours < 12) hours += 12;
    if (mer === "AM" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  const h24 = text.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return { hours: Number(h24[1]), minutes: Number(h24[2]) };
  return { hours: 9, minutes: 0 };
}

export function appointmentInstantUtc(date: string, timeSlot: string, offsetMinutes: number): Date {
  const [year, month, day] = String(date).split("-").map(Number);
  const { hours, minutes } = parseTimeSlot(timeSlot);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, hours, minutes) - offsetMinutes * 60 * 1000);
}

function reminderWindowForHoursUntil(hoursUntil: number): ReminderWindow | null {
  if (hoursUntil <= 0) return null;
  if (hoursUntil <= 2) return "2h";
  if (hoursUntil <= 24) return "24h";
  return null;
}

function alreadySentReminder(appointmentId: string, window: ReminderWindow): boolean {
  const rows = getDb()
    .prepare(
      `SELECT action_payload FROM whatsapp_outbound_events
       WHERE event_type = 'appointment_reminder' AND status IN ('sent', 'sandbox_recorded', 'delivered')`
    )
    .all() as { action_payload?: string }[];
  return rows.some((row) => {
    try {
      const payload = JSON.parse(String(row.action_payload || "{}")) as {
        appointmentId?: string;
        window?: string;
      };
      return payload.appointmentId === appointmentId && payload.window === window;
    } catch {
      return false;
    }
  });
}

function clinicNameForTenant(tenantId: string): string {
  const row = getDb().prepare("SELECT name, timezone FROM tenants WHERE id = ?").get(tenantId) as
    | { name?: string; timezone?: string }
    | undefined;
  return String(row?.name || "Lumera Clinic");
}

function timezoneForTenant(tenantId: string): string {
  const row = getDb().prepare("SELECT timezone FROM tenants WHERE id = ?").get(tenantId) as
    | { timezone?: string }
    | undefined;
  return String(row?.timezone || "IST (UTC+5:30)");
}

export function buildReminderMessage(opts: {
  patientName: string;
  doctorName: string;
  date: string;
  timeSlot: string;
  tokenNumber: number;
  clinicName: string;
  window: ReminderWindow;
}): string {
  const when = opts.window === "2h" ? "in about 2 hours" : "tomorrow / within 24 hours";
  return `⏰ *Appointment Reminder - ${opts.clinicName}*\n\nNamaste ${opts.patientName},\nYour consultation with *${opts.doctorName}* is ${when}.\n\n📅 *Date*: ${opts.date}\n🕒 *Time*: ${opts.timeSlot || "OPD hours"}\n🎫 *Token*: *#${opts.tokenNumber}*\n\nPlease confirm arrival or request a reschedule from the clinic WhatsApp desk.`;
}

function recordOutboundEvent(opts: {
  eventType: string;
  phone: string;
  name: string;
  status: string;
  details: string;
  payload: Record<string, unknown>;
  conversationContent?: string;
}): string {
  const db = getDb();
  const now = new Date().toISOString();
  const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, opts.eventType, opts.phone, opts.name, opts.status, opts.details, JSON.stringify(opts.payload), now);

  if (opts.conversationContent) {
    const timeDisplay = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    let conv = db
      .prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ?")
      .get(opts.phone) as { id: string } | undefined;
    if (!conv) {
      const convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
         VALUES (?, ?, ?, 'bot', 'Unassigned', '["Appointment"]', 'en', 0, ?, ?, ?)`
      ).run(convId, opts.phone, opts.name, opts.conversationContent.slice(0, 80), timeDisplay, now);
      conv = { id: convId };
    }
    const msgId = `msg-out-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, status, created_at)
       VALUES (?, ?, ?, 'bot', 'Appointment Reminder', ?, ?, ?, ?)`
    ).run(msgId, conv.id, opts.phone, opts.conversationContent, timeDisplay, opts.status, now);
    db.prepare(
      `UPDATE whatsapp_conversations
       SET last_message = ?, last_message_time = ?, updated_at = ?
       WHERE id = ?`
    ).run(opts.conversationContent.slice(0, 80), timeDisplay, now, conv.id);
  }

  return eventId;
}

export type ReminderDispatchResult =
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string; eventId: string }
  | { ok: false; error: string; channel: "none" | "graph"; eventId?: string };

function recordCloudDispatch(opts: {
  eventType: string;
  appointment: ReturnType<typeof mapAppointment>;
  payload: Record<string, unknown>;
  sent: CloudDispatchResult;
  sandboxText: string;
}): ReminderDispatchResult {
  if (opts.sent.ok && opts.sent.channel === "graph") {
    const eventId = recordOutboundEvent({
      eventType: opts.eventType,
      phone: opts.appointment.patientPhone,
      name: opts.appointment.patientName,
      status: "sent",
      details: `WhatsApp Cloud API ${opts.eventType} accepted`,
      payload: { ...opts.payload, channel: "graph", messageId: opts.sent.messageId },
    });
    return { ok: true, channel: "graph", messageId: opts.sent.messageId, eventId };
  }

  if (isCloudDispatchFailure(opts.sent)) {
    const eventId = recordOutboundEvent({
      eventType: opts.eventType,
      phone: opts.appointment.patientPhone,
      name: opts.appointment.patientName,
      status: "failed",
      details: `${opts.eventType} not delivered: ${opts.sent.error}`,
      payload: { ...opts.payload, channel: opts.sent.channel, error: opts.sent.error, sandbox: false },
    });
    return { ok: false, error: opts.sent.error, channel: opts.sent.channel, eventId };
  }

  const eventId = recordOutboundEvent({
    eventType: opts.eventType,
    phone: opts.appointment.patientPhone,
    name: opts.appointment.patientName,
    status: "sandbox_recorded",
    details: `SANDBOX / DEV-ONLY ${opts.eventType} recorded locally (not Graph)`,
    payload: { ...opts.payload, channel: "sandbox", sandbox: true },
    conversationContent: sandboxBanner(opts.sandboxText),
  });
  return { ok: true, channel: "sandbox", eventId };
}

export async function dispatchAppointmentReminder(opts: {
  tenantId: string;
  appointment: ReturnType<typeof mapAppointment>;
  window: ReminderWindow;
  fetchImpl?: typeof fetch;
}): Promise<ReminderDispatchResult> {
  const clinicName = clinicNameForTenant(opts.tenantId);
  const text = buildReminderMessage({
    patientName: opts.appointment.patientName,
    doctorName: opts.appointment.doctorName,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    clinicName,
    window: opts.window,
  });
  const sent = await sendAppointmentReminder({
    to: opts.appointment.patientPhone,
    patientName: opts.appointment.patientName,
    doctorName: opts.appointment.doctorName,
    specialty: opts.appointment.specialty,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    textBody: text,
    templateParameters: [
      opts.appointment.patientName,
      opts.appointment.doctorName,
      opts.appointment.date,
      opts.appointment.timeSlot || "OPD",
      String(opts.appointment.tokenNumber),
    ],
    db: getDb(),
    fetchImpl: opts.fetchImpl,
  });
  return recordCloudDispatch({
    eventType: "appointment_reminder",
    appointment: opts.appointment,
    payload: { appointmentId: opts.appointment.id, tenantId: opts.tenantId, window: opts.window },
    sent,
    sandboxText: text,
  });
}

export async function dispatchWhatsAppBookConfirmation(opts: {
  tenantId: string;
  appointment: ReturnType<typeof mapAppointment>;
  fetchImpl?: typeof fetch;
}): Promise<ReminderDispatchResult> {
  const sent = await sendBookConfirmation({
    to: opts.appointment.patientPhone,
    patientName: opts.appointment.patientName,
    doctorName: opts.appointment.doctorName,
    specialty: opts.appointment.specialty,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    uhid: opts.appointment.uhid,
    templateParameters: [
      opts.appointment.patientName,
      opts.appointment.doctorName,
      opts.appointment.date,
      opts.appointment.timeSlot || "OPD",
      String(opts.appointment.tokenNumber),
    ],
    db: getDb(),
    fetchImpl: opts.fetchImpl,
  });
  return recordCloudDispatch({
    eventType: "book_confirmation",
    appointment: opts.appointment,
    payload: { appointmentId: opts.appointment.id, tenantId: opts.tenantId },
    sent,
    sandboxText: `Appointment confirmed · token #${opts.appointment.tokenNumber}`,
  });
}

export type ReminderRunItem = {
  appointmentId: string;
  tenantId: string;
  window: ReminderWindow;
  result: ReminderDispatchResult;
};

export async function runAppointmentReminders(opts?: {
  now?: Date;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  appointmentId?: string;
}): Promise<{ sent: ReminderRunItem[]; skipped: number; failed: ReminderRunItem[] }> {
  const now = opts?.now || new Date();
  const db = getDb();
  const rows = (
    opts?.appointmentId
      ? [
          db
            .prepare("SELECT * FROM appointments WHERE id = ?")
            .get(opts.appointmentId) as Record<string, unknown> | undefined,
        ].filter(Boolean)
      : db
          .prepare(
            `SELECT * FROM appointments
             WHERE ${ACTIVE_APPOINTMENT_SQL}
             ${opts?.tenantId ? "AND tenant_id = ?" : ""}`
          )
          .all(...(opts?.tenantId ? [opts.tenantId] : []))
  ) as Record<string, unknown>[];

  const sent: ReminderRunItem[] = [];
  const failed: ReminderRunItem[] = [];
  let skipped = 0;

  for (const row of rows) {
    const tenantId = String(row.tenant_id || "").trim();
    if (!tenantId) {
      skipped += 1;
      continue;
    }
    if (!REMINDABLE_STATUSES.has(String(row.status || ""))) {
      skipped += 1;
      continue;
    }
    const appointment = mapAppointment(row);
    const offset = tenantUtcOffsetMinutes(timezoneForTenant(tenantId));
    const start = appointmentInstantUtc(appointment.date, appointment.timeSlot, offset);
    const hoursUntil = (start.getTime() - now.getTime()) / 3_600_000;
    const window = reminderWindowForHoursUntil(hoursUntil);
    if (!window) {
      skipped += 1;
      continue;
    }
    if (alreadySentReminder(appointment.id, window)) {
      skipped += 1;
      continue;
    }
    const result = await dispatchAppointmentReminder({
      tenantId,
      appointment,
      window,
      fetchImpl: opts?.fetchImpl,
    });
    const item = { appointmentId: appointment.id, tenantId, window, result };
    if (result.ok) sent.push(item);
    else failed.push(item);
  }

  return { sent, skipped, failed };
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;

export function startAppointmentReminderScheduler(): void {
  const flag = String(process.env.APPOINTMENT_REMINDER_SCHEDULER || "true").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return;
  if (reminderTimer) return;
  const ms = Number(process.env.APPOINTMENT_REMINDER_INTERVAL_MS || 15 * 60 * 1000);
  const intervalMs = Number.isFinite(ms) && ms >= 30_000 ? ms : 15 * 60 * 1000;
  const tick = () => {
    runAppointmentReminders().catch((err) => {
      console.error("Appointment reminder scheduler failed:", err);
    });
  };
  reminderTimer = setInterval(tick, intervalMs);
  if (typeof reminderTimer === "object" && reminderTimer && "unref" in reminderTimer) {
    reminderTimer.unref();
  }
}

export function stopAppointmentReminderScheduler(): void {
  if (!reminderTimer) return;
  clearInterval(reminderTimer);
  reminderTimer = null;
}

export function httpErrorStatus(err: unknown): number {
  if (typeof err === "object" && err && "status" in err) {
    const status = Number((err as { status: number }).status);
    if (Number.isFinite(status) && status >= 400) return status;
  }
  return 500;
}
