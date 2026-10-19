import { type SqlDatabase } from "./sql-engine.ts";
import { ensurePlatformTenantSchema } from "./platform-tenants.ts";
import { BOOTSTRAP_DDL } from "./db-bootstrap-ddl.ts";
import {
  addWhatsAppTenantColumns,
  enforceWhatsAppTenantNotNull,
  migrateWhatsAppConversationKey,
} from "./migrate-patients-phone.ts";
import { backfillWhatsAppTenantIds } from "./whatsapp-tenant-backfill.ts";
import { migratePrescriptionDraftKey } from "./migrate-prescription-drafts.ts";

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
/** Full seeded FOOTER text. A row changes only when that component text matches exactly. */
const LEGACY_SEEDED_RX_TEMPLATE_FOOTER = "Lumera Health EMR System • Certified Digital Rx";
const SEEDED_RX_TEMPLATE_FOOTER = "Lumera Health EMR System • Digital Rx";
/**
 * Seeded template whose footer was that sentence. lab_report_ready does not apply:
 * its seeded footer is "Lumera Central Diagnostics".
 */
const SEEDED_RX_TEMPLATE_NAMES = ["post_consultation_rx"] as const;

type TemplateComponent = { type?: string; text?: string; [key: string]: unknown };

/**
 * Idempotent copy fix. Rewrites a tenant footer only when it still equals the
 * old seeded default. A custom footer that merely contains the old phrase stays.
 * A WhatsApp template changes only when its name is a seeded Rx template and a
 * FOOTER component's text equals the old seeded footer exactly.
 */
export function rewriteLegacyHonestyCopy(database: SqlDatabase): void {
  try {
    database
      .prepare(
        `UPDATE tenants
            SET footer_disclaimer = ?
          WHERE footer_disclaimer = ?`
      )
      .run(DEMO_LETTERHEAD_SEED.footerDisclaimer, LEGACY_SEEDED_FOOTER_DISCLAIMER);
  } catch {
    /* footer_disclaimer is added in this same migrate() pass */
  }
  try {
    const names = [...SEEDED_RX_TEMPLATE_NAMES];
    const rows = database
      .prepare(
        `SELECT id, components FROM meta_templates WHERE name IN (${names.map(() => "?").join(", ")})`
      )
      .all(...names) as { id: string; components: unknown }[];
    const update = database.prepare("UPDATE meta_templates SET components = ? WHERE id = ?");
    for (const row of rows) {
      const next = rewriteExactSeededFooter(row.components);
      if (next != null) update.run(next, row.id);
    }
  } catch {
    /* meta_templates is created by BOOTSTRAP_DDL before this runs */
  }
}

