import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./password.ts";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "lumera.db");

export type UserRole =
  | "doctor"
  | "receptionist"
  | "polyclinic_admin"
  | "CLINIC_ADMIN"
  | "super_admin"
  | "patient";

export type UserStatus = "active" | "invited" | "disabled";

export interface DbUser {
  id: string;
  tenant_id?: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  phone: string;
  last_login: string | null;
  created_at: string;
  avatar_url?: string;
  clinic_name?: string;
  whatsapp_verified?: number;
  hpr_id?: string;
  hfr_id?: string;
  onboarding_completed?: number;
  practice_type?: string;
  specialty?: string;
}

export const DEMO_TENANT_ID = "tenant-lumera-main";

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

function ensureDemoTenantLetterhead(database: DatabaseSync) {
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

export function normalizePracticeType(value?: string | null): "individual" | "polyclinic" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "polyclinic" || raw === "multispecialty" || raw === "multi-specialty" || raw === "multi_specialty") {
    return "polyclinic";
  }
  return "individual";
}

export function isDemoWorkspaceUser(user: { id?: string; tenant_id?: string; email?: string }): boolean {
  if (user.tenant_id === DEMO_TENANT_ID) return true;
  return ["user-admin", "user-doctor", "user-patient", "user-reception"].includes(String(user.id || ""));
}

export interface DbTenant {
  id: string;
  name: string;
  specialty: string;
  country: string;
  timezone: string;
  phone: string;
  trial_ends_at: string;
  ai_scribe_minutes_limit: number;
  ai_scribe_minutes_used: number;
  active_status: number;
  hfr_id: string;
  waba_id?: string;
  phone_number_id?: string;
  meta_access_token?: string;
  meta_token_expires_at?: string;
  meta_waba_name?: string;
  meta_quality_rating?: string;
  meta_onboarding_status?: string;
  tagline?: string;
  address?: string;
  city?: string;
  email?: string;
  website?: string;
  gstin?: string;
  reg_id?: string;
  upi_id?: string;
  whatsapp_number?: string;
  seal_text?: string;
  footer_disclaimer?: string;
  created_at: string;
  updated_at: string;
}

