import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion, isProduction, readSecret } from "./runtime.ts";
import { isUsableGraphToken, isUsablePhoneNumberId } from "./meta-security.ts";
import { getDb, mapAppointment } from "./db.ts";

export type GraphCredentials = {
  token: string;
  phoneNumberId: string;
  source: "env" | "tenant";
};

/** Wave 2 utility kinds plus Wave 1B OTP. Generic `text` covers other outbound hooks. */
export type CloudMessageKind =
  | "otp"
  | "appointment_reminder"
  | "book_confirmation"
  | "payment_receipt"
  | "text";

export type AppointmentSendFields = {
  id: string;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  specialty: string;
  date: string;
  timeSlot: string;
  tokenNumber: number;
  uhid?: string;
};

export type ReceiptSendFields = {
  patientName?: string;
  amount?: number | string;
  currency?: string;
  invoiceId?: string;
  date?: string;
};

export type CloudDispatchResult =
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string }
  | { ok: false; error: string; channel: "none" | "graph" };

export function isCloudDispatchFailure(
  sent: CloudDispatchResult
): sent is { ok: false; error: string; channel: "none" | "graph" } {
  return sent.ok === false;
}

export function resolveGraphCredentials(db?: DatabaseSync | null): GraphCredentials | null {
  const envToken = readSecret("META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const envPhone = readSecret("META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID");
  if (isUsableGraphToken(envToken) && isUsablePhoneNumberId(envPhone)) {
    return { token: envToken, phoneNumberId: envPhone, source: "env" };
  }

  if (!db) return null;
  try {
    const rows = db
      .prepare(
        `SELECT meta_access_token, phone_number_id FROM tenants
         WHERE COALESCE(meta_access_token, '') != '' AND COALESCE(phone_number_id, '') != ''`
      )
      .all() as { meta_access_token: string; phone_number_id: string }[];
    for (const row of rows) {
      if (isUsableGraphToken(row.meta_access_token) && isUsablePhoneNumberId(row.phone_number_id)) {
        return { token: row.meta_access_token, phoneNumberId: row.phone_number_id, source: "tenant" };
      }
    }
  } catch {
    /* tenants table may be missing in isolated tests */
  }
  return null;
}

export function toWhatsAppRecipient(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export type GraphMessageResult =
  | { ok: true; messageId: string; graphResponse: unknown }
  | { ok: false; error: string; graphResponse?: unknown };

function tryGetDb(): DatabaseSync | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

function envTrim(name: string): string {
  return String(process.env[name] || "").trim();
}

function utilityTemplateLanguage(): string {
  return envTrim("META_UTILITY_TEMPLATE_LANGUAGE") || envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en";
}

/** Optional Cloud API template for a kind. Unset → session text body (same as OTP #20). */
export function templateConfigForKind(kind: CloudMessageKind): {
  name: string;
  language: string;
  otpButton?: boolean;
} | null {
  if (kind === "otp") {
    const name = envTrim("META_OTP_TEMPLATE_NAME");
    if (!name) return null;
    return {
      name,
      language: envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en",
      otpButton: process.env.META_OTP_TEMPLATE_BUTTON === "true",
    };
  }
  const envName =
    kind === "appointment_reminder"
      ? "META_REMINDER_TEMPLATE_NAME"
      : kind === "book_confirmation"
        ? "META_BOOK_CONFIRMATION_TEMPLATE_NAME"
        : kind === "payment_receipt"
          ? "META_RECEIPT_TEMPLATE_NAME"
          : "";
  if (!envName) return null;
  const name = envTrim(envName);
  if (!name) return null;
  return { name, language: utilityTemplateLanguage() };
}

export function defaultOtpTextBody(otp: string, purpose: string): string {
  return `Lumera verification code: ${otp}\nAction: ${purpose}\nValid for 5 minutes. Do not share this code.`;
}

export function buildReminderText(apt: AppointmentSendFields, patientName?: string): string {
  const name = patientName || apt.patientName || "Patient";
  const token = apt.tokenNumber ? `#${String(apt.tokenNumber).padStart(2, "0")}` : "pending";
  return (
    `⏰ *Appointment reminder — Lumera*\n\n` +
    `Namaste ${name},\n` +
    `Your consultation with *${apt.doctorName || "your clinician"}* is scheduled for *${apt.date || "the upcoming slot"}* at *${apt.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*\n` +
    (apt.specialty ? `📍 ${apt.specialty}\n\n` : "\n") +
    `Please arrive 10 minutes early for vitals.`
  );
}

export function buildBookConfirmationText(apt: AppointmentSendFields, patientName?: string): string {
  const name = patientName || apt.patientName || "Patient";
  const token = apt.tokenNumber ? `#${String(apt.tokenNumber).padStart(2, "0")}` : "pending";
  return (
    `✅ *Appointment confirmed — Lumera*\n\n` +
    `Namaste ${name},\n` +
    `Your visit with *${apt.doctorName || "your clinician"}*` +
    (apt.specialty ? ` (${apt.specialty})` : "") +
    ` is booked for *${apt.date || "the scheduled date"}* at *${apt.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*` +
    (apt.uhid ? `\nUHID: ${apt.uhid}` : "")
  );
}

export function buildReceiptText(receipt: ReceiptSendFields): string {
  const name = receipt.patientName || "Patient";
  const currency = String(receipt.currency || "₹").trim() || "₹";
  const amount = String(receipt.amount ?? "").trim() || "0";
  const invoice = receipt.invoiceId ? `\nInvoice: ${receipt.invoiceId}` : "";
  const date = receipt.date ? `\nDate: ${receipt.date}` : "";
  return (
    `🧾 *Payment receipt — Lumera*\n\n` +
    `Namaste ${name},\n` +
    `We received *${currency}${amount}* for your consultation.${invoice}${date}\n\n` +
    `Thank you.`
  );
}

export function sandboxBanner(body: string): string {
  return `SANDBOX / DEV-ONLY (not sent via Graph)\n\n${body}`;
}

/**
 * Read an existing #13 appointments row. Does not create or mutate calendar data —
 * Platform owns CRUD / the reminder scheduler.
 */
export function lookupAppointmentForWhatsAppSend(
  db: DatabaseSync | null | undefined,
  opts: { appointmentId?: string; patientPhone?: string; tenantId?: string }
): AppointmentSendFields | null {
  if (!db) return null;
  const appointmentId = String(opts.appointmentId || "").trim();
  const patientPhone = String(opts.patientPhone || "").trim();
  const tenantId = String(opts.tenantId || "").trim();
  let row: Record<string, unknown> | undefined;
  try {
    if (appointmentId) {
      row = (
        tenantId
          ? db.prepare("SELECT * FROM appointments WHERE id = ? AND tenant_id = ?").get(appointmentId, tenantId)
          : db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId)
      ) as Record<string, unknown> | undefined;
    } else if (patientPhone) {
      const digits = toWhatsAppRecipient(patientPhone);
      row = (
        tenantId
          ? db
              .prepare(
                `SELECT * FROM appointments
                 WHERE tenant_id = ? AND (patient_phone = ? OR REPLACE(REPLACE(patient_phone, ' ', ''), '-', '') LIKE ?)
                 ORDER BY created_at DESC LIMIT 1`
              )
              .get(tenantId, patientPhone, `%${digits.slice(-10)}%`)
          : db
              .prepare(
                `SELECT * FROM appointments
                 WHERE patient_phone = ? OR REPLACE(REPLACE(patient_phone, ' ', ''), '-', '') LIKE ?
                 ORDER BY created_at DESC LIMIT 1`
              )
              .get(patientPhone, `%${digits.slice(-10)}%`)
      ) as Record<string, unknown> | undefined;
    }
  } catch {
    return null;
  }
  if (!row) return null;
  const mapped = mapAppointment(row);
  return {
    id: mapped.id,
    patientName: mapped.patientName,
    patientPhone: mapped.patientPhone,
    doctorName: mapped.doctorName,
    specialty: mapped.specialty,
    date: mapped.date,
    timeSlot: mapped.timeSlot,
    tokenNumber: mapped.tokenNumber,
    uhid: mapped.uhid,
  };
}

function graphErrorMessage(graphResponse: unknown, status: number, kind: CloudMessageKind): string {
  const graphError = (graphResponse as { error?: { message?: string } })?.error?.message;
  if (graphError) return graphError;
  const label = kind === "otp" ? "OTP send" : `${kind} send`;
  return `Graph API rejected the ${label} (HTTP ${status}).`;
}

function buildGraphRequestBody(opts: {
  recipient: string;
  kind: CloudMessageKind;
  textBody: string;
  otp?: string;
  purpose?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
}): Record<string, unknown> {
  const template =
    opts.templateName && opts.templateName.trim()
      ? {
          name: opts.templateName.trim(),
          language: (opts.templateLanguage || "en").trim() || "en",
        }
      : templateConfigForKind(opts.kind);

  if (template) {
    const parameters = (
      opts.templateParameters && opts.templateParameters.length > 0
        ? opts.templateParameters
        : opts.kind === "otp" && opts.otp
          ? [opts.otp]
          : []
    ).map((text) => ({ type: "text", text: String(text) }));

    const components: Array<Record<string, unknown>> = [];
    if (parameters.length > 0) {
      components.push({ type: "body", parameters });
    }
    if (opts.kind === "otp" && "otpButton" in template && template.otpButton && opts.otp) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: opts.otp }],
      });
    }

    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: opts.recipient,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length > 0 ? { components } : {}),
      },
    };
  }

  const body =
    opts.textBody ||
    (opts.kind === "otp" && opts.otp ? defaultOtpTextBody(opts.otp, opts.purpose || "login") : "");

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.recipient,
    type: "text",
    text: {
      preview_url: false,
      body,
    },
  };
}

