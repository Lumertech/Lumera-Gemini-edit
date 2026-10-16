/**
 * HMAC hook for ABDM gateway callbacks (#39).
 * Stub-grade: sandbox-tolerant when ABDM_CALLBACK_SECRET is unset.
 * Real protocol mapping is owned by Lumera ABDM.
 * NHA sandbox only.
 */

import crypto from "node:crypto";
import { isPlaceholderAbdmSecret, resolveAbdmMode, type AbdmMode } from "./abdm-mode.ts";

export const ABDM_SIGNATURE_HEADER = "x-abdm-signature";

export function signAbdmCallback(secret: string, rawBody: Buffer | string): string {
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

export function verifyAbdmCallbackHmac(
  rawBody: Buffer | string,
  signatureHeader: string | string[] | undefined,
  secret: string
): boolean {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || !secret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(match[1], "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export type AbdmCallbackAuth =
  | { ok: true; matched: boolean; sandboxTolerant?: boolean }
  | { ok: false; status: number; error: string };

/**
 * HMAC hook is wired. Outside production, a missing or placeholder secret is
 * sandbox-tolerant (accept unsigned, matched false). Production fails closed.
 * sandbox mode with a real secret requires a matching X-ABDM-Signature.
 */
export function decideAbdmCallbackSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader?: string | string[];
  secret?: string;
  mode?: AbdmMode;
  /** Defaults to NODE_ENV=production. Tests pass this explicitly. */
  production?: boolean;
}): AbdmCallbackAuth {
  const mode = opts.mode ?? resolveAbdmMode();
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const secret = String(opts.secret ?? process.env.ABDM_CALLBACK_SECRET ?? "").trim();
  const usableSecret = secret && !isPlaceholderAbdmSecret(secret) ? secret : "";
  const header = Array.isArray(opts.signatureHeader) ? opts.signatureHeader[0] : opts.signatureHeader;

  if (!usableSecret) {
    if (production) {
      return { ok: false, status: 401, error: "ABDM callback secret is not configured" };
    }
    return { ok: true, matched: false, sandboxTolerant: true };
  }

  if (!header) {
    if (mode === "stub") {
      return { ok: true, matched: false, sandboxTolerant: true };
    }
    return { ok: false, status: 401, error: "Missing X-ABDM-Signature" };
  }

  if (!verifyAbdmCallbackHmac(opts.rawBody, header, usableSecret)) {
    return { ok: false, status: 401, error: "Invalid X-ABDM-Signature" };
  }
  return { ok: true, matched: true };
}
