import { type SqlDatabase } from "./sql-engine.ts";
import { ensurePlatformTenantSchema } from "./platform-tenants.ts";

const DEMO_LETTERHEAD_SEED = {
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
  footerDisclaimer:
    "This prescription is digitally verified under National Health Authority (NHA) & Telemedicine Practice Guidelines. Please report any adverse drug reactions immediately.",
};

const DEMO_TENANT_ID = "tenant-lumera-main";

export function ensureDemoTenantLetterhead(database: SqlDatabase) {
  const row = database
    .prepare("SELECT id, gstin FROM tenants WHERE id = ?")
    .get(DEMO_TENANT_ID) as { id: string; gstin?: string } | undefined;
  if (!row) return;
  const fill = (column: string, value: string) => {
    try {
      database
        .prepare(`UPDATE tenants SET ${column} = ? WHERE id = ? AND (${column} IS NULL OR ${column} = '')`)
        .run(value, DEMO_TENANT_ID);
    } catch {
      /* column added in the same migrate() pass */
    }
  };
  fill("tagline", DEMO_LETTERHEAD_SEED.tagline);
  fill("address", DEMO_LETTERHEAD_SEED.address);
  fill("city", DEMO_LETTERHEAD_SEED.city);
  fill("phone", DEMO_LETTERHEAD_SEED.phone);
  fill("email", DEMO_LETTERHEAD_SEED.email);
  fill("website", DEMO_LETTERHEAD_SEED.website);
  fill("gstin", DEMO_LETTERHEAD_SEED.gstin);
  fill("reg_id", DEMO_LETTERHEAD_SEED.regId);
  fill("upi_id", DEMO_LETTERHEAD_SEED.upiId);
  fill("whatsapp_number", DEMO_LETTERHEAD_SEED.whatsappNumber);
  fill("seal_text", DEMO_LETTERHEAD_SEED.sealText);
  fill("footer_disclaimer", DEMO_LETTERHEAD_SEED.footerDisclaimer);
  if (!row.gstin) {
    fill("name", DEMO_LETTERHEAD_SEED.name);
  }
}