/**
 * POST https://graph.facebook.com/{version}/{phone-number-id}/messages
 * OTP callers may still pass { otp, purpose }. Wave 2 kinds pass textBody / template fields.
 */
export async function sendWhatsAppGraphMessage(opts: {
  credentials: GraphCredentials;
  to: string;
  otp?: string;
  purpose?: string;
  kind?: CloudMessageKind;
  textBody?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  fetchImpl?: typeof fetch;
}): Promise<GraphMessageResult> {
  const recipient = toWhatsAppRecipient(opts.to);
  if (!recipient || recipient.length < 8) {
    return { ok: false, error: "Recipient phone number is not a valid E.164 / numeric WhatsApp id." };
  }

  const kind: CloudMessageKind = opts.kind || (opts.otp ? "otp" : "text");
  const textBody =
    opts.textBody ||
    (kind === "otp" && opts.otp ? defaultOtpTextBody(opts.otp, opts.purpose || "login") : "");

  const version = graphApiVersion();
  const url = `https://graph.facebook.com/${version}/${opts.credentials.phoneNumberId}/messages`;
  const body = buildGraphRequestBody({
    recipient,
    kind,
    textBody,
    otp: opts.otp,
    purpose: opts.purpose,
    templateName: opts.templateName,
    templateLanguage: opts.templateLanguage,
    templateParameters: opts.templateParameters,
  });

  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const graphResponse = await res.json().catch(() => ({}));
    const messageId = String(
      (graphResponse as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id || ""
    ).trim();

    if (!res.ok || !messageId) {
      return { ok: false, error: graphErrorMessage(graphResponse, res.status, kind), graphResponse };
    }

    return { ok: true, messageId, graphResponse };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Graph API request failed.",
    };
  }
}

