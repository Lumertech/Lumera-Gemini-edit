/**
 * Meta Embedded Signup v4 — Tech Provider-style handshake.
 *
 * Lumera is NOT a certified Meta Tech Provider. This implements the documented
 * code-exchange + subscribed_apps path so App Review / SANDBOX testing can
 * proceed; it does not claim certification.
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

import { appPublicUrl, envFlag, graphApiVersion, isProduction, isUnsetOrPlaceholder, platformMetaGraphToken, platformMetaGraphTokenSource, platformMetaPhoneNumberId, platformMetaWabaId, readSecret, sandboxSimulatorsEnabled } from "./runtime.ts";
import { upsertWhatsAppNumber, publicWhatsAppNumber, type WabaActor, type WhatsAppOwnerType } from "./whatsapp-numbers.ts";

export const EMBEDDED_SIGNUP_SCOPES = [
  "whatsapp_business_management",
  "business_management",
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

export function facebookAppIdForEmbeddedSignup(): string {
  return readSecret("FACEBOOK_APP_ID", "META_APP_ID");
}

export function facebookAppSecretForEmbeddedSignup(): string {
  return readSecret("FACEBOOK_APP_SECRET", "META_APP_SECRET");
}

export function embeddedSignupConfigId(): string {
  return readSecret("META_EMBEDDED_SIGNUP_CONFIG_ID");
}

export function appReviewWhatsAppScopesApproved(): boolean {
  return envFlag("META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED");
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
    appReviewWhatsAppScopesApproved: appReviewWhatsAppScopesApproved(),
    notice: configured
      ? "Embedded Signup v4 handshake is wired. Lumera is not a certified Meta Tech Provider. App Review stays SANDBOX-honest until META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED=true. Contact ravee@lumer.me."
      : "SANDBOX / DEV-ONLY: FACEBOOK_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID are not live. Real FB.login will fail until the founder provisions them. Lumera is not a certified Meta Tech Provider. Contact ravee@lumer.me.",
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
  fetchImpl: FetchImpl;
}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await opts.fetchImpl(opts.url, {
    method: opts.method || "GET",
    headers: opts.headers,
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
}): Promise<{
  wabaName: string;
  phoneStatus: string;
  codeVerificationStatus: string;
  displayNameStatus: string;
  qualityRating: string;
  verifiedName: string;
  businessId: string;
  businessVerificationStatus: string;
}> {
  const wabaId = String(opts.wabaId || "").trim();
  const phoneNumberId = String(opts.phoneNumberId || "").trim();
  if (!wabaId || !phoneNumberId) {
    throw new EmbeddedSignupError("wabaId and phoneNumberId from sessionInfoResponse are required.", 400, "ASSET_IDS_REQUIRED");
  }

  const grantedWabaIds = new Set<string>();
  for (const row of opts.debugToken?.granularScopes || []) {
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
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}?fields=id,name,account_review_status,on_behalf_of_business_info&${tokenQ.toString()}`,
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
    url: `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,name_status,quality_rating,status&${tokenQ.toString()}`,
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

  const onBehalf = waba.data?.on_behalf_of_business_info;
  const businessIdFromWaba =
    (onBehalf && typeof onBehalf === "object" ? String((onBehalf as { id?: string }).id || "").trim() : "") || "";
  const review = String(waba.data?.account_review_status || "").trim();

  return {
    wabaName: String(waba.data?.name || "").trim(),
    phoneStatus: String(match.status || "").trim(),
    codeVerificationStatus: String(match.code_verification_status || "").trim(),
    displayNameStatus: String(match.name_status || "").trim(),
    qualityRating: String(match.quality_rating || "").trim(),
    verifiedName: String(match.verified_name || "").trim(),
    businessId: businessIdFromWaba,
    businessVerificationStatus: review,
  };
}

async function inspectBusinessVerification(opts: {
  accessToken: string;
  businessId: string;
  fetchImpl: FetchImpl;
}): Promise<string> {
  const businessId = String(opts.businessId || "").trim();
  if (!businessId) return "";
  try {
    const version = graphApiVersion();
    const tokenQ = new URLSearchParams({ access_token: opts.accessToken });
    const result = await graphCall({
      url: `https://graph.facebook.com/${version}/${encodeURIComponent(businessId)}?fields=id,name,verification_status&${tokenQ.toString()}`,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.ok || (result.data && typeof result.data === "object" && result.data.error)) {
      return "";
    }
    return String(result.data?.verification_status || "").trim();
  } catch {
    return "";
  }
}

function maskSecretPreview(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return "••••";
  return `${raw.slice(0, 4)}••••${raw.slice(-4)}`;
}

/** Super Admin inventory of platform Meta env — never returns live secrets. */
export function platformMetaCredentialsOverview(opts?: { host?: string; proto?: string }) {
  const appId = facebookAppIdForEmbeddedSignup();
  const appSecret = facebookAppSecretForEmbeddedSignup();
  const systemToken = platformMetaGraphToken();
  const fallbackToken = readSecret("META_FALLBACK_ACCESS_TOKEN") || systemToken;
  const phoneNumberId = platformMetaPhoneNumberId();
  const fallbackPhoneNumberId = readSecret("META_FALLBACK_PHONE_NUMBER_ID") || phoneNumberId;
  const configId = embeddedSignupConfigId();
  const webhookUrl = `${appPublicUrl(opts?.host, opts?.proto)}/api/meta/webhook`;
  return {
    appId: appId || null,
    appIdConfigured: Boolean(appId),
    appSecretConfigured: Boolean(appSecret),
    appSecretPreview: appSecret ? maskSecretPreview(appSecret) : "",
    systemTokenConfigured: Boolean(systemToken),
    systemTokenPreview: systemToken ? maskSecretPreview(systemToken) : "",
    graphTokenEnvName: platformMetaGraphTokenSource() || null,
    phoneNumberId: phoneNumberId || null,
    wabaId: platformMetaWabaId() || null,
    fallbackPhoneNumberId: fallbackPhoneNumberId || null,
    fallbackTokenConfigured: Boolean(fallbackToken),
    embeddedSignupConfigIdConfigured: Boolean(configId),
    webhookUrl,
    webhookVerifyTokenConfigured: Boolean(readSecret("META_VERIFY_TOKEN")),
    notice:
      "Platform Meta App ID, App Secret, META_GRAPH_TOKEN (MasterAdmin Graph send), and the central webhook receiver are env-configured on Cloud Run. Super Admin does not paste tokens and does not trigger Embedded Signup — clinic tenants connect from Settings. Lumera is not a certified Meta Tech Provider. Contact ravee@lumer.me.",
  };
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

export async function completeEmbeddedSignup(opts: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  actor: WabaActor;
  ownerType: WhatsAppOwnerType;
  ownerId: string;
  displayName?: string;
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

  const businessId = String(opts.businessId || grants.businessId || "").trim();
  const businessVerificationStatus =
    (await inspectBusinessVerification({
      accessToken: exchanged.accessToken,
      businessId,
      fetchImpl,
    })) || grants.businessVerificationStatus;

  const row = upsertWhatsAppNumber(opts.actor, {
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    wabaId: opts.wabaId,
    phoneNumberId: opts.phoneNumberId,
    businessId,
    metaWabaName: grants.wabaName || grants.verifiedName || opts.displayName || "",
    metaAccessToken: exchanged.accessToken,
    metaTokenExpiresAt: tokenExpiryIso(debug),
    status: "connected",
    connectedVia: "embedded_signup",
    phoneStatus: grants.phoneStatus,
    codeVerificationStatus: grants.codeVerificationStatus,
    displayNameStatus: grants.displayNameStatus,
    businessVerificationStatus,
    qualityRating: grants.qualityRating,
  });

  return {
    whatsappNumber: publicWhatsAppNumber(row),
    tokenStorage: {
      table: "whatsapp_number_secrets",
      column: "meta_access_token",
      tokenRef: row.meta_token_ref,
      note: "Business token stored as SQLite TEXT on whatsapp_number_secrets, referenced by whatsapp_numbers.meta_token_ref. Same pattern as tenants.meta_access_token. Not Secret Manager.",
    },
    webhook: {
      subscribed: true,
      receiver: "/api/meta/webhook",
      notice: "Customer WABA subscribed_apps registered against Lumera's central webhook receiver.",
    },
    sandbox: !isProduction(),
    notice:
      "Embedded Signup v4 handshake completed. Lumera is not a certified Meta Tech Provider. Phone-number /register (two-step PIN) is not done here — see remaining App Review steps. Contact ravee@lumer.me.",
  };
}
