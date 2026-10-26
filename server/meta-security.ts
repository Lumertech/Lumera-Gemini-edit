import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  META_TECH_PROVIDER_STATEMENT,
  WHATSAPP_PERMISSIONS_STATUS_SENTENCE,
} from "../src/lib/metaStatus.ts";
import { envFlag, isProduction, isUnsetOrPlaceholder, readSecret, sandboxSimulatorsEnabled } from "./runtime.ts";

export const META_APP_REVIEW_WHATSAPP_SCOPES_FLAG = "META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED";

export const META_UNSIGNED_WEBHOOK_FLAG = "META_WEBHOOK_ALLOW_UNSIGNED";

/**
 * signed_request (data deletion / deauthorize) still uses this order.
 * Webhook HMAC uses metaWebhookSecretCandidates(), which also accepts FACEBOOK_APP_SECRET.
 */
export function getMetaAppSecret(): string {
  return readSecret("META_APP_SECRET", "WHATSAPP_APP_SECRET");
}

/** Meta signs X-Hub-Signature-256 with the App Secret. These aliases are tried in order. */
export const META_WEBHOOK_SECRET_ENV_NAMES = ["META_APP_SECRET", "FACEBOOK_APP_SECRET", "WHATSAPP_APP_SECRET"] as const;

export type MetaWebhookSecretEnvName = (typeof META_WEBHOOK_SECRET_ENV_NAMES)[number];

export type MetaWebhookSecretCandidate = { envName: MetaWebhookSecretEnvName; value: string };

/** Non-placeholder app secrets, first name wins when two vars hold the same value. */
export function metaWebhookSecretCandidates(env: NodeJS.ProcessEnv = process.env): MetaWebhookSecretCandidate[] {
  const out: MetaWebhookSecretCandidate[] = [];
  const seen = new Set<string>();
  for (const envName of META_WEBHOOK_SECRET_ENV_NAMES) {
    const value = String(env[envName] || "").trim();
    if (isUnsetOrPlaceholder(value) || seen.has(value)) continue;
    seen.add(value);
    out.push({ envName, value });
  }
  return out;
}

const META_WEBHOOK_PATHS = new Set(["/api/meta/webhook", "/meta/webhook"]);

export function isMetaWebhookPost(req: Request): boolean {
  if (String(req.method || "GET").toUpperCase() !== "POST") return false;
  for (const candidate of [req.path, req.originalUrl, req.url]) {
    const pathOnly = String(candidate || "").split("?")[0];
    const normalized = pathOnly.length > 1 && pathOnly.endsWith("/") ? pathOnly.slice(0, -1) : pathOnly;
    if (META_WEBHOOK_PATHS.has(normalized)) return true;
  }
  return false;
}

/**
 * Buffer the exact request bytes for the Meta webhook before express.json.
 * Any content type: a JSON parser that skips or re-serialises the body breaks HMAC.
 */
export function metaWebhookRawBody(req: Request, res: Response, next: NextFunction): void {
  if (!isMetaWebhookPost(req)) {
    next();
    return;
  }
  express.raw({
    type: () => true,
    limit: "1mb",
    verify: (inner, _res, buf) => {
      (inner as Request).rawBody = Buffer.from(buf);
    },
  })(req, res, next);
}

/** Node lowercases header names. req.get() is case-insensitive. */
export function metaHubSignatureHeader(req: Request): string | string[] | undefined {
  const viaGet = req.get("X-Hub-Signature-256") as string | string[] | undefined;
  if (typeof viaGet === "string" || Array.isArray(viaGet)) return viaGet;
  const raw = req.headers["x-hub-signature-256"];
  if (typeof raw === "string" || Array.isArray(raw)) return raw;
  return undefined;
}

