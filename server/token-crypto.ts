import crypto from "node:crypto";
import { getJwtSecret } from "./auth.ts";
import { readSecret } from "./runtime.ts";

const PREFIX = "v1";

function encryptionKey(): Buffer {
  const dedicated = readSecret("TOKEN_ENCRYPTION_KEY", "GOOGLE_CALENDAR_TOKEN_KEY");
  const material = dedicated || getJwtSecret();
  return crypto.createHash("sha256").update(material, "utf8").digest();
}

/** AES-256-GCM. Stored as `v1:<iv_b64>:<tag_b64>:<cipher_b64>`. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const raw = String(stored || "");
  if (!raw) return "";
  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Encrypted token is not a recognized v1 payload.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function looksEncryptedSecret(stored: string): boolean {
  const parts = String(stored || "").split(":");
  return parts.length === 4 && parts[0] === PREFIX;
}
