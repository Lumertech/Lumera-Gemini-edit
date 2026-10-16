import type { SqlDatabase } from "./sql-engine.ts";
import { DEMO_LOGIN_MATRIX } from "../src/lib/demoAccounts.ts";
import { META_REVIEW_TENANT_ID, SUNRISE_TENANT_ID, ensureUniqueTenantSlugs, slugifyTenant } from "./tenant-slug.ts";
import { spreadDemoBookDates } from "./demo-book-dates.ts";

export const INDIVIDUAL_DEMO_TENANT_ID = "tenant-demo-individual";
export const INDIVIDUAL_DEMO_SLUG = "malhotra-individual-practice";
export const INDIVIDUAL_DEMO_NAME = "Malhotra Individual Practice";

export const POLYCLINIC_DEMO_TENANT_ID = "tenant-demo-polyclinic";
export const POLYCLINIC_DEMO_SLUG = "iyer-city-polyclinic";
export const POLYCLINIC_DEMO_NAME = "Iyer City Polyclinic";

/** doctor@ + front desk share one Individual workspace. */
const INDIVIDUAL_SHARED_EMAILS = new Set([
  "doctor@lumera.me",
  "reception@lumera.me",
  "receptionist@lumera.me",
  "patient@lumera.me",
]);

/** CLINIC_ADMIN plus the polyclinic doctor roster. */
const POLYCLINIC_EMAILS = new Set([
  "clinic.admin@lumera.me",
  "cardiology@lumera.me",
  "dermatology@lumera.me",
  "orthopedics@lumera.me",
  "pediatrics@lumera.me",
  "gynecology@lumera.me",
  "ent@lumera.me",
  "ophthalmology@lumera.me",
]);

export interface DemoWorkspace {
  tenantId: string;
  slug: string;
  name: string;
  practiceType: "individual" | "polyclinic";
}

/**
 * Where a seeded @lumera.me login should live.
 * Super Admin stays on the platform/Meta tenant (no clinic workspace move).
 * Returns null when this email must not be reassigned.
 */
export function demoWorkspaceForEmail(email?: string | null): DemoWorkspace | null {
  const key = String(email || "").trim().toLowerCase();
  if (!key || key === "admin@lumera.me") return null;
  if (INDIVIDUAL_SHARED_EMAILS.has(key)) {
    return {
      tenantId: INDIVIDUAL_DEMO_TENANT_ID,
      slug: INDIVIDUAL_DEMO_SLUG,
      name: INDIVIDUAL_DEMO_NAME,
      practiceType: "individual",
    };
  }
  if (POLYCLINIC_EMAILS.has(key)) {
    return {
      tenantId: POLYCLINIC_DEMO_TENANT_ID,
      slug: POLYCLINIC_DEMO_SLUG,
      name: POLYCLINIC_DEMO_NAME,
      practiceType: "polyclinic",
    };
  }
  const known = DEMO_LOGIN_MATRIX.some((acct) => acct.email === key);
  if (!known || !key.endsWith("@lumera.me")) return null;
  const local = slugifyTenant(key.split("@")[0] || "practice") || "practice";
  return {
    tenantId: `tenant-demo-${local}`,
    slug: `${local}-practice`.slice(0, 48),
    name: `${local} practice`,
    practiceType: "individual",
  };
}

function upsertOwnedTenant(database: SqlDatabase, workspace: DemoWorkspace, now: string) {
  if (workspace.tenantId === META_REVIEW_TENANT_ID || workspace.tenantId === SUNRISE_TENANT_ID) return;
  database
    .prepare(
      `INSERT INTO tenants (
         id, name, specialty, country, timezone, phone, trial_ends_at,
         ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id,
         created_at, updated_at, practice_type, slug
       ) VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 98000 12000', ?, 500, 0, 1, '', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         practice_type = excluded.practice_type,
         updated_at = excluded.updated_at`
    )
    .run(
      workspace.tenantId,
      workspace.name,
      now,
      now,
      now,
      workspace.practiceType,
      workspace.slug
    );
}

