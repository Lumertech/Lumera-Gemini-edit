import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDemoAccountEmail } from "../src/lib/demoAccounts.ts";
import { getDb } from "./db.ts";
import { reportCaughtError } from "./error-tracker.ts";
import {
  type GraphCredentials,
  type GraphMessageResult,
  isWithinCustomerServiceWindow,
  resolveGraphCredentials,
  sendWhatsAppGraphTemplate,
  sendWhatsAppGraphText,
  toWhatsAppRecipient,
} from "./graph-whatsapp.ts";
import { graphApiVersion } from "./runtime.ts";
import type { SqlDatabase } from "./sql-engine.ts";

export const DEFAULT_SIGNUP_ALERT_WHATSAPP_TO = "+919999973271";
export const DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME = "lumera_new_signup_alert";
const FOUNDER_PLATFORM_TENANT_ID = "tenant-lumera-main";

export interface SignupAlertInput {
  userId?: string;
  tenantId?: string;
  name: string;
  email: string;
  phone?: string;
  clinicName?: string;
  role?: string;
  specialty?: string;
  source: string;
}

export type SignupAlertResult =
  | {
      ok: true;
      delivered: true;
      mode: "text" | "signup_template" | "utility_fallback_template";
      messageId: string;
      recipient: string;
    }
  | {
      ok: true;
      delivered: false;
      skipped: "disabled" | "test_runtime" | "seed_or_fixture" | "duplicate" | "invalid_recipient";
    }
  | {
      ok: false;
      delivered: false;
      error: string;
    };

export interface SignupAlertOptions {
  db?: SqlDatabase | DatabaseSync | null;
  fetchImpl?: typeof fetch;
  allowInTest?: boolean;
  allowSeedEmails?: boolean;
  now?: Date;
}

type TestTransportConfig = {
  fetchImpl: typeof fetch;
  allowSeedEmails?: boolean;
};

let testTransportOverride: TestTransportConfig | null = null;
const alertedSignupKeys = new Set<string>();
const provisionedWabaIds = new Set<string>();

/** Test-only hook so HTTP route tests can capture signup alerts without real network traffic. */
export function setSignupAlertTestTransport(config: TestTransportConfig | null): void {
  testTransportOverride = config;
}

export function resetSignupAlertStateForTests(): void {
  testTransportOverride = null;
  alertedSignupKeys.clear();
  provisionedWabaIds.clear();
}

export function isAutomatedTestRuntime(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_TEST_CONTEXT) return true;
  if (process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test="))) return true;
  if (process.argv.some((arg) => arg === "--test" || arg.endsWith(".test.ts"))) return true;
  return false;
}

export function signupAlertEnabled(): boolean {
  const disabled = String(process.env.SIGNUP_ALERT_DISABLED || "").trim().toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") return false;
  const enabled = String(process.env.SIGNUP_ALERT_ENABLED || "").trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "no") return false;
  return true;
}

export function signupAlertRecipient(): string {
  const configured = String(process.env.SIGNUP_ALERT_WHATSAPP_TO || DEFAULT_SIGNUP_ALERT_WHATSAPP_TO).trim();
  return toWhatsAppRecipient(configured);
}

const FIXTURE_EMAIL_SUFFIXES = [
  "@lumera.me",
  "@lumera-test.local",
  "@example.com",
  "@example.org",
  "@example.net",
  ".example",
  "@test.local",
  ".invalid",
];

export function isSeedOrFixtureSignup(input: { email?: string; tenantId?: string }): boolean {
  const email = String(input.email || "").trim().toLowerCase();
  const tenantId = String(input.tenantId || "").trim().toLowerCase();
  if (!email) return true;
  if (isDemoAccountEmail(email)) return true;
  if (FIXTURE_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix))) return true;
  if (
    tenantId.startsWith("tenant-demo-") ||
    tenantId === "tenant-suspended-demo" ||
    tenantId === "tenant-rehab-mumbai"
  ) {
    return true;
  }
  return false;
}

/**
 * Meta Graph API (#132018) rejects template text parameters containing newlines,
 * tabs, >4 consecutive spaces, or empty strings.
 */
