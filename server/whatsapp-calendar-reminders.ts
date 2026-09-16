import { getDb, mapAppointment } from "./db.ts";
import {
  isCloudDispatchFailure,
  sandboxBanner,
  sendAppointmentReminder,
  sendBookConfirmation,
  type CloudDispatchResult,
} from "./graph-whatsapp.ts";

const ACTIVE_APPOINTMENT_SQL = `status NOT IN ('Completed', 'Cancelled', 'No-Show')`;
const REMINDABLE_STATUSES = new Set(["Waiting", "Confirmed"]);
const REMINDER_WINDOWS = ["24h", "2h"] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

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
  return `\u{23F0} *Appointment Reminder - ${opts.clinicName}*\n\nNamaste ${opts.patientName},\nYour consultation with *${opts.doctorName}* is ${when}.\n\n\u{1F4C5} *Date*: ${opts.date}\n\u{1F552} *Time*: ${opts.timeSlot || "OPD hours"}\n\u{1F3AB} *Token*: *#${opts.tokenNumber}*\n\nPlease confirm arrival or request a reschedule from the clinic WhatsApp desk.`;
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
    tenantId: opts.tenantId,
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
    tenantId: opts.tenantId,
  });
  return recordCloudDispatch({
    eventType: "book_confirmation",
    appointment: opts.appointment,
    payload: { appointmentId: opts.appointment.id, tenantId: opts.tenantId },
    sent,
    sandboxText: `Appointment confirmed - token #${opts.appointment.tokenNumber}`,
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