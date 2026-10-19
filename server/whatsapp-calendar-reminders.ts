import { getDb, mapAppointment } from "./db.ts";
import {
  FAILED_FINAL,
  isCloudDispatchFailure,
  resolveApprovedClinicTemplate,
  sandboxBanner,
  sendAppointmentReminder,
  sendBookConfirmation,
  SKIPPED_NOT_ALLOWLISTED,
  toWhatsAppRecipient,
  type CloudDispatchResult,
} from "./graph-whatsapp.ts";

const ACTIVE_APPOINTMENT_SQL = `status NOT IN ('Completed', 'Cancelled', 'No-Show')`;
const REMINDABLE_STATUSES = new Set(["Waiting", "Confirmed"]);
const REMINDER_WINDOWS = ["24h", "2h"] as const;
export type ReminderWindow = (typeof REMINDER_WINDOWS)[number];

/** Three Graph attempts per appointment per window, then stop. */
export const REMINDER_MAX_ATTEMPTS = 3;
/**
 * Wait before the next try after failure 1 and failure 2.
 * The third failure is permanent, so the 4h slot is not another send.
 */
export const REMINDER_RETRY_BACKOFF_MS = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000] as const;
export const NO_APPROVED_TEMPLATE = "no_approved_template";

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
  return String(row?.name || "").trim();
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
  tenantId?: string;
  conversationContent?: string;
  sentAt?: string;
}): string {
  const db = getDb();
  const now = opts.sentAt || new Date().toISOString();
  const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
  const tenantId = String(opts.tenantId || opts.payload.tenantId || "").trim();
  db.prepare(
    `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    opts.eventType,
    opts.phone,
    opts.name,
    opts.status,
    opts.details,
    JSON.stringify(opts.payload),
    now,
    tenantId
  );

  if (opts.conversationContent) {
    const timeDisplay = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
    let conv = db
      .prepare(
        `SELECT id, tenant_id FROM whatsapp_conversations
         WHERE patient_phone = ? AND (TRIM(COALESCE(tenant_id, '')) = ? OR TRIM(COALESCE(tenant_id, '')) = '')`
      )
      .get(opts.phone, tenantId) as { id: string; tenant_id?: string } | undefined;
    if (!conv) {
      const convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at, tenant_id)
         VALUES (?, ?, ?, 'bot', 'Unassigned', '["Appointment"]', 'en', 0, ?, ?, ?, ?)`
      ).run(convId, opts.phone, opts.name, opts.conversationContent.slice(0, 80), timeDisplay, now, tenantId);
      conv = { id: convId, tenant_id: tenantId };
    } else if (tenantId && !String(conv.tenant_id || "").trim()) {
      db.prepare(
        "UPDATE whatsapp_conversations SET tenant_id = ? WHERE id = ? AND (tenant_id IS NULL OR TRIM(tenant_id) = '')"
      ).run(tenantId, conv.id);
    }
    if (conv) {
    const msgId = `msg-out-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, status, created_at, tenant_id)
       VALUES (?, ?, ?, 'bot', 'Appointment Reminder', ?, ?, ?, ?, ?)`
    ).run(msgId, conv.id, opts.phone, opts.conversationContent, timeDisplay, opts.status, now, tenantId);
    db.prepare(
      `UPDATE whatsapp_conversations
       SET last_message = ?, last_message_time = ?, updated_at = ?
       WHERE id = ? AND (tenant_id IS NULL OR TRIM(tenant_id) = '' OR tenant_id = ?)`
    ).run(opts.conversationContent.slice(0, 80), timeDisplay, now, conv.id, tenantId);
    }
  }

  return eventId;
}

export type ReminderDispatchResult =
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string; eventId: string }
  | { ok: false; error: string; channel: "none" | "graph"; eventId?: string; status?: number; skipped?: boolean };

