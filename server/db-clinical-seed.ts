import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./password.ts";
import { DOCTOR_SEED } from "./db-seed-sql.ts";
import { seedClinicalRowsIfMissing } from "./db-clinical-rows.ts";
import { seedWhatsAppRowsIfMissing } from "./db-clinical-wa.ts";

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

  // Seed default tenant if tenants table is empty
  const tenantCount = database.prepare("SELECT COUNT(*) AS c FROM tenants").get() as { c: number };
  if (tenantCount.c === 0) {
    const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare(`
      INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      "tenant-lumera-main",
      "Lumera Apex PolyClinic",
      "General Medicine",
      "India",
      "IST (UTC+5:30)",
      "+91 98234 55667",
      trialEnds,
      500,
      0,
      "HFR-IN-8829104",
      now,
      now
    );

    database.prepare(`
      INSERT INTO dhis_transactions (id, tenant_id, claims_count, claims_threshold, month_year, status, created_at, updated_at)
      VALUES (?, 'tenant-lumera-main', 0, 100, ?, 'active', ?, ?)
    `).run(
      "dhis-lumera-main",
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      now,
      now
    );

    try {
      database.exec("UPDATE users SET tenant_id = 'tenant-lumera-main' WHERE tenant_id IS NULL OR tenant_id = ''");
      database.exec("UPDATE users SET hpr_id = 'HPR-IN-9024819' WHERE role IN ('doctor', 'polyclinic_admin', 'CLINIC_ADMIN') AND (hpr_id IS NULL OR hpr_id = '')");
    } catch {}
  }

  ensureDemoTenantLetterhead(database);

  // Keep the shared demo roster on the demo tenant even after test-doctor logins are created.
  try {
    database.exec(`
      UPDATE users
      SET tenant_id = '${CLINICAL_SEED_TENANT_ID}',
          onboarding_completed = 1
      WHERE id IN ('user-admin', 'user-doctor', 'user-patient', 'user-reception', 'user-receptionist', 'user-clinic-admin')
         OR id LIKE 'test-user-%'
    `);
    // Legacy per-doctor test logins stay on the shared multi-specialty tenant.
    // Persona @lumera.me demos keep practice_type from ensureDemoPersonaUsers.
    database.exec(`
      UPDATE users
      SET practice_type = 'polyclinic'
      WHERE id LIKE 'test-user-%'
    `);
  } catch {}

  // SECURITY: this block creates a "Test {DoctorName}" login for every seeded
  // doctor, using one shared, hardcoded password, and repoints each real
  // doctor row's user_id at that test account. That is safe only on a local
  // dev database -- in any real deployment it would let anyone who has read
  // this public source code log in as any doctor, and it re-applies on every
  // server restart, silently overwriting whatever real credentials were set.
  // It must never run when NODE_ENV=production.
  if (process.env.NODE_ENV !== "production") {
    const testUserPasswordHash = hashPassword("Lumera@2026");
    for (const d of DOCTOR_SEED) {
      const testUserId = `test-user-${d.id}`;
      const testName = d.name.startsWith("Test ") ? d.name : `Test ${d.name}`;
      const testEmail = d.email.includes("test") ? d.email : d.email.replace("@", ".test@");

      const existingUser = database.prepare("SELECT id FROM users WHERE email = ? OR id = ?").get(testEmail, testUserId) as { id: string } | undefined;
      if (!existingUser) {
        database.prepare(`
          INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, onboarding_completed, practice_type)
          VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, NULL, ?, 1, 'polyclinic')
        `).run(testUserId, CLINICAL_SEED_TENANT_ID, testEmail, testUserPasswordHash, testName, d.phone, now);
      } else {
        database.prepare("UPDATE users SET name = ?, tenant_id = COALESCE(NULLIF(tenant_id, ''), ?), onboarding_completed = 1 WHERE id = ?").run(
          testName,
          CLINICAL_SEED_TENANT_ID,
          existingUser.id
        );
      }

      database.prepare("UPDATE doctors SET user_id = ? WHERE id = ?").run(testUserId, d.id);
    }
  }

  seedClinicalRowsIfMissing(database, now);
  seedWhatsAppRowsIfMissing(database, now);
}