function seedIndividualChart(database: SqlDatabase, now: string) {
  const tenantId = INDIVIDUAL_DEMO_TENANT_ID;
  const patients = [
    ["ind-pat-rajiv", "LUM-IND-0106", "Rajiv Saxena", 44, "Male", "+91 98111 01061"],
    ["ind-pat-sunita", "LUM-IND-0107", "Sunita Roy", 38, "Female", "+91 98111 01062"],
    ["ind-pat-3", "LUM-IND-0108", "Asha Menon", 29, "Female", "+91 98400 12003"],
    ["ind-pat-4", "LUM-IND-0109", "Karthik Rao", 51, "Male", "+91 98400 12004"],
    ["ind-pat-5", "LUM-IND-0110", "Meera Shah", 33, "Female", "+91 98400 12005"],
  ];
  const insertPatient = database.prepare(
    `INSERT INTO patients (
       id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
       emergency_contact, address, last_visit, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, '', 'O+', '[]', '[]', '', '', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM patients WHERE id = ?)`
  );
  for (const [id, uhid, name, age, gender, phone] of patients) {
    insertPatient.run(id, tenantId, uhid, name, age, gender, phone, "2026-08-30", now, id);
  }

  database
    .prepare(
      `INSERT INTO appointments (
         id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
         doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
         consultation_fee, is_paid, created_at
       )
       SELECT ?, ?, 1, 'ind-pat-rajiv', 'Rajiv Saxena', '+91 98111 01061', 'LUM-IND-0106',
              'doc-persona-gp', 'Dr. Vikram Malhotra', 'General Medicine', '2026-08-30', '10:00 AM',
              'New Consultation', 'Waiting', 'Walk-in', 600, 0, ?
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE id = 'ind-apt-1')`
    )
    .run("ind-apt-1", tenantId, now);

  database
    .prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
         icd10_code, chief_complaints, medicines, lab_tests, advice, diet_instructions,
         follow_up_date, pdf_url, created_at
       )
       SELECT ?, ?, 'RX-IND-DEMO-0001', 'ind-pat-rajiv', 'Rajiv Saxena', '+91 98111 01061', 'LUM-IND-0106',
              'doc-persona-gp', 'Dr. Vikram Malhotra', 'General Medicine', 'MCI-2012-74892', '2026-08-30',
              'Seasonal allergic rhinitis', 'J30.2', '[]',
              ?, '[]', '[]', '', '', '', ?
       WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE id = 'ind-rx-1')`
    )
    .run(
      "ind-rx-1",
      tenantId,
      JSON.stringify([
        {
          id: "med-ind-1",
          drugName: "Cetirizine 10 mg",
          dosage: "1 tab",
          frequency: "0-0-1",
          durationDays: 5,
        },
      ]),
      now
    );

  seedIndividualWhatsAppInbox(database, now);
}

function seedIndividualWhatsAppInbox(database: SqlDatabase, now: string) {
  const tenantId = INDIVIDUAL_DEMO_TENANT_ID;
  try {
    database
      .prepare(
        `INSERT INTO whatsapp_conversations (
           id, patient_phone, patient_name, patient_id, uhid, handover_mode, assigned_staff, tags,
           preferred_language, unread_count, last_message, last_message_time, updated_at, tenant_id
         )
         SELECT ?, '+91 98111 01061', 'Rajiv Saxena', 'ind-pat-rajiv', 'LUM-IND-0106', 'bot', 'Unassigned', '[]',
                'en', 0, 'Namaste from Malhotra Individual Practice.', '10:00 AM', ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM whatsapp_conversations WHERE id = 'ind-conv-rajiv')`
      )
      .run("ind-conv-rajiv", now, tenantId);
    database
      .prepare(
        `INSERT INTO whatsapp_messages (
           id, conversation_id, patient_phone, sender, staff_name, content, time_display, status, created_at, tenant_id
         )
         SELECT ?, 'ind-conv-rajiv', '+91 98111 01061', 'bot', 'Clinic Desk',
                'Namaste from Malhotra Individual Practice.', '10:00 AM', 'delivered', ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM whatsapp_messages WHERE id = 'ind-msg-rajiv')`
      )
      .run("ind-msg-rajiv", now, tenantId);
    database
      .prepare(
        `INSERT INTO whatsapp_outbound_events (
           id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id
         )
         SELECT ?, 'appointment_reminder', '+91 98111 01061', 'Rajiv Saxena', 'delivered',
                'Individual practice reminder for Rajiv Saxena.', '{}', ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM whatsapp_outbound_events WHERE id = 'ind-evt-rajiv')`
      )
      .run("ind-evt-rajiv", now, tenantId);
  } catch {
    /* tenant_id columns are added in migrate() before this seed */
  }
}

/**
 * Idempotent split of the @lumera.me matrix into separate workspaces.
 * Does not UPDATE the Meta review tenant or Sunrise (`tenant-543feff7`).
 * Users already on Sunrise, or on any tenant other than the Meta review tenant / the target, are left in place.
 */
export function ensureDemoWorkspaceTenants(database: SqlDatabase) {
  ensureUniqueTenantSlugs(database);
  const now = new Date().toISOString();
  const workspaces = new Map<string, DemoWorkspace>();
  for (const acct of DEMO_LOGIN_MATRIX) {
    const workspace = demoWorkspaceForEmail(acct.email);
    if (!workspace) continue;
    workspaces.set(workspace.tenantId, workspace);
  }
  for (const workspace of workspaces.values()) {
    upsertOwnedTenant(database, workspace, now);
  }
  ensureUniqueTenantSlugs(database);

  const reassign = database.prepare(
    `UPDATE users
     SET tenant_id = ?, clinic_name = ?
     WHERE lower(email) = ?
       AND COALESCE(tenant_id, '') != ?
       AND (
         tenant_id IS NULL OR tenant_id = '' OR tenant_id = ? OR tenant_id = ?
       )`
  );
  for (const acct of DEMO_LOGIN_MATRIX) {
    const workspace = demoWorkspaceForEmail(acct.email);
    if (!workspace) continue;
    reassign.run(
      workspace.tenantId,
      workspace.name,
      acct.email.toLowerCase(),
      SUNRISE_TENANT_ID,
      META_REVIEW_TENANT_ID,
      workspace.tenantId
    );
  }

  try {
    database
      .prepare(
        `UPDATE branches
         SET tenant_id = ?
         WHERE id IN ('b-1', 'b-2', 'b-3')
           AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)`
      )
      .run(POLYCLINIC_DEMO_TENANT_ID, META_REVIEW_TENANT_ID);
  } catch {
    /* branches.tenant_id is added with the slug migration */
  }

  seedIndividualChart(database, now);
  spreadDemoBookDates(database);
}
