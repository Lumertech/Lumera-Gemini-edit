import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "otp1";
const SIX_DIGITS = /^\d{6}$/;

/** Store this value. Callers keep the plaintext only long enough to send it. */
export function hashOtp(otp: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(String(otp || ""), salt, 32);
  return `${PREFIX}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function isHashedOtp(stored: string): boolean {
  return String(stored || "").startsWith(`${PREFIX}:`);
}

/**
 * Constant-time check. Hashed rows use scrypt. Legacy plaintext rows (tests and
 * in-flight codes) compare equal-length buffers. A length mismatch still runs a
 * compare so the function does not return on the first differing byte.
 */
export function otpMatches(stored: string, input: string): boolean {
  const record = String(stored || "");
  const given = String(input || "");
  if (!SIX_DIGITS.test(given)) {
    const filler = Buffer.alloc(32);
    timingSafeEqual(filler, filler);
    return false;
  }
  if (isHashedOtp(record)) {
    const parts = record.split(":");
    const saltHex = parts[1] || "";
    const hashHex = parts[2] || "";
    if (!saltHex || !hashHex || saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return false;
    let derived: Buffer;
    let expected: Buffer;
    try {
      derived = scryptSync(given, Buffer.from(saltHex, "hex"), 32);
      expected = Buffer.from(hashHex, "hex");
    } catch {
      return false;
    }
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
  const left = Buffer.from(record);
  const right = Buffer.from(given);
  if (left.length !== right.length) {
    const filler = Buffer.alloc(Math.max(left.length, 1));
    timingSafeEqual(filler, filler);
    return false;
  }
  return timingSafeEqual(left, right);
}
