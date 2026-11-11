import crypto from "node:crypto";

/** Header the voice gateway and register-gateway must send. */
export const VOICE_GATEWAY_SECRET_HEADER = "x-voice-gateway-secret";

export function readVoiceGatewaySecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.VOICE_GATEWAY_SECRET || "").trim();
}

function production(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Shared secret for the unauthenticated voice gateway and register-gateway.
 * Production fails closed when VOICE_GATEWAY_SECRET is unset.
 * Non-production allows the call only while the secret is unset, so local tests
 * keep working. Once it is set, every environment must present the same value.
 * Comparison is constant-time. The Meta verify token is not accepted here.
 */
export function voiceGatewayAuthorized(provided: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = readVoiceGatewaySecret(env);
  const got = String(provided ?? "");
  if (!expected) return !production(env);
  const left = Buffer.from(got, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}
