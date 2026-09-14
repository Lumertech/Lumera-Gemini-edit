import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./password.ts";
import { scrubSeedBillingIds } from "./seed-branding.ts";
import { CMS_POLICY_UPSERTS } from "./cms-policy-seed.ts";
import { ensureDemoPersonaUsers } from "./demo-seed.ts";
import {
  DEMO_SPECIALTY_MATRIX,
  assertPacksDifferByMoreThanLabel,
  canonicalSpecialty,
  getSpecialtyPack,
  resolveSpecialtyPack,
  roleHomeForAccount,
} from "./specialty-packs.ts";
import { ensurePlatformTenantSchema, seedPlatformTenantData } from "./platform-tenants.ts";
import { openConfiguredDatabase } from "./sql-open.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import { DOCTOR_SEED, META_WHATSAPP_TEMPLATE_SEED, seedCms } from "./db-seed-sql.ts";
import { ensureDemoTenantLetterhead, seedClinicalAndWhatsAppIfMissing } from "./db-clinical-seed.ts";
import { migrate } from "./db-migrate.ts";

export type { SqlDatabase } from "./sql-engine.ts";

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
  pack_id?: string;
}

export const DEMO_TENANT_ID = "tenant-lumera-main";

export function normalizePracticeType(value?: string | null): "individual" | "polyclinic" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "polyclinic" || raw === "multispecialty" || raw === "multi-specialty" || raw === "multi_specialty") {
    return "polyclinic";
  }
  return "individual";
}

/** Individual founders are the doctor master (receptionist is the sub). Polyclinic founders are CLINIC_ADMIN and own Branches. Super Admin is never assigned here. */
export function assignedRoleForPracticeType(
  practiceType: "individual" | "polyclinic",
  currentRole?: string | null
): UserRole {
  if (currentRole === "super_admin" || currentRole === "patient" || currentRole === "receptionist") {
    return currentRole;
  }
  return practiceType === "polyclinic" ? "CLINIC_ADMIN" : "doctor";
}

export function isDemoWorkspaceUser(user: { id?: string; tenant_id?: string; email?: string }): boolean {
  if (user.tenant_id === DEMO_TENANT_ID) return true;
  const email = String(user.email || "").toLowerCase();
  if (email.endsWith("@lumera.me")) return true;
  return String(user.id || "").startsWith("user-") && ["user-admin", "user-doctor", "user-patient", "user-reception", "user-receptionist"].includes(String(user.id || ""));
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

let db: SqlDatabase | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db as unknown as DatabaseSync;
}

export function initDatabase(): DatabaseSync {
  db = openConfiguredDatabase();
  const database = db as unknown as DatabaseSync;
  migrate(database);
  seedIfEmpty(database);
  seedSubscriptionsIfMissing(database);
  seedClinicalAndWhatsAppIfMissing(database);
  seedDemoSpecialtyPackUsers(database);
  ensureDemoPersonaUsers(database);
  seedSubscriptionsIfMissing(database);
  assignDemoTenantToUnscopedClinicalRows(database);
  ensureMetaTechProviderAndPolicies(database);
  ensureAbdmAndDhisSeeding(database);
  seedPlatformTenantData(database);
  return database;
}

