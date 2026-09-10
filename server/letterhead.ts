import { DEMO_TENANT_ID, getDb } from "./db.ts";

export interface TenantLetterhead {
  name: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  regId: string;
  upiId: string;
  whatsappNumber: string;
  sealText: string;
  signatureUrl: string;
}

export const DEMO_LETTERHEAD: TenantLetterhead = {
  name: "Lumera Healthcare & Polyclinic Institute",
  tagline: "Precision AI-Powered Multi-Specialty Clinical Center",
  address: "Suite 401-405, Healthcare Towers, 14 Park Circus Avenue",
  city: "Kolkata, West Bengal - 700017",
  phone: "+91 (033) 2289-9000 / +91 98000 12345",
  email: "care@lumeraclinic.in",
  website: "https://lumeraclinic.in",
  gstin: "19AABCL8899K1Z5",
  regId: "WB-CLINIC-REG-2023/8892",
  upiId: "lumerahealth@icici",
  whatsappNumber: "+91 98000 12345",
  sealText: "Authorized Medical Seal & Digital Signature Verified",
  signatureUrl: "",
};

const EMPTY_LETTERHEAD: TenantLetterhead = {
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
  sealText: "",
  signatureUrl: "",
};

const WRITABLE_KEYS = [
  "name",
  "tagline",
  "address",
  "city",
  "phone",
  "email",
  "website",
  "gstin",
  "regId",
  "upiId",
  "whatsappNumber",
  "sealText",
  "signatureUrl",
] as const;

type WritableKey = (typeof WRITABLE_KEYS)[number];

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asLetterhead(row: Record<string, unknown> | undefined, signatureUrl = ""): TenantLetterhead {
  if (!row) {
    return { ...EMPTY_LETTERHEAD, signatureUrl };
  }
  return {
    name: str(row.name),
    tagline: str(row.tagline),
    address: str(row.address),
    city: str(row.city),
    phone: str(row.phone),
    email: str(row.email),
    website: str(row.website),
    gstin: str(row.gstin),
    regId: str(row.reg_id),
    upiId: str(row.upi_id),
    whatsappNumber: str(row.whatsapp_number) || str(row.phone),
    sealText: str(row.seal_text),
    signatureUrl,
  };
}

export function doctorSignatureForUser(userId?: string | null): string {
  if (!userId) return "";
  const row = getDb()
    .prepare("SELECT signature_url FROM doctors WHERE user_id = ?")
    .get(userId) as { signature_url?: string } | undefined;
  return str(row?.signature_url);
}

export function doctorSignatureByDoctorId(doctorId?: string | null): string {
  if (!doctorId) return "";
  const row = getDb()
    .prepare("SELECT signature_url FROM doctors WHERE id = ?")
    .get(doctorId) as { signature_url?: string } | undefined;
  return str(row?.signature_url);
}

export function getTenantLetterhead(tenantId: string, userId?: string | null): TenantLetterhead {
  const row = getDb()
    .prepare("SELECT * FROM tenants WHERE id = ?")
    .get(tenantId) as Record<string, unknown> | undefined;
  const signatureUrl = doctorSignatureForUser(userId);
  const letterhead = asLetterhead(row, signatureUrl);
  if (tenantId === DEMO_TENANT_ID) {
    return {
      ...DEMO_LETTERHEAD,
      ...Object.fromEntries(
        (Object.keys(letterhead) as (keyof TenantLetterhead)[]).map((key) => [
          key,
          letterhead[key] || DEMO_LETTERHEAD[key],
        ])
      ),
      signatureUrl: letterhead.signatureUrl,
    } as TenantLetterhead;
  }
  return letterhead;
}

export function parseLetterheadPatch(body: unknown): Partial<TenantLetterhead> {
  if (!body || typeof body !== "object") return {};
  const raw = body as Record<string, unknown>;
  const nested =
    raw.letterhead && typeof raw.letterhead === "object"
      ? (raw.letterhead as Record<string, unknown>)
      : raw;
  const patch: Partial<TenantLetterhead> = {};
  for (const key of WRITABLE_KEYS) {
    if (nested[key] !== undefined) {
      patch[key] = str(nested[key]);
    }
  }
  return patch;
}

export function updateTenantLetterhead(
  tenantId: string,
  patch: Partial<TenantLetterhead>,
  userId?: string | null
): TenantLetterhead {
  const current = getTenantLetterhead(tenantId, userId);
  const next: TenantLetterhead = { ...current, ...patch };
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE tenants
       SET name = ?,
           tagline = ?,
           address = ?,
           city = ?,
           phone = ?,
           email = ?,
           website = ?,
           gstin = ?,
           reg_id = ?,
           upi_id = ?,
           whatsapp_number = ?,
           seal_text = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.name,
      next.tagline,
      next.address,
      next.city,
      next.phone,
      next.email,
      next.website,
      next.gstin,
      next.regId,
      next.upiId,
      next.whatsappNumber,
      next.sealText,
      now,
      tenantId
    );

  if (userId && next.name) {
    getDb().prepare("UPDATE users SET clinic_name = ? WHERE id = ?").run(next.name, userId);
  }

  if (userId && patch.signatureUrl !== undefined) {
    getDb()
      .prepare("UPDATE doctors SET signature_url = ? WHERE user_id = ?")
      .run(patch.signatureUrl, userId);
  }

  return getTenantLetterhead(tenantId, userId);
}

export function clinicLine(letterhead: TenantLetterhead): { name: string; address: string; phone: string } {
  const address = [letterhead.address, letterhead.city].filter(Boolean).join(", ");
  return {
    name: letterhead.name,
    address,
    phone: letterhead.phone,
  };
}

export function escapeHtml(value: unknown): string {
  return str(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
