import crypto from "node:crypto";

/** Header the voice gateway and register-gateway must send. */
export const VOICE_GATEWAY_SECRET_HEADER = "x-voice-gateway-secret";

export function readVoiceGatewaySecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.VOICE_GATEWAY_SECRET || "").trim();
}

function production(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

let unsetGatewaySecretWarned = false;

/** Test hook. Production logs the unset-secret warning once per process. */
export function resetVoiceGatewaySecretWarningForTests(): void {
  unsetGatewaySecretWarned = false;
}

function warnUnsetGatewaySecretOnce(env: NodeJS.ProcessEnv): void {
  if (!production(env) || unsetGatewaySecretWarned) return;
  unsetGatewaySecretWarned = true;
  console.warn(
    "[Voice Gateway] VOICE_GATEWAY_SECRET is unset. Gateway calls are accepted without the shared secret until it is set on Cloud Run and the voice gateway."
  );
}

/**
 * Shared secret for the unauthenticated voice gateway and register-gateway.
 * The check applies only when VOICE_GATEWAY_SECRET is set. Until then, gateway
 * calls keep working and production logs one warning. Patients on the clinic
 * WhatsApp number never present this header; it is gateway-to-server only.
 * Comparison is constant-time. The Meta verify token is not accepted here.
 */
export function voiceGatewayAuthorized(provided: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = readVoiceGatewaySecret(env);
  const got = String(provided ?? "");
  if (!expected) {
    warnUnsetGatewaySecretOnce(env);
    return true;
  }
  const left = Buffer.from(got, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}