const CLOUD_NOT_CONFIGURED =
  "WhatsApp Cloud API is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID (or a real tenant phone_number_id + token). Message was not delivered.";

function recordUtilityOutbound(opts: {
  db?: DatabaseSync | null;
  eventType: string;
  phone: string;
  name: string;
  status: string;
  details: string;
  payload: Record<string, unknown>;
}): void {
  const db = opts.db ?? tryGetDb();
  if (!db) return;
  try {
    const now = new Date().toISOString();
    const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(eventId, opts.eventType, opts.phone, opts.name, opts.status, opts.details, JSON.stringify(opts.payload), now);
  } catch (err) {
    console.error("Failed to record WhatsApp Cloud send in database:", err);
  }
}

/**
 * Shared dual-path send (Wave 1B OTP + Wave 2 reminder / book confirmation / receipt):
 * Graph when usable credentials are present; SANDBOX SQLite in non-prod when missing;
 * hard-fail in production when secrets are absent (no fake wamid / Graph success).
 */
export async function dispatchWhatsAppCloudMessage(opts: {
  to: string;
  kind: CloudMessageKind;
  patientName?: string;
  textBody: string;
  otp?: string;
  purpose?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  eventType?: string;
  payload?: Record<string, unknown>;
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  recordEvent?: boolean;
}): Promise<CloudDispatchResult> {
  const phone = String(opts.to || "").trim();
  const name = String(opts.patientName || "Patient").trim() || "Patient";
  const eventType = opts.eventType || opts.kind;
  const db = opts.db === undefined ? tryGetDb() : opts.db;
  const record = opts.recordEvent !== false;
  const creds = resolveGraphCredentials(db);

  if (creds) {
    const graph = await sendWhatsAppGraphMessage({
      credentials: creds,
      to: phone,
      otp: opts.otp,
      purpose: opts.purpose,
      kind: opts.kind,
      textBody: opts.textBody,
      templateName: opts.templateName,
      templateLanguage: opts.templateLanguage,
      templateParameters: opts.templateParameters,
      fetchImpl: opts.fetchImpl,
    });
    if (graph.ok) {
      if (record) {
        recordUtilityOutbound({
          db,
          eventType,
          phone,
          name,
          status: "sent",
          details: `WhatsApp Cloud API ${opts.kind} accepted`,
          payload: { ...(opts.payload || {}), kind: opts.kind, channel: "graph", messageId: graph.messageId, sandbox: false },
        });
      }
      return { ok: true, channel: "graph", messageId: graph.messageId };
    }
    const graphError = "error" in graph ? graph.error : "Graph send failed.";
    if (record) {
      recordUtilityOutbound({
        db,
        eventType,
        phone,
        name,
        status: "failed",
        details: `Graph ${opts.kind} send failed: ${graphError}`,
        payload: { ...(opts.payload || {}), kind: opts.kind, channel: "graph", error: graphError, sandbox: false },
      });
    }
    return { ok: false, error: graphError, channel: "graph" };
  }

  if (isProduction()) {
    if (record) {
      recordUtilityOutbound({
        db,
        eventType,
        phone,
        name,
        status: "failed",
        details: `${opts.kind} not delivered: META_ACCESS_TOKEN and META_PHONE_NUMBER_ID (or a real tenant token) are required in production.`,
        payload: { ...(opts.payload || {}), kind: opts.kind, channel: "none", sandbox: false },
      });
    }
    return { ok: false, channel: "none", error: CLOUD_NOT_CONFIGURED };
  }

  if (record) {
    recordUtilityOutbound({
      db,
      eventType,
      phone,
      name,
      status: "sandbox_recorded",
      details: `SANDBOX / DEV-ONLY ${opts.kind} recorded locally (not Graph)`,
      payload: {
        ...(opts.payload || {}),
        kind: opts.kind,
        channel: "sandbox",
        sandbox: true,
        text: sandboxBanner(opts.textBody),
      },
    });
  }
  return { ok: true, channel: "sandbox" };
}

