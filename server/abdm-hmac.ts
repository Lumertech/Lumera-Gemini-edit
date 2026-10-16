/**
 * HMAC hook for ABDM gateway callbacks (#39).
 * Stub mode outside production accepts unsigned callbacks (matched false).
 * Any other mode requires ABDM_CALLBACK_SECRET and a matching signature.
 * A missing secret refuses that callback and logs. It does not exit the process,
 * so the current www deploy (stub, NODE_ENV=production) keeps listening.
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

const CALLBACK_LISTENING_CONTINUES = "Listening continues.";

function logCallbackRefused(reason: string): void {
  console.error(`[ABDM] Refusing callback: ${reason} ${CALLBACK_LISTENING_CONTINUES}`);
}

/**
 * HMAC hook is wired.
 * Stub mode outside production is sandbox-tolerant when the secret or signature
 * is missing (accept unsigned, matched false).
 * Stub mode in production fails closed: unsigned callbacks are refused.
 * Whenever mode is not stub, ABDM_CALLBACK_SECRET is required even if NODE_ENV
 * is not production. A missing or placeholder secret refuses the callback.
 * This function never throws and never exits, so boot of the www deploy is unchanged.
 * sandbox mode with a real secret requires a matching X-ABDM-Signature.
 */
export function decideAbdmCallbackSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader?: string | string[];
  secret?: string;
  mode?: AbdmMode;
  /** Defaults to NODE_ENV=production. Tests pass this explicitly. Non-stub mode ignores this for the secret requirement. */
  production?: boolean;
}): AbdmCallbackAuth {
  const mode = opts.mode ?? resolveAbdmMode();
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const secret = String(opts.secret ?? process.env.ABDM_CALLBACK_SECRET ?? "").trim();
  const usableSecret = secret && !isPlaceholderAbdmSecret(secret) ? secret : "";
  const header = Array.isArray(opts.signatureHeader) ? opts.signatureHeader[0] : opts.signatureHeader;

  if (!usableSecret) {
    if (mode !== "stub" || production) {
      logCallbackRefused(
        mode !== "stub"
          ? "ABDM_CALLBACK_SECRET is required when ABDM_MODE is not stub."
          : "ABDM_CALLBACK_SECRET is not configured."
      );
      return { ok: false, status: 401, error: "ABDM callback secret is not configured" };
    }
    return { ok: true, matched: false, sandboxTolerant: true };
  }

  if (!header) {
    if (mode === "stub" && !production) {
      return { ok: true, matched: false, sandboxTolerant: true };
    }
    if (mode === "stub" && production) {
      logCallbackRefused("stub mode fails closed in production without X-ABDM-Signature.");
    }
    return { ok: false, status: 401, error: "Missing X-ABDM-Signature" };
  }

  if (!verifyAbdmCallbackHmac(opts.rawBody, header, usableSecret)) {
    return { ok: false, status: 401, error: "Invalid X-ABDM-Signature" };
  }
  return { ok: true, matched: true };
}
