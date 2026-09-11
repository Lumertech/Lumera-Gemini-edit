import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion, isProduction, readSecret } from "./runtime.ts";
import { isUsableGraphToken, isUsablePhoneNumberId } from "./meta-security.ts";

/**
 * Shared Meta WhatsApp Cloud API send module (Wave 1B OTP + Wave 2 utilities).
 *
 * Platform owns appointment CRUD, reminder scheduling, WhatsApp book, and PSP/invoices.
 * Import these helpers instead of duplicating Graph POST / dual-path logic.
 *
 * Dual-path: Graph when usable credentials are present; SANDBOX in non-prod when
 * missing; production hard-fails (no fake wamid). App Review is NOT_SUBMITTED.
 */

export type GraphCredentials = {
  token: string;
  phoneNumberId: string;
  source: "env" | "tenant";
};

export type CloudMessageKind =
  | "otp"
  | "appointment_reminder"
  | "book_confirmation"
  | "payment_receipt"
  | "text";

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

/** Env or tenant Graph path is usable — OTP can actually be sent. */
export function whatsappCloudConfigured(db?: DatabaseSync | null): boolean {
  return resolveGraphCredentials(db) != null;
}

export function toWhatsAppRecipient(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export type GraphMessageResult =
  | { ok: true; messageId: string; graphResponse: unknown }
  | { ok: false; error: string; graphResponse?: unknown };

/** Low-level Graph POST. Platform #25 billing uses this via sendWhatsAppGraphText. */
export async function postGraphWhatsAppMessage(opts: {
  credentials: GraphCredentials;
  to: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  failureLabel?: string;
}): Promise<GraphMessageResult> {
  const recipient = toWhatsAppRecipient(opts.to);
  if (!recipient || recipient.length < 8) {
    return { ok: false, error: "Recipient phone number is not a valid E.164 / numeric WhatsApp id." };
  }

  const version = graphApiVersion();
  const url = `https://graph.facebook.com/${version}/${opts.credentials.phoneNumberId}/messages`;
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...opts.payload, to: recipient }),
    });
    const graphResponse = await res.json().catch(() => ({}));
    const messageId = String(
      (graphResponse as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id || ""
    ).trim();

    if (!res.ok || !messageId) {
      const graphError =
        (graphResponse as { error?: { message?: string } })?.error?.message ||
        `Graph API rejected the ${opts.failureLabel || "message"} send (HTTP ${res.status}).`;
      return { ok: false, error: graphError, graphResponse };
    }

    return { ok: true, messageId, graphResponse };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Graph API request failed.",
    };
  }
}

export async function sendWhatsAppGraphText(opts: {
  credentials: GraphCredentials;
  to: string;
  body: string;
  previewUrl?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<GraphMessageResult> {
  return postGraphWhatsAppMessage({
    credentials: opts.credentials,
    to: opts.to,
    fetchImpl: opts.fetchImpl,
    failureLabel: "text",
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "text",
      text: {
        preview_url: Boolean(opts.previewUrl),
        body: opts.body,
      },
    },
  });
}

export async function sendWhatsAppGraphTemplate(opts: {
  credentials: GraphCredentials;
  to: string;
  name: string;
  language?: string;
  bodyParameters?: string[];
  otpButtonParameter?: string;
  fetchImpl?: typeof fetch;
  failureLabel?: string;
}): Promise<GraphMessageResult> {
  const language = String(opts.language || "en").trim() || "en";
  const parameters = (opts.bodyParameters || []).map((text) => ({ type: "text", text: String(text) }));
  const components: Array<Record<string, unknown>> = [];
  if (parameters.length > 0) {
    components.push({ type: "body", parameters });
  }
  if (opts.otpButtonParameter) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: opts.otpButtonParameter }],
    });
  }
  return postGraphWhatsAppMessage({
    credentials: opts.credentials,
    to: opts.to,
    fetchImpl: opts.fetchImpl,
    failureLabel: opts.failureLabel || "template",
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "template",
      template: {
        name: opts.name,
        language: { code: language },
        ...(components.length > 0 ? { components } : {}),
      },
    },
  });
}

/** Wave 1B OTP Graph send. Signature matches Platform #25 rebase of this file. */
export async function sendWhatsAppGraphMessage(opts: {
  credentials: GraphCredentials;
  to: string;
  otp: string;
  purpose: string;
  fetchImpl?: typeof fetch;
}): Promise<GraphMessageResult> {
  const templateName = String(process.env.META_OTP_TEMPLATE_NAME || "").trim();
  const language = String(process.env.META_OTP_TEMPLATE_LANGUAGE || "en").trim() || "en";

  if (templateName) {
    return sendWhatsAppGraphTemplate({
      credentials: opts.credentials,
      to: opts.to,
      name: templateName,
      language,
      bodyParameters: [opts.otp],
      otpButtonParameter: process.env.META_OTP_TEMPLATE_BUTTON === "true" ? opts.otp : undefined,
      fetchImpl: opts.fetchImpl,
      failureLabel: "OTP",
    });
  }

  return sendWhatsAppGraphText({
    credentials: opts.credentials,
    to: opts.to,
    body: `Lumera verification code: ${opts.otp}\nAction: ${opts.purpose}\nValid for 5 minutes. Do not share this code.`,
    fetchImpl: opts.fetchImpl,
  });
}

function envTrim(name: string): string {
  return String(process.env[name] || "").trim();
}

function utilityTemplateLanguage(): string {
  return envTrim("META_UTILITY_TEMPLATE_LANGUAGE") || envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en";
}

