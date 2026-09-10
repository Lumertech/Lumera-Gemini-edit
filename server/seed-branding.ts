/** Seed Lumera identifiers — never persist or print these on real-tenant invoices. */
export const SEED_CLINIC_GSTIN = "19AABCL8899K1Z5";
export const SEED_CLINIC_UPI = "lumerahealth@icici";

/** Same id as DEMO_TENANT_ID in db.ts — kept local to avoid an import cycle. */
const DEMO_TENANT = "tenant-lumera-main";

export function isDemoTenantId(tenantId: string): boolean {
  return tenantId === DEMO_TENANT;
}

export function isSeedGstin(value: string): boolean {
  return value.trim().toUpperCase() === SEED_CLINIC_GSTIN.toUpperCase();
}

export function isSeedUpi(value: string): boolean {
  return value.trim().toLowerCase() === SEED_CLINIC_UPI.toLowerCase();
}

/** Real tenants: empty or their own letterhead. Demo may keep seed branding. */
export function scrubSeedBillingIds(
  tenantId: string,
  ids: { gstin: string; upiId: string }
): { gstin: string; upiId: string } {
  const gstin = String(ids.gstin || "").trim();
  const upiId = String(ids.upiId || "").trim();
  if (isDemoTenantId(tenantId)) return { gstin, upiId };
  return {
    gstin: isSeedGstin(gstin) ? "" : gstin,
    upiId: isSeedUpi(upiId) ? "" : upiId,
  };
}
