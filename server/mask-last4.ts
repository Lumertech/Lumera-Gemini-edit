/**
 * Audit mask shared with Aadhaar rows.
 * Accepts either the last four characters or a longer identifier.
 */
export function maskedLast4(value: string): string {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const last4 = (digits.length >= 4 ? digits : raw).slice(-4);
  return `XXXX-XXXX-${last4}`;
}
