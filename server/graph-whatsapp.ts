import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion, isProduction, readSecret } from "./runtime.ts";
import { isUsableGraphToken, isUsablePhoneNumberId } from "./meta-security.ts";
import { recordWhatsAppUsageAndDebit } from "./usage-billing.ts";
import { getTenantWabaNumber, getWhatsAppNumberSecret } from "./whatsapp-numbers-store.ts";
import { waTokenKeyBytes } from "./wa-token-crypto.ts";
import { formatINR } from "../src/lib/currency.ts";
import { isSampleTaxInvoice, sampleTaxInvoiceReceiptText } from "../src/lib/sampleTaxInvoice.ts";
import {
  approvedClinicTemplate,
  bookConfirmationTemplateParameters,
  clinicTemplateName,
  formatGraphSendError,
  receiptTemplateParameters,
  reminderTemplateParameters,
  TEMPLATE_NOT_APPROVED_ERROR,
} from "./clinic-whatsapp-templates.ts";
import { mintPatientLinkToken, revokePatientLinkToken } from "./patient-link-token.ts";
import { whatsAppOptInBlock } from "./whatsapp-opt-in.ts";

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
  | "prescription_ready"
  | "text";

export type CloudDispatchResult =
  | { ok: true; channel: "graph" | "sandbox"; messageId?: string }
  | { ok: false; error: string; channel: "none" | "graph"; status?: number; eventId?: string };

export const SKIPPED_NOT_ALLOWLISTED = "skipped_not_allowlisted";
export const FAILED_FINAL = "failed_final";
export const DEMO_OUTBOUND_ATTEMPT_CAP = 3;

export const CLINIC_WHATSAPP_NOT_CONNECTED = "Clinic WhatsApp not connected";
export const READ_ONLY_WHATSAPP_SEND_ERROR =
  "This clinic is read-only. Templates, reminders, and automated WhatsApp sends are not permitted.";
export const WHATSAPP_WINDOW_CLOSED_ERROR =
  "Manual WhatsApp replies are limited to 24 hours after the patient's last inbound message.";
export const CLINIC_DOCTOR_NAME_REQUIRED = "clinic_name and doctor_name are required.";
export const WA_TOKEN_KEY_UNSET_ERROR =
  "WA_TOKEN_KEY is unset. Clinic WhatsApp sends are unavailable until it is set.";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function cloudDispatchHttpStatus(error: string, status?: number): number {
  if (status === 403 || status === 402 || status === 503 || status === 400) return status;
  if (error === CLINIC_WHATSAPP_NOT_CONNECTED || /Clinic WhatsApp not connected/i.test(error)) return 503;
  if (error === WA_TOKEN_KEY_UNSET_ERROR || /WA_TOKEN_KEY is unset/i.test(error)) return 503;
  if (error === READ_ONLY_WHATSAPP_SEND_ERROR || error === WHATSAPP_WINDOW_CLOSED_ERROR) return 403;
  if (/not permitted|24 hours after the patient/i.test(error)) return 403;
  if (String(error || "").includes("Top up now")) return 402;
  if (String(error || "").includes("TEMPLATE_NOT_APPROVED")) return 409;
  return isProduction() ? 503 : 502;
}

export function isCloudDispatchFailure(
  sent: CloudDispatchResult
): sent is { ok: false; error: string; channel: "none" | "graph" } {
  return sent.ok === false;
}