export function sanitizeTemplateParam(value: unknown, fallback = "-", maxLen = 100): string {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1).trim()}…` : cleaned;
}

function formatIstParts(date: Date): { dateLabel: string; timeLabel: string; fullLabel: string } {
  try {
    const dateLabel = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .format(date)
      .toUpperCase();
    return { dateLabel, timeLabel, fullLabel: `${dateLabel}, ${timeLabel} IST` };
  } catch {
    const iso = date.toISOString();
    return { dateLabel: iso.slice(0, 10), timeLabel: `${iso.slice(11, 16)} UTC`, fullLabel: iso };
  }
}

export function buildSignupAlertText(input: SignupAlertInput, now = new Date()): string {
  const { fullLabel } = formatIstParts(now);
  const name = sanitizeTemplateParam(input.name, "Clinician", 120);
  const email = sanitizeTemplateParam(input.email, "-", 120);
  const phone = sanitizeTemplateParam(input.phone, "Not provided", 40);
  const clinic = sanitizeTemplateParam(input.clinicName, "Lumera Workspace", 120);
  const role = sanitizeTemplateParam(input.role, "doctor", 40);
  const specialty = sanitizeTemplateParam(input.specialty, "", 60);
  const roleLine = specialty && specialty !== "-" ? `${role} · ${specialty}` : role;
  const source = sanitizeTemplateParam(input.source, "User Signup", 60);

  return (
    `🆕 *New Lumera User Signup*\n\n` +
    `• *Name:* ${name}\n` +
    `• *Email:* ${email}\n` +
    `• *Phone:* ${phone}\n` +
    `• *Clinic / Workspace:* ${clinic}\n` +
    `• *Role:* ${roleLine}\n` +
    `• *Flow:* ${source}\n` +
    `• *Time:* ${fullLabel}`
  );
}

function buildDedicatedTemplateParams(input: SignupAlertInput, now: Date): string[] {
  const { fullLabel } = formatIstParts(now);
  const name = sanitizeTemplateParam(input.name, "Clinician", 80);
  const email = sanitizeTemplateParam(input.email, "-", 100);
  const phone = sanitizeTemplateParam(input.phone, "Not provided", 40);
  const clinic = sanitizeTemplateParam(input.clinicName, "Lumera Workspace", 70);
  const role = sanitizeTemplateParam(input.role, "doctor", 30);
  const specialty = sanitizeTemplateParam(input.specialty, "", 40);
  const workspaceSummary = sanitizeTemplateParam(
    `${clinic} (${specialty && specialty !== "-" ? `${role} - ${specialty}` : role})`,
    clinic,
    100
  );
  return [name, email, phone, workspaceSummary, sanitizeTemplateParam(fullLabel, "-", 60)];
}

/**
 * Maps signup details cleanly into the already-approved 5-parameter Utility template
 * (`lumera_appointment_reminder`: {{1}} name, {{2}} clinic, {{3}} contact, {{4}} date, {{5}} time/flow)
 * when outside the 24h customer-service window and before `lumera_new_signup_alert` is approved.
 */
function buildUtilityFallbackTemplateParams(input: SignupAlertInput, now: Date): string[] {
  const { dateLabel, timeLabel } = formatIstParts(now);
  const name = sanitizeTemplateParam(`[NEW SIGNUP] ${input.name || "Clinician"}`, "[NEW SIGNUP]", 90);
  const clinic = sanitizeTemplateParam(input.clinicName, "Lumera Workspace", 65);
  const role = sanitizeTemplateParam(input.role, "doctor", 25);
  const specialty = sanitizeTemplateParam(input.specialty, "", 30);
  const clinicAndRole = sanitizeTemplateParam(
    `${clinic} (${specialty && specialty !== "-" ? `${role}/${specialty}` : role})`,
    clinic,
    100
  );
  const email = sanitizeTemplateParam(input.email, "-", 65);
  const phone = sanitizeTemplateParam(input.phone, "no-phone", 30);
  const contact = sanitizeTemplateParam(`${email} | ${phone}`, email, 100);
  const source = sanitizeTemplateParam(input.source, "Signup", 40);
  return [
    name,
    clinicAndRole,
    contact,
    sanitizeTemplateParam(dateLabel, "-", 40),
    sanitizeTemplateParam(`${timeLabel} IST - ${source}`, `${timeLabel} IST`, 80),
  ];
}

function hasAlreadyAlertedInDb(db: SqlDatabase | DatabaseSync | null | undefined, dedupeEmail: string, dedupeUserId: string): boolean {
  if (!db) return false;
  try {
    if (dedupeUserId) {
      const byId = (db as SqlDatabase)
        .prepare(
          `SELECT id FROM whatsapp_outbound_events
           WHERE event_type = 'founder_signup_alert'
             AND status != 'failed'
             AND action_payload LIKE ?
           LIMIT 1`
        )
        .get(`%"signupUserId":"${dedupeUserId}"%`) as { id?: string } | undefined;
      if (byId?.id) return true;
    }
    if (dedupeEmail) {
      const byEmail = (db as SqlDatabase)
        .prepare(
          `SELECT id FROM whatsapp_outbound_events
           WHERE event_type = 'founder_signup_alert'
             AND status != 'failed'
             AND action_payload LIKE ?
           LIMIT 1`
        )
        .get(`%"signupEmail":"${dedupeEmail}"%`) as { id?: string } | undefined;
      if (byEmail?.id) return true;
    }
  } catch {
    /* isolated unit tests may omit whatsapp_outbound_events */
  }
  return false;
}

function recordSignupAlertEvent(
  db: SqlDatabase | DatabaseSync | null | undefined,
  opts: {
    recipient: string;
    input: SignupAlertInput;
    status: "sent" | "failed";
    mode: string;
    messageId?: string;
    error?: string;
    nowIso: string;
  }
): void {
  if (!db) return;
  try {
    const eventId = `evt-signup-${crypto.randomUUID().slice(0, 8)}`;
    const payload = {
      signupUserId: String(opts.input.userId || "").trim(),
      signupEmail: String(opts.input.email || "").trim().toLowerCase(),
      signupPhone: String(opts.input.phone || "").trim(),
      signupName: String(opts.input.name || "").trim(),
      clinicName: String(opts.input.clinicName || "").trim(),
      role: String(opts.input.role || "").trim(),
      specialty: String(opts.input.specialty || "").trim(),
      source: String(opts.input.source || "").trim(),
      mode: opts.mode,
      messageId: opts.messageId || null,
      error: opts.error || null,
      fallbackRetried: false,
    };
    (db as SqlDatabase)
      .prepare(
        `INSERT INTO whatsapp_outbound_events
          (id, tenant_id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
         VALUES (?, ?, 'founder_signup_alert', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        FOUNDER_PLATFORM_TENANT_ID,
        `+${opts.recipient}`,
        opts.input.name || "New Lumera User",
        opts.status,
        opts.status === "sent"
          ? `Founder signup alert sent (${opts.mode}) for ${opts.input.email}`
          : `Founder signup alert failed (${opts.mode}): ${opts.error || "unknown"}`,
        JSON.stringify(payload),
        opts.nowIso
      );
  } catch {
    /* non-fatal if outbound events table is unavailable */
  }
}

