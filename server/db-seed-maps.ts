import { hashPassword } from "./password.ts";
import { scrubSeedBillingIds } from "./seed-branding.ts";
import { CMS_POLICY_UPSERTS } from "./cms-policy-seed.ts";
import { type SqlDatabase } from "./sql-engine.ts";
import {
  DEMO_SPECIALTY_MATRIX,
  assertPacksDifferByMoreThanLabel,
  canonicalSpecialty,
  getSpecialtyPack,
  resolveSpecialtyPack,
  roleHomeForAccount,
} from "./specialty-packs.ts";
import { PRODUCT_NAME } from "../src/brand.ts";
import { DEMO_TENANT_ID, getDb, type DbUser, isDemoWorkspaceUser, normalizePracticeType } from "./db.ts";
import { ensureDemoTenantLetterhead } from "./db-migrate.ts";

export function assignDemoTenantToUnscopedClinicalRows(database: SqlDatabase) {
  try {
    database.exec(`UPDATE patients SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE appointments SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE prescriptions SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
  } catch {}
}

export const DEMO_PASSWORD = "Lumera@2026";

export const DOCTOR_SEED = [
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

export function seedIfEmpty(database: SqlDatabase) {
  const existing = database.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (existing.c > 0) return;

  const now = new Date().toISOString();
  const passwordHash = hashPasswordSync(DEMO_PASSWORD);

  const insertUser = database.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, status, phone, last_login, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?)
  `);

  // #70 role model: admin@ platform Super Admin (no Branches); doctor@ Individual master; reception@ Individual sub.
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

  // Seeded branches belong to the polyclinic demo — CLINIC_ADMIN owns CRUD, not Super Admin (#70).
  const insertBranch = database.prepare(`
    INSERT INTO branches (id, tenant_id, name, address, phone, opd_hours, active_doctors, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertBranch.run("b-1", "tenant-lumera-main", "Lumera Central Polyclinic & Diagnostics", "Indiranagar 100ft Road, Bengaluru", "+91 80 4123 4567", "08:00 AM - 09:00 PM", 8, "Operating");
  insertBranch.run("b-2", "tenant-lumera-main", "Lumera Specialty Care & Rehab Center", "Bandra West, Mumbai", "+91 22 2640 1234", "09:00 AM - 08:00 PM", 5, "Operating");
  insertBranch.run("b-3", "tenant-lumera-main", "Lumera Day Surgery & Eye Clinic", "Koramangala 4th Block, Bengaluru", "+91 80 4987 6543", "08:30 AM - 07:00 PM", 4, "Operating");

  seedCms(database, now);
  writeAudit(database, "user-admin", "System Admin", "Seed", "Initial SQLite database seeded with demo users, CMS, and clinic roster");
}

export function hashPasswordSync(password: string): string {
  return hashPassword(password);
}

export function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function seedSubscriptionsIfMissing(database: SqlDatabase) {
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

export function mapSubscription(row: { [key: string]: unknown }, user?: { name: string; email: string; phone: string }) {
  const ends = (row.ends_at as string) || null;
  let daysRemaining: number | null = null;
  if (ends) {
    daysRemaining = Math.ceil((new Date(ends).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
  const billingSource = String(row.billing_source || "manual");
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tenantId: (row.tenant_id as string) || "",
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    status: row.status as string,
    planType: row.plan_type as string,
    planCode: (row.plan_code as string) || "",
    monthlyPrice: Number(row.monthly_price),
    autoRenew: Boolean(row.auto_renew),
    startedAt: row.started_at as string,
    endsAt: ends,
    notes: (row.notes as string) || "",
    daysRemaining,
    billingSource,
    honestyLabel: billingSource,
    paymentCollected: false,
  };
}

export function seedCms(database: SqlDatabase, now: string) {
  const set = database.prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?)");
  const settings: { [key: string]: string } = {
    brand_name: PRODUCT_NAME,
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
    { title: "ABDM-aligned (NHA sandbox)", desc: "ABHA ID integration path, digital consent, and sandbox-unverified health records — not production HIU/HIP approval." },
  ];
  features.forEach((f, i) => insertSection.run(`feat-${i + 1}`, "feature", i, JSON.stringify(f)));

  const personas = [
    { title: "Doctors & Clinics", desc: "AI prescriptions, patient records, ABDM sandbox path" },
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

export type DataDeletionRequestRow = {
  confirmation_code: string;
  status: string;
  user_ref: string;
  created_at: string;
  processed_at: string | null;
};

export function insertDataDeletionRequest(
  database: SqlDatabase,
  confirmationCode: string,
  userRef = ""
): DataDeletionRequestRow {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO meta_data_deletion_requests (confirmation_code, status, user_ref, created_at, processed_at)
       VALUES (?, 'pending', ?, ?, NULL)`
    )
    .run(confirmationCode, userRef, now);
  return {
    confirmation_code: confirmationCode,
    status: "pending",
    user_ref: userRef,
    created_at: now,
    processed_at: null,
  };
}

export function findDataDeletionRequest(
  database: SqlDatabase,
  confirmationCode: string
): DataDeletionRequestRow | undefined {
  return database
    .prepare(
      `SELECT confirmation_code, status, user_ref, created_at, processed_at
       FROM meta_data_deletion_requests WHERE confirmation_code = ?`
    )
    .get(confirmationCode) as DataDeletionRequestRow | undefined;
}

export function writeAudit(database: SqlDatabase, userId: string | null, userName: string, action: string, details: string) {
  database.prepare(
    "INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), new Date().toISOString(), userId, userName, action, details);
}

export function parseJsonColumn(value: unknown, fallback: any): any {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
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
  "followUpTimeSlot",
  "followUpAppointmentId",
  "followUpBookingRef",
] as const;

/** Patient JSON never presents unlocked KYC. Leftover rows remap to LINKED_SANDBOX. */
export function presentPatientKyc(raw: unknown): string {
  const kyc = String(raw || "").trim() || "PENDING";
  if (/^verified$/i.test(kyc) || /government|unlocked/i.test(kyc)) {
    return "LINKED_SANDBOX";
  }
  return kyc;
}

export function mapPatient(row: { [key: string]: unknown }) {
  return {
    id: row.id as string,
    uhid: row.uhid as string,
    name: row.name as string,
    age: Number(row.age || 0),
    gender: (row.gender as string) || "Other",
    phone: row.phone as string,
    email: (row.email as string) || "",
    bloodGroup: (row.blood_group as string) || "",
    allergies: parseJsonColumn(row.allergies, []),
    chronicConditions: parseJsonColumn(row.chronic_conditions, []),
    emergencyContact: (row.emergency_contact as string) || "",
    address: (row.address as string) || "",
    lastVisit: (row.last_visit as string) || undefined,
    abhaNumber: (row.abha_number as string) || "",
    abhaAddress: (row.abha_address as string) || "",
    kycStatus: presentPatientKyc(row.kyc_status),
    hfrId: (row.hfr_id as string) || "",
    abhaLinkedAt: (row.abha_linked_at as string) || "",
  };
}

export function mapConsentArtefact(row: { [key: string]: unknown }) {
  const parsed = parseJsonColumn(row.artefact_json, {});
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    patientId: row.patient_id as string,
    consentId: (row.consent_id as string) || String(parsed.consentId || ""),
    createdAt: (row.created_at as string) || "",
    updatedAt: (row.updated_at as string) || "",
    status: parsed.status,
    dateRange: parsed.dateRange as { from?: string; to?: string } | undefined,
    ...parsed,
  };
}

export function mapAppointment(row: { [key: string]: unknown }) {
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

export function mapPrescription(row: { [key: string]: unknown }) {
  const modules = parseJsonColumn(row.specialty_modules, {});
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
    chiefComplaints: parseJsonColumn(row.chief_complaints, []),
    medicines: parseJsonColumn(row.medicines, []),
    labTests: parseJsonColumn(row.lab_tests, []),
    advice: parseJsonColumn(row.advice, []),
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

export function mapDoctor(row: { [key: string]: unknown }) {
  return {
    id: row.id as string,
    userId: (row.user_id as string) || null,
    name: row.name as string,
    qualification: (row.qualification as string) || "",
    regNumber: (row.reg_number as string) || "",
    specialty: row.specialty as string,
    packId: (row.pack_id as string) || resolveSpecialtyPack(String(row.specialty || ""))?.id || "",
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
    const ids = scrubSeedBillingIds(tenantId, {
      gstin: String(row?.gstin || ""),
      upiId: String(row?.upi_id || ""),
    });
    return {
      name: String(row?.name || ""),
      gstin: ids.gstin,
      upiId: ids.upiId,
    };
  } catch {
    return { name: "", gstin: "", upiId: "" };
  }
}

export function mapInvoice(row: { [key: string]: unknown }) {
  const ids = scrubSeedBillingIds(String(row.tenant_id || ""), {
    gstin: (row.gstin as string) || "",
    upiId: (row.upi_id as string) || "",
  });
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
    gstin: ids.gstin,
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
    upiId: ids.upiId,
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
    specialty: canonicalSpecialty(String(user.specialty || user.pack_id || "")),
    ...roleHomeForAccount(user.role, canonicalSpecialty(String(user.specialty || user.pack_id || ""))),
    isDemoWorkspace: isDemoWorkspaceUser(user),
    gstin: billing.gstin,
    upiId: billing.upiId,
  };
}

