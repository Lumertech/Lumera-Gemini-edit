import type { DatabaseSync } from "node:sqlite";

/** Demo prescriptions and lab reports extracted from db-clinical-rows.ts. */
export function seedClinicalRxIfMissing(database: DatabaseSync, now: string) {
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
        { param: "Estimated GFR (CKD-EPI)", value: 54, unit: "mL/min/1.73m\u00b2", normalRange: "> 90", status: "Low", trendDelta: "-8 mL/min" },
        { param: "Total Cholesterol", value: 218, unit: "mg/dL", normalRange: "< 200", status: "High", trendDelta: "-12 mg/dL" }
      ]),
      "/api/emr/lab-report/lab-101/pdf",
      now
    );
  }

}
