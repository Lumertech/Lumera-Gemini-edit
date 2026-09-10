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

export function hashPassword(password: string): string {
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
