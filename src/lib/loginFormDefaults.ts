/** Hint copy only — never used as a controlled `value` on the public login/signup form. */
export const LOGIN_EMAIL_PLACEHOLDER = "Work email";
export const LOGIN_PASSWORD_PLACEHOLDER = "Password";
export const LOGIN_WHATSAPP_PLACEHOLDER = "WhatsApp number";
export const REGISTER_EMAIL_PLACEHOLDER = "doctor@clinic.com";
export const REGISTER_PASSWORD_PLACEHOLDER = "Minimum 6 characters";

const SEEDED_DEMO_EMAILS = new Set([
  "doctor@lumera.me",
  "admin@lumera.me",
  "rdp9999973271@gmail.com",
]);

const SEEDED_DEMO_PASSWORDS = new Set(["Lumera@2026"]);
const SEEDED_DEMO_PHONES = new Set(["+91 98234 55667", "+919823455667"]);

export type PublicLoginFields = {
  email: string;
  password: string;
  whatsappPhone: string;
  adminPassword: string;
  oauthEmail: string;
  oauthName: string;
};

/** Public login/signup inputs start empty so placeholders fade on type and autofill can write. */
export function emptyPublicLoginFields(): PublicLoginFields {
  return {
    email: "",
    password: "",
    whatsappPhone: "",
    adminPassword: "",
    oauthEmail: "",
    oauthName: "",
  };
}

export function isSeededDemoEmail(value: string): boolean {
  return SEEDED_DEMO_EMAILS.has(value.trim().toLowerCase());
}

export function isSeededDemoPassword(value: string): boolean {
  return SEEDED_DEMO_PASSWORDS.has(value);
}

export function isSeededDemoPhone(value: string): boolean {
  return SEEDED_DEMO_PHONES.has(value.trim());
}

/**
 * Drop values we used to seed the public form. Call only for our own initial
 * state — not after the user or the browser password manager has written.
 */
export function stripSeededPublicLoginValue(
  kind: "email" | "password" | "phone",
  value: string
): string {
  if (kind === "email" && isSeededDemoEmail(value)) return "";
  if (kind === "password" && isSeededDemoPassword(value)) return "";
  if (kind === "phone" && isSeededDemoPhone(value)) return "";
  return value;
}

/** WhatsApp / tel fields: digits only, optional leading `+`. Letters never persist. */
export function sanitizePhoneDigits(raw: string): string {
  const trimmed = raw.trimStart();
  const leadingPlus = trimmed.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return leadingPlus ? "+" : "";
  return leadingPlus ? `+${digits}` : digits;
}

/**
 * National (local) digits for an inline country-code + number row.
 * Strips a pasted international prefix when it matches `countryCode`.
 */
export function sanitizeNationalPhoneDigits(raw: string, countryCode = ""): string {
  let digits = raw.replace(/\D/g, "");
  const codeDigits = countryCode.replace(/\D/g, "");
  if (codeDigits && digits.startsWith(codeDigits) && digits.length >= codeDigits.length + 8) {
    digits = digits.slice(codeDigits.length);
  }
  return digits;
}

/** Compose E.164-ish WhatsApp number from an adjacent country code + national digits. */
export function composeWhatsAppNumber(countryCode: string, national: string): string {
  const trimmedNational = national.trim();
  if (trimmedNational.startsWith("+")) return sanitizePhoneDigits(trimmedNational);
  const n = trimmedNational.replace(/\D/g, "");
  if (!n) return "";
  const code = countryCode.trim();
  const codeDigits = code.replace(/\D/g, "");
  if (codeDigits && n.startsWith(codeDigits) && n.length > codeDigits.length + 6) {
    return `+${n}`;
  }
  const prefix = code.startsWith("+") ? code : codeDigits ? `+${codeDigits}` : "";
  return `${prefix}${n}`;
}

export const REMEMBER_EMAIL_KEY = "lumera.rememberEmail";

export function readRememberedLoginEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = (window.localStorage.getItem(REMEMBER_EMAIL_KEY) || "").trim();
    if (!raw || isSeededDemoEmail(raw)) {
      if (raw) window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      return "";
    }
    return raw;
  } catch {
    return "";
  }
}

/** Persist work email only when the user opts in. Never store demo seeds or passwords. */
export function persistRememberedLoginEmail(email: string, remember: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const next = email.trim().toLowerCase();
    if (!remember || !next || isSeededDemoEmail(next)) {
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      return;
    }
    window.localStorage.setItem(REMEMBER_EMAIL_KEY, next);
  } catch {
    /* private mode / quota */
  }
}