/** Optional Cloud API template for a kind. Unset → session text body (same as OTP #20). */
export function templateConfigForKind(kind: CloudMessageKind): { name: string; language: string } | null {
  const envName =
    kind === "otp"
      ? "META_OTP_TEMPLATE_NAME"
      : kind === "appointment_reminder"
        ? "META_REMINDER_TEMPLATE_NAME"
        : kind === "book_confirmation"
          ? "META_BOOK_CONFIRMATION_TEMPLATE_NAME"
          : kind === "payment_receipt"
            ? "META_RECEIPT_TEMPLATE_NAME"
            : "";
  if (!envName) return null;
  const name = envTrim(envName);
  if (!name) return null;
  const language =
    kind === "otp" ? envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en" : utilityTemplateLanguage();
  return { name, language };
}

export type ReminderFields = {
  patientName?: string;
  doctorName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
};

export type ReceiptFields = {
  patientName?: string;
  amount?: number | string;
  currency?: string;
  invoiceId?: string;
  date?: string;
};

export function sandboxBanner(body: string): string {
  return `SANDBOX / DEV-ONLY (not sent via Graph)\n\n${body}`;
}

export function buildReminderText(fields: ReminderFields): string {
  const name = fields.patientName || "Patient";
  const token =
    fields.tokenNumber != null && Number(fields.tokenNumber) > 0
      ? `#${String(fields.tokenNumber).padStart(2, "0")}`
      : "pending";
  return (
    `⏰ *Appointment reminder — Lumera*\n\n` +
    `Namaste ${name},\n` +
    `Your consultation with *${fields.doctorName || "your clinician"}* is scheduled for *${fields.date || "the upcoming slot"}* at *${fields.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*\n` +
    (fields.specialty ? `📍 ${fields.specialty}\n\n` : "\n") +
    `Please arrive 10 minutes early for vitals.`
  );
}

export function buildBookConfirmationText(fields: ReminderFields & { uhid?: string }): string {
  const name = fields.patientName || "Patient";
  const token =
    fields.tokenNumber != null && Number(fields.tokenNumber) > 0
      ? `#${String(fields.tokenNumber).padStart(2, "0")}`
      : "pending";
  return (
    `✅ *Appointment confirmed — Lumera*\n\n` +
    `Namaste ${name},\n` +
    `Your visit with *${fields.doctorName || "your clinician"}*` +
    (fields.specialty ? ` (${fields.specialty})` : "") +
    ` is booked for *${fields.date || "the scheduled date"}* at *${fields.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*` +
    (fields.uhid ? `\nUHID: ${fields.uhid}` : "")
  );
}

export function buildReceiptText(receipt: ReceiptFields): string {
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

const CLOUD_NOT_CONFIGURED =
  "WhatsApp Cloud API is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID (or a real tenant phone_number_id + token). Message was not delivered.";

/**
 * Dual-path Cloud send for Platform to import (reminders, book confirmations, receipts, OTP).
 * Does not schedule, look up appointments, or own invoice rows.
 */
export async function dispatchWhatsAppCloudMessage(opts: {
  to: string;
  textBody: string;
  kind?: CloudMessageKind;
  otp?: string;
  purpose?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  previewUrl?: boolean;
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
}): Promise<CloudDispatchResult> {
  const kind: CloudMessageKind = opts.kind || (opts.otp ? "otp" : "text");
  const creds = resolveGraphCredentials(opts.db);

  if (creds) {
    let graph: GraphMessageResult;
    if (kind === "otp" && opts.otp) {
      graph = await sendWhatsAppGraphMessage({
        credentials: creds,
        to: opts.to,
        otp: opts.otp,
        purpose: opts.purpose || "login",
        fetchImpl: opts.fetchImpl,
      });
    } else {
      const templateName = (opts.templateName || "").trim() || templateConfigForKind(kind)?.name || "";
      const templateLanguage =
        (opts.templateLanguage || "").trim() || templateConfigForKind(kind)?.language || "en";
      if (templateName) {
        graph = await sendWhatsAppGraphTemplate({
          credentials: creds,
          to: opts.to,
          name: templateName,
          language: templateLanguage,
          bodyParameters: opts.templateParameters,
          fetchImpl: opts.fetchImpl,
          failureLabel: kind,
        });
      } else {
        graph = await sendWhatsAppGraphText({
          credentials: creds,
          to: opts.to,
          body: opts.textBody,
          previewUrl: opts.previewUrl,
          fetchImpl: opts.fetchImpl,
        });
      }
    }
    if (graph.ok) return { ok: true, channel: "graph", messageId: graph.messageId };
    const graphError = "error" in graph ? graph.error : "Graph send failed.";
    return { ok: false, error: graphError, channel: "graph" };
  }

  if (isProduction()) {
    return { ok: false, channel: "none", error: CLOUD_NOT_CONFIGURED };
  }

  return { ok: true, channel: "sandbox" };
}

export async function sendAppointmentReminder(opts: {
  to: string;
  patientName?: string;
  doctorName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
  textBody?: string;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "appointment_reminder",
    textBody: opts.textBody || buildReminderText(opts),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
  });
}

export async function sendBookConfirmation(opts: {
  to: string;
  patientName?: string;
  doctorName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
  uhid?: string;
  textBody?: string;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "book_confirmation",
    textBody: opts.textBody || buildBookConfirmationText(opts),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
  });
}

/** #25 assist: Graph dual-path only. Platform owns Razorpay/invoices and can pass textBody. */
export async function sendPaymentReceipt(opts: {
  to: string;
  patientName?: string;
  amount?: number | string;
  currency?: string;
  invoiceId?: string;
  date?: string;
  textBody?: string;
  previewUrl?: boolean;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "payment_receipt",
    textBody: opts.textBody || buildReceiptText(opts),
    previewUrl: opts.previewUrl,
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
  });
}
