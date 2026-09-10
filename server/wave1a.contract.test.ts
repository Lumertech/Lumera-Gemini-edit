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
  const doctorId = `doc-${label}-${suffix}`;
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 0, '', '[]', '', ?, ?, '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  return { tenantId, userId, doctorId, email };
}

describe("Wave 1A patient/appointment contract", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-wave1a-contract";
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

  it("requires session JWT on patient and appointment routes", async () => {
    const patients = await jsonRequest(port, "GET", "/api/patients");
    assert.equal(patients.status, 401);
    const createPatient = await jsonRequest(port, "POST", "/api/patients", { name: "X", phone: "1" });
    assert.equal(createPatient.status, 401);
    const appointments = await jsonRequest(port, "GET", "/api/appointments");
    assert.equal(appointments.status, 401);
    const createApt = await jsonRequest(port, "POST", "/api/appointments", { patientId: "p-1" });
    assert.equal(createApt.status, 401);
    const abha = await jsonRequest(port, "PATCH", "/api/patients/p-1/abha", {
      abhaNumber: "91",
      abhaAddress: "x@sbx",
    });
    assert.equal(abha.status, 401);
    const linkAbha = await jsonRequest(port, "POST", "/api/patients/link-abha", {
      abhaNumber: "91-0000-0000-0000",
      source: "aadhaar_otp",
      abdmMode: "stub",
    });
    assert.equal(linkAbha.status, 401);
  });

  it("POST patient assigns id/uhid and POST appointment defaults Waiting + next token", async () => {
    const clinic = createClinicUser("w1a");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    const emptyPatients = await jsonRequest(port, "GET", "/api/patients", undefined, auth);
    assert.equal(emptyPatients.status, 200);
    assert.deepEqual(emptyPatients.json.patients, []);

    const createdPatient = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Meera Shah",
        age: 36,
        gender: "Female",
        phone: `+91 98122 ${clinic.tenantId.slice(-4)}`,
        email: "meera@clinic.test",
        bloodGroup: "O+",
        allergies: ["Dust"],
        chronicConditions: [],
        emergencyContact: "+91 98122 00000",
        address: "Pune",
      },
      auth
    );
    assert.equal(createdPatient.status, 201, String(createdPatient.json.error || ""));
    const patient = createdPatient.json.patient as Record<string, unknown>;
    assert.equal(patient.name, "Meera Shah");
    assert.ok(typeof patient.id === "string" && patient.id.length > 0);
    assert.ok(typeof patient.uhid === "string" && String(patient.uhid).startsWith("LUM-"));
    assert.equal(patient.age, 36);
    assert.equal(patient.gender, "Female");
    assert.equal(patient.bloodGroup, "O+");
    assert.deepEqual(patient.allergies, ["Dust"]);

    const ignoredIds = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        id: "client-pat-id",
        uhid: "CLIENT-UHID",
        name: "Ravi Shah",
        age: 40,
        gender: "Male",
        phone: `+91 98123 ${clinic.tenantId.slice(-4)}`,
      },
      auth
    );
    assert.equal(ignoredIds.status, 201, String(ignoredIds.json.error || ""));
    const ravi = ignoredIds.json.patient as { id: string; uhid: string };
    assert.notEqual(ravi.id, "client-pat-id");
    assert.notEqual(ravi.uhid, "CLIENT-UHID");

    const date = new Date().toISOString().slice(0, 10);
    const createdApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        doctorId: clinic.doctorId,
        date,
        timeSlot: "10:30 AM",
        type: "New Consultation",
        source: "Walk-in",
      },
      auth
    );
    assert.equal(createdApt.status, 201, String(createdApt.json.error || ""));
    const appointment = createdApt.json.appointment as Record<string, unknown>;
    assert.ok(appointment.id);
    assert.equal(appointment.tokenNumber, 1);
    assert.equal(appointment.status, "Waiting");
    assert.equal(appointment.patientId, patient.id);
    assert.equal(appointment.patientName, "Meera Shah");
    assert.equal(appointment.uhid, patient.uhid);
    assert.equal(appointment.patientPhone, patient.phone);
    assert.equal(appointment.doctorId, clinic.doctorId);
    assert.equal(appointment.doctorName, `Dr w1a`);
    assert.equal(appointment.vitals, null);

    const secondApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: ravi.id,
        doctorId: clinic.doctorId,
        date,
        timeSlot: "10:45 AM",
      },
      auth
    );
    assert.equal(secondApt.status, 201, String(secondApt.json.error || ""));
    assert.equal((secondApt.json.appointment as { tokenNumber: number }).tokenNumber, 2);
    assert.equal((secondApt.json.appointment as { status: string }).status, "Waiting");

    const patchedPatient = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patient.id}`,
      { age: 37, address: "Mumbai" },
      auth
    );
    assert.equal(patchedPatient.status, 200);
    const afterPatch = patchedPatient.json.patient as { age: number; address: string };
    assert.equal(afterPatch.age, 37);
    assert.equal(afterPatch.address, "Mumbai");

    const abha = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patient.id}/abha`,
      { abhaNumber: "91-1234-5678-9012", abhaAddress: "meera@sbx", source: "aadhaar_otp", abdmMode: "stub" },
      auth
    );
    assert.equal(abha.status, 200);
    assert.equal(abha.json.success, true);
    assert.equal(abha.json.id, patient.id);
    assert.equal(abha.json.abhaNumber, "91-1234-5678-9012");
    assert.equal(abha.json.abhaAddress, "meera@sbx");
    assert.equal(abha.json.kycStatus, "LINKED_SANDBOX");

    const vitals = { heartRate: 72, recordedAt: "10:31 AM" };
    const patchedApt = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/${appointment.id}`,
      { status: "In Consultation", tokenNumber: 1, vitals, isPaid: true },
      auth
    );
    assert.equal(patchedApt.status, 200);
    const updated = patchedApt.json.appointment as {
      status: string;
      tokenNumber: number;
      isPaid: boolean;
      vitals: { heartRate: number };
    };
    assert.equal(updated.status, "In Consultation");
    assert.equal(updated.tokenNumber, 1);
    assert.equal(updated.isPaid, true);
    assert.equal(updated.vitals.heartRate, 72);

    const listed = await jsonRequest(port, "GET", "/api/appointments", undefined, auth);
    const apts = listed.json.appointments as Array<{ tokenNumber: number; status: string; vitals: unknown }>;
    assert.equal(apts.length, 2);
    assert.ok(apts.every((a) => typeof a.tokenNumber === "number"));
    assert.ok(apts.some((a) => a.status === "Waiting"));
    assert.ok(apts.some((a) => a.status === "In Consultation" && a.vitals));
  });

  it("tenant isolation: real clinics never see demo or peer PHI", async () => {
    const clinicA = createClinicUser("isoA2");
    const clinicB = createClinicUser("isoB2");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };

    const patientA = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Clinic A Only", age: 29, gender: "Male", phone: `+91 97111 ${clinicA.tenantId.slice(-4)}` },
      authA
    );
    const patA = patientA.json.patient as { id: string };

    await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patA.id,
        doctorId: clinicA.doctorId,
        date: new Date().toISOString().slice(0, 10),
        timeSlot: "11:00 AM",
      },
      authA
    );

    const listB = await jsonRequest(port, "GET", "/api/patients", undefined, authB);
    const namesB = ((listB.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
    assert.equal(namesB.includes("Clinic A Only"), false);
    assert.equal(namesB.some((n) => /sunita|rajiv/i.test(n)), false);

    const aptsB = await jsonRequest(port, "GET", "/api/appointments", undefined, authB);
    assert.deepEqual(aptsB.json.appointments, []);

    const stolenPatient = await jsonRequest(port, "GET", `/api/patients/${patA.id}`, undefined, authB);
    assert.equal(stolenPatient.status, 404);

    const stolenAbha = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${patA.id}/abha`,
      { abhaNumber: "99", abhaAddress: "stolen@sbx" },
      authB
    );
    assert.equal(stolenAbha.status, 403);

    const stolenApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patA.id,
        doctorId: clinicB.doctorId,
        date: new Date().toISOString().slice(0, 10),
        timeSlot: "11:15 AM",
      },
      authB
    );
    assert.equal(stolenApt.status, 404);

    const demoToken = await login("doctor@lumera.me");
    const demoPatients = await jsonRequest(port, "GET", "/api/patients", undefined, {
      Authorization: `Bearer ${demoToken}`,
    });
    const demoNames = ((demoPatients.json.patients as Array<{ name: string }>) || []).map((p) => p.name);
    assert.equal(demoNames.includes("Clinic A Only"), false);
    const demoCount = getDb()
      .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?")
      .get(DEMO_TENANT_ID) as { c: number };
    assert.ok(demoCount.c >= 5);
  });
});
