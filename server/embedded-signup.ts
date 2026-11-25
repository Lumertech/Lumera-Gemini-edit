/**
 * Meta Embedded Signup v4 handshake.
 *
 * See META_TECH_PROVIDER_STATEMENT in src/lib/metaStatus.ts.
 * Meta has approved Lumera's WhatsApp permission requests in App Review.
 * This implements the documented code-exchange + subscribed_apps path.
 *
 * Docs (fetched 2026-09-13):
 * - Implementation (v4): FB.login({ config_id, response_type: "code",
 *   override_default_response_type: true, extras: { setup: {} } })
 *   + WA_EMBEDDED_SIGNUP postMessage (waba_id, phone_number_id)
 *   https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
 * - Onboarding as Tech Provider: GET /{version}/oauth/access_token
 *   with client_id, client_secret, code — NO redirect_uri
 *   then POST /{waba-id}/subscribed_apps with the business token
 *   https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
 *
 * Token storage: upsertWhatsAppNumber() → whatsapp_number_secrets.meta_access_token
 * (same SQLite TEXT pattern as tenants.meta_access_token). Not Secret Manager.
 */

import crypto from "node:crypto";
import { getDb } from "./db.ts";
import {
  WHATSAPP_CLINIC_STATUS_LINE,
  WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE,
} from "../src/lib/metaStatus.ts";
import { graphApiVersion, isProduction, isUnsetOrPlaceholder, readSecret, sandboxSimulatorsEnabled } from "./runtime.ts";
import { isAutomatedTestRuntime } from "./signup-alert.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import {
  getWhatsAppNumberByPhoneNumberId,
  getWhatsAppRegistrationPin,
  publicWhatsAppNumber,
  upsertWhatsAppNumber,
  type WabaActor,
  type WhatsAppOwnerType,
} from "./whatsapp-numbers.ts";

export const EMBEDDED_SIGNUP_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

export class EmbeddedSignupError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, code = "EMBEDDED_SIGNUP", extra?: Record<string, unknown>) {
    super(message);
    this.name = "EmbeddedSignupError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function resolveEmbeddedSignupCredentials(): { appId: string; appSecret: string } {
  const esAppId = readSecret("META_EMBEDDED_SIGNUP_APP_ID");
  if (esAppId) {
    return {
      appId: esAppId,
      appSecret: readSecret(
        "META_EMBEDDED_SIGNUP_APP_SECRET",
        "WHATSAPP_APP_SECRET",
        "FACEBOOK_APP_SECRET",
        "META_APP_SECRET"
      ),
    };
  }
  const waAppId = readSecret("WHATSAPP_APP_ID");
  if (waAppId) {
    return {
      appId: waAppId,
      appSecret: readSecret(
        "WHATSAPP_APP_SECRET",
        "META_EMBEDDED_SIGNUP_APP_SECRET",
        "FACEBOOK_APP_SECRET",
        "META_APP_SECRET"
      ),
    };
  }
  const fbAppId = readSecret("FACEBOOK_APP_ID");
  if (fbAppId) {
    return {
      appId: fbAppId,
      appSecret: readSecret("FACEBOOK_APP_SECRET", "META_APP_SECRET", "WHATSAPP_APP_SECRET"),
    };
  }
  const metaAppId = readSecret("META_APP_ID");
  return {
    appId: metaAppId,
    appSecret: metaAppId ? readSecret("META_APP_SECRET", "FACEBOOK_APP_SECRET", "WHATSAPP_APP_SECRET") : "",
  };
}

export function facebookAppIdForEmbeddedSignup(): string {
  return resolveEmbeddedSignupCredentials().appId;
}

export function facebookAppSecretForEmbeddedSignup(): string {
  return resolveEmbeddedSignupCredentials().appSecret;
}

export function embeddedSignupConfigId(): string {
  return readSecret("META_EMBEDDED_SIGNUP_CONFIG_ID");
}

export function embeddedSignupConfigured(): boolean {
  return Boolean(facebookAppIdForEmbeddedSignup() && embeddedSignupConfigId());
}

