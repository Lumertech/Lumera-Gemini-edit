import { type SqlDatabase } from "./sql-engine.ts";
import { ensurePlatformTenantSchema } from "./platform-tenants.ts";
import { BOOTSTRAP_DDL } from "./db-bootstrap-ddl.ts";
import {
  addWhatsAppTenantColumns,
  enforceWhatsAppTenantNotNull,
  migrateWhatsAppConversationKey,
} from "./migrate-patients-phone.ts";
import { backfillWhatsAppTenantIds } from "./whatsapp-tenant-backfill.ts";

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
  footerDisclaimer: "Prescription issued under the Telemedicine Practice Guidelines, 2020.",
};

/** Previous seeded Rx footer. Matched only to rewrite stored rows; not a default. */
const LEGACY_SEEDED_FOOTER_DISCLAIMER =
  "This prescription is digitally verified under National Health Authority (NHA) & Telemedicine Practice Guidelines. Please report any adverse drug reactions immediately.";
const LEGACY_FOOTER_MARK = "digitally verified under";
const LEGACY_WHATSAPP_RX_FOOTER = "Certified Digital Rx";
const WHATSAPP_RX_FOOTER = "Digital Rx";

/**
 * Idempotent copy fix. Rewrites a tenant footer when it is still the old seeded
 * default or still contains "digitally verified under". Custom footer text stays.
 * Seeded WhatsApp template rows lose the "Certified Digital Rx" phrase.
 */
export function rewriteLegacyHonestyCopy(database: SqlDatabase): void {
  try {
    database
      .prepare(
        `UPDATE tenants
            SET footer_disclaimer = ?
          WHERE footer_disclaimer = ?
             OR lower(footer_disclaimer) LIKE '%' || ? || '%'`
      )
      .run(DEMO_LETTERHEAD_SEED.footerDisclaimer, LEGACY_SEEDED_FOOTER_DISCLAIMER, LEGACY_FOOTER_MARK);
  } catch {
    /* footer_disclaimer is added in this same migrate() pass */
  }
  try {
    database
      .prepare(
        `UPDATE meta_templates
            SET components = replace(components, ?, ?)
          WHERE components LIKE '%' || ? || '%'`
      )
      .run(LEGACY_WHATSAPP_RX_FOOTER, WHATSAPP_RX_FOOTER, LEGACY_WHATSAPP_RX_FOOTER);
  } catch {
    /* meta_templates is created by BOOTSTRAP_DDL before this runs */
  }
}

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
    database.exec("ALTER TABLE users ADD COLUMN facebook_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE users ADD COLUMN patient_id TEXT DEFAULT ''");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_users_tenant_patient ON users(tenant_id, patient_id)");
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
        source TEXT NOT NULL DEFAULT 'staff',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, consent_id)
      )
    `);
  } catch {}
  try {
    database.exec("ALTER TABLE abdm_consent_artefacts ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'");
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

  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS revoked_credentials (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    );
  } catch {}

  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS patient_documents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '',
        patient_id TEXT NOT NULL,
        title TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        document_date TEXT NOT NULL,
        uploaded_by_id TEXT NOT NULL DEFAULT '',
        uploaded_by_name TEXT NOT NULL DEFAULT '',
        uploaded_by_role TEXT NOT NULL DEFAULT '',
        original_filename TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_key TEXT NOT NULL,
        storage_backend TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    );
  } catch {}
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_patient_documents_tenant_patient ON patient_documents(tenant_id, patient_id)"
    );
  } catch {}
  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS patient_document_tickets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`
    );
  } catch {}

  backfillLabReportAndBranchTenants(database);
  try {
    database.exec("ALTER TABLE otp_verifications ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0");
  } catch {}
  addWhatsAppTenantColumns(database);
  backfillWhatsAppTenantIds(database);
  migrateWhatsAppConversationKey(database);
  enforceWhatsAppTenantNotNull(database);
  rewriteLegacyHonestyCopy(database);
}

/**
 * Forward-only tenant columns for lab reports and branches.
 * Existing rows keep their data: lab ownership follows the patient, and
 * historical unscoped branch rows stay on the demo polyclinic tenant.
 */
export function backfillLabReportAndBranchTenants(database: SqlDatabase) {
  try {
    database.exec("ALTER TABLE lab_reports ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE branches ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_lab_reports_tenant ON lab_reports(tenant_id)");
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id)");
  } catch {}
  try {
    database.exec(`
      UPDATE lab_reports
      SET tenant_id = (
        SELECT p.tenant_id FROM patients p
        WHERE p.id = lab_reports.patient_id
          AND p.tenant_id IS NOT NULL
          AND TRIM(p.tenant_id) != ''
      )
      WHERE (tenant_id IS NULL OR TRIM(tenant_id) = '')
        AND EXISTS (
          SELECT 1 FROM patients p
          WHERE p.id = lab_reports.patient_id
            AND p.tenant_id IS NOT NULL
            AND TRIM(p.tenant_id) != ''
        )
    `);
  } catch {}
  try {
    database.exec(
      `UPDATE lab_reports SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR TRIM(tenant_id) = ''`
    );
  } catch {}
  try {
    database.exec(
      `UPDATE branches SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR TRIM(tenant_id) = ''`
    );
  } catch {}
}
