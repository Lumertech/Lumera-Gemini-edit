import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion, isProduction, readSecret } from "./runtime.ts";
import { isUsableGraphToken, isUsablePhoneNumberId } from "./meta-security.ts";
import {
  assertWalletAllowsDebit,
  billedAmountFromRaw,
  estimateWhatsAppRawCostInr,
  getMarkupPercent,
  isCriticalWhatsAppKind,
  recordWhatsAppUsageAndDebit,
} from "./usage-billing.ts";

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
  | "queue_next"
  | "prescription_ready"
  | "text";

export type CloudDispatchResult =
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string }
  | { ok: false; error: string; channel: "none" | "graph" };

export function isCloudDispatchFailure(
  sent: CloudDispatchResult
): sent is { ok: false; error: string; channel: "none" | "graph" } {
  return sent.ok === false;
}

function usableTenantGraphRow(row: { meta_access_token?: string; phone_number_id?: string } | undefined): GraphCredentials | null {
  if (!row) return null;
  const token = String(row.meta_access_token || "");
  const phoneNumberId = String(row.phone_number_id || "");
  if (isUsableGraphToken(token) && isUsablePhoneNumberId(phoneNumberId)) {
    return { token, phoneNumberId, source: "tenant" };
  }
  return null;
}

/**
 * Env credentials win for every send.
 * A tenant id (including "") uses only that clinic's row — never another clinic's WABA.
 * Omit tenantId to scan any connected clinic (readiness overview only).
 */
