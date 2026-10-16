import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { patientMatchesQuery } from "./clinical.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function createClinicUser(label: string, role: "doctor" | "receptionist" | "CLINIC_ADMIN" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@patients-tab.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `${label} user`,
    role,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  const doctorId = `doc-${label}-${suffix}`;
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 600, '', '[]', '', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  return { tenantId, userId, doctorId, email, role };
}

describe("patient search matching", () => {
  const row = {
    name: "Asha Menon",
    phone: "+91 98111 22233",
    uhid: "LUM-2026-0042",
    abha_number: "91-4242-4242-4242",
    abha_address: "asha.only@sbx",
  };

  it("matches name, reformatted phone, and ABHA digits or address", () => {
    assert.equal(patientMatchesQuery(row, "asha"), true);
    assert.equal(patientMatchesQuery(row, "9811122233"), true);
    assert.equal(patientMatchesQuery(row, "+91 98111 22233"), true);
    assert.equal(patientMatchesQuery(row, "91424242424242"), true);
    assert.equal(patientMatchesQuery(row, "asha.only@sbx"), true);
    assert.equal(patientMatchesQuery(row, "LUM-2026-0042"), true);
    assert.equal(patientMatchesQuery(row, "nobody-else"), false);
    assert.equal(patientMatchesQuery(row, ""), true);
  });
});