async function sendAlertViaTemplates(opts: {
  creds: GraphCredentials;
  recipient: string;
  input: SignupAlertInput;
  now: Date;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; mode: "signup_template" | "utility_fallback_template"; messageId: string }
  | { ok: false; error: string }
> {
  const signupTemplateName =
    String(process.env.META_SIGNUP_ALERT_TEMPLATE_NAME || DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME).trim();
  const signupTemplateLang = String(process.env.META_SIGNUP_ALERT_TEMPLATE_LANGUAGE || "en").trim() || "en";

  let primaryError = "";
  if (signupTemplateName) {
    const dedicated = await sendWhatsAppGraphTemplate({
      credentials: opts.creds,
      to: opts.recipient,
      name: signupTemplateName,
      language: signupTemplateLang,
      bodyParameters: buildDedicatedTemplateParams(opts.input, opts.now),
      fetchImpl: opts.fetchImpl,
      failureLabel: "signup-alert-template",
    });
    if (dedicated.ok === true) {
      return { ok: true, mode: "signup_template", messageId: dedicated.messageId };
    }
    if (dedicated.ok === false) {
      primaryError = dedicated.error;
    }
  }

  const utilityFallbackName = String(process.env.META_REMINDER_TEMPLATE_NAME || "").trim();
  const utilityFallbackLang =
    String(process.env.META_UTILITY_TEMPLATE_LANGUAGE || "en_US").trim() || "en_US";

  if (utilityFallbackName && utilityFallbackName !== signupTemplateName) {
    const fallback = await sendWhatsAppGraphTemplate({
      credentials: opts.creds,
      to: opts.recipient,
      name: utilityFallbackName,
      language: utilityFallbackLang,
      bodyParameters: buildUtilityFallbackTemplateParams(opts.input, opts.now),
      fetchImpl: opts.fetchImpl,
      failureLabel: "signup-alert-utility-fallback",
    });
    if (fallback.ok === true) {
      return { ok: true, mode: "utility_fallback_template", messageId: fallback.messageId };
    }
    const fallbackErr = fallback.ok === false ? fallback.error : "Fallback template failed.";
    return { ok: false, error: `${primaryError ? `${primaryError}; ` : ""}${fallbackErr}` };
  }

  return { ok: false, error: primaryError || "No approved signup alert template available." };
}

export async function notifyFounderNewUserSignup(
  input: SignupAlertInput,
  opts?: SignupAlertOptions
): Promise<SignupAlertResult> {
  if (!signupAlertEnabled()) {
    return { ok: true, delivered: false, skipped: "disabled" };
  }

  const effectiveFetch = opts?.fetchImpl ?? testTransportOverride?.fetchImpl;
  const allowInTest = Boolean(opts?.allowInTest || opts?.fetchImpl || testTransportOverride);
  if (isAutomatedTestRuntime() && !allowInTest) {
    return { ok: true, delivered: false, skipped: "test_runtime" };
  }

  const allowSeedEmails = Boolean(opts?.allowSeedEmails || testTransportOverride?.allowSeedEmails);
  if (!allowSeedEmails && isSeedOrFixtureSignup({ email: input.email, tenantId: input.tenantId })) {
    return { ok: true, delivered: false, skipped: "seed_or_fixture" };
  }

  const recipient = signupAlertRecipient();
  if (!recipient || recipient.length < 8) {
    return { ok: true, delivered: false, skipped: "invalid_recipient" };
  }

  const normalizedEmail = String(input.email || "").trim().toLowerCase();
  const normalizedUserId = String(input.userId || "").trim();
  const emailKey = normalizedEmail ? `email:${normalizedEmail}` : "";
  const userKey = normalizedUserId ? `user:${normalizedUserId}` : "";

  if ((emailKey && alertedSignupKeys.has(emailKey)) || (userKey && alertedSignupKeys.has(userKey))) {
    return { ok: true, delivered: false, skipped: "duplicate" };
  }

  let db: SqlDatabase | DatabaseSync | null = opts?.db ?? null;
  if (db === null && opts?.db === undefined) {
    try {
      db = getDb();
    } catch {
      db = null;
    }
  }

  if (hasAlreadyAlertedInDb(db, normalizedEmail, normalizedUserId)) {
    if (emailKey) alertedSignupKeys.add(emailKey);
    if (userKey) alertedSignupKeys.add(userKey);
    return { ok: true, delivered: false, skipped: "duplicate" };
  }

  const creds = resolveGraphCredentials(db as DatabaseSync | null, undefined, { platformSend: true });
  if (!creds) {
    return {
      ok: false,
      delivered: false,
      error: "WhatsApp Cloud API platform credentials (META_ACCESS_TOKEN + META_PHONE_NUMBER_ID) are not configured.",
    };
  }

  // Reserve keys before awaiting network calls so concurrent requests for the same user cannot double-send
  if (emailKey) alertedSignupKeys.add(emailKey);
  if (userKey) alertedSignupKeys.add(userKey);

  const now = opts?.now || new Date();
  const nowIso = now.toISOString();
  const forceTemplate =
    String(process.env.SIGNUP_ALERT_FORCE_TEMPLATE || "").trim().toLowerCase() === "true";
  const inWindow =
    !forceTemplate &&
    Boolean(db && isWithinCustomerServiceWindow(db as DatabaseSync, FOUNDER_PLATFORM_TENANT_ID, recipient));

  const textBody = buildSignupAlertText(input, now);

  if (inWindow) {
    const textSent: GraphMessageResult = await sendWhatsAppGraphText({
      credentials: creds,
      to: recipient,
      body: textBody,
      fetchImpl: effectiveFetch,
    });
    if (textSent.ok) {
      recordSignupAlertEvent(db, {
        recipient,
        input,
        status: "sent",
        mode: "text",
        messageId: textSent.messageId,
        nowIso,
      });
      return { ok: true, delivered: true, mode: "text", messageId: textSent.messageId, recipient };
    }
  }

  // Outside the 24-hour customer service window (or text failed): use approved Meta template first
  // because Meta drops free-form text messages asynchronously (131047) outside the 24h window.
  const templated = await sendAlertViaTemplates({
    creds,
    recipient,
    input,
    now,
    fetchImpl: effectiveFetch,
  });
  if (templated.ok === true) {
    recordSignupAlertEvent(db, {
      recipient,
      input,
      status: "sent",
      mode: templated.mode,
      messageId: templated.messageId,
      nowIso,
    });
    return {
      ok: true,
      delivered: true,
      mode: templated.mode,
      messageId: templated.messageId,
      recipient,
    };
  }
  const templateError = templated.ok === false ? templated.error : "Template send failed.";

  // Final fallback if no template is configured in the environment
  if (!inWindow) {
    const fallbackText = await sendWhatsAppGraphText({
      credentials: creds,
      to: recipient,
      body: textBody,
      fetchImpl: effectiveFetch,
    });
    if (fallbackText.ok === true) {
      recordSignupAlertEvent(db, {
        recipient,
        input,
        status: "sent",
        mode: "text",
        messageId: fallbackText.messageId,
        nowIso,
      });
      return { ok: true, delivered: true, mode: "text", messageId: fallbackText.messageId, recipient };
    }
    if (emailKey) alertedSignupKeys.delete(emailKey);
    if (userKey) alertedSignupKeys.delete(userKey);
    const textError = fallbackText.ok === false ? fallbackText.error : "Text send failed.";
    const combinedError = `${templateError}; text fallback: ${textError}`;
    recordSignupAlertEvent(db, {
      recipient,
      input,
      status: "failed",
      mode: "template_and_text",
      error: combinedError,
      nowIso,
    });
    return { ok: false, delivered: false, error: combinedError };
  }

  if (emailKey) alertedSignupKeys.delete(emailKey);
  if (userKey) alertedSignupKeys.delete(userKey);
  recordSignupAlertEvent(db, {
    recipient,
    input,
    status: "failed",
    mode: "template",
    error: templateError,
    nowIso,
  });
  return { ok: false, delivered: false, error: templateError };
}

/** Non-blocking fire-and-forget wrapper for HTTP registration handlers. */
export function fireFounderNewUserSignupAlert(input: SignupAlertInput, opts?: SignupAlertOptions): void {
  void notifyFounderNewUserSignup(input, opts).catch((err) => {
    reportCaughtError(err, "signup.founder_whatsapp_alert");
  });
}

/**
 * If a free-form `text` signup alert fails asynchronously on Meta's webhook
 * (e.g. error 131047 when the 24h window just expired), automatically retry once via template.
 */
export async function retryFailedSignupAlertWithTemplate(
  db: SqlDatabase,
  opts: { messageId?: string; status?: string; fetchImpl?: typeof fetch; allowInTest?: boolean }
): Promise<boolean> {
  const messageId = String(opts.messageId || "").trim();
  const status = String(opts.status || "").trim().toLowerCase();
  if (!messageId || status !== "failed") return false;

  const effectiveFetch = opts.fetchImpl ?? testTransportOverride?.fetchImpl;
  const allowInTest = Boolean(opts.allowInTest || opts.fetchImpl || testTransportOverride);
  if (isAutomatedTestRuntime() && !allowInTest) return false;

  try {
    const row = db
      .prepare(
        `SELECT id, action_payload FROM whatsapp_outbound_events
         WHERE event_type = 'founder_signup_alert'
           AND action_payload LIKE ?
         LIMIT 1`
      )
      .get(`%${messageId}%`) as { id?: string; action_payload?: string } | undefined;
    if (!row?.id || !row.action_payload) return false;

    const payload = JSON.parse(row.action_payload) as Record<string, unknown>;
    if (payload.mode !== "text" || payload.fallbackRetried) return false;

    payload.fallbackRetried = true;
    db.prepare("UPDATE whatsapp_outbound_events SET action_payload = ? WHERE id = ?").run(
      JSON.stringify(payload),
      row.id
    );

    const creds = resolveGraphCredentials(db as unknown as DatabaseSync, undefined, { platformSend: true });
    if (!creds) return false;

    const recipient = signupAlertRecipient();
    if (!recipient) return false;

    const retried = await sendAlertViaTemplates({
      creds,
      recipient,
      input: {
        userId: String(payload.signupUserId || ""),
        email: String(payload.signupEmail || ""),
        phone: String(payload.signupPhone || ""),
        name: String(payload.signupName || "Clinician"),
        clinicName: String(payload.clinicName || ""),
        role: String(payload.role || ""),
        specialty: String(payload.specialty || ""),
        source: String(payload.source || "User Signup"),
      },
      now: new Date(),
      fetchImpl: effectiveFetch,
    });
    return retried.ok;
  } catch {
    return false;
  }
}

/**
 * Opportunistically provisions `lumera_new_signup_alert` (UTILITY, en) on the platform WABA
 * the first time a webhook supplies `entry.id` for `tenant-lumera-main`.
 */
export async function maybeEnsureFounderSignupAlertTemplate(
  wabaId: string,
  opts?: { fetchImpl?: typeof fetch; allowInTest?: boolean }
): Promise<boolean> {
  const cleanWabaId = String(wabaId || "").trim();
  if (!/^\d{6,30}$/.test(cleanWabaId)) return false;
  if (provisionedWabaIds.has(cleanWabaId)) return false;

  const effectiveFetch = opts?.fetchImpl ?? testTransportOverride?.fetchImpl;
  const allowInTest = Boolean(opts?.allowInTest || opts?.fetchImpl || testTransportOverride);
  if (isAutomatedTestRuntime() && !allowInTest) return false;

  const creds = resolveGraphCredentials(null, undefined, { platformSend: true });
  if (!creds) return false;

  provisionedWabaIds.add(cleanWabaId);
  const templateName =
    String(process.env.META_SIGNUP_ALERT_TEMPLATE_NAME || DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME).trim();
  if (!templateName) return false;

  const fetchFn = effectiveFetch || fetch;
  const version = graphApiVersion();
  try {
    const checkUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(cleanWabaId)}/message_templates?name=${encodeURIComponent(templateName)}&limit=5`;
    const checkRes = await fetchFn(checkUrl, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (checkRes.ok) {
      const checkJson = (await checkRes.json().catch(() => ({}))) as {
        data?: Array<{ name?: string; status?: string }>;
      };
      if ((checkJson.data || []).some((tpl) => tpl.name === templateName)) {
        return true;
      }
    }

    const createUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(cleanWabaId)}/message_templates`;
    const createRes = await fetchFn(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: templateName,
        language: String(process.env.META_SIGNUP_ALERT_TEMPLATE_LANGUAGE || "en").trim() || "en",
        category: "UTILITY",
        components: [
          {
            type: "BODY",
            text: "New Lumera user signup alert.\nName: {{1}}\nEmail: {{2}}\nPhone: {{3}}\nWorkspace: {{4}}\nRegistered at: {{5}}",
            example: {
              body_text: [
                [
                  "Dr. Priya Nair",
                  "priya@nairclinic.in",
                  "+91 98765 43210",
                  "Nair Clinic (doctor - gynecology)",
                  "18 Nov 2026, 10:55 AM IST",
                ],
              ],
            },
          },
        ],
      }),
    });
    return createRes.ok;
  } catch {
    return false;
  }
}