export function resolveGraphCredentials(db?: DatabaseSync | null, tenantId?: string | null): GraphCredentials | null {
  const envToken = readSecret("META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const envPhone = readSecret("META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID");
  if (isUsableGraphToken(envToken) && isUsablePhoneNumberId(envPhone)) {
    return { token: envToken, phoneNumberId: envPhone, source: "env" };
  }

  if (!db) return null;
  try {
    if (tenantId !== undefined) {
      const id = String(tenantId || "").trim();
      if (!id) return null;
      const row = db
        .prepare(
          `SELECT meta_access_token, phone_number_id FROM tenants WHERE id = ?`
        )
        .get(id) as { meta_access_token?: string; phone_number_id?: string } | undefined;
      return usableTenantGraphRow(row);
    }

    const rows = db
      .prepare(
        `SELECT meta_access_token, phone_number_id FROM tenants
         WHERE COALESCE(meta_access_token, '') != '' AND COALESCE(phone_number_id, '') != ''`
      )
      .all() as { meta_access_token: string; phone_number_id: string }[];
    for (const row of rows) {
      const creds = usableTenantGraphRow(row);
      if (creds) return creds;
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
    // AUTH COPY_CODE (lumera_login_otp). Cloud API button component is
    // sub_type "copy_code" with { type: "coupon_code", coupon_code: OTP },
    // not a URL text suffix. Graph (#131008) if this parameter is omitted.
    // https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/coupon-templates/
    components.push({
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "coupon_code", coupon_code: opts.otpButtonParameter }],
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
      // Always send the button OTP. META_OTP_TEMPLATE_BUTTON is not a gate;
      // leaving it "true" is harmless.
      otpButtonParameter: opts.otp,
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

const TEMPLATE_ENV_BY_KIND: Partial<Record<CloudMessageKind, string>> = {
  otp: "META_OTP_TEMPLATE_NAME",
  appointment_reminder: "META_REMINDER_TEMPLATE_NAME",
  book_confirmation: "META_BOOK_CONFIRMATION_TEMPLATE_NAME",
  payment_receipt: "META_RECEIPT_TEMPLATE_NAME",
  queue_next: "META_QUEUE_NEXT_TEMPLATE_NAME",
  prescription_ready: "META_PRESCRIPTION_READY_TEMPLATE_NAME",
};

/**
 * Per-kind language. META_UTILITY_TEMPLATE_LANGUAGE stays en_US for Reminder safety.
 * Booked, receipt, queue, and prescription Manager copies are English (`en`), so each
 * has its own override. OTP never reads the utility language.
 */
const TEMPLATE_LANGUAGE_BY_KIND: Partial<
  Record<CloudMessageKind, { env: string; fallback: string; useUtility: boolean }>
> = {
  otp: { env: "META_OTP_TEMPLATE_LANGUAGE", fallback: "en", useUtility: false },
  appointment_reminder: { env: "META_REMINDER_TEMPLATE_LANGUAGE", fallback: "en_US", useUtility: true },
  book_confirmation: { env: "META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE", fallback: "en", useUtility: true },
  payment_receipt: { env: "META_RECEIPT_TEMPLATE_LANGUAGE", fallback: "en", useUtility: true },
  queue_next: { env: "META_QUEUE_NEXT_TEMPLATE_LANGUAGE", fallback: "en", useUtility: true },
  prescription_ready: { env: "META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE", fallback: "en", useUtility: true },
};

export function languageForKind(kind: CloudMessageKind): string {
  const spec = TEMPLATE_LANGUAGE_BY_KIND[kind];
  if (!spec) return "en";
  const specific = envTrim(spec.env);
  if (specific) return specific;
  if (spec.useUtility) {
    const utility = envTrim("META_UTILITY_TEMPLATE_LANGUAGE");
    if (utility) return utility;
  }
  return spec.fallback;
}

/** Optional Cloud API template for a kind. Unset → session text body (same as OTP #20). */
export function templateConfigForKind(kind: CloudMessageKind): { name: string; language: string } | null {
  const envName = TEMPLATE_ENV_BY_KIND[kind] || "";
  if (!envName) return null;
  const name = envTrim(envName);
  if (!name) return null;
  return { name, language: languageForKind(kind) };
}

/** Neutral fillers when a tenant row has no display name. Never a Lumera brand string. */
export const CLINIC_DISPLAY_FALLBACK = "your clinic";
export const DOCTOR_DISPLAY_FALLBACK = "your clinician";

function templateParamText(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

/** Numeric tokens are zero-padded. A leading # is stripped so the Manager body can say "Token {{n}}". */
export function formatQueueToken(value: unknown, fallback = "02"): string {
  const raw = templateParamText(value, "").replace(/^#/, "");
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return raw.padStart(2, "0");
  return raw;
}

export type QueueNextFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  tokenNumber?: string | number;
  currentToken?: string | number;
  location?: string;
};

/**
 * lumera_queue_next body order (language: META_QUEUE_NEXT_TEMPLATE_LANGUAGE,
 * else META_UTILITY_TEMPLATE_LANGUAGE, else en).
 * Manager count is not in this repo. Order follows lumera_appointment_reminder:
 * {{1}} patient, {{2}} clinic display name, {{3}} doctor, {{4}} your token, {{5}} room.
 * Clinic and doctor come from the tenant / appointment. The token currently in
 * consultation stays in the session text only.
 */
export function queueNextTemplateParameters(fields: QueueNextFields): string[] {
  return [
    templateParamText(fields.patientName, "Patient"),
    templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK),
    templateParamText(fields.doctorName, DOCTOR_DISPLAY_FALLBACK),
    formatQueueToken(fields.tokenNumber, "02"),
    templateParamText(fields.location, "Rehab Suite 105"),
  ];
}

export function buildQueueNextText(fields: QueueNextFields): string {
  const name = templateParamText(fields.patientName, "Patient");
  const current = formatQueueToken(fields.currentToken, "01");
  const next = formatQueueToken(fields.tokenNumber, "02");
  const location = templateParamText(fields.location, "Rehab Suite 105");
  const place =
    location === "Rehab Suite 105" ? "*Rehab Suite 105* near Waiting Lounge B" : `*${location}*`;
  return (
    `📢 *OPD Queue Alert - You're Almost Up!*\n\n` +
    `Namaste ${name},\n` +
    `Token *#${current}* is currently completing consultation. You are *NEXT IN LINE* (Token #${next}).\n\n` +
    `📍 Please proceed to ${place}.`
  );
}

export type PrescriptionReadyFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  rxNumber?: string;
};

/**
 * lumera_prescription_ready body order. Never META_RECEIPT_TEMPLATE_NAME.
 * {{1}} patient, {{2}} clinic display name, {{3}} doctor, {{4}} Rx number.
 * Clinic and doctor come from the tenant / appointment. The PDF link stays on
 * the session text / local media card.
 */
export function prescriptionReadyTemplateParameters(fields: PrescriptionReadyFields): string[] {
  return [
    templateParamText(fields.patientName, "Patient"),
    templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK),
    templateParamText(fields.doctorName, DOCTOR_DISPLAY_FALLBACK),
    templateParamText(fields.rxNumber, "RX"),
  ];
}

export type BookConfirmationFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: string | number;
};

/**
 * lumera_appointment_booked body order.
 * {{1}} patient, {{2}} clinic display name, {{3}} doctor, {{4}} date, {{5}} time, {{6}} token.
 * Clinic is the tenant display name. Doctor is the appointment clinician.
 */
export function bookConfirmationTemplateParameters(fields: BookConfirmationFields): string[] {
  const token = templateParamText(fields.tokenNumber, "");
  return [
    templateParamText(fields.patientName, "Patient"),
    templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK),
    templateParamText(fields.doctorName, DOCTOR_DISPLAY_FALLBACK),
    templateParamText(fields.date, "the scheduled date"),
    templateParamText(fields.timeSlot, "OPD"),
    token || "pending",
  ];
}