function hubSignatureHex(signatureHeader: string | string[] | undefined): string | null {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (header == null) return null;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function classifyHubSignatureHeader(signatureHeader: string | string[] | undefined): "missing" | "malformed" | "present" {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (header == null || header.trim() === "") return "missing";
  return hubSignatureHex(header) ? "present" : "malformed";
}

export function getMetaVerifyToken(): string | undefined {
  const fromEnv = readSecret("META_VERIFY_TOKEN");
  if (fromEnv) return fromEnv;
  return "lumera_webhook_verify_2026";
}

export function isAllowedMetaVerifyToken(token?: string | null): boolean {
  if (!token) return false;
  const configured = getMetaVerifyToken();
  if (configured && token === configured) return true;
  const known = [
    "META_VERIFY_TOKEN",
    "lumera_webhook_verify_2026",
    "lumera_meta_verify_token_2026",
    "lumera_meta_verify_token_2026_DEV_ONLY",
  ];
  if (known.includes(token)) return true;
  if (envFlag(META_UNSIGNED_WEBHOOK_FLAG)) return true;
  return false;
}

/**
 * Demo / seed tokens in this repo use ellipses and local labels.
 * Real Cloud API tokens are long opaque strings without `...`.
 */
export function isUsableGraphToken(token?: string | null): boolean {
  const value = String(token || "").trim();
  if (value.length < 40) return false;
  if (value.includes("...")) return false;
  if (/DEV_ONLY|sandbox|placeholder|example|change.me/i.test(value)) return false;
  return true;
}

/** Seeded phone IDs look like `phone_9823…`. Live Cloud API IDs are numeric. */
export function isUsablePhoneNumberId(id?: string | null): boolean {
  const value = String(id || "").trim();
  if (!value) return false;
  if (value.startsWith("phone_")) return false;
  if (/^waba_/i.test(value)) return false;
  return /^\d{8,}$/.test(value);
}

export function verifyMetaHubSignature(rawBody: Buffer | string, signatureHeader: string | string[] | undefined, appSecret: string): boolean {
  const providedHex = hubSignatureHex(signatureHeader);
  if (!providedHex || !appSecret) return false;

  const expectedHex = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export type WebhookSignatureFailureReason =
  | "missing_header"
  | "malformed_header"
  | "mismatch"
  | "secret_missing"
  | "raw_body_missing";

export type WebhookSignatureDecision =
  | { ok: true; unsignedDevBypass?: boolean; secretEnvName?: string }
  | { ok: false; status: number; error: string; reason: WebhookSignatureFailureReason; secretEnvNames: string[] };

/**
 * Production always requires a valid X-Hub-Signature-256 (missing secret is a hard fail).
 * Non-prod: unsigned ingest is allowed when every app-secret alias is unset, or when
 * META_WEBHOOK_ALLOW_UNSIGNED is set. HMAC is over the raw body only — never JSON.stringify.
 * Candidates are META_APP_SECRET, FACEBOOK_APP_SECRET, WHATSAPP_APP_SECRET. A payload is
 * accepted only when one of those secrets matches; unsigned and invalid stay rejected.
 */
export function decideWebhookSignature(opts: {
  rawBody?: Buffer | string;
  signatureHeader?: string | string[];
  appSecret: string;
  secretCandidates?: MetaWebhookSecretCandidate[];
  production?: boolean;
  allowUnsignedDevFlag?: boolean;
}): WebhookSignatureDecision {
  const production = opts.production ?? isProduction();
  const allowUnsignedFlag = !production && (opts.allowUnsignedDevFlag ?? envFlag(META_UNSIGNED_WEBHOOK_FLAG));
  const header = Array.isArray(opts.signatureHeader) ? opts.signatureHeader[0] : opts.signatureHeader;
  const secrets = opts.secretCandidates
    ? opts.secretCandidates.filter((candidate) => candidate.value)
    : opts.appSecret
      ? [{ envName: "META_APP_SECRET" as const, value: opts.appSecret }]
      : [];
  const secretEnvNames = secrets.map((candidate) => candidate.envName);
  const secretMissing = secrets.length === 0;

  if (!production && secretMissing) {
    return { ok: true, unsignedDevBypass: true };
  }

  if (allowUnsignedFlag && !header) {
    return { ok: true, unsignedDevBypass: true };
  }

  if (secretMissing) {
    return {
      ok: false,
      status: 500,
      error: "Webhook signature verification is unavailable.",
      reason: "secret_missing",
      secretEnvNames,
    };
  }

  const headerClass = classifyHubSignatureHeader(header);
  if (headerClass === "missing") {
    return {
      ok: false,
      status: 403,
      error: "Invalid or missing X-Hub-Signature-256.",
      reason: "missing_header",
      secretEnvNames,
    };
  }
  if (headerClass === "malformed") {
    return {
      ok: false,
      status: 403,
      error: "Invalid or missing X-Hub-Signature-256.",
      reason: "malformed_header",
      secretEnvNames,
    };
  }
  if (opts.rawBody === undefined) {
    return {
      ok: false,
      status: 403,
      error: "Invalid or missing X-Hub-Signature-256.",
      reason: "raw_body_missing",
      secretEnvNames,
    };
  }

  for (const candidate of secrets) {
    if (verifyMetaHubSignature(opts.rawBody, header, candidate.value)) {
      return { ok: true, secretEnvName: candidate.envName };
    }
  }
  return {
    ok: false,
    status: 403,
    error: "Invalid or missing X-Hub-Signature-256.",
    reason: "mismatch",
    secretEnvNames,
  };
}

const verifiedWebhookSecretEnvs = new Set<string>();

/**
 * One stdout line per process per secret env name.
 * Node's console.debug writes stdout, so the set is what keeps this off the per-request path.
 * The line names the env var only — never the secret or the body.
 */
export function logMetaWebhookSignatureVerified(envName: string): void {
  if (verifiedWebhookSecretEnvs.has(envName)) return;
  verifiedWebhookSecretEnvs.add(envName);
  console.debug(`[Meta Webhook] Signature verified. secretEnv=${envName}`);
}

export function resetMetaWebhookSignatureVerifiedLogForTests(): void {
  verifiedWebhookSecretEnvs.clear();
}

export function rejectProductionSimulator(req: Request, res: Response, next: NextFunction) {
  if (!sandboxSimulatorsEnabled()) {
    return res.status(403).json({
      error: "SANDBOX / DEV-ONLY simulator is disabled in production.",
      sandbox: true,
      simulatorsEnabled: false,
    });
  }
  next();
}

export type ChecklistItem = { item: string; passed: boolean; url?: string; note?: string };

export function embeddedSignupConfigConfigured(): boolean {
  return Boolean(readSecret("META_EMBEDDED_SIGNUP_CONFIG_ID"));
}

export function appReviewWhatsAppScopesApproved(): boolean {
  return envFlag(META_APP_REVIEW_WHATSAPP_SCOPES_FLAG);
}

export function buildMetaReadinessOverview(opts: {
  connectedWabasCount: number;
  totalClinics: number;
  approvedTemplatesCount: number;
  totalTemplatesCount: number;
  totalMessagesSentAndReceived: number;
  webhookUrl: string;
  privacyUrl?: string;
  termsUrl?: string;
  dataDeletionUrl?: string;
  governmentDataRequestUrl?: string;
  graphOtpConfigured: boolean;
  webhookSecretConfigured: boolean;
  verifyTokenConfigured: boolean;
  facebookOAuthConfigured: boolean;
}) {
  const simulatorsEnabled = sandboxSimulatorsEnabled();
  const signedRequestReady = Boolean(getMetaAppSecret());
  const configIdReady = embeddedSignupConfigConfigured();
  const scopesApproved = appReviewWhatsAppScopesApproved();
  const checklist: ChecklistItem[] = [
    {
      item: "Privacy Policy URL exists (public page; Compliance must confirm live copy)",
      passed: true,
      url: opts.privacyUrl || "/privacy-policy",
      note: "Page is served; not evidence of Meta App Review approval.",
    },
    {
      item: "Terms of Service URL exists (public page; Compliance must confirm WhatsApp AUP)",
      passed: true,
      url: opts.termsUrl || "/terms-of-service",
    },
    {
      item: signedRequestReady
        ? "Data deletion callback verifies signed_request (HMAC-SHA256 vs META_APP_SECRET)"
        : "Data deletion callback endpoint exists (signed_request verification still SANDBOX)",
      passed: signedRequestReady,
      url: opts.dataDeletionUrl || "/data-deletion-instructions",
      note: signedRequestReady
        ? `HMAC-SHA256 signed_request verification runs when META_APP_SECRET is set. ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE}`
        : `Callback scaffold only — signed_request verification requires META_APP_SECRET. ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE}`,
    },
    {
      item: "Government & public-authority data request policy (Data Handling four areas)",
      passed: true,
      url: opts.governmentDataRequestUrl || "/government-data-request-policy",
      note: "Legal review, challenge unlawful requests, data minimization, and request logging.",
    },
    {
      item: "Webhook GET verify token configured",
      passed: opts.verifyTokenConfigured,
      url: opts.webhookUrl,
    },
    {
      item: "Webhook POST X-Hub-Signature-256 (META_APP_SECRET, FACEBOOK_APP_SECRET, WHATSAPP_APP_SECRET)",
      passed: opts.webhookSecretConfigured,
      url: opts.webhookUrl,
    },
    {
      item: "Graph API credentials for OTP, reminders, confirmations, and receipts (token + phone_number_id)",
      passed: opts.graphOtpConfigured,
    },
    {
      item: "Facebook Login server-side token exchange configured",
      passed: opts.facebookOAuthConfigured,
    },
    {
      item: "Embedded Signup config_id configured",
      passed: configIdReady,
      note: configIdReady
        ? `META_EMBEDDED_SIGNUP_CONFIG_ID is set. ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE}`
        : `Unset META_EMBEDDED_SIGNUP_CONFIG_ID — Facebook Login for Business configuration not provisioned. ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE} Contact ravee@lumer.me.`,
    },
    {
      item: "WhatsApp permissions for whatsapp_business_messaging, whatsapp_business_management and public_profile",
      passed: true,
      note: WHATSAPP_PERMISSIONS_STATUS_SENTENCE,
    },
  ];

  const passedCount = checklist.filter((c) => c.passed).length;

  return {
    providerName: "Lumera Solutions LLP",
    providerType: "WhatsApp Cloud API",
    certificationStatus: "NOT_CERTIFIED",
    techProviderStatus: "TECH_PROVIDER",
    techProviderLabel: META_TECH_PROVIDER_STATEMENT,
    environment: isProduction() ? "production" : "sandbox",
    simulatorsEnabled,
    appReviewStatus: {
      status: "APPROVED",
      checklist,
      passedCount,
      totalCount: checklist.length,
    },
    appReviewManuallyConfirmed: scopesApproved,
    appReviewManualConfirmationNote: scopesApproved
      ? "META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED=true is set. Not auto-detected from Meta's dashboard."
      : "META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED is unset. Not auto-detected from Meta's dashboard.",
    connectedWabasCount: opts.connectedWabasCount,
    totalClinics: opts.totalClinics,
    approvedTemplatesCount: opts.approvedTemplatesCount,
    totalTemplatesCount: opts.totalTemplatesCount,
    totalMessagesSentAndReceived: opts.totalMessagesSentAndReceived,
    webhookUrl: opts.webhookUrl,
    webhookSignatureRequired: isProduction() || !envFlag(META_UNSIGNED_WEBHOOK_FLAG),
    graphOtpConfigured: opts.graphOtpConfigured,
    facebookOAuthConfigured: opts.facebookOAuthConfigured,
    qualityRating: "UNKNOWN — not fetched from Graph (do not treat local GREEN as live)",
    notice:
      `SANDBOX / DEV-ONLY readiness view. Live Meta/Facebook app credentials are optional until provisioned separately. ${WHATSAPP_PERMISSIONS_STATUS_SENTENCE} Do not use this payload for marketing claims.`,
  };
}