describe("Patients tab API tenant isolation", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-patients-tab";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    assert.ok(token);
    return token;
  }

  it("search and chart stay inside the session tenant for doctor, clinic admin, and receptionist", async () => {
    const clinicA = createClinicUser("pta", "doctor");
    const adminA = createClinicUser("ptadmin", "CLINIC_ADMIN");
    // Same tenant as the doctor so the admin can read that clinic's chart.
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicA.tenantId, adminA.userId);
    const deskA = createClinicUser("ptdesk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicA.tenantId, deskA.userId);
    const clinicB = createClinicUser("ptb", "doctor");
    const deskB = createClinicUser("ptdeskb", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinicB.tenantId, deskB.userId);

    const tokenA = await login(clinicA.email);
    const tokenAdmin = await login(adminA.email);
    const tokenDesk = await login(deskA.email);
    const tokenB = await login(clinicB.email);
    const tokenDeskB = await login(deskB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authAdmin = { Authorization: `Bearer ${tokenAdmin}` };
    const authDesk = { Authorization: `Bearer ${tokenDesk}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const authDeskB = { Authorization: `Bearer ${tokenDeskB}` };

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "OnlyAsha Menon",
        phone: "+91 98111 22233",
        age: 36,
        gender: "Female",
        email: "asha@example.test",
        address: "12 Lake Road, Kochi",
        emergencyContact: "Ravi Menon +91 98111 00001",
        bloodGroup: "O+",
        allergies: ["Penicillin"],
        chronicConditions: ["Asthma"],
      },
      authA
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patient = created.json.patient as { id: string; name: string; uhid: string };
    assert.equal(patient.name, "OnlyAsha Menon");
    assert.ok(patient.uhid);

    const abha = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patient.id}/abha`,
      {
        abhaNumber: "91-4242-4242-4242",
        abhaAddress: "asha.only@sbx",
        source: "aadhaar_otp",
        abdmMode: "stub",
      },
      authA
    );
    assert.equal(abha.status, 200, String(abha.json.error || ""));

    const contact = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patient.id}`,
      { address: "12 Lake Road, Kochi", emergencyContact: "Ravi Menon +91 98111 00001" },
      authA
    );
    assert.equal(contact.status, 200, String(contact.json.error || ""));

    const visit = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        doctorId: clinicA.doctorId,
        date: "2026-10-01",
        timeSlot: "09:30 AM",
        type: "Follow-up",
        consultationFee: 1500,
      },
      authA
    );
    assert.equal(visit.status, 201, String(visit.json.error || ""));

    const rx = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Asha private diagnosis",
        medicines: [{ id: "m1", drugName: "Salbutamol", dosage: "100 mcg", frequency: "1-0-1", durationDays: 5 }],
      },
      authA
    );
    assert.equal(rx.status, 201, String(rx.json.error || ""));

    for (const q of ["OnlyAsha", "9811122233", "+91 98111 22233", "91424242424242", "asha.only@sbx", patient.uhid]) {
      const found = await jsonRequest(port, "GET", `/api/patients?q=${encodeURIComponent(q)}`, undefined, authA);
      assert.equal(found.status, 200, q);
      const names = ((found.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
      assert.deepEqual(names, ["OnlyAsha Menon"], q);
    }

    const chartA = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, authA);
    assert.equal(chartA.status, 200);
    const chart = chartA.json as {
      patient: { name: string; phone: string; address: string; abhaNumber: string };
      visits: Array<{ consultationFee: number; date: string }>;
      prescriptions: Array<{ diagnosis: string; medicines: Array<{ drugName: string }> }>;
    };
    assert.equal(chart.patient.name, "OnlyAsha Menon");
    assert.equal(chart.patient.phone, "+91 98111 22233");
    assert.equal(chart.patient.address, "12 Lake Road, Kochi");
    assert.equal(chart.patient.abhaNumber, "91-4242-4242-4242");
    assert.equal(chart.visits.length, 1);
    assert.equal(chart.visits[0].consultationFee, 1500);
    assert.equal(chart.prescriptions[0].diagnosis, "Asha private diagnosis");
    assert.equal(chart.prescriptions[0].medicines[0].drugName, "Salbutamol");

    const adminList = await jsonRequest(port, "GET", "/api/patients?q=OnlyAsha", undefined, authAdmin);
    assert.equal(adminList.status, 200);
    assert.equal(((adminList.json.patients as Array<{ id: string }>) || [])[0]?.id, patient.id);
    const adminChart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, authAdmin);
    assert.equal(adminChart.status, 200);

    const deskChart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, authDesk);
    assert.equal(deskChart.status, 200);
    assert.equal((deskChart.json.patient as { name: string }).name, "OnlyAsha Menon");
    const deskBody = JSON.stringify(deskChart.json);
    assert.equal(deskBody.includes("Asha private diagnosis"), false);
    assert.equal(deskBody.includes("Salbutamol"), false);
    const deskRx = ((deskChart.json.prescriptions as Array<Record<string, unknown>>) || [])[0];
    assert.equal(deskRx?.redacted, true);
    assert.equal("diagnosis" in (deskRx || {}), false);
    assert.equal("medicines" in (deskRx || {}), false);
    const deskTimeline = JSON.stringify(deskChart.json.timeline || []);
    assert.equal(deskTimeline.includes("Salbutamol"), false);
    assert.equal(deskTimeline.includes("Asha private"), false);
    assert.match(deskTimeline, /Rx issued/);

    const anon = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`);
    assert.equal(anon.status, 401);

    for (const headers of [authB, authDeskB]) {
      for (const q of ["OnlyAsha", "9811122233", "91424242424242", "asha.only@sbx"]) {
        const list = await jsonRequest(port, "GET", `/api/patients?q=${encodeURIComponent(q)}`, undefined, headers);
        assert.equal(list.status, 200);
        const names = ((list.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
        assert.equal(names.includes("OnlyAsha Menon"), false, q);
        assert.deepEqual(list.json.patients, []);
      }
      const stolen = await jsonRequest(port, "GET", `/api/patients/${patient.id}`, undefined, headers);
      assert.equal(stolen.status, 404);
      assert.equal(JSON.stringify(stolen.json).includes("OnlyAsha"), false);
      assert.equal(JSON.stringify(stolen.json).includes("Asha private"), false);

      const stolenChart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, headers);
      assert.equal(stolenChart.status, 404);
      const body = JSON.stringify(stolenChart.json);
      assert.equal(body.includes("OnlyAsha"), false);
      assert.equal(body.includes("Asha private diagnosis"), false);
      assert.equal(body.includes("98111 22233"), false);
      assert.equal(body.includes("Salbutamol"), false);
      assert.equal(stolenChart.json.patient, undefined);
      assert.equal(stolenChart.json.visits, undefined);
      assert.equal(stolenChart.json.prescriptions, undefined);
    }
  });

  it("adds vitals and WhatsApp items matched on the patient phone inside the tenant", async () => {
    const clinic = createClinicUser("pt-timeline", "doctor");
    const other = createClinicUser("pt-timeline-b", "doctor");
    const token = await login(clinic.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Timeline Meera", phone: "+91 98111 66601", age: 33, gender: "Female" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patient = created.json.patient as { id: string; phone: string; uhid?: string; name: string };
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO appointments (
        id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
        specialty, date, time_slot, type, status, source, consultation_fee, is_paid, vitals, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'General Medicine', '2026-10-01', '10:00', 'New Consultation', 'Completed', 'Walk-in', 600, 1, ?, ?)`
    ).run(
      `apt-${patient.id}`,
      clinic.tenantId,
      patient.id,
      patient.name,
      patient.phone,
      patient.uhid || "UHID-TL",
      clinic.doctorId,
      "Dr Timeline",
      JSON.stringify({ bloodPressureSystolic: 128, bloodPressureDiastolic: 82, heartRate: 76 }),
      now
    );
    db.prepare(
      `INSERT INTO whatsapp_messages (
        id, conversation_id, patient_phone, sender, content, time_display, status, created_at, tenant_id
      ) VALUES (?, ?, ?, 'user', ?, '10:05', 'delivered', ?, ?)`
    ).run(`wa-in-${patient.id}`, `conv-${patient.id}`, "919811166601", "Need the report today", now, clinic.tenantId);
    db.prepare(
      `INSERT INTO whatsapp_messages (
        id, conversation_id, patient_phone, sender, content, time_display, status, created_at, tenant_id
      ) VALUES (?, ?, ?, 'bot', ?, '10:06', 'delivered', ?, ?)`
    ).run(`wa-bot-${patient.id}`, `conv-${patient.id}`, patient.phone, "bot template not inbound", now, clinic.tenantId);
    db.prepare(
      `INSERT INTO whatsapp_messages (
        id, conversation_id, patient_phone, sender, content, time_display, status, created_at, tenant_id
      ) VALUES (?, ?, ?, 'user', ?, '10:07', 'delivered', ?, ?)`
    ).run(`wa-other-${patient.id}`, `conv-other-${patient.id}`, patient.phone, "LEAK other clinic", now, other.tenantId);
    db.prepare(
      `INSERT INTO whatsapp_outbound_events (
        id, event_type, patient_phone, patient_name, status, details, sent_at, tenant_id
      ) VALUES (?, 'queue_token_update', ?, ?, 'delivered', ?, ?, ?)`
    ).run(`wa-out-${patient.id}`, "+91 98111 66601", patient.name, "OPD queue template", now, clinic.tenantId);
    db.prepare(
      `INSERT INTO whatsapp_messages (
        id, conversation_id, patient_phone, sender, content, time_display, status, created_at, tenant_id
      ) VALUES (?, ?, ?, 'user', ?, '10:08', 'delivered', ?, ?)`
    ).run(`wa-wrong-${patient.id}`, `conv-wrong-${patient.id}`, "+91 90000 00000", "wrong patient hello", now, clinic.tenantId);

    const chart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(chart.status, 200);
    const timeline = (chart.json.timeline || []) as Array<{ type: string; title: string; summary: string }>;
    const body = JSON.stringify(timeline);
    assert.equal(timeline.some((item) => item.type === "visit"), true);
    assert.equal(timeline.some((item) => item.type === "vitals" && item.summary.includes("BP 128/82")), true);
    assert.equal(timeline.some((item) => item.title === "WhatsApp message received" && item.summary.includes("Need the report")), true);
    assert.equal(timeline.some((item) => item.title === "WhatsApp template sent" && item.summary.includes("OPD queue template")), true);
    assert.equal(body.includes("LEAK other clinic"), false);
    assert.equal(body.includes("bot template not inbound"), false);
    assert.equal(body.includes("wrong patient hello"), false);
  });

  it("keeps Rx and diagnosis text out of WhatsApp items on a receptionist chart", async () => {
    const clinic = createClinicUser("pt-wa-rx", "doctor");
    const desk = createClinicUser("pt-wa-desk", "receptionist");
    getDb().prepare("UPDATE users SET tenant_id = ? WHERE id = ?").run(clinic.tenantId, desk.userId);
    const token = await login(clinic.email);
    const deskToken = await login(desk.email);
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "WhatsApp Desk Patient", phone: "+91 98111 77721", age: 41, gender: "Female" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patient = created.json.patient as { id: string; name: string; phone: string };
    const rx = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Desk private diagnosis",
        medicines: [{ id: "m1", drugName: "Amoxicillin", dosage: "500 mg", frequency: "1-0-1", durationDays: 5 }],
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(rx.status, 201, String(rx.json.error || ""));
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO whatsapp_messages (
        id, conversation_id, patient_phone, sender, content, time_display, status, created_at, tenant_id
      ) VALUES (?, ?, ?, 'user', ?, '11:00', 'delivered', ?, ?)`
    ).run(`wa-desk-in-${patient.id}`, `conv-desk-${patient.id}`, patient.phone, "When is my next visit?", now, clinic.tenantId);
    db.prepare(
      `INSERT INTO whatsapp_outbound_events (
        id, event_type, patient_phone, patient_name, status, details, sent_at, tenant_id
      ) VALUES (?, 'appointment_reminder', ?, ?, 'delivered', ?, ?, ?)`
    ).run(`wa-desk-out-${patient.id}`, patient.phone, patient.name, "Appointment reminder for tomorrow", now, clinic.tenantId);

    const chart = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, {
      Authorization: `Bearer ${deskToken}`,
    });
    assert.equal(chart.status, 200);
    const timeline = (chart.json.timeline || []) as Array<{ type: string; title: string; summary: string }>;
    const whatsapp = timeline.filter((item) => item.type === "whatsapp");
    assert.equal(whatsapp.some((item) => item.title === "WhatsApp message received"), true);
    assert.equal(whatsapp.some((item) => item.title === "WhatsApp template sent"), true);
    const whatsappText = JSON.stringify(whatsapp);
    assert.equal(whatsappText.includes("Desk private diagnosis"), false);
    assert.equal(whatsappText.includes("Amoxicillin"), false);
    assert.equal(whatsappText.includes("Rx issued"), false);
    assert.equal(/diagnosis/i.test(whatsappText), false);
  });

  it("returns 404 and no timeline when patient A requests patient B", async () => {
    const clinic = createClinicUser("pt-cross", "doctor");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const createdA = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Patient Cross A", phone: "+91 98111 44001", age: 30, gender: "Female" },
      auth
    );
    const createdB = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Patient Cross B", phone: "+91 98111 44002", age: 31, gender: "Male" },
      auth
    );
    assert.equal(createdA.status, 201, String(createdA.json.error || ""));
    assert.equal(createdB.status, 201, String(createdB.json.error || ""));
    const patientA = createdA.json.patient as { id: string; name: string; phone: string };
    const patientB = createdB.json.patient as { id: string; name: string; phone: string };
    const now = new Date().toISOString();
    const suffix = patientB.id.slice(-6);
    const emailA = `cross.a.${suffix}@patients-tab.example`;
    getDb()
      .prepare(
        `INSERT INTO users (
          id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
          onboarding_completed, practice_type, specialty, last_login, created_at, patient_id
        ) VALUES (?, ?, ?, ?, 'Patient Cross A', 'patient', 'active', ?, 'Clinic pt-cross', 1, 'individual', 'General Medicine', ?, ?, ?)`
      )
      .run(`user-cross-a-${suffix}`, clinic.tenantId, emailA, hashPassword("Lumera@2026"), patientA.phone, now, now, patientA.id);
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
          id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
          doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
          medicines, lab_tests, advice, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'UHID-B', ?, 'Dr Cross', 'General Medicine', 'REG-CROSS', '2026-10-16', ?, '[]', '[]', '[]', ?)`
      )
      .run(
        `rx-b-${suffix}`,
        clinic.tenantId,
        `RX-B-${suffix}`,
        patientB.id,
        patientB.name,
        patientB.phone,
        clinic.doctorId,
        "OnlyOnPatientBChart",
        now
      );

    const tokenA = await login(emailA);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const own = await jsonRequest(port, "GET", `/api/patients/${patientA.id}/chart`, undefined, authA);
    assert.equal(own.status, 200);
    assert.equal((own.json.patient as { id?: string }).id, patientA.id);

    const chart = await jsonRequest(port, "GET", `/api/patients/${patientB.id}/chart`, undefined, authA);
    assert.equal(chart.status, 404);
    assert.equal(chart.json.timeline, undefined);
    assert.equal(JSON.stringify(chart.json).includes("OnlyOnPatientBChart"), false);
    assert.equal(JSON.stringify(chart.json).includes(patientB.name), false);

    const record = await jsonRequest(port, "GET", `/api/patients/${patientB.id}`, undefined, authA);
    assert.equal(record.status, 404);
    assert.equal(record.json.timeline, undefined);
    assert.equal(JSON.stringify(record.json).includes("OnlyOnPatientBChart"), false);
    assert.equal(JSON.stringify(record.json).includes(patientB.name), false);
  });

  it("keeps draft Rx and WhatsApp event details out of a patient's timeline", async () => {
    const clinic = createClinicUser("pt-portal", "doctor");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Portal Timeline Patient", phone: "+91 98111 44009", age: 28, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patient = created.json.patient as { id: string; name: string; phone: string };
    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Issued signed diagnosis",
        medicines: [{ id: "m1", drugName: "Paracetamol", dosage: "500 mg", frequency: "1-0-1", durationDays: 3 }],
      },
      auth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO prescription_drafts (patient_id, tenant_id, doctor_id, draft_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      patient.id,
      clinic.tenantId,
      clinic.doctorId,
      JSON.stringify({
        diagnosis: "DraftOnlyDiagnosisSecret",
        medicines: [{ drugName: "SecretDraftDrug" }],
      }),
      now
    );
    db.prepare(
      `INSERT INTO whatsapp_outbound_events (
        id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id
      ) VALUES (?, 'appointment_reminder', ?, ?, 'delivered', ?, ?, ?, ?)`
    ).run(
      `wa-portal-${patient.id}`,
      patient.phone,
      patient.name,
      "OutboundPayloadSecretToken",
      JSON.stringify({ template: "action-payload-secret-token" }),
      now,
      clinic.tenantId
    );
    const suffix = patient.id.slice(-6);
    const email = `portal.tl.${suffix}@patients-tab.example`;
    db.prepare(
      `INSERT INTO users (
        id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
        onboarding_completed, practice_type, specialty, last_login, created_at, patient_id
      ) VALUES (?, ?, ?, ?, 'Portal Timeline Patient', 'patient', 'active', ?, 'Clinic pt-portal', 1, 'individual', 'General Medicine', ?, ?, ?)`
    ).run(`user-portal-${suffix}`, clinic.tenantId, email, hashPassword("Lumera@2026"), patient.phone, now, now, patient.id);

    const portal = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, {
      Authorization: `Bearer ${await login(email)}`,
    });
    assert.equal(portal.status, 200);
    const timeline = (portal.json.timeline || []) as Array<{ type: string; title: string; summary: string }>;
    const body = JSON.stringify(timeline);
    assert.equal(timeline.some((item) => item.type === "prescription" && item.summary.includes("Issued signed diagnosis")), true);
    assert.equal(body.includes("DraftOnlyDiagnosisSecret"), false);
    assert.equal(body.includes("SecretDraftDrug"), false);
    assert.equal(body.includes("OutboundPayloadSecretToken"), false);
    assert.equal(body.includes("action-payload-secret-token"), false);
    const sent = timeline.find((item) => item.title === "WhatsApp template sent");
    assert.ok(sent);
    assert.equal(sent?.summary, "");

    const staff = await jsonRequest(port, "GET", `/api/patients/${patient.id}/chart`, undefined, auth);
    assert.equal(staff.status, 200);
    const staffBody = JSON.stringify(staff.json.timeline || []);
    assert.equal(staffBody.includes("OutboundPayloadSecretToken"), true);
    assert.equal(staffBody.includes("Issued signed diagnosis"), true);
    assert.equal(staffBody.includes("DraftOnlyDiagnosisSecret"), false);
  });
});
