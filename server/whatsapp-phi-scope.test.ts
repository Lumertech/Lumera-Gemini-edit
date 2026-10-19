import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";

const SIMULATOR_OFF = "SANDBOX / DEV-ONLY simulator is disabled in production.";

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@wa-phi.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, `+91 97000 ${suffix.slice(0, 5)}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

function insertPatient(opts: { id: string; tenantId: string; name: string; phone: string; uhid: string }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO patients (
         id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
         emergency_contact, address, last_visit, created_at
       ) VALUES (?, ?, ?, ?, 34, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?, ?)`
    )
    .run(opts.id, opts.tenantId, opts.uhid, opts.name, opts.phone, now, now);
}

describe("WhatsApp bot PHI tenant scope", () => {
  let server: TestHttpServer;
  const cleanupIds: {
    patients: string[];
    rxs: string[];
    labs: string[];
    tenants: string[];
    users: string[];
    doctors: string[];
    appointments: string[];
  } = {
    patients: [],
    rxs: [],
    labs: [],
    tenants: [],
    users: [],
    doctors: [],
    appointments: [],
  };

  before(async () => {
    installWhatsAppRouterPatch();
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-wa-phi";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    server = await startTestServer((app) => {
      app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter()));
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    const db = getDb();
    for (const id of cleanupIds.labs) db.prepare("DELETE FROM lab_reports WHERE id = ?").run(id);
    for (const id of cleanupIds.rxs) db.prepare("DELETE FROM prescriptions WHERE id = ?").run(id);
    for (const id of cleanupIds.appointments) db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
    for (const id of cleanupIds.doctors) db.prepare("DELETE FROM doctors WHERE id = ?").run(id);
    for (const id of cleanupIds.patients) {
      db.prepare("DELETE FROM whatsapp_messages WHERE patient_phone = (SELECT phone FROM patients WHERE id = ?)").run(id);
      db.prepare("DELETE FROM whatsapp_conversations WHERE patient_phone = (SELECT phone FROM patients WHERE id = ?)").run(id);
      db.prepare("DELETE FROM patients WHERE id = ?").run(id);
    }
    for (const id of cleanupIds.users) db.prepare("DELETE FROM users WHERE id = ?").run(id);
    for (const id of cleanupIds.tenants) db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    await server.close();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("tenant B cannot read tenant A's prescription through POST /api/whatsapp/send", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const sharedPhone = `+91 96${String(Date.now()).slice(-8)}`;
    const sharedName = "Meera Iyer";
    const diagnosis = `ZXQDIAG${suffix}`;
    const drug = `ZXQDRUG${suffix}`;
    const rxNumber = `RX-ZXQ-${suffix}`;
    const a = createClinic("phiA");
    const b = createClinic("phiB");
    cleanupIds.tenants.push(a.tenantId, b.tenantId);
    cleanupIds.users.push(a.userId, b.userId);
    const patientA = `pat-phi-a-${suffix}`;
    const patientB = `pat-phi-b-${suffix}`;
    const rxId = `rx-phi-a-${suffix}`;
    cleanupIds.patients.push(patientA, patientB);
    cleanupIds.rxs.push(rxId);
    insertPatient({ id: patientA, tenantId: a.tenantId, name: sharedName, phone: sharedPhone, uhid: `UHID-A-${suffix}` });
    insertPatient({ id: patientB, tenantId: b.tenantId, name: sharedName, phone: sharedPhone, uhid: `UHID-B-${suffix}` });
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?)`
      )
      .run(
        rxId,
        a.tenantId,
        rxNumber,
        patientA,
        sharedName,
        sharedPhone,
        `UHID-A-${suffix}`,
        "doc-phi-a",
        "Dr Secret",
        "Medicine",
        "REG-PHI",
        "2026-10-15",
        diagnosis,
        JSON.stringify([{ drugName: drug, dosage: "500 mg", frequency: "1-0-1", timing: "Night" }]),
        now
      );

    const tokenA = await login(a.email);
    const tokenB = await login(b.email);
    const stolen = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        patientPhone: sharedPhone,
        patientName: sharedName,
        sender: "user",
        content: "rx",
      },
      auth(tokenB)
    );
    assert.equal(stolen.status, 201, String(stolen.json.error || ""));
    const stolenBody = JSON.stringify(stolen.json);
    const stolenReply = stolen.json.botReply as { content?: string; media?: unknown } | undefined;
    assert.notEqual(stolenReply?.content, "your prescription is ready");
    for (const secret of [diagnosis, drug, rxNumber, rxId, "Dr Secret", "previewData"]) {
      assert.equal(stolenBody.includes(secret), false, `tenant B response leaked ${secret}`);
    }

    const own = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        patientPhone: sharedPhone,
        patientName: "Someone Else",
        sender: "user",
        content: "rx",
      },
      auth(tokenA)
    );
    assert.equal(own.status, 201, String(own.json.error || ""));
    const ownReply = own.json.botReply as { content?: string; media?: { previewData?: unknown } } | undefined;
    assert.equal(ownReply?.content, "your prescription is ready");
    assert.equal(ownReply?.media, undefined);
    const ownBody = JSON.stringify(own.json);
    for (const secret of [diagnosis, drug, rxNumber, "previewData"]) {
      assert.equal(ownBody.includes(secret), false, `owner reply leaked ${secret}`);
    }

    const stored = getDb()
      .prepare("SELECT content, COALESCE(media, '') AS media FROM whatsapp_messages WHERE patient_phone = ?")
      .all(sharedPhone) as { content: string; media: string }[];
    const storedBlob = JSON.stringify(stored);
    for (const secret of [diagnosis, drug, rxNumber, "previewData"]) {
      assert.equal(storedBlob.includes(secret), false, `stored message leaked ${secret}`);
    }
  });

  it("same-tenant lab lookup follows the phone's patient, not the supplied name", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const clinic = createClinic("phiLab");
    cleanupIds.tenants.push(clinic.tenantId);
    cleanupIds.users.push(clinic.userId);
    const sharedName = "Anika Shah";
    const phoneOwner = `+91 97${String(Date.now()).slice(-8)}`;
    const phoneOther = `+91 95${String(Date.now() + 17).slice(-8)}`;
    assert.notEqual(phoneOwner, phoneOther);
    const ownerId = `pat-lab-own-${suffix}`;
    const otherId = `pat-lab-other-${suffix}`;
    const labId = `lab-phi-${suffix}`;
    cleanupIds.patients.push(ownerId, otherId);
    cleanupIds.labs.push(labId);
    const interpretation = `ZXQLAB${suffix}`;
    const flagged = `ZXQVAL${suffix}`;
    insertPatient({ id: ownerId, tenantId: clinic.tenantId, name: sharedName, phone: phoneOwner, uhid: `UHID-LO-${suffix}` });
    insertPatient({ id: otherId, tenantId: clinic.tenantId, name: sharedName, phone: phoneOther, uhid: `UHID-LX-${suffix}` });
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO lab_reports (
           id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name, category,
           doctor_interpretation, results, pdf_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        labId,
        clinic.tenantId,
        ownerId,
        `UHID-LO-${suffix}`,
        sharedName,
        "2026-10-15",
        "City Lab",
        "Chemistry",
        interpretation,
        JSON.stringify([{ param: "HbA1c", value: flagged, unit: "%", normalRange: "4-6", status: "High" }]),
        `/api/emr/lab-report/${labId}/pdf`,
        now
      );

    const token = await login(clinic.email);
    const wrongPatient = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        patientPhone: phoneOther,
        patientName: sharedName,
        sender: "user",
        content: "lab",
      },
      auth(token)
    );
    assert.equal(wrongPatient.status, 201, String(wrongPatient.json.error || ""));
    const wrongReply = wrongPatient.json.botReply as { content?: string } | undefined;
    assert.notEqual(wrongReply?.content, "your lab report is ready");
    const wrongBody = JSON.stringify(wrongPatient.json);
    for (const secret of [interpretation, flagged, labId, "previewData", "City Lab"]) {
      assert.equal(wrongBody.includes(secret), false, `other patient response leaked ${secret}`);
    }

    const owner = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        patientPhone: phoneOwner,
        patientName: "Not The Owner",
        sender: "user",
        content: "lab",
      },
      auth(token)
    );
    assert.equal(owner.status, 201, String(owner.json.error || ""));
    const ownerReply = owner.json.botReply as { content?: string; media?: unknown } | undefined;
    assert.equal(ownerReply?.content, "your lab report is ready");
    assert.equal(ownerReply?.media, undefined);
    const ownerBody = JSON.stringify(owner.json);
    for (const secret of [interpretation, flagged, labId, "previewData"]) {
      assert.equal(ownerBody.includes(secret), false, `owner lab reply leaked ${secret}`);
    }
  });

  it("POST /api/whatsapp/send rejects sender other than agent when simulators are off", async () => {
    const clinic = createClinic("phiSim");
    cleanupIds.tenants.push(clinic.tenantId);
    cleanupIds.users.push(clinic.userId);
    const token = await login(clinic.email);
    const phone = `+91 94${String(Date.now()).slice(-8)}`;
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      for (const sender of ["user", "bot"]) {
        const res = await jsonRequest(
          server.port,
          "POST",
          "/api/whatsapp/send",
          { patientPhone: phone, patientName: "Simulator", sender, content: "rx" },
          auth(token)
        );
        assert.equal(res.status, 403, sender);
        assert.equal(res.json.error, SIMULATOR_OFF);
        assert.equal(res.json.botReply, undefined);
      }
      const agent = await jsonRequest(
        server.port,
        "POST",
        "/api/whatsapp/send",
        { patientPhone: phone, patientName: "Simulator", sender: "agent", content: "staff reply" },
        auth(token)
      );
      assert.notEqual(agent.json.error, SIMULATOR_OFF);
      assert.notEqual(agent.status, 403);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("booking bot reply and its stored row omit the patient UHID", async () => {
    const clinic = createClinic("phiBook");
    cleanupIds.tenants.push(clinic.tenantId);
    cleanupIds.users.push(clinic.userId);
    const phone = `+91 93${String(Date.now()).slice(-8)}`;
    const token = await login(clinic.email);
    const booked = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        patientPhone: phone,
        patientName: "Booked Patient",
        sender: "user",
        content: "book dr. siddharth",
      },
      auth(token)
    );
    assert.equal(booked.status, 201, String(booked.json.error || ""));
    const reply = booked.json.botReply as { content?: string } | undefined;
    assert.match(String(reply?.content || ""), /Appointment Confirmed|Existing booking found/);
    const patient = getDb()
      .prepare("SELECT id, uhid FROM patients WHERE tenant_id = ? AND phone = ?")
      .get(clinic.tenantId, phone) as { id: string; uhid: string };
    assert.ok(patient?.uhid);
    cleanupIds.patients.push(patient.id);
    const replyText = String(reply?.content || "");
    assert.equal(replyText.includes("UHID"), false);
    assert.equal(replyText.includes(patient.uhid), false);
    const stored = getDb()
      .prepare("SELECT content FROM whatsapp_messages WHERE patient_phone = ? AND sender = 'bot'")
      .all(phone) as { content: string }[];
    assert.ok(stored.length >= 1);
    for (const row of stored) {
      assert.equal(row.content.includes("UHID"), false);
      assert.equal(row.content.includes(patient.uhid), false);
    }
  });

  it("booking list and roster include only the session clinic's doctors", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const a = createClinic("phiDocA");
    const b = createClinic("phiDocB");
    cleanupIds.tenants.push(a.tenantId, b.tenantId);
    cleanupIds.users.push(a.userId, b.userId);
    const doctorA = `doc-phi-a-${suffix}`;
    const doctorB = `doc-phi-b-${suffix}`;
    cleanupIds.doctors.push(doctorA, doctorB);
    const nameA = `ZXQDOCA ${suffix}`;
    const nameB = `ZXQDOCB ${suffix}`;
    const roomA = `ROOMA-${suffix}`;
    const roomB = `ROOMB-${suffix}`;
    const specA = `ZXQSPECA-${suffix}`;
    const specB = `ZXQSPECB-${suffix}`;
    const timingA = `ZXQTIMEA-${suffix}`;
    const timingB = `ZXQTIMEB-${suffix}`;
    const secretA = `ZXQMAILA-${suffix}@phi.example`;
    const secretB = `ZXQMAILB-${suffix}@phi.example`;
    const bioA = `ZXQBIOA-${suffix}`;
    const bioB = `ZXQBIOB-${suffix}`;
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, specialty, consultation_fee, opd_room, opd_timing, phone, email, bio, active
         ) VALUES (?, ?, ?, ?, 4242, ?, ?, '+910000111222', ?, ?, 1)`
      )
      .run(doctorA, a.userId, nameA, specA, roomA, timingA, secretA, bioA);
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, specialty, consultation_fee, opd_room, opd_timing, phone, email, bio, active
         ) VALUES (?, ?, ?, ?, 5151, ?, ?, '+910000333444', ?, ?, 1)`
      )
      .run(doctorB, b.userId, nameB, specB, roomB, timingB, secretB, bioB);

    const tokenB = await login(b.email);
    const phone = `+91 92${String(Date.now()).slice(-8)}`;
    const booking = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Roster Patient", sender: "user", content: "appointment" },
      auth(tokenB)
    );
    assert.equal(booking.status, 201, String(booking.json.error || ""));
    const bookingText = String((booking.json.botReply as { content?: string } | undefined)?.content || "");
    assert.equal(bookingText.includes(nameB), true);
    assert.equal(bookingText.includes(roomB), true);
    assert.equal(bookingText.includes(specB), true);
    for (const foreign of [nameA, roomA, specA, timingA, secretA, secretB, bioA, bioB]) {
      assert.equal(bookingText.includes(foreign), false, `booking list leaked ${foreign}`);
    }

    const roster = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Roster Patient", sender: "user", content: "roster" },
      auth(tokenB)
    );
    assert.equal(roster.status, 201, String(roster.json.error || ""));
    const rosterText = String((roster.json.botReply as { content?: string } | undefined)?.content || "");
    assert.equal(rosterText.includes(nameB), true);
    assert.equal(rosterText.includes(roomB), true);
    assert.equal(rosterText.includes(timingB), true);
    for (const foreign of [nameA, roomA, specA, timingA, secretA, secretB, bioA, bioB]) {
      assert.equal(rosterText.includes(foreign), false, `roster leaked ${foreign}`);
    }
  });

  it("queue and cancel use the session clinic, and a tenantless super admin cannot target another clinic", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const a = createClinic("phiQA");
    const b = createClinic("phiQB");
    const adminId = `user-phi-sa-${suffix}`;
    const adminEmail = `phi.sa.${suffix}@wa-phi.example`.toLowerCase();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, '', ?, ?, ?, 'super_admin', 'active', ?, 'Lumera', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(adminId, adminEmail, hashPassword("Lumera@2026"), `SA ${suffix}`, `+91 91${suffix.slice(0, 8)}`, now, now);
    cleanupIds.tenants.push(a.tenantId, b.tenantId);
    cleanupIds.users.push(a.userId, b.userId, adminId);

    const phone = `+91 90${String(Date.now()).slice(-8)}`;
    const patientId = `pat-phi-q-${suffix}`;
    const appointmentId = `appt-phi-q-${suffix}`;
    const storedName = `ZXQROW ${suffix}`;
    const tokenNumber = 880000 + (Date.now() % 10000);
    const uhid = `UHID-Q-${suffix}`;
    cleanupIds.patients.push(patientId);
    cleanupIds.appointments.push(appointmentId);
    insertPatient({ id: patientId, tenantId: a.tenantId, name: storedName, phone, uhid });
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'doc-q', 'Dr Queue', 'ZXQSPEC', '2026-10-19', '09:00 AM', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(appointmentId, a.tenantId, tokenNumber, patientId, storedName, phone, uhid, now);

    const tokenB = await login(b.email);
    const queued = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Caller Name", sender: "user", content: "queue" },
      auth(tokenB)
    );
    assert.equal(queued.status, 201, String(queued.json.error || ""));
    const queuedBody = JSON.stringify(queued.json);
    for (const secret of [storedName, String(tokenNumber), uhid, "Dr Queue"]) {
      assert.equal(queuedBody.includes(secret), false, `tenant B queue leaked ${secret}`);
    }

    const cancelled = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: phone, patientName: "Caller Name", sender: "user", content: "❌ cancel" },
      auth(tokenB)
    );
    assert.equal(cancelled.status, 201, String(cancelled.json.error || ""));
    assert.equal(JSON.stringify(cancelled.json).includes(storedName), false);
    assert.equal(
      (getDb().prepare("SELECT status FROM appointments WHERE id = ?").get(appointmentId) as { status: string }).status,
      "Waiting"
    );

    const tokenAdmin = await login(adminEmail);
    for (const content of ["queue", "❌ cancel"]) {
      const forged = await jsonRequest(
        server.port,
        "POST",
        "/api/whatsapp/send",
        { patientPhone: phone, patientName: "Caller Name", sender: "user", content, tenantId: a.tenantId },
        auth(tokenAdmin)
      );
      assert.equal(forged.status, 400, content);
      assert.equal(forged.json.error, "No tenant associated with this account.");
      const forgedBody = JSON.stringify(forged.json);
      for (const secret of [storedName, String(tokenNumber), uhid, "Dr Queue"]) {
        assert.equal(forgedBody.includes(secret), false, `super admin ${content} leaked ${secret}`);
      }
    }
    assert.equal(
      (getDb().prepare("SELECT status FROM appointments WHERE id = ?").get(appointmentId) as { status: string }).status,
      "Waiting"
    );
  });
});
