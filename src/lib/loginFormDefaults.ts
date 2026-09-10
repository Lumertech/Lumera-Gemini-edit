/** Hint copy only — never used as a controlled `value` on the public login/signup form. */
export const LOGIN_EMAIL_PLACEHOLDER = "doctor@lumera.me";
export const LOGIN_PASSWORD_PLACEHOLDER = "••••••••";
export const LOGIN_WHATSAPP_PLACEHOLDER = "+91 98234 55667";
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