export interface DbMetaTemplate {
  id: string;
  tenant_id: string;
  waba_id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: string;
  meta_template_id?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

export function initDatabase(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  seedIfEmpty(db);
  seedSubscriptionsIfMissing(db);
  seedClinicalAndWhatsAppIfMissing(db);
  assignDemoTenantToUnscopedClinicalRows(db);
  ensureMetaTechProviderAndPolicies(db);
  ensureAbdmAndDhisSeeding(db);
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phone TEXT NOT NULL DEFAULT '',
      last_login TEXT,
      created_at TEXT NOT NULL,
      tenant_id TEXT DEFAULT '',
      clinic_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      whatsapp_verified INTEGER DEFAULT 0,
      hpr_id TEXT DEFAULT '',
      hfr_id TEXT DEFAULT '',
      onboarding_completed INTEGER DEFAULT 0,
      practice_type TEXT DEFAULT 'individual',
      specialty TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cms_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_sections (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_policies (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      alt TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      qualification TEXT NOT NULL DEFAULT '',
      reg_number TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL,
      experience_years INTEGER NOT NULL DEFAULT 0,
      consultation_fee INTEGER NOT NULL DEFAULT 0,
      opd_room TEXT NOT NULL DEFAULT '',
      available_days TEXT NOT NULL DEFAULT '[]',
      opd_timing TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      hpr_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      shift TEXT NOT NULL DEFAULT 'Morning',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      opd_hours TEXT NOT NULL DEFAULT '',
      active_doctors INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Operating'
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      monthly_price INTEGER NOT NULL DEFAULT 0,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      ends_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      uhid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      age INTEGER NOT NULL DEFAULT 30,
      gender TEXT NOT NULL DEFAULT 'Male',
      phone TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      blood_group TEXT NOT NULL DEFAULT 'O+',
      allergies TEXT NOT NULL DEFAULT '[]',
      chronic_conditions TEXT NOT NULL DEFAULT '[]',
      emergency_contact TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      last_visit TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      token_number INTEGER NOT NULL,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      uhid TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'New Consultation',
      status TEXT NOT NULL DEFAULT 'Waiting',
      source TEXT NOT NULL DEFAULT 'WhatsApp Bot',
      consultation_fee INTEGER NOT NULL DEFAULT 600,
      is_paid INTEGER NOT NULL DEFAULT 1,
      vitals TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      rx_number TEXT NOT NULL UNIQUE,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_uhid TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      doctor_specialty TEXT NOT NULL,
      doctor_reg_number TEXT NOT NULL,
      date TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      icd10_code TEXT,
      chief_complaints TEXT NOT NULL DEFAULT '[]',
      medicines TEXT NOT NULL DEFAULT '[]',
      lab_tests TEXT NOT NULL DEFAULT '[]',
      advice TEXT NOT NULL DEFAULT '[]',
      diet_instructions TEXT,
      follow_up_date TEXT,
      pdf_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lab_reports (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      patient_uhid TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      date TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      category TEXT NOT NULL,
      doctor_interpretation TEXT,
      results TEXT NOT NULL DEFAULT '[]',
      pdf_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id TEXT PRIMARY KEY,
      patient_phone TEXT NOT NULL UNIQUE,
      patient_name TEXT NOT NULL,
      patient_id TEXT,
      uhid TEXT,
      handover_mode TEXT NOT NULL DEFAULT 'bot',
      assigned_staff TEXT NOT NULL DEFAULT 'Unassigned',
      tags TEXT NOT NULL DEFAULT '[]',
      preferred_language TEXT NOT NULL DEFAULT 'en',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message TEXT NOT NULL DEFAULT '',
      last_message_time TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      sender TEXT NOT NULL,
      staff_name TEXT,
      content TEXT NOT NULL,
      translated_content TEXT,
      detected_language TEXT,
      time_display TEXT NOT NULL,
      buttons TEXT,
      media TEXT,
      audio_url TEXT,
      voice_transcript TEXT,
      status TEXT NOT NULL DEFAULT 'delivered',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_outbound_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'delivered',
      details TEXT NOT NULL,
      action_payload TEXT,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      country TEXT NOT NULL,
      timezone TEXT NOT NULL,
      phone TEXT NOT NULL,
      trial_ends_at TEXT NOT NULL,
      ai_scribe_minutes_limit INTEGER NOT NULL DEFAULT 500,
      ai_scribe_minutes_used INTEGER NOT NULL DEFAULT 0,
      active_status INTEGER NOT NULL DEFAULT 1,
      hfr_id TEXT NOT NULL DEFAULT '',
      waba_id TEXT DEFAULT '',
      phone_number_id TEXT DEFAULT '',
      meta_access_token TEXT DEFAULT '',
      meta_token_expires_at TEXT DEFAULT '',
      meta_waba_name TEXT DEFAULT '',
      meta_quality_rating TEXT DEFAULT 'GREEN',
      meta_onboarding_status TEXT DEFAULT 'pending',
      tagline TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      gstin TEXT DEFAULT '',
      reg_id TEXT DEFAULT '',
      upi_id TEXT DEFAULT '',
      whatsapp_number TEXT DEFAULT '',
      seal_text TEXT DEFAULT '',
      footer_disclaimer TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      appointment_id TEXT NOT NULL DEFAULT '',
      patient_id TEXT NOT NULL DEFAULT '',
      patient_name TEXT NOT NULL DEFAULT '',
      patient_phone TEXT NOT NULL DEFAULT '',
      patient_uhid TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      gstin TEXT NOT NULL DEFAULT '',
      gst_percent REAL NOT NULL DEFAULT 0,
      tax_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      paid_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Unpaid',
      payment_mode TEXT NOT NULL DEFAULT '',
      payment_ref TEXT NOT NULL DEFAULT '',
      razorpay_order_id TEXT NOT NULL DEFAULT '',
      razorpay_payment_id TEXT NOT NULL DEFAULT '',
      razorpay_payment_link_id TEXT NOT NULL DEFAULT '',
      pay_link TEXT NOT NULL DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      issued_by TEXT NOT NULL DEFAULT '',
      receipt_whatsapp_status TEXT NOT NULL DEFAULT 'unsent',
      receipt_whatsapp_channel TEXT NOT NULL DEFAULT '',
      receipt_whatsapp_message_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      paid_at TEXT,
      UNIQUE (tenant_id, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS meta_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      waba_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      components TEXT NOT NULL DEFAULT '[]',
      meta_template_id TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dhis_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      claims_count INTEGER NOT NULL DEFAULT 0,
      claims_threshold INTEGER NOT NULL DEFAULT 100,
      month_year TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      otp TEXT NOT NULL,
      purpose TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT
    );
  `);

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

export function assignDemoTenantToUnscopedClinicalRows(database: DatabaseSync) {
  try {
    database.exec(`UPDATE patients SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE appointments SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE prescriptions SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
  } catch {}
}

const DEMO_PASSWORD = "Lumera@2026";

const DOCTOR_SEED = [
  {
    id: "doc-1",
    name: "Dr. Vikram Malhotra",
    qualification: "MBBS, MD (General Medicine), FICP",
    regNumber: "MCI-2012-74892",
    specialty: "General Medicine",
    experienceYears: 14,
    consultationFee: 600,
    opdRoom: "OPD Room 102",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "09:00 AM - 02:00 PM",
    phone: "+91 98765 43210",
    email: "doctor@lumera.me",
    avatarUrl: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80",
    bio: "Senior Consultant Physician specializing in Adult Internal Medicine, Hypertension, Diabetes & Preventive Cardiology.",
    hprId: "HPR-IN-2012-9841",
  },
  {
    id: "doc-6",
    name: "Dr. Siddharth Varma (PT)",
    qualification: "BPT, MPT (Musculoskeletal & Sports Physiotherapy), MIAP, CMP",
    regNumber: "IAP-2014-9921",
    specialty: "Physiotherapy & Rehabilitation",
    experienceYears: 12,
    consultationFee: 700,
    opdRoom: "Physio & Rehab Suite 105",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "08:30 AM - 01:30 PM, 04:30 PM - 08:00 PM",
    phone: "+91 98312 77889",
    email: "dr.siddharth@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=400&q=80",
    bio: "Lead Musculoskeletal & Sports Physiotherapist certified in Spinal Mobilization, Dry Needling & Post-Operative Knee Rehab.",
    hprId: "HPR-IN-2014-6102",
  },
  {
    id: "doc-2",
    name: "Dr. Ananya Sen",
    qualification: "MBBS, MD (Pediatrics), DCH (London)",
    regNumber: "WBMC-2016-39482",
    specialty: "Pediatrics",
    experienceYears: 9,
    consultationFee: 700,
    opdRoom: "OPD Room 104",
    availableDays: ["Mon", "Wed", "Fri", "Sat"],
    opdTiming: "10:00 AM - 03:00 PM",
    phone: "+91 98112 34567",
    email: "dr.ananya@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1594824813589-98072124c6e9?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Pediatrician with extensive experience in Neonatal Intensive Care, Immunization, and Developmental Milestones.",
    hprId: "HPR-IN-2016-3391",
  },
  {
    id: "doc-3",
    name: "Dr. Rajesh Sharma",
    qualification: "MBBS, MD, DM (Cardiology), FACC",
    regNumber: "DMC-2008-11928",
    specialty: "Cardiology",
    experienceYears: 18,
    consultationFee: 1000,
    opdRoom: "Cardiac OPD 201",
    availableDays: ["Tue", "Thu", "Sat"],
    opdTiming: "11:00 AM - 04:00 PM",
    phone: "+91 98223 99887",
    email: "dr.rajesh@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80",
    bio: "Interventional Cardiologist & Clinical Electrophysiology Specialist with 18+ years managing Coronary Artery Disease and Heart Failure.",
    hprId: "HPR-IN-2008-1140",
  },
  {
    id: "doc-4",
    name: "Dr. Meera Vasudevan",
    qualification: "MBBS, MD (Dermatology, Venereology & Leprosy)",
    regNumber: "KMC-2015-88392",
    specialty: "Dermatology",
    experienceYears: 11,
    consultationFee: 750,
    opdRoom: "Derma Suite 108",
    availableDays: ["Mon", "Tue", "Thu", "Fri"],
    opdTiming: "02:00 PM - 07:00 PM",
    phone: "+91 97334 11223",
    email: "dr.meera@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Dermatologist & Dermatosurgeon specializing in Clinical Dermatology, Trichology, and Advanced Laser Therapies.",
    hprId: "HPR-IN-2015-8821",
  },
  {
    id: "doc-5",
    name: "Dr. Harshvardhan Patel",
    qualification: "MBBS, MS (Orthopedics), M.Ch (Joint Replacement)",
    regNumber: "GMC-2010-55421",
    specialty: "Orthopedics",
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: "Ortho OPD 106",
    availableDays: ["Mon", "Wed", "Fri"],
    opdTiming: "09:30 AM - 01:30 PM",
    phone: "+91 99445 66778",
    email: "dr.harsh@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=400&q=80",
    bio: "Chief Orthopedic Surgeon with fellowships in Computer-Navigated Joint Replacements and Arthroscopic Sports Medicine.",
    hprId: "HPR-IN-2010-5519",
  },
  {
    id: "doc-7",
    name: "Dr. Shalini Mukhopadhyay",
    qualification: "MBBS, MS (Obstetrics & Gynecology), DGO, FICOG",
    regNumber: "WBMC-2011-44910",
    specialty: "Gynecology",
    experienceYears: 15,
    consultationFee: 800,
    opdRoom: "Women & Maternity Suite 203",
    availableDays: ["Mon", "Tue", "Thu", "Sat"],
    opdTiming: "10:00 AM - 02:30 PM",
    phone: "+91 98319 88990",
    email: "dr.shalini@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1591604021695-0c69b7c05981?auto=format&fit=crop&w=400&q=80",
    bio: "Senior Consultant Gynecologist & Obstetrician specializing in High-Risk Obstetrics, Infertility Care, and Minimally Invasive Laparoscopy.",
    hprId: "HPR-IN-2011-4402",
  },
  {
    id: "doc-8",
    name: "Dr. Arunachalam Swamy",
    qualification: "BDS, MDS (Conservative Dentistry & Endodontics), FIA",
    regNumber: "DCI-2013-19920",
    specialty: "Dental Surgery",
    experienceYears: 13,
    consultationFee: 650,
    opdRoom: "Dental Operatory 109",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    opdTiming: "09:00 AM - 01:00 PM, 05:00 PM - 08:30 PM",
    phone: "+91 98401 22334",
    email: "dr.arun@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=400&q=80",
    bio: "Specialist Dental Surgeon & Endodontist with mastery in Single-Sitting Microscope-Assisted Root Canals and Cosmetic Restorations.",
    hprId: "HPR-IN-2013-1945",
  },
  {
    id: "doc-9",
    name: "Dr. Alok Nath Mukherjee",
    qualification: "MBBS, MS (Ophthalmology), DNB, FICO (UK)",
    regNumber: "DMC-2009-33211",
    specialty: "Ophthalmology",
    experienceYears: 16,
    consultationFee: 750,
    opdRoom: "Eye & Refraction Suite 205",
    availableDays: ["Mon", "Wed", "Fri", "Sat"],
    opdTiming: "11:00 AM - 04:30 PM",
    phone: "+91 98109 44332",
    email: "dr.alok@lumera.health",
    avatarUrl: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=400&q=80",
    bio: "Consultant Ophthalmic Surgeon specializing in Phaco-Emulsification Cataract Surgeries, Diabetic Retinopathy, and Glaucoma Management.",
    hprId: "HPR-IN-2009-3382",
  },
];

function seedIfEmpty(database: DatabaseSync) {
  const existing = database.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (existing.c > 0) return;

  const now = new Date().toISOString();
  const passwordHash = hashPasswordSync(DEMO_PASSWORD);

  const insertUser = database.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, status, phone, last_login, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?)
  `);

  insertUser.run("user-admin", "admin@lumera.me", passwordHash, "Priya Iyer", "super_admin", "+91 98000 11111", now);
  insertUser.run("user-doctor", "doctor@lumera.me", passwordHash, "Dr. Vikram Malhotra", "doctor", "+91 98765 43210", now);
  insertUser.run("user-patient", "patient@lumera.me", passwordHash, "Rajiv Saxena", "patient", "+91 98234 55667", now);
  insertUser.run("user-reception", "reception@lumera.me", passwordHash, "Ramesh Patel", "receptionist", "+91 98200 44556", now);

  const insertDoc = database.prepare(`
    INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const d of DOCTOR_SEED) {
    insertDoc.run(
      d.id,
      d.id === "doc-1" ? "user-doctor" : null,
      d.name,
      d.qualification,
      d.regNumber,
      d.specialty,
      d.experienceYears,
      d.consultationFee,
      d.opdRoom,
      JSON.stringify(d.availableDays),
      d.opdTiming,
      d.phone,
      d.email,
      d.avatarUrl,
      d.bio,
      d.hprId
    );
  }

  const insertStaff = database.prepare(`
    INSERT INTO staff (id, user_id, name, role, department, phone, email, status, shift)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStaff.run("s-1", null, "Sunita Sharma", "Nurse", "Triage & OPD", "+91 98200 11223", "sunita.s@lumera.me", "Active", "Morning");
  insertStaff.run("s-2", "user-reception", "Ramesh Patel", "Receptionist", "Front Desk & Billing", "+91 98200 44556", "reception@lumera.me", "Active", "Full Day");
  insertStaff.run("s-3", null, "Deepa Nair", "Pharmacist", "In-House Pharmacy", "+91 98200 77889", "deepa.n@lumera.me", "Active", "Evening");
  insertStaff.run("s-4", null, "Amit Verma", "Lab Tech", "Pathology & Diagnostic", "+91 98200 99001", "amit.v@lumera.me", "Active", "Morning");

  const insertBranch = database.prepare(`
    INSERT INTO branches (id, name, address, phone, opd_hours, active_doctors, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertBranch.run("b-1", "Lumera Central Polyclinic & Diagnostics", "Indiranagar 100ft Road, Bengaluru", "+91 80 4123 4567", "08:00 AM - 09:00 PM", 8, "Operating");
  insertBranch.run("b-2", "Lumera Specialty Care & Rehab Center", "Bandra West, Mumbai", "+91 22 2640 1234", "09:00 AM - 08:00 PM", 5, "Operating");
  insertBranch.run("b-3", "Lumera Day Surgery & Eye Clinic", "Koramangala 4th Block, Bengaluru", "+91 80 4987 6543", "08:30 AM - 07:00 PM", 4, "Operating");

  seedCms(database, now);
  writeAudit(database, "user-admin", "System Admin", "Seed", "Initial SQLite database seeded with demo users, CMS, and clinic roster");
}

function hashPasswordSync(password: string): string {
  return hashPassword(password);
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function seedSubscriptionsIfMissing(database: DatabaseSync) {
  const users = database.prepare("SELECT id, role FROM users").all() as { id: string; role: string }[];
  const insert = database.prepare(`
    INSERT OR IGNORE INTO subscriptions (id, user_id, status, plan_type, monthly_price, auto_renew, started_at, ends_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const u of users) {
    const plan =
      u.role === "super_admin"
        ? { status: "active", plan: "internal", price: 0, days: 3650, notes: "Platform operator" }
        : u.role === "doctor"
          ? { status: "active", plan: "professional", price: 2499, days: 365, notes: "Clinician professional plan" }
          : u.role === "receptionist"
            ? { status: "active", plan: "starter", price: 999, days: 365, notes: "Front-desk starter plan" }
            : u.role === "polyclinic_admin"
              ? { status: "active", plan: "clinic", price: 4999, days: 365, notes: "Multi-branch clinic plan" }
              : { status: "trial", plan: "trial", price: 0, days: 14, notes: "14-day product trial" };
    insert.run(
      `sub-${u.id}`,
      u.id,
      plan.status,
      plan.plan,
      plan.price,
      plan.price > 0 ? 1 : 0,
      now,
      addDays(now, plan.days),
      plan.notes
    );
  }
}

export function mapSubscription(row: Record<string, unknown>, user?: { name: string; email: string; phone: string }) {
  const ends = (row.ends_at as string) || null;
  let daysRemaining: number | null = null;
  if (ends) {
    daysRemaining = Math.ceil((new Date(ends).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    status: row.status as string,
    planType: row.plan_type as string,
    monthlyPrice: Number(row.monthly_price),
    autoRenew: Boolean(row.auto_renew),
    startedAt: row.started_at as string,
    endsAt: ends,
    notes: (row.notes as string) || "",
    daysRemaining,
  };
}

function seedCms(database: DatabaseSync, now: string) {
  const set = database.prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?)");
  const settings: Record<string, string> = {
    brand_name: "Lumera",
    badge_text: "AI-Powered Practice Management for Healthcare Professionals",
    hero_title: "Your AI Receptionist for 24/7 Appointment Booking",
    hero_subtitle:
      "Let Lumera AI answer calls, book appointments via WhatsApp, and manage your practice automatically — in Hindi, Tamil, Telugu, Marathi, Bengali & English.",
    contact_email: "ravee@lumer.me",
    cta_primary: "Get Started Free",
    cta_secondary: "See Demo",
    cta_banner_title: "Ready to Transform Your Practice?",
    cta_banner_subtitle: "Start your free trial today. No credit card required. Set up in under 5 minutes.",
    stats: JSON.stringify([
      { icon: "calendar", value: "50K+", label: "Appointments Booked" },
      { icon: "clock", value: "10K+", label: "Hours Saved Monthly" },
      { icon: "trend", value: "95%", label: "No-Show Reduction" },
      { icon: "bot", value: "24/7", label: "AI Availability" },
    ]),
    gemini_model: "models/gemini-3.7-flash",
    ambient_sensitivity: "High (Medical Grade 16kHz)",
    auto_soap: "true",
    abdm_enabled: "true",
    clinic_name: "Lumera Healthcare & Polyclinic Institute",
    clinic_address: "Suite 401-405, Healthcare Towers, 14 Park Circus Avenue, Kolkata",
    logo_url: "",
  };
  for (const [key, value] of Object.entries(settings)) {
    set.run(key, value);
  }

  const insertSection = database.prepare(
    "INSERT INTO cms_sections (id, type, sort_order, payload) VALUES (?, ?, ?, ?)"
  );

  const pains = [
    {
      title: "Handle every call yourself",
      items: [
        "Constant interruptions during consultations",
        "Missed calls = missed patients",
        "No time for actual patient care",
      ],
    },
    {
      title: "Let calls go unanswered",
      items: [
        "Patients hang up and call competitors",
        "No way to reconnect with lost leads",
        "Poor first impression of your practice",
      ],
    },
    {
      title: "Hire expensive receptionists",
      items: [
        "High salary costs that add up fast",
        "Staff unavailable nights & weekends",
        "Inconsistent patient experience",
      ],
    },
  ];
  pains.forEach((p, i) => insertSection.run(`pain-${i + 1}`, "pain", i, JSON.stringify(p)));

  const features = [
    { title: "AI Voice Assistant", desc: "Human-like AI answers calls in Hindi, Tamil, Telugu, Marathi & more. Never miss a patient call again." },
    { title: "WhatsApp Integration", desc: "Patients book appointments through WhatsApp. AI chatbot handles queries 24/7." },
    { title: "Smart Scheduling", desc: "AI manages your calendar, prevents double-bookings, and optimizes appointment slots." },
    { title: "Automated Reminders", desc: "WhatsApp & voice reminders reduce no-shows by up to 95%. Smart follow-ups included." },
    { title: "Instant Payments", desc: "Send payment links via WhatsApp. Accept UPI, cards, or Razorpay. Get paid faster." },
    { title: "ABDM Compliant", desc: "ABHA ID integration, digital consent management, and secure health records." },
  ];
  features.forEach((f, i) => insertSection.run(`feat-${i + 1}`, "feature", i, JSON.stringify(f)));

  const personas = [
    { title: "Doctors & Clinics", desc: "AI prescriptions, patient records, ABDM compliance" },
    { title: "Dentists", desc: "Treatment plans, follow-up reminders, payment tracking" },
    { title: "Therapists", desc: "Session notes, secure storage, appointment reminders" },
    { title: "Wellness & Spas", desc: "Service catalog, packages, loyalty management" },
    { title: "Physiotherapists", desc: "Treatment tracking, exercise reminders, progress notes" },
    { title: "Consultants", desc: "Meeting scheduling, document sharing, invoicing" },
  ];
  personas.forEach((p, i) => insertSection.run(`persona-${i + 1}`, "persona", i, JSON.stringify(p)));

  const testimonials = [
    {
      quote: "Lumera AI answers calls instantly and sounds natural. Patients think they're speaking to my receptionist.",
      name: "Dr. Priya Sharma",
      role: "Cardiologist, Mumbai",
    },
    {
      quote: "Since switching to Lumera, we don't miss after-hours calls anymore. Revenue is up 30%.",
      name: "Dr. Rajesh Kumar",
      role: "Dental Clinic, Bangalore",
    },
    {
      quote: "The WhatsApp booking is a game-changer. My patients love how easy it is to schedule appointments.",
      name: "Dr. Meera Patel",
      role: "Physiotherapist, Delhi",
    },
  ];
  testimonials.forEach((t, i) => insertSection.run(`quote-${i + 1}`, "testimonial", i, JSON.stringify(t)));

  const insertPolicy = database.prepare(
    "INSERT INTO cms_policies (slug, title, body, updated_at) VALUES (?, ?, ?, ?)"
  );
  insertPolicy.run(
    "privacy",
    "Privacy Policy",
    `# Privacy Policy

Lumera Solutions LLP (“Lumera”, “we”) provides AI-assisted practice management for healthcare professionals.

## Information we collect
- Account details (name, email, phone, role) for clinic staff and patients you enrol
- Clinical workflow data you enter in the EMR (appointments, SOAP notes, prescriptions)
- Technical logs required for security and audit

## How we use it
Data is used to operate the clinician suite, patient portal, and admin CMS; to generate AI drafts you review; and to meet ABDM / NDHM interoperability where you enable it.

## Sharing
We do not sell health information. Processors (for example Gemini API when a clinic key is configured) receive only the minimum payload needed for the requested inference.

## Retention & rights
Clinic administrators can disable users and export or delete CMS content from the Admin console. Contact ravee@lumer.me for data requests.`,
    now
  );
  insertPolicy.run(
    "terms",
    "Terms of Service",
    `# Terms of Service

By creating a Lumera account you agree to use the software for lawful clinical and administrative purposes.

## Accounts
You are responsible for credentials issued to your staff. Demo passwords must be changed before any live patient data is stored.

## Clinical responsibility
AI-generated SOAP notes, prescriptions, and chat replies are decision-support drafts. Licensed practitioners remain solely responsible for diagnosis, treatment, and documentation.

## Availability
The service is provided as a practice operating suite. Scheduled maintenance may occur with notice in the admin audit log.`,
    now
  );
  insertPolicy.run(
    "disclaimer",
    "Medical Disclaimer",
    `# Medical Disclaimer

Lumera is not a substitute for professional medical advice, diagnosis, or treatment.

Ambient transcription, HEXA answers, and OCR lab extraction can contain errors. Always verify against source documents and clinical judgement before acting.

Emergency care should never rely on the AI receptionist or WhatsApp bot — direct patients to emergency services.`,
    now
  );
  insertPolicy.run(
    "security",
    "Data Security",
    `# Data Security

- Passwords are stored with scrypt hashes; sessions use httpOnly cookies
- Role-based access separates Super Admin, clinicians, reception, and patients
- Mutating admin actions are written to an immutable audit log
- Gemini API keys stay in server environment variables and are never written to SQLite
- Uploaded media is stored on the clinic server under /uploads

Report suspected incidents to ravee@lumer.me.`,
    now
  );
}

export function writeAudit(database: DatabaseSync, userId: string | null, userName: string, action: string, details: string) {
  database.prepare(
    "INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), new Date().toISOString(), userId, userName, action, details);
}

export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const PRESCRIPTION_SPECIALTY_KEYS = [
  "physiotherapyAssessment",
  "performedTherapies",
  "prescribedExercises",
  "cardiologyAssessment",
  "dermatologyAssessment",
  "pediatricAssessment",
  "orthopedicAssessment",
  "ophthalmologyAssessment",
  "dentalAssessment",
  "gynecologyAssessment",
] as const;

export function mapPatient(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    uhid: row.uhid as string,
    name: row.name as string,
    age: Number(row.age || 0),
    gender: (row.gender as string) || "Other",
    phone: row.phone as string,
    email: (row.email as string) || "",
    bloodGroup: (row.blood_group as string) || "",
    allergies: parseJsonColumn<string[]>(row.allergies, []),
    chronicConditions: parseJsonColumn<string[]>(row.chronic_conditions, []),
    emergencyContact: (row.emergency_contact as string) || "",
    address: (row.address as string) || "",
    lastVisit: (row.last_visit as string) || undefined,
    abhaNumber: (row.abha_number as string) || "",
    abhaAddress: (row.abha_address as string) || "",
    kycStatus: (row.kyc_status as string) || "PENDING",
    hfrId: (row.hfr_id as string) || "",
  };
}

export function mapAppointment(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    tokenNumber: Number(row.token_number || 0),
    patientId: row.patient_id as string,
    patientName: row.patient_name as string,
    patientPhone: row.patient_phone as string,
    uhid: row.uhid as string,
    doctorId: row.doctor_id as string,
    doctorName: row.doctor_name as string,
    specialty: row.specialty as string,
    date: row.date as string,
    timeSlot: row.time_slot as string,
    type: row.type as string,
    status: row.status as string,
    source: row.source as string,
    consultationFee: Number(row.consultation_fee || 0),
    isPaid: Boolean(row.is_paid),
    vitals: row.vitals ? parseJsonColumn(row.vitals, null) : null,
  };
}

export function mapPrescription(row: Record<string, unknown>) {
  const modules = parseJsonColumn<Record<string, unknown>>(row.specialty_modules, {});
  return {
    id: row.id as string,
    rxNumber: row.rx_number as string,
    patientId: (row.patient_id as string) || "",
    patientName: row.patient_name as string,
    patientAge: Number(row.patient_age || 0),
    patientGender: (row.patient_gender as string) || "",
    patientPhone: row.patient_phone as string,
    patientUhid: (row.patient_uhid as string) || "",
    doctorId: (row.doctor_id as string) || "",
    doctorName: row.doctor_name as string,
    doctorSpecialty: (row.doctor_specialty as string) || "",
    doctorRegNumber: (row.doctor_reg_number as string) || "",
    date: row.date as string,
    diagnosis: (row.diagnosis as string) || "",
    icd10Code: (row.icd10_code as string) || undefined,
    chiefComplaints: parseJsonColumn<string[]>(row.chief_complaints, []),
    medicines: parseJsonColumn(row.medicines, []),
    labTests: parseJsonColumn(row.lab_tests, []),
    advice: parseJsonColumn<string[]>(row.advice, []),
    dietInstructions: (row.diet_instructions as string) || undefined,
    followUpDate: (row.follow_up_date as string) || "",
    vitals: row.vitals ? parseJsonColumn(row.vitals, undefined) : undefined,
    clinicName: (row.clinic_name as string) || "",
    clinicAddress: (row.clinic_address as string) || "",
    clinicPhone: (row.clinic_phone as string) || "",
    qrVerificationUrl: (row.qr_verification_url as string) || undefined,
    whatsappSentStatus: ((row.whatsapp_sent_status as string) || "unsent") as
      | "unsent"
      | "queued"
      | "delivered"
      | "read",
    specialtyType: (row.specialty_type as string) || undefined,
    ...modules,
  };
}

export function mapDoctor(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: (row.user_id as string) || null,
    name: row.name as string,
    qualification: (row.qualification as string) || "",
    regNumber: (row.reg_number as string) || "",
    specialty: row.specialty as string,
    experienceYears: Number(row.experience_years || 0),
    consultationFee: Number(row.consultation_fee || 0),
    opdRoom: (row.opd_room as string) || "",
    availableDays: JSON.parse((row.available_days as string) || "[]"),
    opdTiming: (row.opd_timing as string) || "",
    phone: (row.phone as string) || "",
    email: (row.email as string) || "",
    avatarUrl: (row.avatar_url as string) || "",
    bio: (row.bio as string) || "",
    hprId: (row.hpr_id as string) || "",
    signatureUrl: (row.signature_url as string) || "",
    slotDurationMinutes: Number(row.slot_duration_minutes || 15),
    rxTemplate: ((row.rx_template as string) || "classic") as "classic" | "compact" | "detailed",
    active: Boolean(row.active),
  };
}

export function getTenantBillingProfile(tenantId: string): {
  name: string;
  gstin: string;
  upiId: string;
} {
  if (!tenantId) return { name: "", gstin: "", upiId: "" };
  try {
    const row = getDb()
      .prepare("SELECT name, gstin, upi_id FROM tenants WHERE id = ?")
      .get(tenantId) as { name?: string; gstin?: string; upi_id?: string } | undefined;
    return {
      name: String(row?.name || ""),
      gstin: String(row?.gstin || ""),
      upiId: String(row?.upi_id || ""),
    };
  } catch {
    return { name: "", gstin: "", upiId: "" };
  }
}

export function mapInvoice(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    invoiceNumber: row.invoice_number as string,
    appointmentId: (row.appointment_id as string) || "",
    patientId: (row.patient_id as string) || "",
    patientName: (row.patient_name as string) || "",
    patientPhone: (row.patient_phone as string) || "",
    patientUhid: (row.patient_uhid as string) || "",
    date: row.date as string,
    items: parseJsonColumn(row.items, [] as unknown[]),
    subtotal: Number(row.subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    gstin: (row.gstin as string) || "",
    gstPercent: Number(row.gst_percent || 0),
    taxAmount: Number(row.tax_amount || 0),
    totalAmount: Number(row.total_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    paymentStatus: (row.status as string) || "Unpaid",
    paymentMode: (row.payment_mode as string) || undefined,
    paymentRef: (row.payment_ref as string) || undefined,
    razorpayOrderId: (row.razorpay_order_id as string) || "",
    razorpayPaymentId: (row.razorpay_payment_id as string) || "",
    razorpayPaymentLinkId: (row.razorpay_payment_link_id as string) || "",
    payLink: (row.pay_link as string) || "",
    upiId: (row.upi_id as string) || "",
    issuedBy: (row.issued_by as string) || "",
    receiptWhatsAppStatus: (row.receipt_whatsapp_status as string) || "unsent",
    receiptWhatsAppChannel: (row.receipt_whatsapp_channel as string) || "",
    receiptWhatsAppMessageId: (row.receipt_whatsapp_message_id as string) || "",
    createdAt: row.created_at as string,
    paidAt: (row.paid_at as string) || null,
  };
}

export function publicUser(user: DbUser) {
  const billing = getTenantBillingProfile(user.tenant_id || "");
  return {
    id: user.id,
    tenantId: user.tenant_id || "",
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    phone: user.phone,
    lastLogin: user.last_login,
    createdAt: user.created_at,
    avatarUrl: user.avatar_url || "",
    clinicName: user.clinic_name || billing.name || "",
    whatsappVerified: Boolean(user.whatsapp_verified),
    hprId: user.hpr_id || "",
    hfrId: user.hfr_id || "",
    onboardingCompleted: Boolean(user.onboarding_completed),
    practiceType: normalizePracticeType(user.practice_type),
    specialty: (user.specialty as string) || "",
    isDemoWorkspace: isDemoWorkspaceUser(user),
    gstin: billing.gstin,
    upiId: billing.upiId,
  };
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
      SET tenant_id = '${DEMO_TENANT_ID}',
          onboarding_completed = 1,
          practice_type = 'polyclinic'
      WHERE id IN ('user-admin', 'user-doctor', 'user-patient', 'user-reception')
         OR id LIKE 'test-user-%'
    `);
  } catch {}

  const patientCount = database.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number };

  // SECURITY: this block creates a "Test {DoctorName}" login for every seeded
  // doctor, using one shared, hardcoded password, and repoints each real
  // doctor row's user_id at that test account. That is safe only on a local
  // dev database — in any real deployment it would let anyone who has read
  // this public source code log in as any doctor, and it re-applies on every
  // server restart, silently overwriting whatever real credentials were set.
  // It must never run when NODE_ENV=production.
  if (process.env.NODE_ENV !== "production") {
    const testUserPasswordHash = hashPasswordSync("Lumera@2026");
    for (const d of DOCTOR_SEED) {
      const testUserId = `test-user-${d.id}`;
      const testName = d.name.startsWith("Test ") ? d.name : `Test ${d.name}`;
      const testEmail = d.email.includes("test") ? d.email : d.email.replace("@", ".test@");

      const existingUser = database.prepare("SELECT id FROM users WHERE email = ? OR id = ?").get(testEmail, testUserId) as { id: string } | undefined;
      if (!existingUser) {
        database.prepare(`
          INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, onboarding_completed, practice_type)
          VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, NULL, ?, 1, 'polyclinic')
        `).run(testUserId, DEMO_TENANT_ID, testEmail, testUserPasswordHash, testName, d.phone, now);
      } else {
        database.prepare("UPDATE users SET name = ?, tenant_id = COALESCE(NULLIF(tenant_id, ''), ?), onboarding_completed = 1 WHERE id = ?").run(
          testName,
          DEMO_TENANT_ID,
          existingUser.id
        );
      }

      database.prepare("UPDATE doctors SET user_id = ? WHERE id = ?").run(testUserId, d.id);
    }
  }

  if (patientCount.c === 0) {
    const insertPatient = database.prepare(`
      INSERT INTO patients (id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions, emergency_contact, address, last_visit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPatient.run(
      "pat-6",
      "LUM-2026-0106",
      "Rajiv Saxena",
      44,
      "Male",
      "+91 98234 55667",
      "rajiv.saxena@gmail.com",
      "O+",
      JSON.stringify(["None known"]),
      JSON.stringify(["Lumbar Disc Herniation (L4-L5)", "Sedentary IT Posture Strain"]),
      "Meena Saxena (Wife) - +91 98234 99001",
      "A-502, Orchid Woods, Whitefield, Bengaluru",
      "2026-08-30",
      now
    );

    insertPatient.run(
      "pat-7",
      "LUM-2026-0107",
      "Priyanka Mukherjee",
      52,
      "Female",
      "+91 98311 44556",
      "priyanka.m@gmail.com",
      "A+",
      JSON.stringify(["Sulfa drugs"]),
      JSON.stringify(["Adhesive Capsulitis (Left Shoulder)", "Type 2 Diabetes"]),
      "Debashis Mukherjee (Husband) - +91 98311 77889",
      "18/2, Gariahat Road, South Kolkata",
      "2026-08-29",
      now
    );

    insertPatient.run(
      "pat-1",
      "LUM-2026-0101",
      "Sunita Roy",
      48,
      "Female",
      "+91 98301 23456",
      "sunita.roy@gmail.com",
      "B+",
      JSON.stringify(["Penicillin", "Sulfa drugs"]),
      JSON.stringify(["Type 2 Diabetes", "Hypertension"]),
      "Amit Roy (Husband) - +91 98301 99887",
      "Flat 4B, Greenwood Heights, Salt Lake, Kolkata",
      "2026-08-20",
      now
    );

    insertPatient.run(
      "pat-2",
      "LUM-2026-0102",
      "Rohan Deshmukh",
      32,
      "Male",
      "+91 98200 45678",
      "rohan.deshmukh@outlook.com",
      "O+",
      JSON.stringify(["None known"]),
      JSON.stringify(["Allergic Rhinitis"]),
      "Pooja Deshmukh (Wife) - +91 98200 88990",
      "B-201, Shanti Park, Andheri East, Mumbai",
      "2026-08-28",
      now
    );

    insertPatient.run(
      "pat-3",
      "LUM-2026-0103",
      "Aarav Gupta",
      6,
      "Male",
      "+91 97110 54321",
      "aarav.g@gmail.com",
      "A+",
      JSON.stringify(["Dust mites", "Peanuts"]),
      JSON.stringify(["Childhood Asthma"]),
      "Neha Gupta (Mother) - +91 97110 54321",
      "C-44, Sector 50, Noida, UP",
      "2026-08-25",
      now
    );

    insertPatient.run(
      "pat-4",
      "LUM-2026-0104",
      "Mohammed Tariq",
      58,
      "Male",
      "+91 98450 78901",
      "tariq.mohd@gmail.com",
      "AB+",
      JSON.stringify(["Aspirin (Bronchospasm)"]),
      JSON.stringify(["Ischemic Heart Disease (Post-PTCA 2024)", "Dyslipidemia"]),
      "Zaid Tariq (Son) - +91 98450 11223",
      "14, 8th Main, Indiranagar, Bengaluru",
      "2026-08-15",
      now
    );

    insertPatient.run(
      "pat-5",
      "LUM-2026-0105",
      "Kavita Menon",
      27,
      "Female",
      "+91 98950 12399",
      "kavita.m@gmail.com",
      "O-",
      JSON.stringify(["None known"]),
      JSON.stringify(["PCOS"]),
      "Suresh Menon (Father) - +91 98950 44556",
      "32/145, Marine Drive, Kochi, Kerala",
      "2026-08-10",
      now
    );
  }

  const apptCount = database.prepare("SELECT COUNT(*) AS c FROM appointments").get() as { c: number };
  if (apptCount.c === 0) {
    const insertAppt = database.prepare(`
      INSERT INTO appointments (id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, vitals, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertAppt.run(
      "apt-1",
      1,
      "pat-6",
      "Rajiv Saxena",
      "+91 98234 55667",
      "LUM-2026-0106",
      "doc-6",
      "Dr. Siddharth Varma (PT)",
      "Physiotherapy & Rehabilitation",
      "2026-09-03",
      "09:00 AM",
      "New Consultation",
      "In Consultation",
      "WhatsApp Bot",
      700,
      1,
      JSON.stringify({
        bloodPressureSystolic: 124,
        bloodPressureDiastolic: 80,
        heartRate: 72,
        temperature: 98.4,
        spO2: 99,
        weightKg: 78.0,
        heightCm: 176,
        bmi: 25.2,
        recordedAt: "08:50 AM",
        recordedBy: "Nurse Rina",
      }),
      now
    );

    insertAppt.run(
      "apt-2",
      2,
      "pat-7",
      "Priyanka Mukherjee",
      "+91 98311 44556",
      "LUM-2026-0107",
      "doc-6",
      "Dr. Siddharth Varma (PT)",
      "Physiotherapy & Rehabilitation",
      "2026-09-03",
      "09:45 AM",
      "Follow-up",
      "Waiting",
      "Online Portal",
      700,
      1,
      null,
      now
    );

    insertAppt.run(
      "apt-3",
      3,
      "pat-1",
      "Sunita Roy",
      "+91 98301 23456",
      "LUM-2026-0101",
      "doc-1",
      "Dr. Vikram Malhotra",
      "General Medicine",
      "2026-09-03",
      "10:15 AM",
      "Follow-up",
      "Waiting",
      "WhatsApp Bot",
      600,
      1,
      JSON.stringify({
        bloodPressureSystolic: 132,
        bloodPressureDiastolic: 84,
        heartRate: 76,
        temperature: 98.4,
        spO2: 99,
        weightKg: 68.5,
        bloodSugarRandom: 148,
      }),
      now
    );

    insertAppt.run(
      "apt-4",
      4,
      "pat-2",
      "Rohan Deshmukh",
      "+91 98200 45678",
      "LUM-2026-0102",
      "doc-1",
      "Dr. Vikram Malhotra",
      "General Medicine",
      "2026-09-03",
      "10:45 AM",
      "New Consultation",
      "Waiting",
      "Walk-in",
      600,
      1,
      null,
      now
    );

    insertAppt.run(
      "apt-5",
      5,
      "pat-3",
      "Aarav Gupta",
      "+91 97110 54321",
      "LUM-2026-0103",
      "doc-2",
      "Dr. Ananya Sen",
      "Pediatrics",
      "2026-09-03",
      "11:15 AM",
      "New Consultation",
      "Waiting",
      "Online Portal",
      700,
      0,
      null,
      now
    );

    insertAppt.run(
      "apt-6",
      6,
      "pat-4",
      "Mohammed Tariq",
      "+91 98450 78901",
      "LUM-2026-0104",
      "doc-3",
      "Dr. Rajesh Sharma",
      "Cardiology",
      "2026-09-03",
      "11:45 AM",
      "Follow-up",
      "Waiting",
      "WhatsApp Bot",
      1000,
      1,
      null,
      now
    );
  }

  const rxCount = database.prepare("SELECT COUNT(*) AS c FROM prescriptions").get() as { c: number };
  if (rxCount.c === 0) {
    const insertRx = database.prepare(`
      INSERT INTO prescriptions (id, rx_number, patient_id, patient_name, patient_phone, patient_uhid, doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, icd10_code, chief_complaints, medicines, lab_tests, advice, diet_instructions, follow_up_date, pdf_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRx.run(
      "rx-101",
      "RX-2026-0106",
      "pat-6",
      "Rajiv Saxena",
      "+91 98234 55667",
      "LUM-2026-0106",
      "doc-6",
      "Dr. Siddharth Varma (PT)",
      "Physiotherapy & Rehabilitation",
      "IAP-2014-9921",
      "2026-08-30",
      "Lumbar Disc Herniation (L4-L5) with Left S1 Radiculopathy & Muscular Spasm",
      "M54.4",
      JSON.stringify(["Low back pain radiating to left calf for 3 weeks", "Morning lumbar stiffness", "Difficulty sitting >30 mins continuously"]),
      JSON.stringify([
        {
          id: "med-1",
          drugName: "Aceclofenac 100 mg + Paracetamol 325 mg (Zerodol-P)",
          composition: "Aceclofenac (100mg) + Paracetamol (325mg)",
          dosage: "1 tab",
          form: "Tablet",
          frequency: "1-0-1",
          timing: "After Food",
          durationDays: 5,
          instructions: "Take with food; stop once acute pain subsides"
        },
        {
          id: "med-2",
          drugName: "Pregabalin 75 mg + Methylcobalamin 750 mcg (Pregeb-M)",
          composition: "Pregabalin 75mg + Methylcobalamin 750mcg",
          dosage: "1 cap",
          form: "Capsule",
          frequency: "0-0-1",
          timing: "At Bedtime",
          durationDays: 14,
          instructions: "Neuropathic pain relief and nerve root regeneration"
        },
        {
          id: "med-3",
          drugName: "Thiocolchicoside 4 mg (Myoril)",
          composition: "Thiocolchicoside 4mg",
          dosage: "1 cap",
          form: "Capsule",
          frequency: "1-0-1",
          timing: "After Food",
          durationDays: 5,
          instructions: "Skeletal muscle relaxant for paravertebral spasm"
        },
        {
          id: "med-4",
          drugName: "Pantoprazole 40 mg (Pan 40)",
          composition: "Pantoprazole 40mg",
          dosage: "1 tab",
          form: "Tablet",
          frequency: "1-0-0",
          timing: "Before Breakfast",
          durationDays: 7,
          instructions: "Gastroprotection against NSAID irritation"
        }
      ]),
      JSON.stringify([
        { id: "lab-1", testName: "Serum 25-OH Vitamin D3", category: "Biochemistry", urgency: "Routine" },
        { id: "lab-2", testName: "Serum Vitamin B12", category: "Biochemistry", urgency: "Routine" },
        { id: "lab-3", testName: "High Sensitivity CRP (hs-CRP)", category: "Immunology", urgency: "Routine" },
        { id: "lab-4", testName: "MRI Lumbar Spine with Screening Whole Spine", category: "Radiology", urgency: "Routine" }
      ]),
      JSON.stringify([
        "Strictly avoid forward bending at waist and lifting weights over 5 kg",
        "Maintain lumbar lordosis support with ergonomic lumbar cushion during desk work",
        "Perform McKenzie lumbar extensions 3x daily as instructed during physiotherapy",
        "Apply cold gel pack for 15 mins if tingling flares down the leg"
      ]),
      "Anti-inflammatory Mediterranean diet; increase calcium and leafy greens; drink 3L water daily.",
      "2026-09-14",
      "/api/emr/prescription/rx-101/pdf",
      now
    );

    insertRx.run(
      "rx-102",
      "RX-2026-0101",
      "pat-1",
      "Sunita Roy",
      "+91 98301 23456",
      "LUM-2026-0101",
      "doc-1",
      "Dr. Vikram Malhotra",
      "General Medicine",
      "MCI-2012-74892",
      "2026-08-25",
      "Type 2 Diabetes Mellitus with Essential Hypertension (Stage 1)",
      "E11.9 / I10",
      JSON.stringify(["Polyuria and fatigue", "Mild occipital headache in mornings"]),
      JSON.stringify([
        {
          id: "med-11",
          drugName: "Metformin 500 mg Extended Release (Glycomet-SR)",
          composition: "Metformin 500mg SR",
          dosage: "1 tab",
          form: "Tablet",
          frequency: "1-0-1",
          timing: "With Dinner",
          durationDays: 30,
          instructions: "Monitor blood sugar levels twice weekly"
        },
        {
          id: "med-12",
          drugName: "Telmisartan 40 mg (Telma 40)",
          composition: "Telmisartan 40mg",
          dosage: "1 tab",
          form: "Tablet",
          frequency: "1-0-0",
          timing: "Morning",
          durationDays: 30,
          instructions: "Take consistently at 8 AM"
        }
      ]),
      JSON.stringify([
        { id: "lab-11", testName: "HbA1c & Fasting / PP Blood Sugar", category: "Biochemistry", urgency: "Routine" },
        { id: "lab-12", testName: "Lipid Profile & Serum Creatinine", category: "Biochemistry", urgency: "Routine" }
      ]),
      JSON.stringify([
        "30 minutes brisk walking daily",
        "Reduce sodium intake <2g/day",
        "Log fasting glucose every Monday"
      ]),
      "Low glycemic index diet; avoid refined sugars, white rice, and deep-fried foods.",
      "2026-09-25",
      "/api/emr/prescription/rx-102/pdf",
      now
    );
  }

  const labCount = database.prepare("SELECT COUNT(*) AS c FROM lab_reports").get() as { c: number };
  if (labCount.c === 0) {
    const insertLab = database.prepare(`
      INSERT INTO lab_reports (id, patient_id, patient_uhid, patient_name, date, lab_name, category, doctor_interpretation, results, pdf_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLab.run(
      "lab-102",
      "pat-6",
      "LUM-2026-0106",
      "Rajiv Saxena",
      "2026-08-28",
      "Lumera Clinical Pathology & Radiology Services",
      "Renal, Electrolytes & Vitamin Profile",
      "Severe Vitamin D3 (14.2 ng/mL) & B12 (180 pg/mL) deficiencies contributing to chronic radicular muscle fatigue and delayed nerve regeneration. Mild hyperuricemia noted.",
      JSON.stringify([
        { param: "Serum 25-OH Vitamin D3", value: 14.2, unit: "ng/mL", normalRange: "30 - 100", status: "Low", trendDelta: "-2.1 ng/mL (Severe Deficiency)" },
        { param: "Serum Vitamin B12", value: 180, unit: "pg/mL", normalRange: "211 - 911", status: "Low", trendDelta: "-35 pg/mL" },
        { param: "High Sensitivity CRP (hs-CRP)", value: 4.8, unit: "mg/L", normalRange: "< 1.0", status: "High", trendDelta: "Systemic low-grade spinal inflammation" },
        { param: "Serum Uric Acid", value: 7.8, unit: "mg/dL", normalRange: "3.5 - 7.2", status: "High", trendDelta: "+0.6 mg/dL" },
        { param: "Serum Calcium", value: 9.2, unit: "mg/dL", normalRange: "8.8 - 10.2", status: "Normal", trendDelta: "Normal" },
        { param: "Serum Creatinine", value: 0.92, unit: "mg/dL", normalRange: "0.7 - 1.3", status: "Normal", trendDelta: "Stable" }
      ]),
      "/api/emr/lab-report/lab-102/pdf",
      now
    );

    insertLab.run(
      "lab-101",
      "pat-1",
      "LUM-2026-0101",
      "Sunita Roy",
      "2026-08-25",
      "Lumera Clinical Pathology & Biochemistry Lab",
      "Metabolic & Diabetes",
      "Suboptimal glycemic control (HbA1c 8.4%) with early diabetic nephropathy evidence. Serum Creatinine mildly elevated at 1.32 mg/dL. Microalbuminuria positive.",
      JSON.stringify([
        { param: "HbA1c (Glycosylated Hemoglobin)", value: 8.4, unit: "%", normalRange: "< 5.7", status: "High", trendDelta: "+0.5% vs May 2026" },
        { param: "Fasting Blood Sugar (FBS)", value: 162, unit: "mg/dL", normalRange: "70 - 99", status: "High", trendDelta: "+18 mg/dL" },
        { param: "Post-Prandial Blood Sugar (PPBS)", value: 248, unit: "mg/dL", normalRange: "< 140", status: "Critical", trendDelta: "+34 mg/dL" },
        { param: "Serum Creatinine", value: 1.32, unit: "mg/dL", normalRange: "0.6 - 1.1", status: "High", trendDelta: "+0.18 mg/dL" },
        { param: "Estimated GFR (CKD-EPI)", value: 54, unit: "mL/min/1.73m²", normalRange: "> 90", status: "Low", trendDelta: "-8 mL/min" },
        { param: "Total Cholesterol", value: 218, unit: "mg/dL", normalRange: "< 200", status: "High", trendDelta: "-12 mg/dL" }
      ]),
      "/api/emr/lab-report/lab-101/pdf",
      now
    );
  }

  const convCount = database.prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations").get() as { c: number };
  if (convCount.c === 0) {
    const insertConv = database.prepare(`
      INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, patient_id, uhid, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertConv.run(
      "conv-rajiv",
      "+91 98234 55667",
      "Rajiv Saxena",
      "pat-6",
      "LUM-2026-0106",
      "bot",
      "Ramesh Patel (Reception)",
      JSON.stringify(["Appointment", "Prescription"]),
      "en",
      0,
      "Namaste Rajiv Saxena! Welcome to Lumera Health Desk.",
      "10:15 AM",
      now
    );

    insertConv.run(
      "conv-sunita",
      "+91 98301 23456",
      "Sunita Roy",
      "pat-1",
      "LUM-2026-0101",
      "human",
      "Dr. Vikram Malhotra",
      JSON.stringify(["Prescription", "Emergency Triage"]),
      "hi",
      2,
      "नमस्ते डॉक्टर, मेरी शुगर रिपोर्ट 248 आई है, क्या मुझे इंसुलिन शुरू करना होगा?",
      "09:40 AM",
      now
    );

    insertConv.run(
      "conv-rohan",
      "+91 98200 45678",
      "Rohan Deshmukh",
      "pat-2",
      "LUM-2026-0102",
      "bot",
      "Unassigned",
      JSON.stringify(["Billing"]),
      "mr",
      0,
      "Can I get the UPI receipt for my OPD consultation fee?",
      "Yesterday",
      now
    );

    insertConv.run(
      "conv-priyanka",
      "+91 98311 44556",
      "Priyanka Mukherjee",
      "pat-7",
      "LUM-2026-0107",
      "bot",
      "Sunita Sharma (Nurse)",
      JSON.stringify(["Appointment"]),
      "en",
      1,
      "What time is Dr. Siddharth available for shoulder rehab session?",
      "Yesterday",
      now
    );

    const insertMsg = database.prepare(`
      INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, audio_url, voice_transcript, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMsg.run(
      "msg-1",
      "conv-rajiv",
      "+91 98234 55667",
      "bot",
      null,
      "Namaste Rajiv Saxena! 🙏 Welcome to *Lumera Polyclinic WhatsApp Health Desk*.\n\nHow can we help you today?",
      null,
      "en",
      "10:15 AM",
      JSON.stringify(["📅 Book Doctor Appointment", "💊 Refill / View Prescription", "🔬 Download Lab Reports", "⏰ Check Doctor Timings"]),
      null,
      null,
      null,
      "read",
      now
    );

    insertMsg.run(
      "msg-2",
      "conv-sunita",
      "+91 98301 23456",
      "user",
      null,
      "नमस्ते डॉक्टर, मेरी आज की पीपीबीएस शुगर 248 आई है। थोड़ा चक्कर आ रहा है।",
      "Hello Doctor, my post-prandial blood sugar today is 248. Feeling mild dizziness.",
      "hi",
      "09:38 AM",
      null,
      null,
      null,
      null,
      "delivered",
      now
    );

    insertMsg.run(
      "msg-3",
      "conv-sunita",
      "+91 98301 23456",
      "agent",
      "Dr. Vikram Malhotra",
      "नमस्ते सुनीता जी, मैंने आपकी फाइल देखी है। कृपया घबराएं नहीं। खूब पानी पिएं और तुरंत ओपीडी 102 में आएं। हमने आपकी प्राथमिकता टोकन लगा दी है।",
      "Namaste Sunita ji, I have reviewed your chart. Please do not panic. Drink plenty of water and report immediately to OPD Room 102. Priority triage token assigned.",
      "hi",
      "09:42 AM",
      null,
      null,
      null,
      null,
      "read",
      now
    );
  }

  const eventCount = database.prepare("SELECT COUNT(*) AS c FROM whatsapp_outbound_events").get() as { c: number };
  if (eventCount.c === 0) {
    const insertEvent = database.prepare(`
      INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(
      "evt-1",
      "appointment_reminder",
      "+91 98234 55667",
      "Rajiv Saxena",
      "delivered",
      "Pre-visit reminder for Dr. Siddharth Varma at 09:00 AM. Token #01.",
      JSON.stringify({ token: 1, doctor: "Dr. Siddharth Varma (PT)", time: "09:00 AM", buttons: ["Confirm Arrival", "Reschedule"] }),
      now
    );

    insertEvent.run(
      "evt-2",
      "post_consultation_dispatch",
      "+91 98234 55667",
      "Rajiv Saxena",
      "read",
      "Digital prescription RX-2026-0106 & diagnostic receipt dispatched with direct PDF link.",
      JSON.stringify({ rxNumber: "RX-2026-0106", pdfUrl: "/api/emr/prescription/rx-101/pdf", amount: 700 }),
      now
    );

    insertEvent.run(
      "evt-3",
      "queue_token_update",
      "+91 98311 44556",
      "Priyanka Mukherjee",
      "delivered",
      "Live OPD queue alert: You are next in line (Token #02). Please proceed to Rehab Suite 105.",
      JSON.stringify({ token: 2, queuePosition: 1, room: "Rehab Suite 105" }),
      now
    );
  }
}

export function ensureMetaTechProviderAndPolicies(database: DatabaseSync) {
  const now = new Date().toISOString();

  // 1. Ensure Meta Compliance Policies exist in cms_policies
  const insertOrReplacePolicy = database.prepare(`
    INSERT INTO cms_policies (slug, title, body, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at
  `);

  const privacyPolicyContent = `# Lumera Privacy Policy & WhatsApp Cloud API Notice

**Last Updated:** September 2026  
**Effective Date:** January 1, 2026  
**Provider:** Lumera Solutions LLP (“Lumera”, “we”, “our”, or “us”)  
**Designated Compliance Contact:** dpo@lumera.me | privacy@lumera.health  

---

### 1. Overview & WhatsApp Cloud API status
Lumera operates a clinical practice operating system with a WhatsApp Cloud API integration path. **Lumera is not a certified Meta Tech Provider or Business Solution Provider, and Meta App Review is not submitted.** Copy in this policy describes intended processing once Cloud API credentials are configured; it is not a certification claim.

### 2. Scope of WhatsApp & User Data Handled
When clinics connect their WhatsApp Business Accounts (WABA) or when patients interact via the Lumera WhatsApp Desk, we process:
- **Phone Numbers & Identifiers:** Patient mobile numbers (E.164 standard), Unique Healthcare Identifiers (UHID), and Meta Phone Number IDs.
- **Transactional Messages:** Appointment tokens, schedule changes, OPD reminders, and doctor follow-up notices.
- **Clinical Artifacts:** Encrypted PDF links for diagnostic reports and physician-authorized digital prescriptions.
- **Opt-In & Consent Records:** Timestamped affirmative patient consents collected during clinic intake or conversational opt-in.
- **Technical Telemetry:** Webhook delivery receipts (sent, delivered, read), quality indicators, and error diagnostics.

### 3. Purpose of Processing & Meta Terms Compliance
All WhatsApp messaging is processed strictly in accordance with:
1. **Meta WhatsApp Business Messaging Policy**
2. **Meta Commerce Policy & Developer Terms**
3. **India Digital Personal Data Protection (DPDP) Act & ABDM Health Data Management Policy**

We **NEVER** sell personal or medical data to third parties, advertising brokers, or unauthorized entities. Data is processed solely to fulfill requested clinical operations, facilitate physician-patient communication, and maintain regulatory compliance.

### 4. Data Storage, Encryption & Security
- **Encryption in Transit:** All communications between Meta Graph API, Lumera edge nodes, and clinic servers are encrypted via TLS 1.3.
- **Encryption at Rest:** Patient identifiers, access tokens, and clinical notes are safeguarded using AES-256-GCM encryption with periodic key rotation.
- **Access Control:** Role-Based Access Control (RBAC) isolates super-admins, clinicians, reception desks, and patient portal sessions.

### 5. Subprocessors
- **Meta Platforms, Inc. / Meta Platforms Ireland Ltd:** WhatsApp Business Platform API and Webhook infrastructure.
- **Google Cloud Platform:** Secure container hosting and cloud infrastructure.
- **Google Gemini API:** Server-side clinical transcription and note structuring (runs with zero data retention for training).

### 6. Data Deletion & User Rights
Patients and clinic administrators retain full rights to request access, rectification, or complete erasure of their data. See our dedicated [Data Deletion Instructions](/data-deletion-instructions) or email our Data Protection Officer directly at **dpo@lumera.me**.`;

  const termsOfServiceContent = `# Lumera Enterprise Clinical Terms of Service & Meta WhatsApp Usage Terms

**Last Updated:** September 2026  
**Jurisdiction:** India & Global Healthcare Cloud  
**Contact:** legal@lumera.health  

---

### 1. Agreement to Terms
These Terms of Service (“Terms”) constitute a binding legal agreement between Lumera Solutions LLP (“Lumera”) and the registered healthcare facility or medical practitioner (“Tenant”, “Clinic”, or “You”). By utilizing the Lumera Clinician Suite, Admin CMS, or WhatsApp Embedded Signup, you agree to be bound by these Terms.

### 2. WhatsApp Business Account (WABA) & Cloud API governance
- **Integration role:** Lumera may act as software that calls Meta Graph APIs on behalf of a clinic after the clinic connects a WABA. This is not Meta Tech Provider certification.
- **Account Ownership:** The Clinic retains full ownership and control of its WhatsApp Business Account, verified phone numbers, and display names.
- **Acceptable Use & Anti-Spam:** Clinics must strictly adhere to the Meta WhatsApp Business Messaging Policy. Unsolicited promotional broadcasts, deceptive advertising, or non-consented bulk messages are strictly prohibited and constitute grounds for immediate service suspension.
- **Prior Patient Consent:** The Clinic warrants that it has collected valid, revocable patient consent prior to initiating outbound WhatsApp notifications.

### 3. Clinical Responsibility & AI Assistive Scope
- Lumera provides assistive decision-support tools, including ambient SOAP transcription, triage drafting, and prescription generation.
- **Licensed Practitioner Prerogative:** All AI-generated suggestions, diagnostic summaries, and prescription drafts are strictly advisory. The licensed treating clinician remains solely responsible for medical diagnosis, treatment plans, and clinical record accuracy.

### 4. Service Availability & SLA
Lumera targets 99.9% platform availability for core clinical and WhatsApp webhook processing. Scheduled maintenance windows are announced in advance in the Admin Audit Log.

### 5. Termination & Data Portability
Upon account termination or cancellation, Clinics may export all patient records, EMR notes, and appointment histories in standard FHIR / HL7 compliant formats within thirty (30) days.`;

  const dataDeletionContent = `# Lumera Data Deletion Instructions (Meta App Review Compliance)

**Last Updated:** September 2026  
**Applicable For:** Meta WhatsApp Embedded Signup, Facebook Login & Lumera Patient Portal  
**Compliance Authority:** Meta Platform Terms §4.b & GDPR / India DPDP Act  
**Direct Data Protection Office:** dpo@lumera.me | compliance@lumera.health  

---

### Overview
In accordance with Meta Platform Terms, GDPR, and India's Digital Personal Data Protection (DPDP) Act, all users, clinicians, and patients have the unconditional right to request the complete deletion of their personal data, WhatsApp message records, and account credentials collected through the Lumera application.

Below are the step-by-step instructions on how to request and confirm data erasure.

---

### Option 1: Automated Self-Service Deletion (Within Facebook / Meta Account)
If you connected Lumera through Facebook Login or WhatsApp Embedded Signup:
1. Log into your **Facebook** or **Meta Business Suite** account.
2. Navigate to **Settings & Privacy** > **Settings**.
3. In the left navigation menu, click **Apps and Websites**.
4. Search for or locate **Lumera Health** in your connected applications list.
5. Click **Remove** to revoke Lumera's access to your profile and business assets.
6. Click **View removed apps and websites**, find Lumera, and click **Send Request** to trigger Meta's automated data deletion callback.
7. Meta will invoke Lumera's Automated Deletion Endpoint (\`/api/meta/data-deletion\`), which will immediately generate a unique **Confirmation Code** for tracking.

---

### Option 2: Automated Direct API Request
Patients and developers can trigger or verify data deletion directly via our verified compliance endpoint:
- **Deletion Endpoint:** \`POST /api/meta/data-deletion\`
- **Status Verification Endpoint:** \`GET /api/meta/data-deletion-status?code={CONFIRMATION_CODE}\`
- Response provides an instant JSON tracking object with confirmation code, timestamp, and audit trail.

---

### Option 3: Manual Deletion Request via Data Protection Officer
You may submit a written deletion request directly to our Data Protection Office:
- **Email:** \`dpo@lumera.me\` or \`compliance@lumera.health\`
- **Subject Line:** \`Meta Data Deletion Request - [Your Phone Number / Email]\`
- **Required Details:**
  1. Your full name or Clinic practice name.
  2. Registered phone number (with country code) or email address.
  3. WhatsApp Business Account ID (WABA ID) if you are a clinic administrator.
- **SLA:** Our team processes and verifies manual requests within **24 to 48 business hours**, permanently purging database entries, session tokens, and cached media. A formal Certificate of Erasure will be emailed to you upon completion.

---

### Scope of Data Erased
Upon execution of a data deletion request:
- All authentication sessions, passwords, and Meta Access Tokens are invalidated and deleted.
- WhatsApp conversation threads and cached media files under \`/uploads\` are permanently erased.
- Non-clinical contact entries and marketing preferences are purged.
- *Note:* Legally mandated medical records governed by statutory clinical retention regulations (e.g. state medical council archives) will be anonymized in compliance with applicable healthcare statutes.`;

  // Seed both short and long slug forms for seamless navigation
  insertOrReplacePolicy.run("privacy-policy", "Privacy Policy", privacyPolicyContent, now);
  insertOrReplacePolicy.run("privacy", "Privacy Policy", privacyPolicyContent, now);
  insertOrReplacePolicy.run("terms-of-service", "Terms of Service", termsOfServiceContent, now);
  insertOrReplacePolicy.run("terms", "Terms of Service", termsOfServiceContent, now);
  insertOrReplacePolicy.run("data-deletion-instructions", "Data Deletion Instructions", dataDeletionContent, now);
  insertOrReplacePolicy.run("data-deletion", "Data Deletion Instructions", dataDeletionContent, now);

  // 2. Ensure Primary Tenant has WABA credentials configured
  const mainTenant = database.prepare("SELECT * FROM tenants WHERE id = 'tenant-lumera-main'").get() as any;
  if (mainTenant && (!mainTenant.waba_id || mainTenant.waba_id === "")) {
    database.prepare(`
      UPDATE tenants 
      SET waba_id = 'waba_398249018247019',
          phone_number_id = 'phone_982345566701',
          meta_access_token = 'EAAJ...verified_system_user_token_lumera_prod_2026',
          meta_token_expires_at = 'SANDBOX / DEV-ONLY local token',
          meta_waba_name = 'Lumera Apex PolyClinic (SANDBOX WABA)',
          meta_quality_rating = 'UNKNOWN',
          meta_onboarding_status = 'connected',
          updated_at = ?
      WHERE id = 'tenant-lumera-main'
    `).run(now);
  }

  // 3. Ensure Secondary Multi-Tenant Practice exists for WABA directory demonstration
  const rehabTenant = database.prepare("SELECT * FROM tenants WHERE id = 'tenant-rehab-mumbai'").get();
  if (!rehabTenant) {
    const trialEnds = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare(`
      INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, waba_id, phone_number_id, meta_access_token, meta_token_expires_at, meta_waba_name, meta_quality_rating, meta_onboarding_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 600, 120, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "tenant-rehab-mumbai",
      "Lumera Specialty Care & Rehab Center",
      "Physiotherapy & Rehabilitation",
      "India",
      "IST (UTC+5:30)",
      "+91 22 2640 1234",
      trialEnds,
      "HFR-MH-5529188",
      "waba_489201948102394",
      "phone_982001234502",
      "EAAJ...verified_system_user_token_rehab_mumbai_2026",
      "SANDBOX / DEV-ONLY local token",
      "Lumera Rehab & Sports Clinic (SANDBOX)",
      "UNKNOWN",
      "connected",
      now,
      now
    );
  }

  // 4. Ensure Meta WhatsApp Templates exist in meta_templates
  const templateCount = (database.prepare("SELECT COUNT(*) AS c FROM meta_templates").get() as { c: number }).c;
  if (templateCount === 0) {
    const insertTemplate = database.prepare(`
      INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, meta_template_id, rejection_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const standardTemplates = [
      {
        id: "tpl-1",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "appointment_reminder_v1",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Appointment Confirmation - Lumera Health" },
          {
            type: "BODY",
            text: "Hello {{1}}, your consultation with {{2}} is confirmed for {{3}} at {{4}}. Your OPD Token is #{{5}}. Please arrive 10 minutes prior to your slot.",
            example: { body_text: [["Rajiv Saxena", "Dr. Vikram Malhotra", "Tomorrow", "09:30 AM", "04"]] }
          },
          { type: "FOOTER", text: "Lumera Apex PolyClinic • Indiranagar, Bengaluru" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Confirm Arrival" },
              { type: "QUICK_REPLY", text: "Reschedule Slot" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948102",
        rejection_reason: null
      },
      {
        id: "tpl-2",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "post_consultation_rx",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "DOCUMENT" },
          {
            type: "BODY",
            text: "Dear {{1}}, thank you for consulting Dr. {{2}}. Your digital prescription (Rx: {{3}}) and itemized consultation receipt are attached above. You can view dosage schedules anytime on your Lumera Portal.",
            example: { body_text: [["Sunita Roy", "Vikram Malhotra", "RX-2026-0101"]] }
          },
          { type: "FOOTER", text: "Lumera Health EMR System • Certified Digital Rx" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "URL", text: "Open Patient Portal", url: "https://lumera.health/portal" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948103",
        rejection_reason: null
      },
      {
        id: "tpl-3",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "lab_report_ready",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Diagnostic Pathology Report" },
          {
            type: "BODY",
            text: "Namaste {{1}}, your test results for {{2}} conducted on {{3}} have been signed off by the pathologist and are now ready for download.",
            example: { body_text: [["Rajiv Saxena", "Renal & Vitamin Profile", "28 Aug 2026"]] }
          },
          { type: "FOOTER", text: "Lumera Central Diagnostics" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Download PDF" },
              { type: "QUICK_REPLY", text: "Book Follow-up" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948104",
        rejection_reason: null
      },
      {
        id: "tpl-4",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "opd_queue_token_alert",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          { type: "HEADER", format: "TEXT", text: "Live Queue Update" },
          {
            type: "BODY",
            text: "Patient Alert: Token #{{1}} ({{2}}). You are next in line for {{3}}. Please proceed to {{4}}.",
            example: { body_text: [["02", "Priyanka Mukherjee", "Dr. Siddharth Varma", "Rehab Suite 105"]] }
          },
          { type: "FOOTER", text: "Live OPD Triage System" }
        ]),
        meta_template_id: "meta_tpl_983102948105",
        rejection_reason: null
      },
      {
        id: "tpl-5",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "otp_login_verification",
        category: "AUTHENTICATION",
        language: "en",
        status: "APPROVED",
        components: JSON.stringify([
          {
            type: "BODY",
            text: "Your Lumera Health verification code is {{1}}. Valid for 5 minutes. Never share this code with anyone.",
            example: { body_text: [["492810"]] }
          },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Copy Code" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948106",
        rejection_reason: null
      },
      {
        id: "tpl-6",
        tenant_id: "tenant-lumera-main",
        waba_id: "waba_398249018247019",
        name: "preventive_cardiac_camp",
        category: "MARKETING",
        language: "en",
        status: "PENDING",
        components: JSON.stringify([
          { type: "HEADER", format: "IMAGE" },
          {
            type: "BODY",
            text: "Dear {{1}}, Lumera Health is organizing a Comprehensive Cardiac Wellness Camp on Saturday, {{2}}. Includes ECG, Lipid Profile & Senior Cardiologist consultation at 50% discount.",
            example: { body_text: [["Rajiv", "15 September 2026"]] }
          },
          { type: "FOOTER", text: "Reply STOP to unsubscribe from health updates" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Book Camp Slot" },
              { type: "QUICK_REPLY", text: "View Details" }
            ]
          }
        ]),
        meta_template_id: "meta_tpl_983102948107",
        rejection_reason: null
      }
    ];

    for (const tpl of standardTemplates) {
      insertTemplate.run(
        tpl.id,
        tpl.tenant_id,
        tpl.waba_id,
        tpl.name,
        tpl.category,
        tpl.language,
        tpl.status,
        tpl.components,
        tpl.meta_template_id,
        tpl.rejection_reason,
        now,
        now
      );
    }
  }
}

/**
 * Ensures existing clinical patients have verified ABHA numbers & addresses,
 * and seeds qualifying DHIS transactions for current month progress meter.
 */
export function ensureAbdmAndDhisSeeding(database: DatabaseSync) {
  const now = new Date().toISOString();
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const defaultHfrId = "HFR-IN-8829104";

  // 1. Enrich existing patients with ABHA details
  const updatePatientAbha = database.prepare(`
    UPDATE patients 
    SET abha_number = ?, abha_address = ?, kyc_status = ?, hfr_id = ?
    WHERE id = ?
  `);

  const abhaSeedMap: Record<string, { abhaNumber: string; abhaAddress: string; kycStatus: string }> = {
    "pat-6": { abhaNumber: "91-4428-9102-3841", abhaAddress: "rajiv.saxena@abdm", kycStatus: "VERIFIED" },
    "pat-7": { abhaNumber: "91-7291-0384-9182", abhaAddress: "priyanka.m@abdm", kycStatus: "VERIFIED" },
    "pat-1": { abhaNumber: "91-8840-2910-4491", abhaAddress: "sunita.roy@abdm", kycStatus: "VERIFIED" },
    "pat-2": { abhaNumber: "91-5519-3829-1048", abhaAddress: "rohan.deshmukh@abdm", kycStatus: "VERIFIED" },
    "pat-4": { abhaNumber: "91-9928-1029-4820", abhaAddress: "mohd.tariq@abdm", kycStatus: "VERIFIED" },
    "pat-3": { abhaNumber: "91-3829-4019-2810", abhaAddress: "aarav.gupta@abdm", kycStatus: "PENDING" },
  };

  for (const [id, data] of Object.entries(abhaSeedMap)) {
    try {
      updatePatientAbha.run(data.abhaNumber, data.abhaAddress, data.kycStatus, defaultHfrId, id);
    } catch {}
  }

  // 2. Set HPR ID for doctors if missing
  try {
    database.prepare("UPDATE doctors SET hpr_id = 'HPR-IN-9024819' WHERE id = 'doc-1' AND (hpr_id IS NULL OR hpr_id = '')").run();
    database.prepare("UPDATE doctors SET hpr_id = 'HPR-IN-9024820' WHERE id = 'doc-2' AND (hpr_id IS NULL OR hpr_id = '')").run();
    database.prepare("UPDATE doctors SET hpr_id = 'HPR-IN-9024821' WHERE id = 'doc-3' AND (hpr_id IS NULL OR hpr_id = '')").run();
  } catch {}

  // 3. Seed DHIS transactions if fewer than 10 for the current month
  try {
    const existing = database.prepare(`
      SELECT COUNT(*) as count 
      FROM dhis_transactions 
      WHERE month_year = ? AND transaction_type IS NOT NULL AND status = 'QUALIFIED'
    `).get(currentMonth) as { count: number };

    if ((existing?.count || 0) < 10) {
      const insertDhis = database.prepare(`
        INSERT INTO dhis_transactions (
          id, tenant_id, transaction_type, patient_id, abha_address, abha_number,
          kyc_status, record_id, fhir_bundle_id, incentive_amount, clinic_share, lumera_share,
          status, month_year, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUALIFIED', ?, ?, ?)
      `);

      const patientPool = [
        { id: "pat-6", abha: "rajiv.saxena@abdm", num: "91-4428-9102-3841" },
        { id: "pat-7", abha: "priyanka.m@abdm", num: "91-7291-0384-9182" },
        { id: "pat-1", abha: "sunita.roy@abdm", num: "91-8840-2910-4491" },
        { id: "pat-2", abha: "rohan.deshmukh@abdm", num: "91-5519-3829-1048" },
        { id: "pat-4", abha: "mohd.tariq@abdm", num: "91-9928-1029-4820" },
      ];

      const typeDist: Array<"OP_CONSULT" | "PRESCRIPTION" | "DIAGNOSTIC_REPORT" | "DISCHARGE_SUMMARY"> = [
        "OP_CONSULT", "OP_CONSULT", "OP_CONSULT",
        "PRESCRIPTION", "PRESCRIPTION",
        "DIAGNOSTIC_REPORT",
        "DISCHARGE_SUMMARY",
      ];

      // Seed 78 qualifying transactions to set progress meter at 78% of the 100-threshold
      const seedCount = 78;
      for (let i = 1; i <= seedCount; i++) {
        const p = patientPool[(i - 1) % patientPool.length];
        const txType = typeDist[(i - 1) % typeDist.length];
        const dayOffset = Math.floor((i / seedCount) * 8); // Spread over past 8 days
        const txDate = new Date(Date.now() - (8 - dayOffset) * 86400000 + (i * 123456) % 3600000).toISOString();

        insertDhis.run(
          `dhis-init-tx-${String(i).padStart(3, "0")}`,
          "tenant-lumera-main",
          txType,
          p.id,
          p.abha,
          p.num,
          "VERIFIED",
          `rec-abdm-${i}`,
          `bundle-nrc-r4-${String(i).padStart(4, "0")}`,
          20, // ₹20 total incentive
          14, // ₹14 (70%) clinic share
          6,  // ₹6 (30%) Lumera digital solution share
          currentMonth,
          txDate,
          txDate
        );
      }
    }
  } catch (err) {
    console.error("Error seeding DHIS transactions:", err);
  }
}



