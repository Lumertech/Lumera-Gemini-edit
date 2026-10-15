import crypto from "node:crypto";
import { isProduction } from "./runtime.ts";

/** AES-256-GCM ciphertext prefix. Plaintext rows do not start with this. */
export const WA_SECRET_PREFIX = "waenc1:";

const warned = new Set<string>();

export function warnWaTokenKeyOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * 32-byte key from WA_TOKEN_KEY (base64 or 64 hex chars).
 * Empty → null. A non-empty value that is not 32 bytes throws.
 */
export function waTokenKeyBytes(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = String(env.WA_TOKEN_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("WA_TOKEN_KEY must be 32 bytes, encoded as base64 or 64 hex characters.");
}

export function isEncryptedWaSecret(value: string): boolean {
  return String(value || "").startsWith(WA_SECRET_PREFIX);
}

export function encryptWaSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const plain = String(plaintext ?? "");
  if (!plain || isEncryptedWaSecret(plain)) return plain;
  const key = waTokenKeyBytes(env);
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${WA_SECRET_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptWaSecret(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = String(stored ?? "");
  if (!value) return "";
  if (!isEncryptedWaSecret(value)) return value;
  const key = waTokenKeyBytes(env);
  if (!key) {
    if (isProduction()) {
      throw new Error("WA_TOKEN_KEY is required in production to read WhatsApp tokens.");
    }
    return "";
  }
  const body = value.slice(WA_SECRET_PREFIX.length);
  const [ivPart, tagPart, dataPart] = body.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("WhatsApp token ciphertext is corrupt.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
  return plain.toString("utf8");
}

export function sealWaSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const plain = String(plaintext ?? "");
  if (!plain) return "";
  const key = waTokenKeyBytes(env);
  if (!key) {
    if (isProduction() && plain) {
      throw new Error("WA_TOKEN_KEY is required in production once WhatsApp number tokens are stored.");
    }
    return plain;
  }
  return encryptWaSecret(plain, env);
}
