import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { envFlag, isProduction, readSecret, sandboxSimulatorsEnabled } from "./runtime.ts";

export const META_UNSIGNED_WEBHOOK_FLAG = "META_WEBHOOK_ALLOW_UNSIGNED";

export function getMetaAppSecret(): string {
  return readSecret("META_APP_SECRET", "WHATSAPP_APP_SECRET");
}

export function getMetaVerifyToken(): string | undefined {
  const fromEnv = readSecret("META_VERIFY_TOKEN");
  if (fromEnv) return fromEnv;
  if (!isProduction()) return "lumera_meta_verify_token_2026_DEV_ONLY";
  return undefined;
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
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!match) return false;

  const expectedHex = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = Buffer.from(match[1], "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export type WebhookSignatureDecision =
  | { ok: true; unsignedDevBypass?: boolean }
  | { ok: false; status: number; error: string };

/**
 * Production always requires a valid X-Hub-Signature-256 (missing secret is a hard fail).
 * Non-prod: unsigned ingest is allowed when META_APP_SECRET is unset (credentials not
 * provisioned yet) or when META_WEBHOOK_ALLOW_UNSIGNED is set.
 */
export function decideWebhookSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader?: string | string[];
  appSecret: string;
  production?: boolean;
  allowUnsignedDevFlag?: boolean;
}): WebhookSignatureDecision {
  const production = opts.production ?? isProduction();
  const allowUnsignedFlag = !production && (opts.allowUnsignedDevFlag ?? envFlag(META_UNSIGNED_WEBHOOK_FLAG));
  const header = Array.isArray(opts.signatureHeader) ? opts.signatureHeader[0] : opts.signatureHeader;
  const secretMissing = !opts.appSecret;

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
      error: "META_APP_SECRET is not configured; webhook signatures cannot be verified.",
    };
  }

  if (!verifyMetaHubSignature(opts.rawBody, header, opts.appSecret)) {
    return { ok: false, status: 403, error: "Invalid or missing X-Hub-Signature-256." };
  }

  return { ok: true };
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
  graphOtpConfigured: boolean;
  webhookSecretConfigured: boolean;
  verifyTokenConfigured: boolean;
  facebookOAuthConfigured: boolean;
}) {
  const simulatorsEnabled = sandboxSimulatorsEnabled();
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
      item: "Data deletion callback endpoint exists (signed_request verification still SANDBOX)",
      passed: false,
      url: opts.dataDeletionUrl || "/data-deletion-instructions",
      note: "Callback scaffold only — not App Review complete.",
    },
    {
      item: "Webhook GET verify token configured",
      passed: opts.verifyTokenConfigured,
      url: opts.webhookUrl,
    },
    {
      item: "Webhook POST X-Hub-Signature-256 (META_APP_SECRET)",
      passed: opts.webhookSecretConfigured,
      url: opts.webhookUrl,
    },
    {
      item: "Graph API credentials for login OTP (token + phone_number_id)",
      passed: opts.graphOtpConfigured,
    },
    {
      item: "Facebook Login server-side token exchange configured",
      passed: opts.facebookOAuthConfigured,
    },
  ];

  const passedCount = checklist.filter((c) => c.passed).length;

  return {
    providerName: "Lumera Health Solutions LLP",
    providerType: "SANDBOX — not a certified Meta Tech Provider",
    certificationStatus: "NOT_CERTIFIED",
    environment: isProduction() ? "production" : "sandbox",
    simulatorsEnabled,
    appReviewStatus: {
      status: "NOT_SUBMITTED",
      checklist,
      passedCount,
      totalCount: checklist.length,
    },
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
      "SANDBOX / DEV-ONLY readiness view. Live Meta/Facebook app credentials are optional until provisioned separately. Lumera is not Meta Tech Provider certified and App Review is NOT_SUBMITTED. Do not use this payload for marketing claims.",
  };
}