export function assignDemoTenantToUnscopedClinicalRows(database: DatabaseSync) {
  try {
    database.exec(`UPDATE patients SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE appointments SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
    database.exec(`UPDATE prescriptions SET tenant_id = '${DEMO_TENANT_ID}' WHERE tenant_id IS NULL OR tenant_id = ''`);
  } catch {}
}

const DEMO_PASSWORD = "Lumera@2026";

function seedIfEmpty(database: DatabaseSync) {
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

export type DataDeletionRequestRow = {
  confirmation_code: string;
  status: string;
  user_ref: string;
  created_at: string;
  processed_at: string | null;
};

export function insertDataDeletionRequest(
  database: DatabaseSync,
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
  database: DatabaseSync,
  confirmationCode: string
): DataDeletionRequestRow | undefined {
  return database
    .prepare(
      `SELECT confirmation_code, status, user_ref, created_at, processed_at
       FROM meta_data_deletion_requests WHERE confirmation_code = ?`
    )
    .get(confirmationCode) as DataDeletionRequestRow | undefined;
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
    kycStatus: presentPatientKyc(row.kyc_status),
    hfrId: (row.hfr_id as string) || "",
    abhaLinkedAt: (row.abha_linked_at as string) || "",
  };
}

export function mapConsentArtefact(row: Record<string, unknown>) {
  const parsed = parseJsonColumn<Record<string, unknown>>(row.artefact_json, {});
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

export function mapInvoice(row: Record<string, unknown>) {
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

function backfillUserSpecialtyEnum(database: DatabaseSync) {
  try {
    const users = database.prepare("SELECT id, specialty, pack_id FROM users").all() as {
      id: string;
      specialty?: string;
      pack_id?: string;
    }[];
    const updateUser = database.prepare("UPDATE users SET specialty = ?, pack_id = ? WHERE id = ?");
    for (const u of users) {
      const pack = resolveSpecialtyPack(u.specialty || u.pack_id || "");
      if (!pack) continue;
      if (u.specialty === pack.id && (u.pack_id === pack.id || !u.pack_id)) continue;
      updateUser.run(pack.id, pack.id, u.id);
    }
  } catch {
    /* specialty / pack_id columns added in the same migrate() pass */
  }
}

/**
 * Demo UM-5 matrix on tenant-lumera-main only. Never copies these logins onto real tenants.
 * Existing emails on a non-demo tenant are left untouched.
 *
 * Complementary to #55 AdminShell seeds: if therapist@ / consultant@ already exist,
 * only canonicalize users.specialty + pack_id. Do not overwrite #55 persona name/role/phone
 * or clinical doctors.specialty display labels.
 */
export function seedDemoSpecialtyPackUsers(database: DatabaseSync) {
  assertPacksDifferByMoreThanLabel();
  backfillUserSpecialtyEnum(database);

  const demoTenant = database.prepare("SELECT id FROM tenants WHERE id = ?").get(DEMO_TENANT_ID) as
    | { id: string }
    | undefined;
  if (!demoTenant) return;

  const now = new Date().toISOString();
  const passwordHash = hashPasswordSync("Lumera@2026");

  const insertUser = database.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, onboarding_completed, practice_type, specialty, pack_id)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, 1, 'individual', ?, ?)
  `);
  const canonicalizeSpecialty = database.prepare(`
    UPDATE users SET specialty = ?, pack_id = ? WHERE id = ?
  `);
  const insertDoc = database.prepare(`
    INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, pack_id, active)
    VALUES (?, ?, ?, '', '', ?, 0, 0, '', '[]', '', ?, ?, '', '', '', ?, 1)
  `);

  for (const row of DEMO_SPECIALTY_MATRIX) {
    const pack = getSpecialtyPack(row.specialty);
    if (!pack) continue;
    const existing = database.prepare("SELECT id, tenant_id FROM users WHERE email = ? OR id = ?").get(row.email, row.id) as
      | { id: string; tenant_id?: string }
      | undefined;
    if (existing) {
      if (existing.tenant_id && existing.tenant_id !== DEMO_TENANT_ID) {
        continue;
      }
      canonicalizeSpecialty.run(pack.id, pack.id, existing.id);
      continue;
    }

    insertUser.run(
      row.id,
      DEMO_TENANT_ID,
      row.email,
      passwordHash,
      row.name,
      row.role,
      row.phone,
      now,
      pack.id,
      pack.id
    );

    const docId = `doc-${row.id}`;
    const existingDoc = database.prepare("SELECT id FROM doctors WHERE user_id = ? OR id = ?").get(row.id, docId) as
      | { id: string }
      | undefined;
    if (!existingDoc) {
      insertDoc.run(docId, row.id, row.name, pack.id, row.phone, row.email, pack.id);
    }
  }

  // Keep the documented reception + admin demo logins on the demo tenant (do not invent extra tenants).
  try {
    database
      .prepare(
        `UPDATE users SET tenant_id = ?, onboarding_completed = 1, pack_id = COALESCE(NULLIF(pack_id, ''), '')
         WHERE email IN ('admin@lumera.me', 'reception@lumera.me')
           AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)`
      )
      .run(DEMO_TENANT_ID, DEMO_TENANT_ID);
  } catch {}
}

export function ensureMetaTechProviderAndPolicies(database: DatabaseSync) {
  const now = new Date().toISOString();

  // Force-upsert Meta App Review policy slugs on every boot so pre-#26
  // certification overclaim rows cannot persist.
  const insertOrReplacePolicy = database.prepare(`
    INSERT INTO cms_policies (slug, title, body, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at
  `);
  for (const row of CMS_POLICY_UPSERTS) {
    insertOrReplacePolicy.run(row.slug, row.title, row.body, now);
  }

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

    const standardTemplates = META_WHATSAPP_TEMPLATE_SEED;

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
 * CMS feat-6 / persona-1 copy is upserted so live DBs keep NHA sandbox labeling.
 */
export function ensureAbdmAndDhisSeeding(database: DatabaseSync) {
  const now = new Date().toISOString();
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const defaultHfrId = "HFR-IN-8829104";

  try {
    database.prepare(
      "UPDATE cms_sections SET payload = ? WHERE id = 'feat-6'"
    ).run(JSON.stringify({
      title: "ABDM-aligned (NHA sandbox)",
      desc: "ABHA ID integration path, digital consent, and sandbox-unverified health records — not production HIU/HIP approval.",
    }));
    database.prepare(
      "UPDATE cms_sections SET payload = ? WHERE id = 'persona-1'"
    ).run(JSON.stringify({
      title: "Doctors & Clinics",
      desc: "AI prescriptions, patient records, ABDM sandbox path",
    }));
  } catch {}

  // 1. Enrich existing patients with ABHA details
  const updatePatientAbha = database.prepare(`
    UPDATE patients 
    SET abha_number = ?, abha_address = ?, kyc_status = ?, hfr_id = ?
    WHERE id = ? AND tenant_id = ?
  `);

  const abhaSeedMap: Record<string, { abhaNumber: string; abhaAddress: string; kycStatus: string }> = {
    "pat-6": { abhaNumber: "91-4428-9102-3841", abhaAddress: "rajiv.saxena@abdm", kycStatus: "LINKED_SANDBOX" },
    "pat-7": { abhaNumber: "91-7291-0384-9182", abhaAddress: "priyanka.m@abdm", kycStatus: "LINKED_SANDBOX" },
    "pat-1": { abhaNumber: "91-8840-2910-4491", abhaAddress: "sunita.roy@abdm", kycStatus: "LINKED_SANDBOX" },
    "pat-2": { abhaNumber: "91-5519-3829-1048", abhaAddress: "rohan.deshmukh@abdm", kycStatus: "LINKED_SANDBOX" },
    "pat-4": { abhaNumber: "91-9928-1029-4820", abhaAddress: "mohd.tariq@abdm", kycStatus: "LINKED_SANDBOX" },
    "pat-3": { abhaNumber: "91-3829-4019-2810", abhaAddress: "aarav.gupta@abdm", kycStatus: "PENDING" },
  };

  for (const [id, data] of Object.entries(abhaSeedMap)) {
    try {
      updatePatientAbha.run(data.abhaNumber, data.abhaAddress, data.kycStatus, defaultHfrId, id, DEMO_TENANT_ID);
    } catch {}
  }
  try {
    database
      .prepare(
        `UPDATE patients SET kyc_status = 'LINKED_SANDBOX'
         WHERE TRIM(abha_number) != ''
           AND TRIM(kyc_status) != ''
           AND kyc_status NOT IN ('LINKED_SANDBOX', 'PENDING', 'FAILED')`
      )
      .run();
  } catch {}

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
          "LINKED_SANDBOX",
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