function recordCloudDispatch(opts: {
  eventType: string;
  appointment: ReturnType<typeof mapAppointment>;
  payload: Record<string, unknown>;
  sent: CloudDispatchResult;
  sandboxText: string;
  sentAt?: string;
}): ReminderDispatchResult {
  if (opts.sent.ok && opts.sent.channel === "graph") {
    const eventId = recordOutboundEvent({
      eventType: opts.eventType,
      phone: opts.appointment.patientPhone,
      name: opts.appointment.patientName,
      status: "sent",
      details: `WhatsApp Cloud API ${opts.eventType} accepted`,
      payload: { ...opts.payload, channel: "graph", messageId: opts.sent.messageId },
      tenantId: String(opts.payload.tenantId || ""),
      sentAt: opts.sentAt,
    });
    return { ok: true, channel: "graph", messageId: opts.sent.messageId, eventId };
  }

  if (
    isCloudDispatchFailure(opts.sent) &&
    (opts.sent.error === SKIPPED_NOT_ALLOWLISTED || opts.sent.error === FAILED_FINAL)
  ) {
    return {
      ok: false,
      error: opts.sent.error,
      channel: "none",
      eventId: opts.sent.eventId,
      status: opts.sent.status,
      skipped: true,
    };
  }

  if (isCloudDispatchFailure(opts.sent)) {
    const eventId = recordOutboundEvent({
      eventType: opts.eventType,
      phone: opts.appointment.patientPhone,
      name: opts.appointment.patientName,
      status: "failed",
      details: `${opts.eventType} not delivered: ${opts.sent.error}`,
      payload: { ...opts.payload, channel: opts.sent.channel, error: opts.sent.error, sandbox: false },
      tenantId: String(opts.payload.tenantId || ""),
      sentAt: opts.sentAt,
    });
    return { ok: false, error: opts.sent.error, channel: opts.sent.channel, eventId, status: opts.sent.status };
  }

  const eventId = recordOutboundEvent({
    eventType: opts.eventType,
    phone: opts.appointment.patientPhone,
    name: opts.appointment.patientName,
    status: "sandbox_recorded",
    details: `SANDBOX / DEV-ONLY ${opts.eventType} recorded locally (not Graph)`,
    payload: { ...opts.payload, channel: "sandbox", sandbox: true },
    tenantId: String(opts.payload.tenantId || ""),
    conversationContent: sandboxBanner(opts.sandboxText),
    sentAt: opts.sentAt,
  });
  return { ok: true, channel: "sandbox", eventId };
}

type ReminderFailureRow = { sentAt: string; permanent: boolean };

function reminderFailureRows(tenantId: string, appointmentId: string, window: ReminderWindow): ReminderFailureRow[] {
  const db = getDb();
  const postgres = (db as { dialect?: string }).dialect === "postgres";
  const appointmentSql = postgres
    ? `CASE WHEN action_payload IS NOT NULL AND left(btrim(action_payload), 1) = '{' THEN action_payload::json->>'appointmentId' ELSE NULL END = ?
       AND CASE WHEN action_payload IS NOT NULL AND left(btrim(action_payload), 1) = '{' THEN action_payload::json->>'window' ELSE NULL END = ?`
    : `json_extract(action_payload, '$.appointmentId') = ?
       AND json_extract(action_payload, '$.window') = ?`;
  const rows = db
    .prepare(
      `SELECT status, action_payload, sent_at FROM whatsapp_outbound_events
       WHERE event_type = 'appointment_reminder'
         AND status IN ('failed', 'skipped_not_allowlisted', 'failed_final')
         AND TRIM(COALESCE(tenant_id, '')) = ?
         AND ${appointmentSql}`
    )
    .all(tenantId, appointmentId, window) as { status?: string; action_payload?: string; sent_at?: string }[];
  const matched: ReminderFailureRow[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row.action_payload || "{}")) as { permanent?: boolean };
      matched.push({
        sentAt: String(row.sent_at || ""),
        permanent: payload.permanent === true || row.status === FAILED_FINAL,
      });
    } catch {
      matched.push({ sentAt: String(row.sent_at || ""), permanent: row.status === FAILED_FINAL });
    }
  }
  matched.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return matched;
}

function reminderRetryDecision(
  tenantId: string,
  appointmentId: string,
  window: ReminderWindow,
  now: Date
): { action: "send"; attempt: number } | { action: "wait" | "stop" } {
  const failures = reminderFailureRows(tenantId, appointmentId, window);
  if (failures.length >= REMINDER_MAX_ATTEMPTS || failures.some((row) => row.permanent)) {
    return { action: "stop" };
  }
  const latest = failures[failures.length - 1];
  if (latest) {
    const lastMs = Date.parse(latest.sentAt);
    const backoff =
      REMINDER_RETRY_BACKOFF_MS[failures.length - 1] ?? REMINDER_RETRY_BACKOFF_MS[REMINDER_RETRY_BACKOFF_MS.length - 1];
    // A scheduler clock far behind the recorded attempt (tests that pass a historical `now`
    // after a wall-clock failure) must not look like it is still inside the backoff window.
    if (Number.isFinite(lastMs) && now.getTime() + 60_000 >= lastMs && now.getTime() < lastMs + backoff) {
      return { action: "wait" };
    }
  }
  return { action: "send", attempt: failures.length + 1 };
}