export function mapEventTypeToKind(eventType: string): CloudMessageKind {
  const value = String(eventType || "").trim().toLowerCase();
  if (value.includes("otp")) return "otp";
  if (value.includes("reminder")) return "appointment_reminder";
  if (value.includes("receipt") || value.includes("payment") || value.includes("invoice")) return "payment_receipt";
  if (value.includes("confirm") || value === "book_appointment" || value.includes("book_confirm")) {
    return "book_confirmation";
  }
  return "text";
}

export async function sendAppointmentReminder(opts: {
  to?: string;
  patientName?: string;
  appointmentId?: string;
  tenantId?: string;
  appointment?: Partial<AppointmentSendFields>;
  templateName?: string;
  templateParameters?: string[];
  fetchImpl?: typeof fetch;
  db?: DatabaseSync | null;
}): Promise<CloudDispatchResult> {
  const db = opts.db === undefined ? tryGetDb() : opts.db;
  const lookedUp = lookupAppointmentForWhatsAppSend(db, {
    appointmentId: opts.appointmentId,
    patientPhone: opts.to,
    tenantId: opts.tenantId,
  });
  const apt: AppointmentSendFields = {
    id: opts.appointment?.id || lookedUp?.id || "",
    patientName: opts.appointment?.patientName || lookedUp?.patientName || opts.patientName || "Patient",
    patientPhone: opts.to || opts.appointment?.patientPhone || lookedUp?.patientPhone || "",
    doctorName: opts.appointment?.doctorName || lookedUp?.doctorName || "your clinician",
    specialty: opts.appointment?.specialty || lookedUp?.specialty || "",
    date: opts.appointment?.date || lookedUp?.date || "",
    timeSlot: opts.appointment?.timeSlot || lookedUp?.timeSlot || "",
    tokenNumber: opts.appointment?.tokenNumber ?? lookedUp?.tokenNumber ?? 0,
    uhid: opts.appointment?.uhid || lookedUp?.uhid,
  };
  if (!apt.patientPhone) {
    return { ok: false, channel: "none", error: "Recipient phone is required for an appointment reminder." };
  }
  return dispatchWhatsAppCloudMessage({
    to: apt.patientPhone,
    kind: "appointment_reminder",
    patientName: opts.patientName || apt.patientName,
    textBody: buildReminderText(apt, opts.patientName),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    eventType: "appointment_reminder",
    payload: { appointmentId: apt.id || undefined },
    db,
    fetchImpl: opts.fetchImpl,
  });
}