function envGraphCredentials(): GraphCredentials | null {
  const token = readSecret("META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = readSecret("META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID");
  if (isUsableGraphToken(token) && isUsablePhoneNumberId(phoneNumberId)) {
    return { token, phoneNumberId, source: "env" };
  }
  return null;
}

function tenantNumberCredentials(db: DatabaseSync, tenantId: string): GraphCredentials | null {
  try {
    const row = getTenantWabaNumber(tenantId, db);
    if (!row || row.status !== "connected") return null;
    const token = row.meta_token_ref ? getWhatsAppNumberSecret(row.meta_token_ref, db) : "";
    const phoneNumberId = String(row.phone_number_id || "");
    if (isUsableGraphToken(token) && isUsablePhoneNumberId(phoneNumberId)) {
      return { token, phoneNumberId, source: "tenant" };
    }
  } catch {
    /* whatsapp_numbers may be missing in isolated tests */
  }
  return null;
}

/** Sandbox/demo clinics may fall back to platform env creds. Real clinics may not. */
export function isSandboxOrDemoTenant(db: DatabaseSync | null | undefined, tenantId: string): boolean {
  const id = String(tenantId || "").trim();
  if (!id) return false;
  if (
    id === "tenant-lumera-main" ||
    id === "tenant-rehab-mumbai" ||
    id === "tenant-suspended-demo" ||
    id.startsWith("tenant-demo-")
  ) {
    return true;
  }
  if (!db) return false;
  try {
    const row = db
      .prepare("SELECT billing_source FROM tenant_subscriptions WHERE tenant_id = ?")
      .get(id) as { billing_source?: string } | undefined;
    const source = String(row?.billing_source || "").trim().toLowerCase();
    return source === "demo" || source === "sandbox";
  } catch {
    return false;
  }
}

/**
 * A clinic tenant uses only that tenant's connected WhatsApp number row.
 * Env creds are for platform sends (login OTP, Super Admin) and sandbox/demo
 * tenants that do not yet have their own number. Never another clinic's WABA.
 */
export function resolveGraphCredentials(
  db?: DatabaseSync | null,
  tenantId?: string | null,
  opts?: { platformSend?: boolean }
): GraphCredentials | null {
  const envCreds = envGraphCredentials();
  if (opts?.platformSend) return envCreds;

  if (tenantId !== undefined && tenantId !== null) {
    const id = String(tenantId || "").trim();
    if (!id) return null;
    if (!db) return null;
    const tenantCreds = tenantNumberCredentials(db, id);
    if (tenantCreds) return tenantCreds;
    if (isSandboxOrDemoTenant(db, id)) return envCreds;
    return null;
  }

  return envCreds;
}

/**
 * Last patient inbound within 24h opens the customer-service window.
 * The clock is whatsapp_conversations.last_inbound_at for the caller's tenant only.
 * Unassigned and other-tenant rows never open the window.
 * tenant_id and last_inbound_at are created by drizzle 0001 and 0003. Do not
 * probe them with PRAGMA: Postgres rejects that and the failure closed the window.
 */
export function isWithinCustomerServiceWindow(
  db: DatabaseSync | null | undefined,
  tenantId: string,
  to: string,
  nowMs = Date.now()
): boolean {
  if (!db) return false;
  const tenant = String(tenantId || "").trim();
  if (!tenant) return false;
  const digits = toWhatsAppRecipient(to);
  if (digits.length < 10) return false;
  const like = `%${digits.slice(-10)}`;
  try {
    const row = db
      .prepare(
        `SELECT last_inbound_at FROM whatsapp_conversations
         WHERE tenant_id = ?
           AND last_inbound_at IS NOT NULL
           AND TRIM(last_inbound_at) != ''
           AND replace(replace(replace(replace(patient_phone, ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?
         ORDER BY last_inbound_at DESC
         LIMIT 1`
      )
      .get(tenant, like) as { last_inbound_at?: string } | undefined;
    const ts = Date.parse(String(row?.last_inbound_at || ""));
    if (!Number.isFinite(ts)) return false;
    const age = nowMs - ts;
    return age >= 0 && age <= CUSTOMER_SERVICE_WINDOW_MS;
  } catch {
    return false;
  }
}

function tenantHasConnectedWhatsAppNumber(db: DatabaseSync, tenantId: string): boolean {
  try {
    const row = getTenantWabaNumber(tenantId, db);
    return Boolean(row && row.status === "connected" && String(row.phone_number_id || "").trim());
  } catch {
    return false;
  }
}

/** Real clinic numbers cannot send until WA_TOKEN_KEY can seal and read the token. */
function clinicTokenKeyMissing(): boolean {
  try {
    return waTokenKeyBytes() == null;
  } catch {
    return true;
  }
}

function clinicWhatsAppRestricted(db: DatabaseSync, tenantId: string): boolean {
  try {
    const tenant = db
      .prepare("SELECT active_status, lifecycle_status, deleted_at FROM tenants WHERE id = ?")
      .get(tenantId) as { active_status?: number; lifecycle_status?: string; deleted_at?: string } | undefined;
    if (tenant) {
      if (String(tenant.deleted_at || "").trim()) return true;
      const life = String(tenant.lifecycle_status || "").trim().toLowerCase();
      if (life === "suspended" || life === "deleted") return true;
      if (Number(tenant.active_status) === 0) return true;
    }
  } catch {
    /* tenants table missing */
  }
  try {
    const sub = db
      .prepare("SELECT status, ends_at FROM tenant_subscriptions WHERE tenant_id = ?")
      .get(tenantId) as { status?: string; ends_at?: string } | undefined;
    if (!sub) return false;
    const status = String(sub.status || "").trim().toLowerCase();
    if (status === "past_due" || status === "canceled" || status === "cancelled") return true;
    if ((status === "trial" || status === "expired") && sub.ends_at) {
      const ends = Date.parse(String(sub.ends_at));
      if (Number.isFinite(ends) && ends < Date.now()) return true;
    }
  } catch {
    /* subscription table missing */
  }
  return false;
}

/**
 * Lapsed or read-only clinics may send only manual staff text inside the
 * 24h customer-service window. Templates, reminders, bot, and other automated
 * sends are rejected.
 */
export function assertTenantMaySendWhatsApp(
  tenantId: string,
  kind: CloudMessageKind,
  isManual: boolean,
  db?: DatabaseSync | null,
  to?: string
): { ok: true } | { ok: false; error: string; status: 403 } {
  const id = String(tenantId || "").trim();
  if (!id || !db) return { ok: true };
  if (!clinicWhatsAppRestricted(db, id)) return { ok: true };
  if (!isManual || kind !== "text") {
    return { ok: false, error: READ_ONLY_WHATSAPP_SEND_ERROR, status: 403 };
  }
  if (!to || !isWithinCustomerServiceWindow(db, id, to)) {
    return { ok: false, error: WHATSAPP_WINDOW_CLOSED_ERROR, status: 403 };
  }
  return { ok: true };
}

function lookupClinicName(db: DatabaseSync | null | undefined, tenantId?: string): string {
  const id = String(tenantId || "").trim();
  if (!db || !id) return "";
  try {
    const row = db.prepare("SELECT name FROM tenants WHERE id = ?").get(id) as { name?: string } | undefined;
    return String(row?.name || "").trim();
  } catch {
    return "";
  }
}

const PLATFORM_AUTH_PURPOSES = new Set(["login", "register", "password_reset"]);

function isPlatformAuthOtp(kind: CloudMessageKind, purpose: string | undefined, explicitTenantId: string): boolean {
  if (kind !== "otp") return false;
  if (explicitTenantId) return false;
  return PLATFORM_AUTH_PURPOSES.has(String(purpose || "").trim().toLowerCase());
}

export function toWhatsAppRecipient(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/** Last 4 digits only. Logs must not carry a full WhatsApp recipient. */
export function maskWhatsAppRecipient(phone: string): string {
  const last4 = toWhatsAppRecipient(phone).slice(-4);
  return last4 ? `****${last4}` : "****";
}

/** Comma-separated E.164. Unset or empty means demo tenants send to nobody. */
export function demoWhatsAppAllowlist(): string[] {
  const raw = String(process.env.DEMO_WHATSAPP_RECIPIENT_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Exact normalized E.164 (digits only, country code included). Not a last-10 match. */
export function isDemoWhatsAppAllowlisted(phone: string): boolean {
  const digits = toWhatsAppRecipient(phone);
  if (!digits) return false;
  return demoWhatsAppAllowlist().some((entry) => toWhatsAppRecipient(entry) === digits);
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
      const graphErr = (graphResponse as { error?: { message?: string; code?: number | string } })?.error;
      const code = graphErr?.code != null ? String(graphErr.code) : "";
      const graphError = formatGraphSendError(
        code,
        graphErr?.message || `Graph API rejected the ${opts.failureLabel || "message"} send (HTTP ${res.status}).`
      );
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
  /** AUTHENTICATION copy-code OTP. Same value as the body OTP. Not a coupon. */
  authOtpButtonParameter?: string;
  /** Marketing/utility coupon COPY_CODE button. Not used for AUTH OTP. */
  couponCodeButtonParameter?: string;
  /** Utility URL button suffix. The template URL is a fixed base plus this one trailing value. */
  urlButtonParameter?: string;
  fetchImpl?: typeof fetch;
  failureLabel?: string;
}): Promise<GraphMessageResult> {
  // lumera_login_otp language is en. Do not let META_UTILITY_TEMPLATE_LANGUAGE
  // or an en_US OTP env value rewrite it. Utility templates keep opts.language.
  const language = opts.authOtpButtonParameter
    ? "en"
    : String(opts.language || "en").trim() || "en";
  // lumera_login_otp: exactly one body text parameter (the OTP). Drop any extra
  // body values such as clinic_name. Footer expiry is rendered by the approved
  // template — do not add a footer component.
  const bodyTexts = opts.authOtpButtonParameter
    ? [String(opts.bodyParameters?.[0] ?? opts.authOtpButtonParameter)]
    : opts.bodyParameters || [];
  const parameters = bodyTexts.map((text) => ({ type: "text", text: String(text) }));
  const components: Array<Record<string, unknown>> = [];
  if (parameters.length > 0) {
    components.push({ type: "body", parameters });
  }
  if (opts.authOtpButtonParameter) {
    // AUTHENTICATION copy-code. Creation uses otp_type COPY_CODE, but WhatsApp
    // stores the button as URL. Payload is body text + button sub_type "url"
    // type "text" with the same OTP. Graph (#132018) if sent as coupon_code.
    // https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates/
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(opts.authOtpButtonParameter) }],
    });
  }
  if (opts.urlButtonParameter && !opts.authOtpButtonParameter) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(opts.urlButtonParameter) }],
    });
  }
  if (opts.couponCodeButtonParameter) {
    // Marketing / utility coupon templates. Distinct from AUTH OTP above.
    // https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/coupon-templates/
    components.push({
      type: "button",
      sub_type: "copy_code",
      index: opts.authOtpButtonParameter ? "1" : "0",
      parameters: [{ type: "coupon_code", coupon_code: String(opts.couponCodeButtonParameter) }],
    });
  }
  return postGraphWhatsAppMessage({
    credentials: opts.credentials,
    to: opts.to,
    fetchImpl: opts.fetchImpl,
    failureLabel: opts.failureLabel || "template",
    payload: {
      messaging_product: "whatsapp",
      // AUTH lumera_login_otp matches the re-audit body: no recipient_type.
      // Utility templates (reminder, book, receipt) still send recipient_type.
      ...(opts.authOtpButtonParameter ? {} : { recipient_type: "individual" }),
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

  if (templateName) {
    // Re-audit body for lumera_login_otp. `to` is added by postGraphWhatsAppMessage.
    // Manager body is "*{{1}}* is your verification code..."; footer expiry is
    // platform-rendered. Do not send those strings, clinic_name, or a 2nd param.
    return sendWhatsAppGraphTemplate({
      credentials: opts.credentials,
      to: opts.to,
      name: templateName,
      language: "en",
      bodyParameters: [opts.otp],
      authOtpButtonParameter: opts.otp,
      fetchImpl: opts.fetchImpl,
      failureLabel: "OTP",
    });
  }

  return sendWhatsAppGraphText({
    credentials: opts.credentials,
    to: opts.to,
    body: `Verification code: ${opts.otp}\nAction: ${opts.purpose}\nValid for 5 minutes. Do not share this code.`,
    fetchImpl: opts.fetchImpl,
  });
}

function envTrim(name: string): string {
  return String(process.env[name] || "").trim();
}

function utilityTemplateLanguage(): string {
  return envTrim("META_UTILITY_TEMPLATE_LANGUAGE") || envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en";
}

function envTemplateConfig(kind: CloudMessageKind): { name: string; language: string } | null {
  const envName =
    kind === "otp"
      ? "META_OTP_TEMPLATE_NAME"
      : kind === "appointment_reminder"
        ? "META_REMINDER_TEMPLATE_NAME"
        : kind === "book_confirmation"
          ? "META_BOOK_CONFIRMATION_TEMPLATE_NAME"
          : kind === "payment_receipt"
            ? "META_RECEIPT_TEMPLATE_NAME"
            : kind === "prescription_ready"
              ? "META_PRESCRIPTION_READY_TEMPLATE_NAME"
              : "";
  if (!envName) return null;
  const name = envTrim(envName);
  if (!name) return null;
  const language =
    kind === "otp" ? envTrim("META_OTP_TEMPLATE_LANGUAGE") || "en" : utilityTemplateLanguage();
  return { name, language };
}

function approvedTenantTemplate(
  db: DatabaseSync,
  tenantId: string,
  kind: CloudMessageKind
): { name: string; language: string; category: string } | null {
  if (kind !== "otp" && clinicTemplateName(kind)) {
    return approvedClinicTemplate(db, tenantId, kind);
  }
  const clause =
    kind === "otp"
      ? "(UPPER(category) = 'AUTHENTICATION' OR LOWER(name) LIKE '%otp%' OR LOWER(name) LIKE '%verification%')"
      : "";
  if (!clause) return null;
  try {
    const row = db
      .prepare(
        `SELECT name, language, category FROM meta_templates
         WHERE tenant_id = ? AND UPPER(status) = 'APPROVED' AND ${clause}
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(tenantId) as { name?: string; language?: string; category?: string } | undefined;
    const name = String(row?.name || "").trim();
    if (!name) return null;
    return {
      name,
      language: String(row?.language || "en").trim() || "en",
      category: String(row?.category || "").trim().toUpperCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Tenant sends resolve an APPROVED meta_templates row for that clinic.
 * Global META_*_TEMPLATE_NAME env is only for platform / unscoped sends.
 */
export function templateConfigForKind(
  kind: CloudMessageKind,
  db?: DatabaseSync | null,
  tenantId?: string | null
): { name: string; language: string } | null {
  const id = String(tenantId || "").trim();
  if (id) {
    if (!db) return null;
    const row = approvedTenantTemplate(db, id, kind);
    if (row) return { name: row.name, language: row.language };
    // Lumera's own number: a demo/sandbox clinic with no connected line uses the
    // platform template name. A real clinic does not.
    if (kind !== "otp" && isSandboxOrDemoTenant(db, id)) {
      const own = tenantNumberCredentials(db, id);
      if (!own) return envTemplateConfig(kind);
    }
    return null;
  }
  return envTemplateConfig(kind);
}

/** Platform Utility templates. Clinic display names are body variables, never this name. */
export const PLATFORM_REMINDER_TEMPLATE = { name: "lumera_appointment_reminder", language: "en_US" };
export const PLATFORM_BOOKING_TEMPLATE = { name: "lumera_appointment_booked", language: "en_US" };

/**
 * Approved template for a clinic send.
 * A tenant APPROVED meta_templates row wins. Demo and platform sends may use the
 * platform template. A real clinic with no APPROVED row has nothing to send.
 */
export function resolveApprovedClinicTemplate(
  kind: "appointment_reminder" | "book_confirmation",
  db?: DatabaseSync | null,
  tenantId?: string | null
): { name: string; language: string } | null {
  const id = String(tenantId || "").trim();
  const platform = kind === "appointment_reminder" ? PLATFORM_REMINDER_TEMPLATE : PLATFORM_BOOKING_TEMPLATE;
  if (!id) return templateConfigForKind(kind) || platform;
  if (!db) return null;
  const row = templateConfigForKind(kind, db, id);
  if (row) return row;
  if (isSandboxOrDemoTenant(db, id)) return platform;
  return null;
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
  receiptUrl?: string;
  tenantId?: string;
  gstin?: string;
  upiId?: string;
  sampleTaxInvoice?: boolean;
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
  const clinic = String(fields.clinicName || "").trim();
  const doctor = String(fields.doctorName || "").trim();
  return (
    `⏰ *Appointment reminder${clinic ? ` — ${clinic}` : ""}*\n\n` +
    `Namaste ${name},\n` +
    `Your consultation with *${doctor || "the clinician"}* is scheduled for *${fields.date || "the upcoming slot"}* at *${fields.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*\n` +
    (fields.specialty ? `📍 ${fields.specialty}\n\n` : "\n") +
    `Please arrive 10 minutes early for vitals.`
  );
}

export function buildBookConfirmationText(fields: ReminderFields): string {
  const name = fields.patientName || "Patient";
  const token =
    fields.tokenNumber != null && Number(fields.tokenNumber) > 0
      ? `#${String(fields.tokenNumber).padStart(2, "0")}`
      : "pending";
  const clinic = String(fields.clinicName || "").trim();
  const doctor = String(fields.doctorName || "").trim();
  return (
    `✅ *Appointment confirmed${clinic ? ` — ${clinic}` : ""}*\n\n` +
    `Namaste ${name},\n` +
    `Your visit with *${doctor || "the clinician"}*` +
    (fields.specialty ? ` (${fields.specialty})` : "") +
    ` is booked for *${fields.date || "the scheduled date"}* at *${fields.timeSlot || "TBD"}*.\n\n` +
    `🎫 Token: *${token}*`
  );
}

export function buildReceiptText(receipt: ReceiptFields): string {
  const name = receipt.patientName || "Patient";
  const amountLabel = formatINR(receipt.amount);
  const invoice = receipt.invoiceId ? `\nInvoice: ${receipt.invoiceId}` : "";
  const date = receipt.date ? `\nDate: ${receipt.date}` : "";
  const clinic = String(receipt.clinicName || "").trim();
  const body =
    `🧰 *Payment receipt${clinic ? ` — ${clinic}` : ""}*\n\n` +
    `Namaste ${name},\n` +
    `We received *${amountLabel}* for your consultation.${invoice}${date}\n\n` +
    `Thank you.`;
  const sample =
    Boolean(receipt.sampleTaxInvoice) ||
    isSampleTaxInvoice({ tenantId: receipt.tenantId, gstin: receipt.gstin, upiId: receipt.upiId });
  return sampleTaxInvoiceReceiptText(body, sample);
}

const CLOUD_NOT_CONFIGURED =
  "WhatsApp Cloud API is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID (or a real tenant phone_number_id + token). Message was not delivered.";

function demoOutboundEventType(kind: CloudMessageKind): string {
  if (kind === "payment_receipt") return "invoice_receipt";
  if (kind === "otp") return "otp_verification";
  return kind;
}

function demoCapRows(db: DatabaseSync, eventType: string, tenantId: string): Array<{ status?: string; action_payload?: string; patient_phone?: string }> {
  try {
    return db
      .prepare(
        `SELECT status, action_payload, patient_phone FROM whatsapp_outbound_events
         WHERE event_type = ? AND TRIM(COALESCE(tenant_id, '')) = ?
           AND status IN ('skipped_not_allowlisted', 'failed_final')`
      )
      .all(eventType, tenantId) as Array<{ status?: string; action_payload?: string; patient_phone?: string }>;
  } catch {
    return [];
  }
}

function demoCapRowMatches(
  row: { action_payload?: string; patient_phone?: string },
  key: { phone: string; appointmentId?: string; reminderWindow?: string; invoiceId?: string }
): boolean {
  let payload: { appointmentId?: string; window?: string; invoiceId?: string } = {};
  try {
    payload = JSON.parse(String(row.action_payload || "{}")) as typeof payload;
  } catch {
    payload = {};
  }
  if (key.appointmentId) {
    if (payload.appointmentId !== key.appointmentId) return false;
    if (key.reminderWindow && payload.window !== key.reminderWindow) return false;
    return true;
  }
  if (key.invoiceId) return String(payload.invoiceId || "") === key.invoiceId;
  const want = toWhatsAppRecipient(key.phone).slice(-10);
  const have = toWhatsAppRecipient(String(row.patient_phone || "")).slice(-10);
  return Boolean(want) && want === have;
}

function recordDemoAllowlistEvent(opts: {
  db: DatabaseSync;
  eventType: string;
  phone: string;
  patientName?: string;
  tenantId: string;
  status: typeof SKIPPED_NOT_ALLOWLISTED | typeof FAILED_FINAL;
  appointmentId?: string;
  reminderWindow?: string;
  invoiceId?: string;
  attempt: number;
  sentAt?: string;
}): string | undefined {
  try {
    const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
    const sentAt = opts.sentAt || new Date().toISOString();
    opts.db
      .prepare(
        `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        opts.eventType,
        opts.phone,
        opts.patientName || "Patient",
        opts.status,
        `Demo WhatsApp recipient ${maskWhatsAppRecipient(opts.phone)} ${opts.status}`,
        JSON.stringify({
          appointmentId: opts.appointmentId,
          tenantId: opts.tenantId,
          window: opts.reminderWindow,
          invoiceId: opts.invoiceId,
          attempt: opts.attempt,
          reason: SKIPPED_NOT_ALLOWLISTED,
          channel: "none",
        }),
        sentAt,
        opts.tenantId
      );
    return eventId;
  } catch (err) {
    console.error("[WhatsApp] failed to record demo allowlist outcome:", err instanceof Error ? err.message : "error");
    return undefined;
  }
}

/**
 * Demo and seed tenants never call Graph for a recipient outside the allowlist.
 * Returns null when the send may proceed.
 */
function demoAllowlistGate(opts: {
  to: string;
  kind: CloudMessageKind;
  db?: DatabaseSync | null;
  tenantId?: string;
  platformSend?: boolean;
  patientName?: string;
  appointmentId?: string;
  reminderWindow?: string;
  invoiceId?: string;
  sentAt?: string;
}): CloudDispatchResult | null {
  if (opts.platformSend) return null;
  const tenantId = String(opts.tenantId || "").trim();
  if (!opts.db || !tenantId || !isSandboxOrDemoTenant(opts.db, tenantId)) return null;
  const masked = maskWhatsAppRecipient(opts.to);
  if (isDemoWhatsAppAllowlisted(opts.to)) {
    console.info(`[WhatsApp] demo recipient ${masked} allowlisted`);
    return null;
  }
  const eventType = demoOutboundEventType(opts.kind);
  const matched = demoCapRows(opts.db, eventType, tenantId).filter((row) =>
    demoCapRowMatches(row, {
      phone: opts.to,
      appointmentId: opts.appointmentId,
      reminderWindow: opts.reminderWindow,
      invoiceId: opts.invoiceId,
    })
  );
  if (matched.some((row) => row.status === FAILED_FINAL) || matched.length >= DEMO_OUTBOUND_ATTEMPT_CAP) {
    console.warn(`[WhatsApp] demo recipient ${masked} ${FAILED_FINAL}`);
    return { ok: false, error: FAILED_FINAL, channel: "none", status: 422 };
  }
  const attempt = matched.length + 1;
  const status = attempt >= DEMO_OUTBOUND_ATTEMPT_CAP ? FAILED_FINAL : SKIPPED_NOT_ALLOWLISTED;
  console.warn(`[WhatsApp] demo recipient ${masked} ${status}`);
  const eventId = recordDemoAllowlistEvent({
    db: opts.db,
    eventType,
    phone: opts.to,
    patientName: opts.patientName,
    tenantId,
    status,
    appointmentId: opts.appointmentId,
    reminderWindow: opts.reminderWindow,
    invoiceId: opts.invoiceId,
    attempt,
    sentAt: opts.sentAt,
  });
  return { ok: false, error: status, channel: "none", status: 422, eventId };
}

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
  urlButtonParameter?: string;
  receiptFields?: ReceiptFields;
  previewUrl?: boolean;
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  inCustomerServiceWindow?: boolean;
  /** Lumera login OTP and Super Admin messaging. Uses env creds, not a clinic WABA. */
  platformSend?: boolean;
  /** Staff typed this reply. Lapsed clinics may send it only inside the 24h window. */
  isManual?: boolean;
  patientName?: string;
  appointmentId?: string;
  reminderWindow?: string;
  invoiceId?: string;
  sentAt?: string;
}): Promise<CloudDispatchResult> {
  const kind: CloudMessageKind = opts.kind || (opts.otp ? "otp" : "text");
  const explicitTenantId = String(opts.tenantId || "").trim();
  const platformSend =
    opts.platformSend === true || isPlatformAuthOtp(kind, opts.purpose, explicitTenantId);
  const tenantId = resolveUsageTenantId(opts.tenantId, opts.to, opts.db);
  const computedWindow = opts.db ? isWithinCustomerServiceWindow(opts.db, tenantId, opts.to) : false;
  const inCustomerServiceWindow = opts.inCustomerServiceWindow ?? (opts.db ? computedWindow : kind === "text");

  const configuredTemplate = platformSend || !tenantId
    ? templateConfigForKind(kind)
    : templateConfigForKind(kind, opts.db, tenantId);
  const requestedName = (opts.templateName || "").trim();
  // A clinic send uses the approved clinic_* row, or the platform template when
  // the clinic is on Lumera's number. A caller-supplied name cannot swap that.
  const templateName =
    platformSend || !tenantId ? requestedName || configuredTemplate?.name || "" : configuredTemplate?.name || "";
  const templateLanguage = (opts.templateLanguage || "").trim() || configuredTemplate?.language || "en";
  const isManual = Boolean(opts.isManual) && kind === "text" && !templateName;

  if (!platformSend && tenantId) {
    const policy = assertTenantMaySendWhatsApp(tenantId, kind, isManual, opts.db, opts.to);
    if (policy.ok === false) {
      return { ok: false, error: policy.error, channel: "none", status: policy.status };
    }
  }

  if (
    isProduction() &&
    !platformSend &&
    tenantId &&
    opts.db &&
    !isSandboxOrDemoTenant(opts.db, tenantId) &&
    tenantHasConnectedWhatsAppNumber(opts.db, tenantId) &&
    clinicTokenKeyMissing()
  ) {
    return { ok: false, channel: "none", error: WA_TOKEN_KEY_UNSET_ERROR, status: 503 };
  }

  const allowlist = demoAllowlistGate({
    to: opts.to,
    kind,
    db: opts.db,
    tenantId,
    platformSend,
    patientName: opts.patientName,
    appointmentId: opts.appointmentId,
    reminderWindow: opts.reminderWindow,
    invoiceId: opts.invoiceId,
    sentAt: opts.sentAt,
  });
  if (allowlist) return allowlist;

  const creds = resolveGraphCredentials(opts.db, platformSend ? undefined : tenantId || undefined, {
    platformSend,
  });

  const catalogKind = clinicTemplateName(kind);
  const clinicPlan: "template" | "text" | "blocked" | "default" =
    platformSend || !tenantId || !catalogKind
      ? "default"
      : templateName
        ? "template"
        : inCustomerServiceWindow
          ? "text"
          : "blocked";

  if (creds && clinicPlan === "blocked") {
    return { ok: false, error: TEMPLATE_NOT_APPROVED_ERROR, channel: "none", status: 409 };
  }

  const templateBusiness =
    clinicPlan === "template" || (clinicPlan !== "text" && ["appointment_reminder", "book_confirmation", "payment_receipt", "prescription_ready"].includes(kind));
  const optInError = whatsAppOptInBlock({
    db: opts.db,
    tenantId,
    to: opts.to,
    kind,
    templateSend: templateBusiness,
  });
  if (optInError) {
    return { ok: false, error: optInError, channel: "none", status: 409 };
  }

  if (creds) {
    let graph: GraphMessageResult;
    const sendAsText = clinicPlan === "text";
    if (kind === "otp" && opts.otp && platformSend) {
      graph = await sendWhatsAppGraphMessage({
        credentials: creds,
        to: opts.to,
        otp: opts.otp,
        purpose: opts.purpose || "login",
        fetchImpl: opts.fetchImpl,
      });
    } else if (kind === "otp" && opts.otp && templateName) {
      const tenantTpl = opts.db && tenantId ? approvedTenantTemplate(opts.db, tenantId, "otp") : null;
      graph = await sendWhatsAppGraphTemplate({
        credentials: creds,
        to: opts.to,
        name: templateName,
        language: templateLanguage,
        bodyParameters: [opts.otp],
        authOtpButtonParameter: tenantTpl?.category === "AUTHENTICATION" ? opts.otp : undefined,
        fetchImpl: opts.fetchImpl,
        failureLabel: "OTP",
      });
    } else if (kind === "otp" && opts.otp) {
      graph = await sendWhatsAppGraphText({
        credentials: creds,
        to: opts.to,
        body: `Verification code: ${opts.otp}\nAction: ${opts.purpose || "verify"}\nValid for 5 minutes. Do not share this code.`,
        fetchImpl: opts.fetchImpl,
      });
    } else if (templateName && !sendAsText) {
      const bodyParameters =
        kind === "payment_receipt"
          ? receiptTemplateParameters(opts.receiptFields || {}, templateName)
          : opts.templateParameters;
      graph = await sendWhatsAppGraphTemplate({
        credentials: creds,
        to: opts.to,
        name: templateName,
        language: templateLanguage,
        bodyParameters,
        urlButtonParameter: opts.urlButtonParameter,
        fetchImpl: opts.fetchImpl,
        failureLabel: kind,
      });
    } else if (kind === "appointment_reminder" || kind === "book_confirmation") {
      // Reminders and booking confirmations are template-only. No session text.
      return { ok: false, error: "no_approved_template", channel: "none", status: 422 };
    } else {
      graph = await sendWhatsAppGraphText({
        credentials: creds,
        to: opts.to,
        body: opts.textBody,
        previewUrl: opts.previewUrl,
        fetchImpl: opts.fetchImpl,
      });
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

  const realClinic = Boolean(tenantId) && !platformSend && !(opts.db && isSandboxOrDemoTenant(opts.db, tenantId));
  if (isProduction() && realClinic) {
    return { ok: false, channel: "none", error: CLINIC_WHATSAPP_NOT_CONNECTED, status: 503 };
  }

  if (isProduction()) {
    return { ok: false, channel: "none", error: CLOUD_NOT_CONFIGURED, status: 503 };
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

const GRAPH_WAMID = /^wamid\.\S+$/;

async function auditTemplateSend(
  db: DatabaseSync | null | undefined,
  eventType: string,
  tenantId: string,
  sent: CloudDispatchResult
) {
  try {
    const { getDb, writeAudit } = await import("./db.ts");
    writeAudit(
      db || getDb(),
      null,
      "system",
      "whatsapp_template_send",
      `tenant ${tenantId || "none"} template ${eventType} outcome ${sent.ok ? "sent" : "failed"}`,
      { tenantId: tenantId || undefined, entityType: "whatsapp_template", entityId: eventType }
    );
  } catch {
    /* audit is best-effort and must not block the send */
  }
}

function invoicePatientId(db: DatabaseSync, tenantId: string, invoiceId: string): string {
  try {
    const rows = db
      .prepare(`SELECT patient_id FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?)`)
      .all(tenantId, invoiceId, invoiceId) as Array<{ patient_id?: string }>;
    const ids = [...new Set(rows.map((row) => String(row.patient_id || "").trim()).filter(Boolean))];
    return ids.length === 1 ? ids[0] : "";
  } catch {
    return "";
  }
}

function graphAccepted(sent: CloudDispatchResult): boolean {
  return sent.ok === true && sent.channel === "graph" && GRAPH_WAMID.test(String(sent.messageId || "").trim());
}

function requireClinicAndDoctor(opts: {
  tenantId?: string;
  db?: DatabaseSync | null;
  clinicName?: string;
  doctorName?: string;
  textBody?: string;
}): { clinicName: string; doctorName: string } | CloudDispatchResult {
  const clinicName = String(opts.clinicName || "").trim() || lookupClinicName(opts.db, opts.tenantId);
  const doctorName = String(opts.doctorName || "").trim();
  if (opts.tenantId && !opts.textBody && (!clinicName || !doctorName)) {
    return { ok: false, channel: "none", error: CLINIC_DOCTOR_NAME_REQUIRED, status: 400 };
  }
  return { clinicName, doctorName };
}

export async function sendAppointmentReminder(opts: {
  to: string;
  patientName?: string;
  doctorName?: string;
  clinicName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
  textBody?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  appointmentId?: string;
  reminderWindow?: string;
  sentAt?: string;
}): Promise<CloudDispatchResult> {
  const names = requireClinicAndDoctor(opts);
  if ("channel" in names) {
    await auditTemplateSend(opts.db, "appointment_reminder", String(opts.tenantId || ""), names);
    return names;
  }
  const clinicName = names.clinicName;
  const doctorName = names.doctorName;
  const parameters = opts.tenantId
    ? reminderTemplateParameters({ ...opts, clinicName, doctorName })
    : opts.templateParameters;
  const sent = await dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "appointment_reminder",
    patientName: opts.patientName,
    appointmentId: opts.appointmentId,
    reminderWindow: opts.reminderWindow,
    sentAt: opts.sentAt,
    textBody: opts.textBody || buildReminderText({ ...opts, clinicName, doctorName }),
    templateName: opts.templateName,
    templateParameters: parameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
  await auditTemplateSend(opts.db, "appointment_reminder", String(opts.tenantId || ""), sent);
  return sent;
}

export async function sendBookConfirmation(opts: {
  to: string;
  patientName?: string;
  doctorName?: string;
  clinicName?: string;
  specialty?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: number;
  textBody?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParameters?: string[];
  db?: DatabaseSync | null;
  fetchImpl?: typeof fetch;
  tenantId?: string;
  appointmentId?: string;
  sentAt?: string;
}): Promise<CloudDispatchResult> {
  const names = requireClinicAndDoctor(opts);
  if ("channel" in names) {
    await auditTemplateSend(opts.db, "book_confirmation", String(opts.tenantId || ""), names);
    return names;
  }
  const clinicName = names.clinicName;
  const doctorName = names.doctorName;
  const parameters = opts.tenantId
    ? bookConfirmationTemplateParameters({ ...opts, clinicName, doctorName })
    : opts.templateParameters;
  const sent = await dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "book_confirmation",
    patientName: opts.patientName,
    appointmentId: opts.appointmentId,
    sentAt: opts.sentAt,
    textBody: opts.textBody || buildBookConfirmationText({ ...opts, clinicName, doctorName }),
    templateName: opts.templateName,
    templateParameters: parameters,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
  await auditTemplateSend(opts.db, "book_confirmation", String(opts.tenantId || ""), sent);
  return sent;
}

/** #25 assist: Graph dual-path only. Platform owns Razorpay/invoices and can pass textBody. */
export async function sendPaymentReceipt(opts: {
  to: string;
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
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
  tenantId?: string;
}): Promise<CloudDispatchResult> {
  const clinicName = String(opts.clinicName || "").trim() || lookupClinicName(opts.db, opts.tenantId);
  const invoiceId = String(opts.invoiceId || "").trim();
  const tenantId = String(opts.tenantId || "").trim();
  if (opts.tenantId && !opts.textBody && !clinicName) {
    const blocked = { ok: false as const, channel: "none" as const, error: CLINIC_DOCTOR_NAME_REQUIRED, status: 400 };
    await auditTemplateSend(opts.db, "payment_receipt", tenantId, blocked);
    return blocked;
  }
  const optInError = whatsAppOptInBlock({
    db: opts.db,
    tenantId,
    to: opts.to,
    kind: "payment_receipt",
    templateSend: true,
  });
  if (optInError) {
    const blocked = { ok: false as const, channel: "none" as const, error: optInError, status: 409 };
    await auditTemplateSend(opts.db, "payment_receipt", tenantId, blocked);
    return blocked;
  }
  let receiptUrl = "";
  let mintedToken = "";
  const patientId = opts.db && tenantId && invoiceId ? invoicePatientId(opts.db, tenantId, invoiceId) : "";
  if (patientId) {
    const link = await mintPatientLinkToken({
      tenantId,
      patientId,
      purpose: "receipt",
      resourceId: invoiceId,
    });
    receiptUrl = link.url;
    mintedToken = link.token;
  }
  const receiptFields: ReceiptFields = {
    patientName: opts.patientName,
    clinicName,
    doctorName: opts.doctorName,
    amount: opts.amount,
    invoiceId: opts.invoiceId,
    date: opts.date,
    receiptUrl,
  };
  const sent = await dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "payment_receipt",
    patientName: opts.patientName,
    invoiceId: opts.invoiceId,
    textBody: opts.textBody || buildReceiptText({ ...opts, clinicName }),
    previewUrl: opts.previewUrl,
    templateName: opts.templateName,
    templateParameters: opts.templateParameters || receiptTemplateParameters(receiptFields),
    receiptFields,
    db: opts.db,
    fetchImpl: opts.fetchImpl,
    tenantId: opts.tenantId,
  });
  if (mintedToken && !graphAccepted(sent)) {
    await revokePatientLinkToken(mintedToken);
  }
  await auditTemplateSend(opts.db, "payment_receipt", tenantId, sent);
  return sent;
}