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
  | "super_admin"
  | "patient";

export type UserStatus = "active" | "invited" | "disabled";

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  phone: string;
  last_login: string | null;
  created_at: string;
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
      created_at TEXT NOT NULL
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
    active: Boolean(row.active),
  };
}

export function publicUser(user: DbUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    phone: user.phone,
    lastLogin: user.last_login,
    createdAt: user.created_at,
  };
}

export function seedClinicalAndWhatsAppIfMissing(database: DatabaseSync) {
  const patientCount = database.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number };
  const now = new Date().toISOString();

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

