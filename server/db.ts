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
  `);
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
    INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
      d.email
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
    qualification: row.qualification as string,
    regNumber: row.reg_number as string,
    specialty: row.specialty as string,
    experienceYears: Number(row.experience_years),
    consultationFee: Number(row.consultation_fee),
    opdRoom: row.opd_room as string,
    availableDays: JSON.parse((row.available_days as string) || "[]"),
    opdTiming: row.opd_timing as string,
    phone: row.phone as string,
    email: row.email as string,
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
