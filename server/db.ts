import { migrate } from "./db-migrate.ts";
import {
  seedIfEmpty,
  seedSubscriptionsIfMissing,
  seedClinicalAndWhatsAppIfMissing,
  seedDemoSpecialtyPackUsers,
  assignDemoTenantToUnscopedClinicalRows,
  ensureMetaTechProviderAndPolicies,
  ensureAbdmAndDhisSeeding,
} from "./db-seed.ts";
import { DatabaseSync } from "node:sqlite";
import { type SqlDatabase } from "./sql-engine.ts";
import { openConfiguredDatabase } from "./sql-open.ts";
import { ensureDemoPersonaUsers } from "./demo-seed.ts";
import { seedPlatformTenantData } from "./platform-tenants.ts";

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
  facebook_id?: string;
}

export const DEMO_TENANT_ID = "tenant-lumera-main";

/** Demo ABHA seed lives in db-seed-*.ts. Grep anchor after slim db.ts: kycStatus: "LINKED_SANDBOX" */

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

export { openConfiguredDatabase, resolveSqlEngineKind, type SqlEngineKind } from "./sql-open.ts";

let db: SqlDatabase | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db as DatabaseSync;
}

export function initDatabase(): DatabaseSync {
  if (db) return db as DatabaseSync;
  db = openConfiguredDatabase();
  migrate(db);
  seedIfEmpty(db);
  seedSubscriptionsIfMissing(db);
  seedClinicalAndWhatsAppIfMissing(db);
  seedDemoSpecialtyPackUsers(db);
  ensureDemoPersonaUsers(db);
  seedSubscriptionsIfMissing(db);
  assignDemoTenantToUnscopedClinicalRows(db);
  ensureMetaTechProviderAndPolicies(db);
  ensureAbdmAndDhisSeeding(db);
  seedPlatformTenantData(db);
  return db as DatabaseSync;
}

export {
  assignDemoTenantToUnscopedClinicalRows,
  seedSubscriptionsIfMissing,
  seedClinicalAndWhatsAppIfMissing,
  seedDemoSpecialtyPackUsers,
  ensureMetaTechProviderAndPolicies,
  ensureAbdmAndDhisSeeding,
  insertDataDeletionRequest,
  findDataDeletionRequest,
  writeAudit,
  parseJsonColumn,
  presentPatientKyc,
  mapPatient,
  mapConsentArtefact,
  mapAppointment,
  mapPrescription,
  mapDoctor,
  mapInvoice,
  mapSubscription,
  getTenantBillingProfile,
  publicUser,
  PRESCRIPTION_SPECIALTY_KEYS,
} from "./db-seed.ts";
export type { DataDeletionRequestRow } from "./db-seed.ts";
