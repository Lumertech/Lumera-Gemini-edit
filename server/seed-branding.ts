/**
 * Seed clinic identifiers — never persist or print these on real-tenant invoices.
 * Demo-tenant and seed-id checks live in src/lib/sampleTaxInvoice.ts.
 */
import { isSeedGstin, isSeedUpi } from "../src/lib/sampleTaxInvoice.ts";

export {
  SEED_CLINIC_GSTIN,
  SEED_CLINIC_UPI,
  SAMPLE_TAX_INVOICE_BANNER,
  isDemoTenant,
  isSampleTaxInvoice,
  isSeedGstin,
  isSeedUpi,
  sampleTaxInvoiceReceiptText,
} from "../src/lib/sampleTaxInvoice.ts";

/** Same id as DEMO_TENANT_ID in db.ts — kept local to avoid an import cycle. */
const DEMO_TENANT = "tenant-lumera-main";

/**
 * Seed GSTIN/UPI may remain on the Meta review clinic's stored bill.
 * Sunrise is a sample tax tenant (see isDemoTenant) and still has seed ids scrubbed.
 */
export function isDemoTenantId(tenantId: string): boolean {
  return tenantId === DEMO_TENANT;
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
