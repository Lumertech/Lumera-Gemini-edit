import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@opd-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  return { tenantId, userId, email };
}

describe("Wave 1A persist OPD loop", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-persist-opd";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
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

  it("unauthenticated clients cannot read or write prescriptions", async () => {
    const list = await jsonRequest(port, "GET", "/api/prescriptions");
    assert.equal(list.status, 401);
    const create = await jsonRequest(port, "POST", "/api/prescriptions", { diagnosis: "x" });
    assert.equal(create.status, 401);
    const one = await jsonRequest(port, "GET", "/api/prescriptions/rx-101");
    assert.equal(one.status, 401);
  });

  it("demo tenant still receives seeded patients and appointments", async () => {
    const token = await login("doctor@lumera.me");
    const patients = await jsonRequest(port, "GET", "/api/patients", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(patients.status, 200);
    const list = patients.json.patients as Array<{ name: string; id: string }>;
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 5);
    assert.ok(list.some((p) => /sunita|rajiv/i.test(p.name)));

    const appointments = await jsonRequest(port, "GET", "/api/appointments", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(appointments.status, 200);
    const apts = appointments.json.appointments as unknown[];
    assert.ok(Array.isArray(apts) && apts.length >= 1);

    const prescriptions = await jsonRequest(port, "GET", "/api/prescriptions", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(prescriptions.status, 200);
    const rxs = prescriptions.json.prescriptions as Array<{ rxNumber: string; medicines: unknown }>;
    assert.ok(Array.isArray(rxs) && rxs.length >= 1);
    assert.ok(rxs[0].rxNumber);
    assert.ok(Array.isArray(rxs[0].medicines));
  });

  it("new clinic starts empty then persists tokens, vitals, and signed Rx", async () => {
    const clinic = createClinicUser("alpha");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    const emptyPatients = await jsonRequest(port, "GET", "/api/patients", undefined, auth);
    assert.equal(emptyPatients.status, 200);
    assert.deepEqual(emptyPatients.json.patients, []);

    const emptyApts = await jsonRequest(port, "GET", "/api/appointments", undefined, auth);
    assert.deepEqual(emptyApts.json.appointments, []);

    const emptyRx = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
    assert.deepEqual(emptyRx.json.prescriptions, []);

    const createdPatient = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Anita Rao",
        phone: `+91 98111 ${clinic.tenantId.slice(-4)}`,
        age: 41,
        gender: "Female",
        bloodGroup: "B+",
        allergies: ["Penicillin"],
        chronicConditions: ["Hypertension"],
      },
      auth
    );
    assert.equal(createdPatient.status, 201, String(createdPatient.json.error || ""));
    const patient = createdPatient.json.patient as {
      id: string;
      uhid: string;
      name: string;
      allergies: string[];
    };
    assert.equal(patient.name, "Anita Rao");
    assert.ok(patient.id);
    assert.ok(patient.uhid);
    assert.deepEqual(patient.allergies, ["Penicillin"]);

    const createdApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        doctorName: "Dr Alpha",
        specialty: "General Medicine",
        type: "New Consultation",
        source: "Walk-in",
        status: "Triage / Vitals",
      },
      auth
    );
    assert.equal(createdApt.status, 201, String(createdApt.json.error || ""));
    const appointment = createdApt.json.appointment as {
      id: string;
      tokenNumber: number;
      status: string;
      vitals: unknown;
    };
    assert.ok(appointment.id);
    assert.equal(appointment.tokenNumber, 1);
    assert.equal(appointment.status, "Triage / Vitals");

    const vitals = {
      bloodPressureSystolic: 128,
      bloodPressureDiastolic: 82,
      heartRate: 74,
      temperature: 98.4,
      spO2: 99,
      weightKg: 64,
      heightCm: 162,
      recordedAt: "09:15 AM",
      recordedBy: "OPD Nurse",
    };
    const patched = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/${appointment.id}`,
      { status: "Waiting", tokenNumber: 7, vitals },
      auth
    );
    assert.equal(patched.status, 200, String(patched.json.error || ""));
    const updated = patched.json.appointment as {
      status: string;
      tokenNumber: number;
      vitals: { heartRate: number };
    };
    assert.equal(updated.status, "Waiting");
    assert.equal(updated.tokenNumber, 7);
    assert.equal(updated.vitals.heartRate, 74);

    const createdRx = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        patientName: patient.name,
        diagnosis: "Essential hypertension",
        icd10Code: "I10",
        chiefComplaints: ["Headache"],
        medicines: [
          {
            id: "med-1",
            drugName: "Telmisartan 40 mg",
            composition: "Telmisartan 40mg",
            dosage: "1 tab",
            form: "Tablet",
            frequency: "1-0-0",
            timing: "Morning",
            durationDays: 30,
          },
        ],
        labTests: [{ id: "lab-1", testName: "HbA1c", category: "Biochemistry" }],
        advice: ["Reduce salt"],
        followUpDate: "2026-10-10",
        clinicName: "Clinic Alpha",
        vitals,
      },
      auth
    );
    assert.equal(createdRx.status, 201, String(createdRx.json.error || ""));
    const prescription = createdRx.json.prescription as {
      id: string;
      rxNumber: string;
      medicines: Array<{ drugName: string }>;
      chiefComplaints: string[];
      vitals: { heartRate: number };
      clinicName: string;
    };
    assert.ok(prescription.id);
    assert.match(prescription.rxNumber, /^RX-/);
    assert.equal(prescription.medicines[0].drugName, "Telmisartan 40 mg");
    assert.deepEqual(prescription.chiefComplaints, ["Headache"]);
    assert.equal(prescription.vitals.heartRate, 74);
    assert.equal(prescription.clinicName, "Clinic Alpha");

    const hydrated = await jsonRequest(port, "GET", "/api/prescriptions", undefined, auth);
    const rxList = hydrated.json.prescriptions as Array<{ id: string }>;
    assert.equal(rxList.length, 1);
    assert.equal(rxList[0].id, prescription.id);

    const byPatient = await jsonRequest(
      port,
      "GET",
      `/api/prescriptions?patientId=${patient.id}`,
      undefined,
      auth
    );
    assert.equal((byPatient.json.prescriptions as unknown[]).length, 1);

    const one = await jsonRequest(port, "GET", `/api/prescriptions/${prescription.id}`, undefined, auth);
    assert.equal(one.status, 200);
    assert.equal((one.json.prescription as { rxNumber: string }).rxNumber, prescription.rxNumber);
  });

  it("clinic A never sees clinic B PHI", async () => {
    const clinicA = createClinicUser("isoA");
    const clinicB = createClinicUser("isoB");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };

    const patientA = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Clinic A Patient", phone: `+91 97110 ${clinicA.tenantId.slice(-4)}`, age: 30, gender: "Male" },
      authA
    );
    assert.equal(patientA.status, 201, String(patientA.json.error || ""));
    const patA = patientA.json.patient as { id: string; name: string };

    const patientB = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Clinic B Patient", phone: `+91 97220 ${clinicB.tenantId.slice(-4)}`, age: 28, gender: "Female" },
      authB
    );
    assert.equal(patientB.status, 201, String(patientB.json.error || ""));
    const patB = patientB.json.patient as { id: string };

    const listA = await jsonRequest(port, "GET", "/api/patients", undefined, authA);
    const namesA = ((listA.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
    assert.ok(namesA.includes("Clinic A Patient"));
    assert.equal(namesA.includes("Clinic B Patient"), false);
    assert.equal(namesA.some((n) => /sunita|rajiv/i.test(n)), false);

    const listB = await jsonRequest(port, "GET", "/api/patients", undefined, authB);
    const namesB = ((listB.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
    assert.ok(namesB.includes("Clinic B Patient"));
    assert.equal(namesB.includes("Clinic A Patient"), false);

    const rxA = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      { patientId: patA.id, diagnosis: "A-only diagnosis", medicines: [] },
      authA
    );
    assert.equal(rxA.status, 201, String(rxA.json.error || ""));
    const rxId = (rxA.json.prescription as { id: string }).id;

    const stolen = await jsonRequest(port, "GET", `/api/prescriptions/${rxId}`, undefined, authB);
    assert.equal(stolen.status, 404);

    const stolenPatient = await jsonRequest(port, "GET", `/api/patients/${patA.id}`, undefined, authB);
    assert.equal(stolenPatient.status, 404);

    const stolenApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: patA.id, specialty: "General Medicine" },
      authB
    );
    assert.equal(stolenApt.status, 404);

    const demoToken = await login("doctor@lumera.me");
    const demoPatients = await jsonRequest(port, "GET", "/api/patients", undefined, {
      Authorization: `Bearer ${demoToken}`,
    });
    const demoNames = ((demoPatients.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
    assert.equal(demoNames.includes("Clinic A Patient"), false);
    assert.equal(demoNames.includes("Clinic B Patient"), false);

    const demoTenantRows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?")
      .get(DEMO_TENANT_ID) as { c: number };
    assert.ok(demoTenantRows.c >= 5);
  });
});
