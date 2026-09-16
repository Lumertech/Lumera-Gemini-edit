/**
 * Lumera clinic schema — 1:1 translation of server/db.ts migrate() plus
 * ALTER TABLE steps and server/platform-tenants.ts ensurePlatformTenantSchema().
 *
 * Do not "clean up" types: TEXT stays text (including ISO datetimes and JSON
 * blobs), INTEGER 0/1 flags stay integer, REAL stays real. This file replaces
 * the unused template users/entries model. Runtime still bootstraps via
 * CREATE TABLE IF NOT EXISTS in migrate(); drizzle-kit uses this file for
 * Cloud SQL migrations.
 */
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  phone: text("phone").notNull().default(""),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull(),
  tenantId: text("tenant_id").default(""),
  clinicName: text("clinic_name").default(""),
  avatarUrl: text("avatar_url").default(""),
  whatsappVerified: integer("whatsapp_verified").default(0),
  hprId: text("hpr_id").default(""),
  hfrId: text("hfr_id").default(""),
  onboardingCompleted: integer("onboarding_completed").default(0),
  practiceType: text("practice_type").default("individual"),
  specialty: text("specialty").default(""),
  packId: text("pack_id").default(""),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_users_id_fk",
    }).onDelete("cascade"),
  ]
);

export const cmsSettings = pgTable("cms_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const cmsSections = pgTable("cms_sections", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  sortOrder: integer("sort_order").notNull(),
  payload: text("payload").notNull(),
});

export const cmsPolicies = pgTable("cms_policies", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const metaDataDeletionRequests = pgTable("meta_data_deletion_requests", {
  confirmationCode: text("confirmation_code").primaryKey(),
  status: text("status").notNull().default("pending"),
  userRef: text("user_ref").notNull().default(""),
  createdAt: text("created_at").notNull(),
  processedAt: text("processed_at"),
});

export const cmsMedia = pgTable("cms_media", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  alt: text("alt").notNull().default(""),
  mime: text("mime").notNull().default(""),
  uploadedBy: text("uploaded_by"),
  createdAt: text("created_at").notNull(),
});

export const doctors = pgTable(
  "doctors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    name: text("name").notNull(),
    qualification: text("qualification").notNull().default(""),
    regNumber: text("reg_number").notNull().default(""),
    specialty: text("specialty").notNull(),
    experienceYears: integer("experience_years").notNull().default(0),
    consultationFee: integer("consultation_fee").notNull().default(0),
    opdRoom: text("opd_room").notNull().default(""),
    availableDays: text("available_days").notNull().default("[]"),
    opdTiming: text("opd_timing").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    avatarUrl: text("avatar_url").notNull().default(""),
    bio: text("bio").notNull().default(""),
    hprId: text("hpr_id").notNull().default(""),
    active: integer("active").notNull().default(1),
    packId: text("pack_id").default(""),
    signatureUrl: text("signature_url").default(""),
    slotDurationMinutes: integer("slot_duration_minutes").default(15),
    rxTemplate: text("rx_template").default("classic"),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "doctors_user_id_users_id_fk",
    }).onDelete("set null"),
  ]
);

export const staff = pgTable(
  "staff",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    name: text("name").notNull(),
    role: text("role").notNull(),
    department: text("department").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    status: text("status").notNull().default("Active"),
    shift: text("shift").notNull().default("Morning"),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "staff_user_id_users_id_fk",
    }).onDelete("set null"),
  ]
);

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  opdHours: text("opd_hours").notNull().default(""),
  activeDoctors: integer("active_doctors").notNull().default(0),
  status: text("status").notNull().default("Operating"),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  userId: text("user_id"),
  userName: text("user_name").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    status: text("status").notNull(),
    planType: text("plan_type").notNull(),
    monthlyPrice: integer("monthly_price").notNull().default(0),
    autoRenew: integer("auto_renew").notNull().default(1),
    startedAt: text("started_at").notNull(),
    endsAt: text("ends_at"),
    notes: text("notes").notNull().default(""),
    tenantId: text("tenant_id").default(""),
    planCode: text("plan_code").default(""),
    billingSource: text("billing_source").default("manual"),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "subscriptions_user_id_users_id_fk",
    }).onDelete("cascade"),
  ]
);

