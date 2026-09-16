import { type SqlDatabase } from "./sql-engine.ts";
import { ensurePlatformTenantSchema } from "./platform-tenants.ts";
import { BOOTSTRAP_DDL } from "./db-bootstrap-ddl.ts";
import { ensureDoctorScheduleSchema } from "./doctor-schedule-schema.ts";

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

export function migrate(database: SqlDatabase) {
  database.exec(BOOTSTRAP_DDL);

  try {
    database.exec("ALTER TABLE doctors ADD COLUMN avatar_url TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN bio TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN hpr_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN clinic_name TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN whatsapp_verified INTEGER DEFAULT 0");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN hpr_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN hfr_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN practice_type TEXT DEFAULT 'individual'");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN pack_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN pack_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN signature_url TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN slot_duration_minutes INTEGER DEFAULT 15");
  } catch {}
  try {
    database.exec("ALTER TABLE doctors ADD COLUMN rx_template TEXT DEFAULT 'classic'");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN waba_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN phone_number_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN meta_access_token TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN meta_token_expires_at TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN meta_waba_name TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN meta_quality_rating TEXT DEFAULT 'GREEN'");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN meta_onboarding_status TEXT DEFAULT 'pending'");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN tagline TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN address TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN city TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN email TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN website TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN gstin TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN reg_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN upi_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN whatsapp_number TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN seal_text TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN footer_disclaimer TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN practice_settings TEXT DEFAULT '{}'");
  } catch {}

  ensurePlatformTenantSchema(database);
  ensureDoctorScheduleSchema(database);

  ensureDemoTenantLetterhead(database);

  // ABDM & DHIS Schema Extensions
  try {
    database.exec("ALTER TABLE patients ADD COLUMN abha_number TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE patients ADD COLUMN abha_address TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE patients ADD COLUMN kyc_status TEXT DEFAULT 'PENDING'");
  } catch {}
  try {
    database.exec("ALTER TABLE patients ADD COLUMN hfr_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE patients ADD COLUMN abha_linked_at TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS abdm_consent_artefacts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        consent_id TEXT NOT NULL,
        artefact_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, consent_id)
      )
    `);
  } catch {}
  try {
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_abha ON patients(tenant_id, abha_number) WHERE abha_number IS NOT NULL AND TRIM(abha_number) != ''"
    );
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_abdm_consent_tenant_patient ON abdm_consent_artefacts(tenant_id, patient_id)");
  } catch {}

  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN transaction_type TEXT DEFAULT 'OP_CONSULT'");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN patient_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN abha_address TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN abha_number TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN kyc_status TEXT DEFAULT 'VERIFIED'");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN record_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN fhir_bundle_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN incentive_amount INTEGER DEFAULT 20");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN clinic_share INTEGER DEFAULT 14");
  } catch {}
  try {
    database.exec("ALTER TABLE dhis_transactions ADD COLUMN lumera_share INTEGER DEFAULT 6");
  } catch {}

  try {
    database.exec("ALTER TABLE patients ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE appointments ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN tenant_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN patient_age INTEGER DEFAULT 0");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN patient_gender TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN vitals TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN clinic_name TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN clinic_address TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN clinic_phone TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN qr_verification_url TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN whatsapp_sent_status TEXT DEFAULT 'unsent'");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN specialty_type TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE prescriptions ADD COLUMN specialty_modules TEXT DEFAULT '{}'");
  } catch {}

  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant ON prescriptions(tenant_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(tenant_id, patient_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, date)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_invoices_razorpay_order ON invoices(razorpay_order_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_invoices_payment_link ON invoices(razorpay_payment_link_id)");
  } catch {}
}