export function embeddedSignupPublicConfig() {
  const appId = facebookAppIdForEmbeddedSignup() || "";
  const configId = embeddedSignupConfigId() || "";
  const configured = Boolean(appId && configId);
  return {
    appId: appId || null,
    configId: configId || null,
    graphVersion: graphApiVersion(),
    scopes: [...EMBEDDED_SIGNUP_SCOPES],
    configured,
    sandbox: !isProduction(),
    simulatorsEnabled: sandboxSimulatorsEnabled(),
    notice: configured
      ? `${WHATSAPP_CLINIC_STATUS_LINE} Contact ravee@lumer.me.`
      : `${WHATSAPP_CONNECTION_UNAVAILABLE_SENTENCE} ${WHATSAPP_CLINIC_STATUS_LINE}`,
  };
}

type FetchImpl = typeof fetch;

let injectedFetchImpl: FetchImpl | undefined;

/** Test hook — HTTP tests mock Graph via completeEmbeddedSignup's fetchImpl path. */
export function setEmbeddedSignupFetchImpl(impl?: FetchImpl) {
  injectedFetchImpl = impl;
}

function resolveFetchImpl(impl?: FetchImpl): FetchImpl {
  return impl || injectedFetchImpl || fetch;
}

async function graphCall(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  fetchImpl: FetchImpl;
}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await opts.fetchImpl(opts.url, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* Graph sometimes documents a bare token string for this exchange. */
  }
  return { ok: res.ok, status: res.status, data, text };
}

function graphErrorMessage(data: any, status: number): string {
  if (data && typeof data === "object" && data.error) {
    return String(data.error.message || data.error.error_user_msg || `Graph error (HTTP ${status})`);
  }
  return `Graph request failed (HTTP ${status}).`;
}

/**
 * Embedded Signup code → business integration system user token.
 * Official v4 Tech Provider docs: client_id, client_secret, code only. No redirect_uri.
 */
export async function exchangeEmbeddedSignupCode(opts: {
  code: string;
  fetchImpl?: FetchImpl;
}): Promise<{ accessToken: string; raw: any }> {
  const appId = facebookAppIdForEmbeddedSignup();
  const appSecret = facebookAppSecretForEmbeddedSignup();
  if (!appId || !appSecret) {
    throw new EmbeddedSignupError(
      "Embedded Signup is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET or META_APP_SECRET).",
      503,
      "NOT_CONFIGURED"
    );
  }
  const code = String(opts.code || "").trim();
  if (!code) {
    throw new EmbeddedSignupError("Embedded Signup authorization code is required.", 400, "CODE_REQUIRED");
  }
  const version = graphApiVersion();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const result = await graphCall({
    url: `https://graph.facebook.com/${version}/oauth/access_token?${params.toString()}`,
    fetchImpl: resolveFetchImpl(opts.fetchImpl),
  });
  if (!result.ok || (result.data && typeof result.data === "object" && result.data.error)) {
    throw new EmbeddedSignupError(graphErrorMessage(result.data, result.status), 401, "CODE_EXCHANGE_FAILED", {
      graphStatus: result.status,
    });
  }
  let token = "";
  if (typeof result.data === "string") {
    token = result.data.trim();
  } else if (result.data && typeof result.data === "object") {
    token = String(result.data.access_token || "").trim();
  }
  if (!token) {
    throw new EmbeddedSignupError(
      "Embedded Signup code exchange did not return a business token.",
      401,
      "NO_BUSINESS_TOKEN"
    );
  }
  return { accessToken: token, raw: result.data };
}

export type DebugTokenPayload = {
  appId: string;
  isValid: boolean;
  userId?: string;
  expiresAt?: number;
  dataAccessExpiresAt?: number;
  scopes: string[];
  granularScopes: Array<{ scope: string; targetIds: string[] }>;
};

export async function inspectEmbeddedSignupToken(opts: {
  accessToken: string;
  fetchImpl?: FetchImpl;
}): Promise<DebugTokenPayload> {
  const appId = facebookAppIdForEmbeddedSignup();
  const appSecret = facebookAppSecretForEmbeddedSignup();
  if (!appId || !appSecret) {
    throw new EmbeddedSignupError(
      "Embedded Signup is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET or META_APP_SECRET).",
      503,
      "NOT_CONFIGURED"
    );
  }
  const params = new URLSearchParams({
    input_token: opts.accessToken,
    access_token: `${appId}|${appSecret}`,
  });
  const result = await graphCall({
    url: `https://graph.facebook.com/debug_token?${params.toString()}`,
    fetchImpl: resolveFetchImpl(opts.fetchImpl),
  });
  if (!result.ok || (result.data && typeof result.data === "object" && result.data.error)) {
    throw new EmbeddedSignupError(graphErrorMessage(result.data, result.status), 401, "DEBUG_TOKEN_FAILED");
  }
  const payload = (result.data && typeof result.data === "object" ? result.data.data : null) || {};
  const granular = Array.isArray(payload.granular_scopes) ? payload.granular_scopes : [];
  return {
    appId: String(payload.app_id || ""),
    isValid: Boolean(payload.is_valid),
    userId: payload.user_id ? String(payload.user_id) : undefined,
    expiresAt: typeof payload.expires_at === "number" ? payload.expires_at : undefined,
    dataAccessExpiresAt: typeof payload.data_access_expires_at === "number" ? payload.data_access_expires_at : undefined,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map((s: unknown) => String(s)) : [],
    granularScopes: granular.map((row: any) => ({
      scope: String(row?.scope || ""),
      targetIds: Array.isArray(row?.target_ids) ? row.target_ids.map((id: unknown) => String(id)) : [],
    })),
  };
}

