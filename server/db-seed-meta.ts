import { type SqlDatabase } from "./sql-engine.ts";
import { DEMO_TENANT_ID } from "./db.ts";
import { hashPasswordSync } from "./db-seed-maps.ts";
import {
  DEMO_SPECIALTY_MATRIX,
  assertPacksDifferByMoreThanLabel,
  getSpecialtyPack,
  resolveSpecialtyPack,
} from "./specialty-packs.ts";
import { CMS_POLICY_UPSERTS } from "./cms-policy-seed.ts";

function backfillUserSpecialtyEnum(database: SqlDatabase) {
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
export function seedDemoSpecialtyPackUsers(database: SqlDatabase) {
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

export function ensureMetaTechProviderAndPolicies(database: SqlDatabase) {
  const now = new Date().toISOString();

  // Force-upsert Meta App Review policy slugs on every boot. ON CONFLICT
  // replaces title and body with no version or hash gate, so stale App Review
  // status copy and pre-#26 certification overclaim rows cannot persist.
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
 * CMS feat-6 / persona-1 copy is upserted so live DBs keep NHA sandbox labeling.
 */
export function ensureAbdmAndDhisSeeding(database: SqlDatabase) {
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

  const abhaSeedMap: { [id: string]: { abhaNumber: string; abhaAddress: string; kycStatus: string } } = {
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

    if ((existing?.count || 0) >= 10) {
      /* already seeded */
    } else {
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

      const typeDist: ("OP_CONSULT" | "PRESCRIPTION" | "DIAGNOSTIC_REPORT" | "DISCHARGE_SUMMARY")[] = [
        "OP_CONSULT", "OP_CONSULT", "OP_CONSULT",
        "PRESCRIPTION", "PRESCRIPTION",
        "DIAGNOSTIC_REPORT",
        "DISCHARGE_SUMMARY",
      ];

      // Seed 78 qualifying transactions to set progress meter at 78% of the 100-threshold
      const seedCount = 78;
      for (let i = 1; !(i > seedCount); i++) {
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


