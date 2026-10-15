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
    const patient = created.json.patient as { id: string; name: string };
    assert.equal(patient.name, "OnlyAsha Menon");

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

    for (const q of ["OnlyAsha", "9811122233", "+91 98111 22233", "91424242424242", "asha.only@sbx"]) {
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
});