export type ReceiptTemplateFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  amount?: number | string;
  invoiceId?: string;
};

/**
 * lumera_payment_receipt body order. Not used for prescription_ready.
 * {{1}} patient, {{2}} clinic display name, {{3}} doctor, {{4}} amount, {{5}} invoice.
 */
export function receiptTemplateParameters(fields: ReceiptTemplateFields): string[] {
  const amount = templateParamText(fields.amount, "0");
  return [
    templateParamText(fields.patientName, "Patient"),
    templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK),
    templateParamText(fields.doctorName, DOCTOR_DISPLAY_FALLBACK),
    amount,
    templateParamText(fields.invoiceId, "invoice"),
  ];
}

export type ReminderFields = {
  patientName?: string;
  doctorName?: string;
  clinicName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
};

export type ReceiptFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
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
    `⏰ *Appointment reminder — ${templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK)}*\n\n` +
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
    `✅ *Appointment confirmed — ${templateParamText(fields.clinicName, CLINIC_DISPLAY_FALLBACK)}*\n\n` +
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
    `🧰 *Payment receipt — ${templateParamText(receipt.clinicName, CLINIC_DISPLAY_FALLBACK)}*\n\n` +
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
  tenantId?: string;
  inCustomerServiceWindow?: boolean;
}): Promise<CloudDispatchResult> {
  const kind: CloudMessageKind = opts.kind || (opts.otp ? "otp" : "text");
  const tenantId = resolveUsageTenantId(opts.tenantId, opts.to, opts.db);
  const inCustomerServiceWindow = opts.inCustomerServiceWindow ?? kind === "text";

  if (tenantId && opts.db) {
    try {
      const estimate = estimateWhatsAppRawCostInr({
        kind,
        to: opts.to,
        inCustomerServiceWindow,
      });
      const markupPercent = getMarkupPercent(tenantId, "whatsapp_message", opts.db);
      const billedAmount = billedAmountFromRaw(estimate.rawCost, markupPercent);
      const gate = assertWalletAllowsDebit({
        tenantId,
        billedAmount,
        critical: isCriticalWhatsAppKind(kind),
        database: opts.db,
      });
      if (gate.ok === false) {
        return { ok: false, error: gate.error, channel: "none" };
      }
    } catch (err) {
      console.error("Wallet pre-check failed:", err);
    }
  }

  const creds = resolveGraphCredentials(opts.db, tenantId);

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
    if (graph.ok) {
      meterWhatsAppUsage({
        tenantId,
        db: opts.db,
        kind,
        to: opts.to,
        inCustomerServiceWindow,
        channel: "graph",
        messageId: graph.messageId,
      });
      return { ok: true, channel: "graph", messageId: graph.messageId };
    }
    const graphError = "error" in graph ? graph.error : "Graph send failed.";
    return { ok: false, error: graphError, channel: "graph" };
  }

  if (isProduction()) {
    return { ok: false, channel: "none", error: CLOUD_NOT_CONFIGURED };
  }

  meterWhatsAppUsage({
    tenantId,
    db: opts.db,
    kind,
    to: opts.to,
    inCustomerServiceWindow,
    channel: "sandbox",
  });
  return { ok: true, channel: "sandbox" };
}

/**
 * Prefer the caller-supplied tenantId (calendar, receipts, staff/bot replies).
 * OTP may omit it and resolve from users.phone. Patient recipients are not users —
 * never skip them: if the phone uniquely maps to one patients.tenant_id, meter that clinic.
 */
export function resolveUsageTenantId(
  tenantId: string | undefined,
  to: string,
  db?: DatabaseSync | null
): string {
  const explicit = String(tenantId || "").trim();
  if (explicit) return explicit;
  if (!db) return "";
  const digits = toWhatsAppRecipient(to);
  if (digits.length < 10) return "";
  const local10 = digits.slice(-10);
  const like = `%${local10}`;
  try {
    const userRow = db
      .prepare(
        `SELECT tenant_id FROM users
         WHERE replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?
         ORDER BY last_login DESC
         LIMIT 1`
      )
      .get(like) as { tenant_id?: string } | undefined;
    const fromUser = String(userRow?.tenant_id || "").trim();
    if (fromUser) return fromUser;
  } catch {
    /* users table may be missing in isolated tests */
  }
  try {
    const patientRows = db
      .prepare(
        `SELECT DISTINCT tenant_id FROM patients
         WHERE tenant_id != '' AND replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?`
      )
      .all(like) as { tenant_id?: string }[];
    const tenantIds = [...new Set(patientRows.map((row) => String(row.tenant_id || "").trim()).filter(Boolean))];
    if (tenantIds.length === 1) return tenantIds[0];
  } catch {
    /* patients table may be missing in isolated tests */
  }
  return "";
}

