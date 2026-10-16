/**
 * Sample tax documents.
 * One list: the Meta review clinic and Sunrise Family Clinic.
 * A bill is also a sample when it carries the seed GSTIN or the seed UPI id.
 */

export const SEED_CLINIC_GSTIN = "19AABCL8899K1Z5";
export const SEED_CLINIC_UPI = "lumerahealth@icici";

/** Meta review clinic and Sunrise. Demo workspaces use the tenant-demo- prefix below. */
export const DEMO_SAMPLE_TENANT_IDS = ["tenant-lumera-main", "tenant-543feff7"] as const;

/** Visible on the bill, the print/PDF view, and e-receipt text. */
export const SAMPLE_TAX_INVOICE_BANNER = "DEMO / SAMPLE — not a valid tax invoice";

export function isDemoTenant(tenantId: string): boolean {
  const id = String(tenantId || "").trim();
  if ((DEMO_SAMPLE_TENANT_IDS as readonly string[]).includes(id)) return true;
  // Same set as isDemoSeedTenantId: workspaces created for demo logins.
  return id.startsWith("tenant-demo-");
}

export function isSeedGstin(value: string): boolean {
  return String(value || "").trim().toUpperCase() === SEED_CLINIC_GSTIN.toUpperCase();
}

export function isSeedUpi(value: string): boolean {
  return String(value || "").trim().toLowerCase() === SEED_CLINIC_UPI.toLowerCase();
}

export function isSampleTaxInvoice(input: {
  tenantId?: string | null;
  gstin?: string | null;
  upiId?: string | null;
}): boolean {
  return (
    isDemoTenant(String(input.tenantId || "")) ||
    isSeedGstin(String(input.gstin || "")) ||
    isSeedUpi(String(input.upiId || ""))
  );
}

/** Prefix clinic receipt text. The banner does not name the product or a wallet. */
export function sampleTaxInvoiceReceiptText(body: string, sample: boolean): string {
  const text = String(body || "");
  if (!sample) return text;
  if (text.includes(SAMPLE_TAX_INVOICE_BANNER)) return text;
  return `${SAMPLE_TAX_INVOICE_BANNER}\n\n${text}`;
}
