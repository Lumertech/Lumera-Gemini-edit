/**
 * Sample tax documents.
 * One list: the Meta review clinic and Sunrise Family Clinic.
 * A bill is also a sample when it carries the seed GSTIN or the seed UPI id.
 */

export const SEED_CLINIC_GSTIN = "19AABCL8899K1Z5";
/** Previous demo VPAs. Still recognized so stored rows and real-tenant scrubbing keep working. */
export const LEGACY_SEED_CLINIC_UPI = "lumerahealth@icici";
export const PREVIOUS_SEED_CLINIC_UPI = "demo-clinic@upi-sample";
/** Obviously fake. Not a bank VPA and not payable. */
export const SEED_CLINIC_UPI = "demo@upi-sandbox";
/** Shown beside the demo letterhead UPI and in place of a payment QR. */
export const SAMPLE_UPI_DO_NOT_PAY = "Demo, do not pay";

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
  const id = String(value || "").trim().toLowerCase();
  return (
    id === SEED_CLINIC_UPI.toLowerCase() ||
    id === LEGACY_SEED_CLINIC_UPI.toLowerCase() ||
    id === PREVIOUS_SEED_CLINIC_UPI.toLowerCase()
  );
}

/**
 * Demo letterhead mark. A static label, not a payment instrument.
 * Callers render this box instead of a scannable code.
 */
export function demoUpiPlaceholder(): { kind: "placeholder"; label: typeof SAMPLE_UPI_DO_NOT_PAY } {
  return { kind: "placeholder", label: SAMPLE_UPI_DO_NOT_PAY };
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
