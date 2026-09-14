import type { DatabaseSync } from "node:sqlite";

/** Demo patients and appointments extracted from db-clinical-rows.ts. */
export function seedClinicalPatientsIfMissing(database: DatabaseSync, now: string) {
  const patientCount = database.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number };

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

}