function meterWhatsAppUsage(opts: {
  tenantId: string;
  db?: DatabaseSync | null;
  kind: CloudMessageKind;
  to: string;
  inCustomerServiceWindow: boolean;
  channel: "graph" | "sandbox";
  messageId?: string;
}) {
  if (!opts.tenantId || !opts.db) return;
  try {
    recordWhatsAppUsageAndDebit({
      tenantId: opts.tenantId,
      kind: opts.kind,
      to: opts.to,
      inCustomerServiceWindow: opts.inCustomerServiceWindow,
      database: opts.db,
      metadata: { channel: opts.channel, messageId: opts.messageId || null },
    });
  } catch (err) {
    console.error("Failed to record WhatsApp usage:", err);
  }
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
  tenantId?: string;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "appointment_reminder",
    textBody: opts.textBody || buildReminderText(opts),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
}

export async function sendBookConfirmation(opts: {
  to: string;
  patientName?: string;
  clinicName?: string;
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
  tenantId?: string;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "book_confirmation",
    textBody: opts.textBody || buildBookConfirmationText(opts),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters || bookConfirmationTemplateParameters(opts),
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
}

function utilityTemplateActive(kind: CloudMessageKind, explicitName?: string): boolean {
  return Boolean((explicitName || "").trim() || templateConfigForKind(kind)?.name);
}

/**
 * Queue-next alert. META_QUEUE_NEXT_TEMPLATE_NAME set → lumera_queue_next.
 * Unset → session text (buildQueueNextText). No fake wamid when Graph is down.
 */
export async function sendQueueNext(opts: {
  to: string;
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  tokenNumber?: string | number;
  currentToken?: string | number;
  location?: string;
  textBody?: string;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  inCustomerServiceWindow?: boolean;
}): Promise<CloudDispatchResult> {
  const fields: QueueNextFields = opts;
  const named = utilityTemplateActive("queue_next", opts.templateName);
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "queue_next",
    textBody: opts.textBody || buildQueueNextText(fields),
    templateName: opts.templateName,
    templateParameters: opts.templateParameters || queueNextTemplateParameters(fields),
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
    // Session-text fallback stays inside the customer-service window (pre-cutover free).
    // A configured template is business-initiated utility and is billed.
    inCustomerServiceWindow: opts.inCustomerServiceWindow ?? !named,
  });
}

/**
 * Prescription-ready alert. Uses META_PRESCRIPTION_READY_TEMPLATE_NAME only —
 * never META_RECEIPT_TEMPLATE_NAME. Unset → session textBody.
 */
export async function sendPrescriptionReady(opts: {
  to: string;
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  rxNumber?: string;
  textBody?: string;
  previewUrl?: boolean;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  inCustomerServiceWindow?: boolean;
}): Promise<CloudDispatchResult> {
  const fields: PrescriptionReadyFields = opts;
  const named = utilityTemplateActive("prescription_ready", opts.templateName);
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "prescription_ready",
    textBody:
      opts.textBody ||
      `Namaste ${templateParamText(fields.patientName, "Patient")}, your prescription ${templateParamText(fields.rxNumber, "RX")} from ${templateParamText(fields.doctorName, "your clinician")} is ready.`,
    previewUrl: opts.previewUrl,
    templateName: opts.templateName,
    templateParameters: opts.templateParameters || prescriptionReadyTemplateParameters(fields),
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
    inCustomerServiceWindow: opts.inCustomerServiceWindow ?? !named,
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
  clinicName?: string;
  doctorName?: string;
  templateName?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
}): Promise<CloudDispatchResult> {
  return dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "payment_receipt",
    textBody: opts.textBody || buildReceiptText(opts),
    previewUrl: opts.previewUrl,
    templateName: opts.templateName,
    templateParameters:
      opts.templateParameters ||
      receiptTemplateParameters({
        patientName: opts.patientName,
        clinicName: opts.clinicName,
        doctorName: opts.doctorName,
        amount: opts.amount,
        invoiceId: opts.invoiceId,
      }),
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
}