export async function confirmWabaAndPhoneGrants(opts: {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  debugToken?: DebugTokenPayload;
  fetchImpl?: FetchImpl;
}): Promise<{ wabaName: string; displayPhoneNumber: string }> {
  const wabaId = String(opts.wabaId || "").trim();
  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  if (!wabaId || !phoneNumberId) {
    throw new EmbeddedSignupError("wabaId and phoneNumberId from sessionInfoResponse are required.", 400, "ASSET_IDS_REQUIRED");
  }

  const grantedWabaIds = new Set<string>();
  for (const row of opts.debugToken?.granularScopes || []) {
    if (row.scope !== "whatsapp_business_management" && row.scope !== "whatsapp_business_messaging") continue;
    for (const id of row.targetIds) grantedWabaIds.add(id);
  }
  if (grantedWabaIds.size > 0 && !grantedWabaIds.has(wabaId)) {
    throw new EmbeddedSignupError(
      "sessionInfoResponse waba_id is not in the business token's debug_token grants.",
      403,
      "WABA_GRANT_MISMATCH"
    );
  }

  const version = graphApiVersion();
  const tokenQ = new URLSearchParams({ access_token: opts.accessToken });
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);

  const waba = await graphCall({
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}?fields=id,name&${tokenQ.toString()}`,
    fetchImpl,
  });
  if (!waba.ok || (waba.data && typeof waba.data === "object" && waba.data.error)) {
    throw new EmbeddedSignupError(
      graphErrorMessage(waba.data, waba.status) || "Business token cannot read the reported WABA.",
      403,
      "WABA_UNREADABLE"
    );
  }
  const returnedWabaId = String(waba.data?.id || "").trim();
  if (returnedWabaId && returnedWabaId !== wabaId) {
    throw new EmbeddedSignupError("Graph WABA id does not match sessionInfoResponse waba_id.", 403, "WABA_ID_MISMATCH");
  }

  const phones = await graphCall({
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number&${tokenQ.toString()}`,
    fetchImpl,
  });
  if (!phones.ok || (phones.data && typeof phones.data === "object" && phones.data.error)) {
    throw new EmbeddedSignupError(
      graphErrorMessage(phones.data, phones.status) || "Business token cannot list WABA phone numbers.",
      403,
      "PHONE_LIST_FAILED"
    );
  }
  const list = Array.isArray(phones.data?.data) ? phones.data.data : [];
  const match = list.find((row: any) => String(row?.id || "") === phoneNumberId);
  if (!match) {
    throw new EmbeddedSignupError(
      "sessionInfoResponse phone_number_id is not granted on this WABA for the business token.",
      403,
      "PHONE_GRANT_MISMATCH"
    );
  }

  return {
    wabaName: String(waba.data?.name || "").trim(),
    displayPhoneNumber: String(match?.display_phone_number || "").trim(),
  };
}

export function generateWhatsAppRegistrationPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Cloud API phone registration. Called after subscribed_apps and again on reconnect. */
export async function registerWhatsAppCloudPhone(opts: {
  accessToken: string;
  phoneNumberId: string;
  pin: string;
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  const pin = String(opts.pin || "").trim();
  if (!phoneNumberId) {
    throw new EmbeddedSignupError("phone_number_id is required to register the WhatsApp number.", 400, "PHONE_REQUIRED");
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new EmbeddedSignupError("WhatsApp registration PIN must be 6 digits.", 400, "PIN_INVALID");
  }
  const version = graphApiVersion();
  const result = await graphCall({
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/register`,
    method: "POST",
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    body: { messaging_product: "whatsapp", pin },
    fetchImpl: resolveFetchImpl(opts.fetchImpl),
  });
  if (!result.ok || result.data?.success === false || (result.data && typeof result.data === "object" && result.data.error)) {
    const errCode = Number(result.data?.error?.code || 0);
    const errSub = Number(result.data?.error?.error_subcode || 0);
    const rawMsg = graphErrorMessage(result.data, result.status);
    // Meta returns 133005 / "Two step verification pin mismatch" when the clinic already set a 6-digit 2FA PIN
    if (errCode === 133005 || errSub === 2388001 || /pin\s*mismatch|two[- ]step\s*verification/i.test(rawMsg)) {
      throw new EmbeddedSignupError(
        "This WhatsApp number already has a 6-digit two-step verification PIN enabled. Enter your existing 6-digit PIN below to complete registration.",
        409,
        "PIN_REQUIRED"
      );
    }
    throw new EmbeddedSignupError(
      rawMsg || "Failed to register the WhatsApp phone number.",
      502,
      "REGISTER_FAILED"
    );
  }
}

export function isCoexistenceSignupEvent(event?: string | null): boolean {
  const clean = String(event || "").trim().toUpperCase();
  return clean === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || clean === "COEXISTENCE";
}

const STANDARD_CLINIC_UTILITY_TEMPLATES: Array<{
  name: string;
  language: string;
  category: "UTILITY";
  bodyText: string;
  exampleRow: string[];
}> = [
  {
    name: "lumera_appointment_reminder",
    language: "en_US",
    category: "UTILITY",
    bodyText:
      "Namaste {{1}}, this is a reminder from {{2}} for your consultation with {{3}} on {{4}} at {{5}}. Please arrive 10 minutes early.",
    exampleRow: ["Priya Sharma", "City Clinic", "Dr. Vikram Malhotra", "2026-11-25", "10:30 AM"],
  },
  {
    name: "lumera_appointment_booked",
    language: "en_US",
    category: "UTILITY",
    bodyText:
      "Namaste {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. Your OPD token number is #{{5}}.",
    exampleRow: ["Priya Sharma", "Dr. Vikram Malhotra", "2026-11-25", "10:30 AM", "04"],
  },
  {
    name: "lumera_payment_receipt",
    language: "en_US",
    category: "UTILITY",
    bodyText:
      "Namaste {{1}}, {{2}} has received your payment of {{3}} for invoice {{4}} dated {{5}}. Thank you.",
    exampleRow: ["Priya Sharma", "City Clinic", "INR 600.00", "INV-2026-101", "2026-11-25"],
  },
];

/**
 * Syncs existing Meta WABA templates into `meta_templates` for `tenantId` and
 * submits any missing standard Lumera utility templates so outside-24h reminders,
 * booking confirmations, and receipts work on newly connected clinic WABAs.
 */
export async function syncAndProvisionClinicWabaTemplates(opts: {
  db?: SqlDatabase;
  tenantId: string;
  wabaId: string;
  accessToken: string;
  fetchImpl?: FetchImpl;
}): Promise<{ synced: number; provisioned: number }> {
  const tenantId = String(opts.tenantId || "").trim();
  const wabaId = String(opts.wabaId || "").trim();
  const accessToken = String(opts.accessToken || "").trim();
  if (!tenantId || !wabaId || !accessToken) return { synced: 0, provisioned: 0 };

  const db = opts.db || getDb();
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  const version = graphApiVersion();
  const now = new Date().toISOString();

  const listRes = await graphCall({
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=100`,
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl,
  });

  const remoteTemplates: Array<Record<string, any>> =
    listRes.ok && Array.isArray(listRes.data?.data) ? listRes.data.data : [];

  const upsertLocalTemplate = (tpl: {
    metaId?: string;
    name: string;
    category: string;
    language: string;
    status: string;
    components: unknown;
  }) => {
    const cleanName = String(tpl.name || "").trim();
    if (!cleanName) return;
    const existing = db
      .prepare("SELECT id FROM meta_templates WHERE tenant_id = ? AND name = ? LIMIT 1")
      .get(tenantId, cleanName) as { id?: string } | undefined;
    const rowId = existing?.id || `tpl-${crypto.randomUUID().slice(0, 12)}`;
    const compJson = typeof tpl.components === "string" ? tpl.components : JSON.stringify(tpl.components || []);
    if (existing?.id) {
      db.prepare(
        `UPDATE meta_templates
         SET waba_id = ?, category = ?, language = ?, status = ?, components = ?, meta_template_id = COALESCE(NULLIF(?, ''), meta_template_id), updated_at = ?
         WHERE id = ?`
      ).run(
        wabaId,
        String(tpl.category || "UTILITY").toUpperCase(),
        String(tpl.language || "en_US"),
        String(tpl.status || "PENDING").toUpperCase(),
        compJson,
        String(tpl.metaId || ""),
        now,
        rowId
      );
    } else {
      db.prepare(
        `INSERT INTO meta_templates
          (id, tenant_id, waba_id, name, category, language, status, components, meta_template_id, rejection_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
      ).run(
        rowId,
        tenantId,
        wabaId,
        cleanName,
        String(tpl.category || "UTILITY").toUpperCase(),
        String(tpl.language || "en_US"),
        String(tpl.status || "PENDING").toUpperCase(),
        compJson,
        String(tpl.metaId || ""),
        now,
        now
      );
    }
  };

  let synced = 0;
  const existingNames = new Set<string>();
  for (const raw of remoteTemplates) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    existingNames.add(name.toLowerCase());
    try {
      upsertLocalTemplate({
        metaId: String(raw?.id || ""),
        name,
        category: String(raw?.category || "UTILITY"),
        language: String(raw?.language || "en_US"),
        status: String(raw?.status || "PENDING"),
        components: raw?.components || [],
      });
      synced += 1;
    } catch {
      /* meta_templates may be absent in isolated DB fixtures */
    }
  }

  let provisioned = 0;
  for (const std of STANDARD_CLINIC_UTILITY_TEMPLATES) {
    if (existingNames.has(std.name.toLowerCase())) continue;
    const components = [
      {
        type: "BODY",
        text: std.bodyText,
        example: { body_text: [std.exampleRow] },
      },
    ];
    const createRes = await graphCall({
      url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates`,
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        name: std.name,
        language: std.language,
        category: std.category,
        components,
      },
      fetchImpl,
    });
    if (createRes.ok && createRes.data && !createRes.data.error) {
      provisioned += 1;
      try {
        upsertLocalTemplate({
          metaId: String(createRes.data.id || ""),
          name: std.name,
          category: std.category,
          language: std.language,
          status: String(createRes.data.status || "PENDING"),
          components,
        });
      } catch {
        /* ignore */
      }
    }
  }

  return { synced, provisioned };
}

