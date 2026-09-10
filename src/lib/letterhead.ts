import { apiFetch } from "../api/http";
import { ClinicSettings, Doctor, TenantLetterhead } from "../types";

/** Seed GSTIN/UPI that must never appear on real-tenant Rx or invoices. */
export const SEED_CLINIC_GSTIN = "19AABCL8899K1Z5";
export const SEED_CLINIC_UPI = "lumerahealth@icici";

/** UI chrome only — not Lumera legal/branding identifiers. */
const LETTERHEAD_CHROME = {
  headerBgColor: "#0f172a",
  accentColor: "#0d9488",
  showLogo: true,
  showQrCode: true,
} as const;

/**
 * Blank letterhead for real tenants. Name/phone/email may be filled from
 * the session; GSTIN, UPI, address, and clinic reg stay empty until
 * `/api/tenant/letterhead` (or settings) supplies them.
 */
export const BLANK_CLINIC_SETTINGS: ClinicSettings = {
  name: "",
  tagline: "",
  address: "",
  city: "",
  phone: "",
  email: "",
  website: "",
  gstin: "",
  regId: "",
  upiId: "",
  whatsappNumber: "",
  ...LETTERHEAD_CHROME,
  sealText: "",
  footerDisclaimer: "",
  signatureUrl: "",
};

export function emptyTenantLetterhead(): TenantLetterhead {
  return {
    clinicName: "",
    address: "",
    city: "",
    phone: "",
    email: "",
    website: "",
    gstin: "",
    regId: "",
    whatsappNumber: "",
    upiId: "",
    sealText: "",
    signatureUrl: "",
    tagline: "",
    footerDisclaimer: "",
  };
}

export function normalizeLetterhead(
  raw: Partial<TenantLetterhead> | null | undefined
): TenantLetterhead {
  const blank = emptyTenantLetterhead();
  if (!raw) return blank;
  return {
    clinicName: raw.clinicName ?? blank.clinicName,
    address: raw.address ?? blank.address,
    city: raw.city ?? blank.city,
    phone: raw.phone ?? blank.phone,
    email: raw.email ?? blank.email,
    website: raw.website ?? blank.website,
    gstin: raw.gstin ?? blank.gstin,
    regId: raw.regId ?? blank.regId,
    whatsappNumber: raw.whatsappNumber ?? blank.whatsappNumber,
    upiId: raw.upiId ?? blank.upiId,
    sealText: raw.sealText ?? blank.sealText,
    signatureUrl: raw.signatureUrl ?? blank.signatureUrl,
    tagline: raw.tagline ?? blank.tagline,
    footerDisclaimer: raw.footerDisclaimer ?? blank.footerDisclaimer,
  };
}

export function clinicSettingsToLetterhead(settings: ClinicSettings): TenantLetterhead {
  return {
    clinicName: settings.name,
    address: settings.address,
    city: settings.city,
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    gstin: settings.gstin,
    regId: settings.regId,
    whatsappNumber: settings.whatsappNumber,
    upiId: settings.upiId,
    sealText: settings.sealText,
    signatureUrl: settings.signatureUrl || "",
    tagline: settings.tagline,
    footerDisclaimer: settings.footerDisclaimer,
  };
}

/**
 * Map Platform `letterhead` → `ClinicSettings` for PrescriptionWriter / BillingManager.
 * `clinicName` → `name`. Unspecified letterhead keys keep `base` values.
 */
export function clinicSettingsFromLetterhead(
  letterhead: Partial<TenantLetterhead> | null | undefined,
  base: ClinicSettings = BLANK_CLINIC_SETTINGS
): ClinicSettings {
  if (!letterhead) return base;
  return {
    ...base,
    name: letterhead.clinicName !== undefined ? letterhead.clinicName : base.name,
    address: letterhead.address !== undefined ? letterhead.address : base.address,
    city: letterhead.city !== undefined ? letterhead.city : base.city,
    phone: letterhead.phone !== undefined ? letterhead.phone : base.phone,
    email: letterhead.email !== undefined ? letterhead.email : base.email,
    website: letterhead.website !== undefined ? letterhead.website : base.website,
    gstin: letterhead.gstin !== undefined ? letterhead.gstin : base.gstin,
    regId: letterhead.regId !== undefined ? letterhead.regId : base.regId,
    whatsappNumber: letterhead.whatsappNumber !== undefined ? letterhead.whatsappNumber : base.whatsappNumber,
    upiId: letterhead.upiId !== undefined ? letterhead.upiId : base.upiId,
    sealText: letterhead.sealText !== undefined ? letterhead.sealText : base.sealText,
    tagline: letterhead.tagline !== undefined ? letterhead.tagline : base.tagline,
    footerDisclaimer:
      letterhead.footerDisclaimer !== undefined ? letterhead.footerDisclaimer : base.footerDisclaimer,
    signatureUrl:
      letterhead.signatureUrl !== undefined ? letterhead.signatureUrl : base.signatureUrl,
  };
}

export function letterheadFromSessionHints(
  clinicName?: string,
  doctor?: Pick<Doctor, "phone" | "email" | "signatureUrl"> | null
): Partial<TenantLetterhead> {
  return {
    clinicName: (clinicName || "").trim(),
    phone: doctor?.phone || "",
    email: doctor?.email || "",
    signatureUrl: doctor?.signatureUrl || "",
    sealText: doctor?.signatureUrl ? "Digitally signed by treating clinician" : "",
  };
}

export async function fetchTenantLetterhead(): Promise<TenantLetterhead | null> {
  try {
    const res = await apiFetch<{ letterhead?: TenantLetterhead }>("/api/tenant/letterhead");
    return res.letterhead ? normalizeLetterhead(res.letterhead) : null;
  } catch {
    // Missing/unauthenticated GET must not block the clinician workspace.
    return null;
  }
}

export async function patchTenantLetterhead(
  partial: Partial<TenantLetterhead>
): Promise<TenantLetterhead> {
  const res = await apiFetch<{ letterhead?: TenantLetterhead }>("/api/tenant/letterhead", {
    method: "PATCH",
    body: JSON.stringify(partial),
  });
  return normalizeLetterhead(res.letterhead || partial);
}

export function usesSeedLetterheadIdentifiers(settings: ClinicSettings): boolean {
  return settings.gstin === SEED_CLINIC_GSTIN || settings.upiId === SEED_CLINIC_UPI;
}
