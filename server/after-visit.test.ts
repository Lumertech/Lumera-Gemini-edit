import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { carePlanForPatient, recordGrowth } from "./after-visit-care.ts";
import { issueCertificate } from "./clinic-certificate.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { approveTranslation, buildTranslation, patientFacingTranslation, readTranslation, saveTranslation } from "./rx-translation.ts";
import { bookTeleconsultAppointment, appendTeleconsultSignal, listTeleconsultSignals } from "./teleconsult.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { vertexGeminiModel } from "./vertex-gemini.ts";
import { growthPercentile } from "../src/lib/growthPercentiles.ts";
import { vaccinePlan } from "../src/lib/iapSchedule.ts";

function suffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function localPhone(): string {
  const tail = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;
  return `+919${tail.slice(-9)}`;
}

describe("after-visit language, certificates, vaccines, growth, and video", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-after-visit";
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

  function seedClinic(name: string) {
    const id = `tenant-after-${suffix()}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, ?, 'Paediatrics', 'India', 'IST (UTC+5:30)', '+91 20 4000 2200', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(id, name, now, now, now);
    return id;
  }

  function seedPatient(tenantId: string, age: number, gender: string, dob = "") {
    const id = `pat-${suffix()}`;
    const phone = localPhone();
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at, date_of_birth
         ) VALUES (?, ?, ?, 'Asha Rao', ?, ?, ?, '', 'O+', '[]', '[]', '', '', ?, ?)`
      )
      .run(id, tenantId, `UHID-${id}`, age, gender, phone, new Date().toISOString(), dob);
    return { id, phone };
  }

  function seedDoctor(tenantId: string, fee: number) {
    const userId = `user-${suffix()}`;
    const doctorId = `doc-${suffix()}`;
    const now = new Date().toISOString();
    const email = `${suffix()}@after-visit.example`;
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, specialty, created_at
         ) VALUES (?, ?, ?, ?, 'Dr Rao', 'doctor', 'active', ?, 1, 'individual', 'Paediatrics', ?)`
      )
      .run(userId, tenantId, email, hashPassword("Lumera@2026"), localPhone(), now);
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, specialty, consultation_fee, reg_number, active
         ) VALUES (?, ?, 'Dr Rao', 'Paediatrics', ?, 'REG-9', 1)`
      )
      .run(doctorId, userId, fee);
    return { doctorId, email };
  }

  it("keeps the drug name and hides AI text until the doctor approves it", async () => {
    const seen: string[][] = [];
    const built = await buildTranslation({
      language: "hi",
      medicines: [
        { drugName: "Crocin 250", frequency: "1-0-1", timing: "After Food", durationDays: 5, instructions: "with water" },
      ],
      advice: ["rest today"],
      generate: async (texts) => {
        seen.push(texts);
        return texts.map((text) => `अनुवाद ${text}`);
      },
    });
    assert.equal(built.directions[0].drugName, "Crocin 250");
    assert.match(built.directions[0].directions, /सुबह और रात/);
    assert.match(built.directions[0].directions, /खाने के बाद/);
    assert.equal(seen[0].includes("Crocin 250"), false);
    assert.equal(built.model, vertexGeminiModel());
    const tenantId = seedClinic("City Clinic");
    const rxId = `rx-${suffix()}`;
    saveTranslation(getDb(), { tenantId, prescriptionId: rxId, language: "hi", translation: built, status: "draft" });
    const draft = patientFacingTranslation(readTranslation(getDb(), tenantId, rxId, "hi"));
    assert.equal(draft?.lines[0].instructions, "");
    assert.equal(draft?.advice.length, 0);
    assert.equal(approveTranslation(getDb(), tenantId, rxId, "hi"), true);
    const approved = patientFacingTranslation(readTranslation(getDb(), tenantId, rxId, "hi"));
    assert.match(approved?.lines[0].instructions || "", /with water/);
    assert.equal(approved?.lines[0].drugName, "Crocin 250");
    assert.equal(approved?.aiApproved, true);
    assert.equal(approveTranslation(getDb(), "other-tenant", rxId, "hi"), false);
  });

  it("marks IAP doses due or overdue from the date of birth", () => {
    const now = new Date("2026-11-11T00:00:00.000Z");
    const dob = new Date(now.getTime() - 70 * 86_400_000);
    const plan = vaccinePlan({ dob, givenCodes: ["bcg"], now });
    assert.equal(plan.overdue.some((dose) => dose.code === "opv-0"), true);
    assert.equal(plan.overdue.some((dose) => dose.code === "bcg"), false);
    assert.equal(plan.due.some((dose) => dose.code === "dtwp-2"), true);
    assert.equal(plan.overdue.some((dose) => dose.code === "hpv"), false);
    assert.equal(plan.due.some((dose) => dose.code === "hpv"), false);
  });

  it("returns WHO/IAP checkpoint percentiles for height, weight, BMI, and head circumference", () => {
    assert.equal(growthPercentile("weight", "male", 12, 9.6), 50);
    assert.equal(growthPercentile("height", "female", 12, 74.0), 50);
    assert.equal(growthPercentile("head", "male", 12, 46.1), 50);
    assert.equal(growthPercentile("bmi", "male", 24, 16.2), 50);
    assert.equal(growthPercentile("weight", "male", 12, 4), 3);
    const tenantId = seedClinic("Growth Clinic");
    const patient = seedPatient(tenantId, 1, "Male", "2025-11-11");
    const point = recordGrowth(getDb(), tenantId, patient.id, {
      recordedOn: "2026-11-11",
      heightCm: 75.7,
      weightKg: 9.6,
      headCm: 46.1,
    });
    assert.equal(point.percentiles.weight, 50);
    assert.equal(point.percentiles.height, 50);
    assert.equal(point.percentiles.head, 50);
    assert.ok(point.bmi != null && point.bmi > 16 && point.bmi < 18);
    assert.throws(() => recordGrowth(getDb(), "missing-tenant", patient.id, { weightKg: 9 }), /Patient not found/);
  });

  it("prints a fitness certificate on the clinic letterhead and bills a video visit like a consult", async () => {
    const tenantId = seedClinic("City Clinic");
    const patient = seedPatient(tenantId, 8, "Female", "2018-01-01");
    const issued = await issueCertificate(getDb(), {
      tenantId,
      patientId: patient.id,
      kind: "fitness",
      patientName: "Asha Rao",
      age: 8,
      gender: "Female",
      date: "2026-11-11",
      diagnosis: "",
      purpose: "school sports",
      doctorName: "Dr Rao",
    });
    const row = getDb()
      .prepare("SELECT body, pdf_base64 FROM clinic_certificates WHERE id = ? AND tenant_id = ?")
      .get(issued.id, tenantId) as { body: string; pdf_base64: string };
    assert.match(row.body, /City Clinic/);
    assert.match(row.body, /medically fit for school sports/);
    assert.equal(row.body.includes("Lumera"), false);
    assert.equal(Buffer.from(row.pdf_base64, "base64").subarray(0, 4).toString(), "%PDF");

    const { doctorId } = seedDoctor(tenantId, 123456);
    const booked = bookTeleconsultAppointment(getDb(), {
      tenantId,
      patientId: patient.id,
      doctorId,
      date: "2026-11-20",
      timeSlot: "04:00 PM",
    });
    assert.equal(booked.type, "Teleconsult");
    assert.equal(booked.consultationFee, 123456);
    assert.equal(booked.doctorName, "Dr Rao");
    const stored = getDb()
      .prepare("SELECT type, consultation_fee, is_paid, tenant_id FROM appointments WHERE id = ?")
      .get(booked.id) as { type: string; consultation_fee: number; is_paid: number; tenant_id: string };
    assert.equal(stored.type, "Teleconsult");
    assert.equal(Number(stored.consultation_fee), 123456);
    assert.equal(Number(stored.is_paid), 0);
    assert.equal(stored.tenant_id, tenantId);
    const other = seedClinic("Other Clinic");
    assert.throws(
      () =>
        bookTeleconsultAppointment(getDb(), {
          tenantId: other,
          patientId: patient.id,
          doctorId,
          date: "2026-11-21",
          timeSlot: "04:00 PM",
        }),
      /Patient not found/
    );
    appendTeleconsultSignal(getDb(), {
      tenantId,
      appointmentId: booked.id,
      senderRole: "doctor",
      kind: "offer",
      payload: JSON.stringify({ type: "offer", sdp: "v=0" }),
    });
    assert.equal(listTeleconsultSignals(getDb(), other, booked.id).length, 0);
    assert.equal(listTeleconsultSignals(getDb(), tenantId, booked.id).length, 1);
    const plan = carePlanForPatient(getDb(), tenantId, patient.id, new Date("2026-11-11T00:00:00.000Z"));
    assert.equal(plan.paediatric, true);
    assert.ok((plan.vaccines?.overdue.length || 0) > 0);
  });

  it("refuses certificates without a session and across tenants", async () => {
    const denied = await jsonRequest(port, "POST", "/api/certificates", { kind: "medical", patientId: "x" });
    assert.equal(denied.status, 401);
    const tenantId = seedClinic("Route Clinic");
    const { email } = seedDoctor(tenantId, 500);
    const login = await jsonRequest(port, "POST", "/api/auth/login", { email, password: "Lumera@2026", skipOtp: true });
    assert.equal(login.status, 200, String(login.json.error || ""));
    const token = String(login.json.token || "");
    const other = seedClinic("Elsewhere");
    const stranger = seedPatient(other, 4, "Male");
    const missing = await jsonRequest(
      port,
      "POST",
      "/api/certificates",
      { kind: "medical", patientId: stranger.id },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(missing.status, 404);
    const desk = seedDoctor(tenantId, 500);
    getDb().prepare("UPDATE users SET role = 'receptionist' WHERE email = ?").run(desk.email);
    const deskLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: desk.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    const deskToken = String(deskLogin.json.token || "");
    const approve = await jsonRequest(
      port,
      "POST",
      "/api/rx-language/rx-missing/approve",
      { language: "hi" },
      { Authorization: `Bearer ${deskToken}` }
    );
    assert.equal(approve.status, 403);
  });
});