export async function sendBookConfirmation(opts: {
  to?: string;
  patientName?: string;
  appointmentId?: string;
  tenantId?: string;
  appointment?: Partial<AppointmentSendFields>;
  templateName?: string;
  templateParameters?: string[];
  fetchImpl?: typeof fetch;
  db?: DatabaseSync | null;
}): Promise<CloudDispatchResult> {
  const db = opts.db === undefined ? tryGetDb() : opts.db;
  const lookedUp = lookupAppointmentForWhatsAppSend(db, {
    appointmentId: opts.appointmentId,
    patientPhone: opts.to,
    tenantId: opts.tenantId,
  });
  const apt: AppointmentSendFields = {
    id: opts.appointment?.id || lookedUp?.id || "",
    patientName: opts.appointment?.patientName || lookedUp?.patientName || opts.patientName || "Patient",
    patientPhone: opts.to || opts.appointment?.patientPhone || lookedUp?.patientPhone || "",
    doctorName: opts.appointment?.doctorName || lookedUp?.doctorName || "your clinician",
    specialty: opts.appointment?.specialty || lookedUp?.specialty || "",
    date: opts.appointment?.date || lookedUp?.date || "",
    timeSlot: opts.appointment?.timeSlot || lookedUp?.timeSlot || "",
    tokenNumber: opts.appointment?.tokenNumber ?? lookedUp?.tokenNumber ?? 0,
    uhid: opts.appointment?.uhid || lookedUp?.uhid,
  };
  if (!apt.patientPhone) {
    return { ok: false, channel: "none", error: "Recipient phone is required for a book confirmation." };
  }
  return dispatchWhatsAppCloudMessage({
    to: apt.patientPhone,
    kind: "book_confirmation",
    patientName: opts.patientName || apt.patientName,
    textBody: buildBookConfirmationText(apt, opts.patientName),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    eventType: "book_confirmation",
    payload: { appointmentId: apt.id || undefined },
    db,
    fetchImpl: opts.fetchImpl,
  });
}

export type CloudSendHttpBody = {
  kind?: string;
  eventType?: string;
  to?: string;
  patientPhone?: string;
  patientName?: string;
  appointmentId?: string;
  tenantId?: string;
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  appointment?: Partial<AppointmentSendFields>;
  receipt?: ReceiptSendFields;
  amount?: number | string;
  currency?: string;
  invoiceId?: string;
  date?: string;
};

function jsonCloudSendResult(sent: CloudDispatchResult, extra: Record<string, unknown> = {}) {
  if (isCloudDispatchFailure(sent)) {
    return {
      status: 503,
      json: {
        ok: false,
        error: sent.error,
        channel: sent.channel,
        sandbox: false,
        delivered: false,
        ...extra,
      },
    };
  }
  return {
    status: 201,
    json: {
      ok: true,
      channel: sent.channel,
      sandbox: sent.channel === "sandbox",
      messageId: sent.messageId,
      notice:
        sent.channel === "sandbox"
          ? "SANDBOX / DEV-ONLY — recorded locally; not a Meta Cloud API delivery."
          : "WhatsApp Cloud API accepted the message.",
      ...extra,
    },
  };
}

/**
 * HTTP body for Platform scheduler / WhatsApp outbound hooks.
 * Looks up existing #13 appointment rows when appointmentId is provided.
 */
