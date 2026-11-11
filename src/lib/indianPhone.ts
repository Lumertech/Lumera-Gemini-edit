/**
 * Indian mobile and landline numbers for clinic transfer lines.
 * Accepts spaces and hyphens. Country code +91, a leading 91, or a trunk 0.
 */

function compactIndianPhone(value: string): string {
  return String(value || "").trim().replace(/[\s()-]/g, "");
}

export function isIndianPhoneNumber(value: string): boolean {
  const compact = compactIndianPhone(value);
  if (!/^\+?\d+$/.test(compact)) return false;
  const digits = compact.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return true;
  if (digits.length === 11 && /^0[1-9]\d{9}$/.test(digits)) return true;
  if (digits.length === 12 && digits.startsWith("91")) {
    const national = digits.slice(2);
    return /^[1-9]\d{9}$/.test(national);
  }
  return false;
}

/** Display form. Mobiles become "+91 98765 43210". Other valid numbers keep a +91 prefix. */
export function formatIndianPhoneDisplay(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (national.length === 10 && /^[6-9]/.test(national)) {
    return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  if (digits.startsWith("91") && digits.length >= 11) return `+${digits}`;
  if (raw.startsWith("+")) return raw;
  return raw;
}