export async function subscribeAppToCustomerWaba(opts: {
  accessToken: string;
  wabaId: string;
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const version = graphApiVersion();
  const result = await graphCall({
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(opts.wabaId)}/subscribed_apps`,
    method: "POST",
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    fetchImpl: resolveFetchImpl(opts.fetchImpl),
  });
  if (!result.ok || result.data?.success === false || (result.data && typeof result.data === "object" && result.data.error)) {
    throw new EmbeddedSignupError(
      graphErrorMessage(result.data, result.status) || "Failed to subscribe the app to the customer WABA.",
      502,
      "SUBSCRIBE_FAILED"
    );
  }
}

function tokenExpiryIso(debug: DebugTokenPayload): string | undefined {
  const candidates = [debug.expiresAt, debug.dataAccessExpiresAt].filter(
    (n): n is number => typeof n === "number" && n > 0
  );
  if (!candidates.length) return undefined;
  const soonest = Math.min(...candidates);
  return new Date(soonest * 1000).toISOString();
}

/** Reconnect keeps the PIN already stored for this phone. A new PIN is only minted when none exists. */
function storedRegistrationPin(phoneNumberId: string): string {
  const row = getWhatsAppNumberByPhoneNumberId(phoneNumberId);
  if (!row?.meta_token_ref) return "";
  const pin = String(getWhatsAppRegistrationPin(row.meta_token_ref) || "").trim();
  return /^\d{6}$/.test(pin) ? pin : "";
}

export async function completeEmbeddedSignup(opts: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  actor: WabaActor;
  ownerType: WhatsAppOwnerType;
  ownerId: string;
  displayName?: string;
  signupEvent?: string;
  existingPin?: string;
  syncTemplates?: boolean;
  fetchImpl?: FetchImpl;
}) {
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  if (isUnsetOrPlaceholder(opts.code)) {
    throw new EmbeddedSignupError("Embedded Signup authorization code is required.", 400, "CODE_REQUIRED");
  }

  const exchanged = await exchangeEmbeddedSignupCode({ code: opts.code, fetchImpl });
  const debug = await inspectEmbeddedSignupToken({ accessToken: exchanged.accessToken, fetchImpl });
  const expectedAppId = facebookAppIdForEmbeddedSignup();
  if (!debug.isValid || debug.appId !== expectedAppId) {
    throw new EmbeddedSignupError("Business token is invalid for this Facebook app.", 401, "TOKEN_APP_MISMATCH");
  }

  const grants = await confirmWabaAndPhoneGrants({
    accessToken: exchanged.accessToken,
    wabaId: opts.wabaId,
    phoneNumberId: opts.phoneNumberId,
    debugToken: debug,
    fetchImpl,
  });

  await subscribeAppToCustomerWaba({
    accessToken: exchanged.accessToken,
    wabaId: opts.wabaId,
    fetchImpl,
  });

  const coexistence = isCoexistenceSignupEvent(opts.signupEvent);
  const callerPin = String(opts.existingPin || "").trim();
  if (callerPin && !/^\d{6}$/.test(callerPin)) {
    throw new EmbeddedSignupError("WhatsApp registration PIN must be 6 digits.", 400, "PIN_INVALID");
  }

  let registrationPin: string | undefined;
  if (!coexistence) {
    registrationPin = callerPin || storedRegistrationPin(opts.phoneNumberId) || generateWhatsAppRegistrationPin();
    await registerWhatsAppCloudPhone({
      accessToken: exchanged.accessToken,
      phoneNumberId: opts.phoneNumberId,
      pin: registrationPin,
      fetchImpl,
    });
  } else if (!opts.fetchImpl && !injectedFetchImpl && !isAutomatedTestRuntime()) {
    // Coexistence numbers stay active on WhatsApp Business App and initiate SMB sync instead of /register
    const version = graphApiVersion();
    for (const syncType of ["smb_app_state_sync", "history"]) {
      await graphCall({
        url: `https://graph.facebook.com/${version}/${encodeURIComponent(opts.phoneNumberId)}/smb_app_data`,
        method: "POST",
        headers: { Authorization: `Bearer ${exchanged.accessToken}` },
        body: { messaging_product: "whatsapp", sync_type: syncType },
        fetchImpl,
      }).catch(() => undefined);
    }
  }

  const row = upsertWhatsAppNumber(opts.actor, {
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    wabaId: opts.wabaId,
    phoneNumberId: opts.phoneNumberId,
    displayPhoneNumber: grants.displayPhoneNumber || undefined,
    metaWabaName: grants.wabaName || opts.displayName || "",
    metaAccessToken: exchanged.accessToken,
    metaTokenExpiresAt: tokenExpiryIso(debug),
    registrationPin,
    status: "connected",
    connectedVia: "embedded_signup",
  });

  let templateSync: { synced: number; provisioned: number } | undefined;
  const shouldSyncTemplates =
    opts.ownerType === "tenant" &&
    (opts.syncTemplates === true || (!opts.fetchImpl && !injectedFetchImpl && !isAutomatedTestRuntime()));
  if (shouldSyncTemplates) {
    try {
      templateSync = await syncAndProvisionClinicWabaTemplates({
        tenantId: opts.ownerId,
        wabaId: opts.wabaId,
        accessToken: exchanged.accessToken,
        fetchImpl,
      });
    } catch {
      /* non-fatal: WABA connection still succeeds even if template sync fails */
    }
  }

  return {
    whatsappNumber: publicWhatsAppNumber(row),
    coexistence,
    ...(templateSync ? { templateSync } : {}),
    tokenStorage: {
      table: "whatsapp_number_secrets",
      column: "meta_access_token",
      tokenRef: row.meta_token_ref,
      note: "Business token stored on whatsapp_number_secrets (AES-256-GCM when WA_TOKEN_KEY is set). tenants.meta_access_token is left null. Not Secret Manager.",
    },
    registrationPinStored: !coexistence,
    sandbox: !isProduction(),
    notice: coexistence
      ? "Embedded Signup v4 (WhatsApp Business App Coexistence) completed. Your number remains active on the WhatsApp Business app and Cloud API. Contact ravee@lumer.me."
      : "Embedded Signup v4 handshake completed. The phone number was registered with the stored 6-digit PIN. Reconnect reuses that PIN and generates a new one only when none is stored. Contact ravee@lumer.me.",
  };
}