export async function handleWhatsAppCloudSendBody(
  body: CloudSendHttpBody,
  opts: { db?: DatabaseSync | null; fetchImpl?: typeof fetch } = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const eventType = String(body.eventType || body.kind || "").trim();
  const kind = mapEventTypeToKind(eventType || String(body.kind || "text"));
  const to = String(body.to || body.patientPhone || "").trim();
  const patientName = String(body.patientName || "").trim();
  const appointmentId = String(body.appointmentId || "").trim();
  const db = opts.db;

  if (kind === "appointment_reminder") {
    const sent = await sendAppointmentReminder({
      to: to || undefined,
      patientName: patientName || undefined,
      appointmentId: appointmentId || undefined,
      tenantId: body.tenantId,
      appointment: body.appointment,
      templateName: body.templateName,
      templateParameters: body.templateParameters,
      fetchImpl: opts.fetchImpl,
      db,
    });
    return jsonCloudSendResult(sent, { kind, eventType: eventType || kind });
  }

  if (kind === "book_confirmation") {
    const sent = await sendBookConfirmation({
      to: to || undefined,
      patientName: patientName || undefined,
      appointmentId: appointmentId || undefined,
      tenantId: body.tenantId,
      appointment: body.appointment,
      templateName: body.templateName,
      templateParameters: body.templateParameters,
      fetchImpl: opts.fetchImpl,
      db,
    });
    return jsonCloudSendResult(sent, { kind, eventType: eventType || kind });
  }

  if (kind === "payment_receipt") {
    const receipt: ReceiptSendFields = body.receipt || {};
    const amount = receipt.amount ?? body.amount;
    if (amount === undefined || amount === null || String(amount).trim() === "") {
      return { status: 400, json: { error: "receipt.amount is required for payment_receipt" } };
    }
    const phone = to || String(body.appointment?.patientPhone || "").trim();
    if (!phone) {
      return { status: 400, json: { error: "to / patientPhone is required for payment_receipt" } };
    }
    const sent = await sendPaymentReceipt({
      to: phone,
      patientName: patientName || receipt.patientName,
      amount,
      currency: receipt.currency || body.currency,
      invoiceId: receipt.invoiceId || body.invoiceId,
      date: receipt.date || body.date,
      appointmentId: appointmentId || undefined,
      templateName: body.templateName,
      templateParameters: body.templateParameters,
      fetchImpl: opts.fetchImpl,
      db,
    });
    return jsonCloudSendResult(sent, { kind, eventType: eventType || kind });
  }

  if (!to) {
    return { status: 400, json: { error: "to / patientPhone is required" } };
  }
  const textBody = String(body.text || "").trim();
  if (!textBody) {
    return { status: 400, json: { error: "text is required for this kind" } };
  }
  const sent = await dispatchWhatsAppCloudMessage({
    to,
    kind: kind === "otp" ? "otp" : "text",
    patientName: patientName || undefined,
    textBody,
    templateName: body.templateName,
    templateLanguage: body.templateLanguage,
    templateParameters: body.templateParameters,
    eventType: eventType || kind,
    db,
    fetchImpl: opts.fetchImpl,
  });
  return jsonCloudSendResult(sent, { kind, eventType: eventType || kind });
}

/** #25 assist: WhatsApp receipt send. Platform owns PSP / invoices; this is Graph dual-path only. */
export async function sendPaymentReceipt(opts: {
  to: string;
  patientName?: string;
  amount: number | string;
  currency?: string;
  invoiceId?: string;
  date?: string;
  appointmentId?: string;
  templateName?: string;
  templateParameters?: string[];
  fetchImpl?: typeof fetch;
  db?: DatabaseSync | null;
}): Promise<CloudDispatchResult> {
  const textBody = buildReceiptText({
    patientName: opts.patientName,
    amount: opts.amount,
    currency: opts.currency,
    invoiceId: opts.invoiceId,
    date: opts.date,
  });
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "payment_receipt",
    patientName: opts.patientName,
    textBody,
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    eventType: "payment_receipt",
    payload: { invoiceId: opts.invoiceId, appointmentId: opts.appointmentId, amount: opts.amount },
    db: opts.db,
    fetchImpl: opts.fetchImpl,
  });
}
