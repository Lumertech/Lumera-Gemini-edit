/**
 * Meta / Facebook signed_request parser for the Data Deletion Request callback.
 *
 * Spec (App Dashboard → Data Deletion Request Callback):
 * POST signed_request = "{base64url_sig}.{base64url_payload}"
 * HMAC-SHA256(payload_encoded, META_APP_SECRET) compared to decoded signature.
 * Payload algorithm must be HMAC-SHA256; user_id is the app-scoped Facebook id.
 *
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import { findDataDeletionRequest, getDb, insertDataDeletionRequest } from "./db.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { getMetaAppSecret } from "./meta-security.ts";
import { appPublicUrl, isProduction } from "./runtime.ts";

export type SignedRequestPayload = {
  algorithm?: string;
  expires?: number;
  issued_at?: number;
  user_id?: string;
  [key: string]: unknown;
};

export type SignedRequestDecision =
  | { ok: true; payload?: SignedRequestPayload; userId?: string; unsignedDevBypass?: boolean }
  | { ok: false; status: number; error: string };

function base64UrlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function parseMetaSignedRequest(
  signedRequest: string,
  appSecret: string
): { ok: true; payload: SignedRequestPayload } | { ok: false; error: string } {
  const raw = String(signedRequest || "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) {
    return { ok: false, error: "signed_request must be signature.payload (base64url)." };
  }
  const encodedSig = raw.slice(0, dot);
  const encodedPayload = raw.slice(dot + 1);

  let payload: SignedRequestPayload;
  try {
    payload = JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8")) as SignedRequestPayload;
  } catch {
    return { ok: false, error: "signed_request payload is not valid JSON." };
  }

  const algorithm = String(payload.algorithm || "").toUpperCase().replace(/_/g, "-");
  if (algorithm && algorithm !== "HMAC-SHA256") {
    return { ok: false, error: "signed_request algorithm must be HMAC-SHA256." };
  }

  let provided: Buffer;
  try {
    provided = base64UrlToBuffer(encodedSig);
  } catch {
    return { ok: false, error: "signed_request signature is not valid base64url." };
  }
  const expected = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, error: "signed_request HMAC-SHA256 verification failed." };
  }

  return { ok: true, payload };
}

export function signMetaSignedRequest(payload: SignedRequestPayload, appSecret: string): string {
  const json = JSON.stringify({ algorithm: "HMAC-SHA256", ...payload });
  const encodedPayload = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest("base64url");
  return `${sig}.${encodedPayload}`;
}

/**
 * Production: valid signed_request is required (missing secret is a hard fail).
 * Non-prod without META_APP_SECRET: SANDBOX unsigned body.user_id is allowed
 * (same posture as webhook ingest before credentials are provisioned).
 * When the secret IS configured, verification always runs.
 */
export function decideDataDeletionSignedRequest(opts: {
  signedRequest?: unknown;
  appSecret?: string;
  production?: boolean;
}): SignedRequestDecision {
  const production = opts.production ?? isProduction();
  const secret = String(opts.appSecret ?? getMetaAppSecret() ?? "").trim();
  const signed = typeof opts.signedRequest === "string" ? opts.signedRequest.trim() : "";

  if (!secret) {
    if (production) {
      return {
        ok: false,
        status: 500,
        error: "META_APP_SECRET is not configured; signed_request cannot be verified.",
      };
    }
    return { ok: true, unsignedDevBypass: true };
  }

  if (!signed) {
    return { ok: false, status: 403, error: "signed_request is required." };
  }

  const parsed = parseMetaSignedRequest(signed, secret);
  if (parsed.ok === false) {
    return { ok: false, status: 403, error: parsed.error };
  }

  const userId = parsed.payload.user_id ? String(parsed.payload.user_id) : undefined;
  return { ok: true, payload: parsed.payload, userId };
}

export function dataDeletionSignedRequestVerificationConfigured(): boolean {
  return Boolean(getMetaAppSecret());
}

/** POST /api/meta/data-deletion — HMAC-SHA256 signed_request when META_APP_SECRET is set. */
export function handleMetaDataDeletionPost(req: Request, res: Response) {
  const signedDecision = decideDataDeletionSignedRequest({
    signedRequest: req.body?.signed_request,
    appSecret: getMetaAppSecret(),
  });
  if (signedDecision.ok === false) {
    return res.status(signedDecision.status).json({ error: signedDecision.error });
  }
  const host = req.get("host") || undefined;
  const proto = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : req.protocol;
  const origin = appPublicUrl(host, proto);
  const code = `DEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const userIdOrPhone = String(
    signedDecision.userId || req.body?.user_id || req.body?.phone || req.body?.id || "meta_user_session"
  );

  try {
    const db = getDb();
    insertDataDeletionRequest(db, code, userIdOrPhone);
    const now = new Date().toISOString();
    try {
      db.prepare(`
          INSERT INTO audit_logs (id, user_id, user_name, action, details, timestamp)
          VALUES (?, ?, ?, 'Meta Data Deletion Request', ?, ?)
        `).run(
        `audit-${Date.now()}`,
        "system-meta-compliance",
        "Meta Compliance Agent",
        `Data erasure request code ${code} initialized for ${userIdOrPhone}`,
        now
      );
    } catch (err) {
      reportCaughtError(err, "meta.data-deletion.audit");
    }

    return res.status(200).json({
      url: `${origin}/data-deletion-instructions?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    });
  } catch (err) {
    console.error("[Meta Data Deletion Callback Error]", err);
    try {
      insertDataDeletionRequest(getDb(), code, userIdOrPhone);
    } catch (err) {
      reportCaughtError(err, "meta.data-deletion.persist-fallback");
    }
    return res.status(200).json({
      url: `${origin}/data-deletion-instructions?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    });
  }
}