export const patients = pgTable(
  "patients",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(""),
    uhid: text("uhid").notNull().unique(),
    name: text("name").notNull(),
    age: integer("age").notNull().default(30),
    gender: text("gender").notNull().default("Male"),
    phone: text("phone").notNull().unique(),
    email: text("email").notNull().default(""),
    bloodGroup: text("blood_group").notNull().default("O+"),
    allergies: text("allergies").notNull().default("[]"),
    chronicConditions: text("chronic_conditions").notNull().default("[]"),
    emergencyContact: text("emergency_contact").notNull().default(""),
    address: text("address").notNull().default(""),
    lastVisit: text("last_visit"),
    createdAt: text("created_at").notNull(),
    abhaNumber: text("abha_number").default(""),
    abhaAddress: text("abha_address").default(""),
    kycStatus: text("kyc_status").default("PENDING"),
    hfrId: text("hfr_id").default(""),
    abhaLinkedAt: text("abha_linked_at").default(""),
  },
  (t) => [
    index("idx_patients_tenant").on(t.tenantId),
    uniqueIndex("idx_patients_tenant_abha")
      .on(t.tenantId, t.abhaNumber)
      .where(sql`abha_number IS NOT NULL AND TRIM(abha_number) != ''`),
  ]
);

export const appointments = pgTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(""),
    tokenNumber: integer("token_number").notNull(),
    patientId: text("patient_id").notNull(),
    patientName: text("patient_name").notNull(),
    patientPhone: text("patient_phone").notNull(),
    uhid: text("uhid").notNull(),
    doctorId: text("doctor_id").notNull(),
    doctorName: text("doctor_name").notNull(),
    specialty: text("specialty").notNull(),
    date: text("date").notNull(),
    timeSlot: text("time_slot").notNull(),
    type: text("type").notNull().default("New Consultation"),
    status: text("status").notNull().default("Waiting"),
    source: text("source").notNull().default("WhatsApp Bot"),
    consultationFee: integer("consultation_fee").notNull().default(600),
    isPaid: integer("is_paid").notNull().default(1),
    vitals: text("vitals"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_appointments_tenant").on(t.tenantId)]
);

export const prescriptions = pgTable(
  "prescriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(""),
    rxNumber: text("rx_number").notNull().unique(),
    patientId: text("patient_id").notNull(),
    patientName: text("patient_name").notNull(),
    patientPhone: text("patient_phone").notNull(),
    patientUhid: text("patient_uhid").notNull(),
    doctorId: text("doctor_id").notNull(),
    doctorName: text("doctor_name").notNull(),
    doctorSpecialty: text("doctor_specialty").notNull(),
    doctorRegNumber: text("doctor_reg_number").notNull(),
    date: text("date").notNull(),
    diagnosis: text("diagnosis").notNull(),
    icd10Code: text("icd10_code"),
    chiefComplaints: text("chief_complaints").notNull().default("[]"),
    medicines: text("medicines").notNull().default("[]"),
    labTests: text("lab_tests").notNull().default("[]"),
    advice: text("advice").notNull().default("[]"),
    dietInstructions: text("diet_instructions"),
    followUpDate: text("follow_up_date"),
    pdfUrl: text("pdf_url"),
    createdAt: text("created_at").notNull(),
    patientAge: integer("patient_age").default(0),
    patientGender: text("patient_gender").default(""),
    vitals: text("vitals"),
    clinicName: text("clinic_name").default(""),
    clinicAddress: text("clinic_address").default(""),
    clinicPhone: text("clinic_phone").default(""),
    qrVerificationUrl: text("qr_verification_url").default(""),
    whatsappSentStatus: text("whatsapp_sent_status").default("unsent"),
    specialtyType: text("specialty_type").default(""),
    specialtyModules: text("specialty_modules").default("{}"),
  },
  (t) => [
    index("idx_prescriptions_tenant").on(t.tenantId),
    index("idx_prescriptions_patient").on(t.tenantId, t.patientId),
  ]
);

export const labReports = pgTable("lab_reports", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  patientUhid: text("patient_uhid").notNull(),
  patientName: text("patient_name").notNull(),
  date: text("date").notNull(),
  labName: text("lab_name").notNull(),
  category: text("category").notNull(),
  doctorInterpretation: text("doctor_interpretation"),
  results: text("results").notNull().default("[]"),
  pdfUrl: text("pdf_url"),
  createdAt: text("created_at").notNull(),
});
