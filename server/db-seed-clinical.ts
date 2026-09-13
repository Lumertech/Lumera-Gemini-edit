import { type SqlDatabase } from "./sql-engine.ts";
import { DEMO_TENANT_ID } from "./db.ts";
import { ensureDemoTenantLetterhead } from "./db-migrate.ts";
import { DEMO_PASSWORD, DOCTOR_SEED, hashPasswordSync } from "./db-seed-maps.ts";

export function seedClinicalAndWhatsAppIfMissing(database: SqlDatabase) {
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
          onboarding_completed = 1
      WHERE id IN ('user-admin', 'user-doctor', 'user-patient', 'user-reception', 'user-receptionist', 'user-clinic-admin')
         OR id LIKE 'test-user-%'
    `);
    // Legacy per-doctor test logins stay on the shared multi-specialty tenant.
    // Persona @lumera.me demos keep practice_type from ensureDemoPersonaUsers.
    database.exec(`
      UPDATE users
      SET practice_type = 'polyclinic'
      WHERE id LIKE 'test-user-%'
    `);
  } catch {}

  const patientCount = database.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number };

  // SECURITY: this block creates a \"Test {DoctorName}\" login for every seeded
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
        "Reduce sodium intake under 2g/day",
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
        { param: "High Sensitivity CRP (hs-CRP)", value: 4.8, unit: "mg/L", normalRange: "\\u003c 1.0", status: "High", trendDelta: "Systemic low-grade spinal inflammation" },
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
        { param: "HbA1c (Glycosylated Hemoglobin)", value: 8.4, unit: "%", normalRange: "\\u003c 5.7", status: "High", trendDelta: "+0.5% vs May 2026" },
        { param: "Fasting Blood Sugar (FBS)", value: 162, unit: "mg/dL", normalRange: "70 - 99", status: "High", trendDelta: "+18 mg/dL" },
        { param: "Post-Prandial Blood Sugar (PPBS)", value: 248, unit: "mg/dL", normalRange: "\\u003c 140", status: "Critical", trendDelta: "+34 mg/dL" },
        { param: "Serum Creatinine", value: 1.32, unit: "mg/dL", normalRange: "0.6 - 1.1", status: "High", trendDelta: "+0.18 mg/dL" },
        { param: "Estimated GFR (CKD-EPI)", value: 54, unit: "mL/min/1.73m²", normalRange: "> 90", status: "Low", trendDelta: "-8 mL/min" },
        { param: "Total Cholesterol", value: 218, unit: "mg/dL", normalRange: "\\u003c 200", status: "High", trendDelta: "-12 mg/dL" }
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
      JSON.stringify(["📅 Book Doctor Appointment", "💊 Refill / View Prescription", "🔎 Download Lab Reports", "⏰ Check Doctor Timings"]),
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