export async function dispatchAppointmentReminder(opts: {
  tenantId: string;
  appointment: ReturnType<typeof mapAppointment>;
  window: ReminderWindow;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ReminderDispatchResult> {
  const clinicName = clinicNameForTenant(opts.tenantId);
  const doctorName = String(opts.appointment.doctorName || "").trim();
  if (!clinicName || !doctorName) {
    return {
      ok: false,
      channel: "none",
      status: 400,
      error: "clinic_name and doctor_name are required.",
    };
  }
  const now = opts.now || new Date();
  const decision = reminderRetryDecision(opts.tenantId, opts.appointment.id, opts.window, now);
  if (decision.action !== "send") {
    return {
      ok: false,
      channel: "none",
      skipped: true,
      error: decision.action === "stop" ? "retry_cap" : "retry_backoff",
    };
  }
  const attempt = decision.attempt;
  const permanent = attempt >= REMINDER_MAX_ATTEMPTS;
  const recordedAt = now.toISOString();
  const template = resolveApprovedClinicTemplate("appointment_reminder", getDb(), opts.tenantId);
  if (!template) {
    const eventId = recordOutboundEvent({
      eventType: "appointment_reminder",
      phone: opts.appointment.patientPhone,
      name: opts.appointment.patientName,
      status: "failed",
      details: `appointment_reminder not delivered: ${NO_APPROVED_TEMPLATE}`,
      payload: {
        appointmentId: opts.appointment.id,
        tenantId: opts.tenantId,
        window: opts.window,
        attempt,
        permanent,
        reason: NO_APPROVED_TEMPLATE,
      },
      tenantId: opts.tenantId,
      sentAt: recordedAt,
    });
    return { ok: false, error: NO_APPROVED_TEMPLATE, channel: "none", eventId, status: 422 };
  }
  const text = buildReminderMessage({
    patientName: opts.appointment.patientName,
    doctorName,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    clinicName,
    window: opts.window,
  });
  const sent = await sendAppointmentReminder({
    to: opts.appointment.patientPhone,
    patientName: opts.appointment.patientName,
    doctorName,
    clinicName,
    specialty: opts.appointment.specialty,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    templateName: template.name,
    templateLanguage: template.language,
    // lumera_appointment_reminder (Utility, en_US): {{1}} patient, {{2}} clinic, {{3}} doctor, {{4}} date, {{5}} time. No token.
    templateParameters: [
      opts.appointment.patientName,
      clinicName,
      doctorName,
      opts.appointment.date,
      opts.appointment.timeSlot || "OPD",
    ],
    db: getDb(),
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
    appointmentId: opts.appointment.id,
    reminderWindow: opts.window,
    sentAt: recordedAt,
  });
  return recordCloudDispatch({
    eventType: "appointment_reminder",
    appointment: opts.appointment,
    payload: {
      appointmentId: opts.appointment.id,
      tenantId: opts.tenantId,
      window: opts.window,
      attempt,
      permanent,
      ...(isCloudDispatchFailure(sent) ? { reason: sent.error } : {}),
    },
    sent,
    sandboxText: text,
    sentAt: recordedAt,
  });
}

export type BookingNotifyResult = { sent: boolean; wamid?: string; reason?: string };

function bookingFailureReason(sent: CloudDispatchResult): string {
  if (isCloudDispatchFailure(sent)) {
    if (sent.error === NO_APPROVED_TEMPLATE) return "no template";
    if (/not connected|not configured|WA_TOKEN_KEY/i.test(sent.error)) return "not connected";
    return "Graph error";
  }
  if (sent.channel === "sandbox") return "not connected";
  return "Graph error";
}

/**
 * Reception booking notify. Sends an approved template only.
 * Body variables are the clinic display name, doctor, date/time, and patient.
 * The clinic name is never replaced with a product name.
 */
export async function notifyReceptionBooking(opts: {
  tenantId: string;
  appointment: ReturnType<typeof mapAppointment>;
  fetchImpl?: typeof fetch;
}): Promise<BookingNotifyResult> {
  const phone = String(opts.appointment.patientPhone || "").trim();
  const digits = toWhatsAppRecipient(phone);
  const clinicName = clinicNameForTenant(opts.tenantId);
  const doctorName = String(opts.appointment.doctorName || "").trim();
  const patientName = String(opts.appointment.patientName || "").trim();
  const dateTime = [opts.appointment.date, opts.appointment.timeSlot].filter(Boolean).join(" ").trim();

  const record = (status: "sent" | "failed", reason: string, messageId?: string) => {
    recordOutboundEvent({
      eventType: "book_confirmation",
      phone: phone || "unknown",
      name: patientName || "Patient",
      status,
      details:
        status === "sent"
          ? "WhatsApp Cloud API book_confirmation accepted"
          : `book_confirmation not delivered: ${reason}`,
      payload: {
        appointmentId: opts.appointment.id,
        tenantId: opts.tenantId,
        ...(messageId ? { messageId, channel: "graph" } : { reason }),
      },
      tenantId: opts.tenantId,
    });
  };

  if (digits.length < 8) {
    record("failed", "no phone");
    return { sent: false, reason: "no phone" };
  }
  const template = resolveApprovedClinicTemplate("book_confirmation", getDb(), opts.tenantId);
  if (!template || !clinicName || !doctorName) {
    const reason = !template ? "no template" : "Graph error";
    record("failed", reason);
    return { sent: false, reason };
  }
  const sent = await sendBookConfirmation({
    to: phone,
    patientName,
    doctorName,
    clinicName,
    specialty: opts.appointment.specialty,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    uhid: opts.appointment.uhid,
    templateName: template.name,
    templateLanguage: template.language,
    templateParameters: [clinicName, doctorName, dateTime, patientName],
    textBody: `${clinicName}: appointment with ${doctorName} on ${dateTime} for ${patientName}`,
    db: getDb(),
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
    appointmentId: opts.appointment.id,
  });
  if (isCloudDispatchFailure(sent) && (sent.error === SKIPPED_NOT_ALLOWLISTED || sent.error === FAILED_FINAL)) {
    return { sent: false, reason: "not allowlisted" };
  }
  if (sent.ok && sent.channel === "graph" && sent.messageId) {
    record("sent", "", sent.messageId);
    return { sent: true, wamid: sent.messageId };
  }
  const reason = bookingFailureReason(sent);
  record("failed", reason);
  return { sent: false, reason };
}

export async function dispatchWhatsAppBookConfirmation(opts: {
  tenantId: string;
  appointment: ReturnType<typeof mapAppointment>;
  fetchImpl?: typeof fetch;
}): Promise<ReminderDispatchResult> {
  const clinicName = clinicNameForTenant(opts.tenantId);
  const doctorName = String(opts.appointment.doctorName || "").trim();
  if (!clinicName || !doctorName) {
    return {
      ok: false,
      channel: "none",
      status: 400,
      error: "clinic_name and doctor_name are required.",
    };
  }
  const sent = await sendBookConfirmation({
    to: opts.appointment.patientPhone,
    patientName: opts.appointment.patientName,
    doctorName,
    clinicName,
    specialty: opts.appointment.specialty,
    date: opts.appointment.date,
    timeSlot: opts.appointment.timeSlot,
    tokenNumber: opts.appointment.tokenNumber,
    templateParameters: [
      opts.appointment.patientName,
      clinicName,
      opts.appointment.doctorName,
      opts.appointment.date,
      opts.appointment.timeSlot || "OPD",
      String(opts.appointment.tokenNumber || ""),
    ],
    db: getDb(),
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
    appointmentId: opts.appointment.id,
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
      now,
    });
    const item = { appointmentId: appointment.id, tenantId, window, result };
    if (result.ok) sent.push(item);
    else if ("skipped" in result && result.skipped) skipped += 1;
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

export function appointmentReminderSchedulerActive(): boolean {
  return reminderTimer !== null;
}

export function stopAppointmentReminderScheduler(): void {
  if (!reminderTimer) return;
  clearInterval(reminderTimer);
  reminderTimer = null;
}