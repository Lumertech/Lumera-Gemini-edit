import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./password.ts";
import { DOCTOR_SEED } from "./db-seed-sql.ts";

/** Clinical/WhatsApp demo seed extracted from db.ts for MCP-sized uploads.
 *  Schema/migrations stay in db.ts. DEMO_TENANT_ID matches db.ts export.
 */
export const CLINICAL_SEED_TENANT_ID = "tenant-lumera-main";

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

export function ensureDemoTenantLetterhead(database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, gstin FROM tenants WHERE id = ?")
    .get(CLINICAL_SEED_TENANT_ID) as { id: string; gstin?: string } | undefined;
  if (!row) return;
  const fill = (column: string, value: string) => {
    try {
      database
        .prepare(`UPDATE tenants SET ${column} = ? WHERE id = ? AND (${column} IS NULL OR ${column} = '')`)
        .run(value, CLINICAL_SEED_TENANT_ID);
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

export function seedClinicalAndWhatsAppIfMissing(database: DatabaseSync) {
  const now = new Date().toISOString();
  const tenantCount = database.prepare("SELECT COUNT(*) AS c FROM tenants").get() as { c: number };
  if (tenantCount.c === 0) {
    const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare(`\n      INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)\n    `).run("tenant-lumera-main", "Lumera Apex PolyClinic", "General Medicine", "India", "IST (UTC+5:30)", "+91 98234 55667", trialEnds, 500, 0, "HFR-IN-8829104", now, now);
  }
  ensureDemoTenantLetterhead(database);
}
