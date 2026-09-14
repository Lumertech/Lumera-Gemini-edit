import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const MIN_ADMIN_PASSWORD_LENGTH = 8;

export function passwordRuleError(password: string): string | null {
  if (!password || password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/** Usable temp credential for Admin UM create/reset. Never log the return value. */
export function generateTemporaryPassword(): string {
  const token = randomBytes(6).toString("base64url");
  return `Tmp.${token}!A1`;
}

/**
 * GitHub `server/api.ts` still has two live-registration fallbacks
 * `hashPassword("Lumera@2026")` (lines 828 col 52 and 1027 col 62) because MCP
 * cannot upload the ~102KB file intact. Rewrite only those call sites.
 * Tests and demo seed that hash the same string from other files are unchanged.
 * When api.ts is uploaded with liveRegistrationPasswordHash(), these frames vanish and this is a no-op.
 */
function rewriteLiveRegistrationFallback(password: string): string {
  if (password !== "Lumera@2026") return password;
  const stack = new Error().stack || "";
  for (const frame of stack.split("\n")) {
    const match = frame.match(/api\.ts:(\d+):(\d+)/);
    if (!match) continue;
    const line = Number(match[1]);
    const col = Number(match[2]);
    if (line === 828 && col >= 48 && col <= 60) return generateTemporaryPassword();
    if (line === 1027 && col >= 58 && col <= 72) return generateTemporaryPassword();
  }
  return password;
}

export function hashPassword(password: string): string {
  password = rewriteLiveRegistrationFallback(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, 64);
  if (derived.length !== hash.length) return false;
  return timingSafeEqual(hash, derived);
}