/** Returns new JSON only when a FOOTER text equals the old seeded footer. */
function rewriteExactSeededFooter(components: unknown): string | null {
  let parsed: unknown = components;
  if (typeof components === "string") {
    try {
      parsed = JSON.parse(components);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  let changed = false;
  const next = parsed.map((part) => {
    if (!part || typeof part !== "object") return part;
    const component = part as TemplateComponent;
    if (component.type === "FOOTER" && component.text === LEGACY_SEEDED_RX_TEMPLATE_FOOTER) {
      changed = true;
      return { ...component, text: SEEDED_RX_TEMPLATE_FOOTER };
    }
    return part;
  });
  return changed ? JSON.stringify(next) : null;
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
  migratePrescriptionDraftKey(database);
  try {
    database.exec("ALTER TABLE invoices ADD COLUMN consulting_doctor_id TEXT NOT NULL DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE invoices ADD COLUMN consulting_doctor_name TEXT NOT NULL DEFAULT ''");
  } catch {}

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

  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS patient_health_document_consents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        notice_version TEXT NOT NULL,
        language TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT '',
        captured_by_id TEXT NOT NULL DEFAULT '',
        captured_by_name TEXT NOT NULL DEFAULT '',
        captured_by_role TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        guardian_name TEXT NOT NULL DEFAULT '',
        guardian_relation TEXT NOT NULL DEFAULT '',
        event TEXT NOT NULL
      )`
    );
  } catch {}
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_patient_doc_consent_tenant_patient ON patient_health_document_consents(tenant_id, patient_id)"
    );
  } catch {}
  try {
    database.exec("ALTER TABLE patients ADD COLUMN date_of_birth TEXT NOT NULL DEFAULT ''");
  } catch {}
  try {
    database.exec("ALTER TABLE tenants ADD COLUMN health_document_retention_years INTEGER NOT NULL DEFAULT 3");
  } catch {}
  for (const column of [
    "tenant_id TEXT NOT NULL DEFAULT ''",
    "patient_id TEXT NOT NULL DEFAULT ''",
    "actor_role TEXT NOT NULL DEFAULT ''",
    "entity_type TEXT NOT NULL DEFAULT ''",
    "entity_id TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      database.exec(`ALTER TABLE audit_logs ADD COLUMN ${column}`);
    } catch {}
  }
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_patient ON audit_logs(tenant_id, patient_id)"
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
  try {
    scrubHistoricalSendRxMessages(database);
  } catch {
    /* whatsapp_messages is created earlier; a partial bootstrap skips the scrub */
  }
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

/** Neutral replacement for a historical send-rx WhatsApp row. Not a clinical document. */
export const SEND_RX_MESSAGE_MARKER = "Prescription notification sent";

const SEND_RX_SCRUB_COLUMNS = ["content", "body", "translated_content", "buttons", "media", "metadata", "metadata_json"] as const;

/**
 * Old POST /send-rx wrote diagnosis, medicines, UHID, and
 * /api/whatsapp/prescription/.../pdf into whatsapp_messages content, buttons,
 * and media. Only rows with that send-rx marker are rewritten. id, tenant_id,
 * timestamps, direction, status, and wamid are not in the SET list.
 * The marker does not match the predicate, so a second run changes nothing.
 */
export function scrubHistoricalSendRxMessages(database: SqlDatabase): number {
  const present = new Set(whatsappMessageColumnNames(database));
  if (!present.has("content")) return 0;
  const assignments = sendRxScrubAssignments(present);
  const where = sendRxMessagePredicate(present);
  if (!assignments || !where) return 0;
  const result = database.prepare(`UPDATE whatsapp_messages SET ${assignments} WHERE ${where}`).run();
  return Number(result.changes || 0);
}

function whatsappMessageColumnNames(database: SqlDatabase): string[] {
  const rows =
    database.dialect === "postgres"
      ? (database
          .prepare(
            `SELECT column_name AS name
             FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'whatsapp_messages'`
          )
          .all() as Array<{ name?: string }>)
      : (database.prepare("PRAGMA table_info(whatsapp_messages)").all() as Array<{ name?: string }>);
  return rows.map((row) => String(row?.name || "").trim()).filter(Boolean);
}

function sendRxScrubAssignments(present: Set<string>): string {
  const marker = `'${SEND_RX_MESSAGE_MARKER}'`;
  const parts: string[] = [];
  for (const column of SEND_RX_SCRUB_COLUMNS) {
    if (!present.has(column)) continue;
    if (column === "translated_content") {
      parts.push(`translated_content = CASE WHEN translated_content IS NULL THEN NULL ELSE ${marker} END`);
      continue;
    }
    parts.push(`${column} = ${marker}`);
  }
  return parts.join(", ");
}

function sendRxMessagePredicate(present: Set<string>): string {
  const clauses: string[] = [];
  if (present.has("content")) {
    clauses.push(`(
      COALESCE(content, '') LIKE '%*Official Digital Prescription*%'
      AND COALESCE(content, '') LIKE '%(UHID:%'
      AND COALESCE(content, '') LIKE '%/api/whatsapp/prescription/%'
      AND COALESCE(content, '') LIKE '%/pdf%'
    )`);
  }
  if (present.has("media")) {
    clauses.push(`(
      COALESCE(media, '') LIKE '%"type":"document"%'
      AND COALESCE(media, '') LIKE '%/api/whatsapp/prescription/%'
      AND COALESCE(media, '') LIKE '%"title":"Prescription-%'
    )`);
  }
  if (present.has("buttons")) {
    clauses.push(`(
      COALESCE(buttons, '') LIKE '%View / Download PDF Rx%'
      AND COALESCE(buttons, '') LIKE '%/api/whatsapp/prescription/%'
    )`);
  }
  return clauses.join(" OR ");
}
