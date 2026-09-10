import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { DEMO_LETTERHEAD } from "./letterhead.ts";
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

function createClinicUser(label: string, role: "doctor" | "receptionist" = "doctor") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@letterhead-test.example`.toLowerCase();
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
    `Dr ${label}`,
    role,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  const doctorId = `doc-${label}-${suffix}`;
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, signature_url, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 0, '', '[]', '', ?, ?, '', '', '', '', 1)`
  ).run(doctorId, userId, `Dr ${label}`, `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  return { tenantId, userId, doctorId, email };
}

describe("Tenant letterhead API", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-letterhead";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json({ limit: "2mb" }));
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

  it("requires authentication on letterhead GET and PUT", async () => {
    const getRes = await jsonRequest(port, "GET", "/api/tenant/letterhead");
    assert.equal(getRes.status, 401);
    const putRes = await jsonRequest(port, "PUT", "/api/tenant/letterhead", { gstin: "22AAAAA0000A1Z5" });
    assert.equal(putRes.status, 401);
  });

  it("round-trips clinic letterhead for a real tenant without seed GSTIN/UPI", async () => {
    const clinic = createClinicUser("lhA");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, auth);
    assert.equal(before.status, 200, String(before.json.error || ""));
    const empty = before.json.letterhead as { gstin: string; upiId: string; name: string };
    assert.equal(empty.gstin, "");
    assert.equal(empty.upiId, "");
    assert.notEqual(empty.gstin, DEMO_LETTERHEAD.gstin);
    assert.notEqual(empty.upiId, DEMO_LETTERHEAD.upiId);
    assert.match(empty.name, /^Clinic /);

    const payload = {
      name: "Meera Heart Clinic",
      address: "12 MG Road",
      city: "Pune, Maharashtra - 411001",
      email: "hello@meera.clinic",
      website: "https://meera.clinic",
      gstin: "27AABCM1234D1Z5",
      regId: "MH-CLINIC-2026/42",
      upiId: "meeraheart@okicici",
      sealText: "Digitally signed — Dr Meera Shah",
      signatureUrl: "data:image/png;base64,aaa",
    };
    const saved = await jsonRequest(port, "PUT", "/api/tenant/letterhead", payload, auth);
    assert.equal(saved.status, 200, String(saved.json.error || ""));
    const letterhead = saved.json.letterhead as Record<string, string>;
    assert.equal(letterhead.name, payload.name);
    assert.equal(letterhead.gstin, payload.gstin);
    assert.equal(letterhead.upiId, payload.upiId);
    assert.equal(letterhead.address, payload.address);
    assert.equal(letterhead.sealText, payload.sealText);
    assert.equal(letterhead.signatureUrl, payload.signatureUrl);

    const again = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, auth);
    const persisted = again.json.letterhead as Record<string, string>;
    assert.equal(persisted.gstin, payload.gstin);
    assert.equal(persisted.upiId, payload.upiId);
    assert.equal(persisted.signatureUrl, payload.signatureUrl);

    const current = await jsonRequest(port, "GET", "/api/tenant/current", undefined, auth);
    assert.equal(current.status, 200);
    const nested = current.json.letterhead as { gstin: string };
    assert.equal(nested.gstin, payload.gstin);

    const tenantRow = getDb()
      .prepare("SELECT name, gstin, upi_id FROM tenants WHERE id = ?")
      .get(clinic.tenantId) as { name: string; gstin: string; upi_id: string };
    assert.equal(tenantRow.gstin, payload.gstin);
    assert.equal(tenantRow.upi_id, payload.upiId);
    assert.equal(tenantRow.name, payload.name);
  });

  it("does not leak letterhead across tenants", async () => {
    const clinicA = createClinicUser("isoLH");
    const clinicB = createClinicUser("isoLX");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const secretGstin = "24SECRET9999K1Z0";

    const putA = await jsonRequest(
      port,
      "PUT",
      "/api/tenant/letterhead",
      { gstin: secretGstin, upiId: "clinic-a@upi", name: "Secret A Clinic" },
      { Authorization: `Bearer ${tokenA}` }
    );
    assert.equal(putA.status, 200, String(putA.json.error || ""));

    const getB = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, {
      Authorization: `Bearer ${tokenB}`,
    });
    assert.equal(getB.status, 200);
    const letterheadB = getB.json.letterhead as { gstin: string; upiId: string; name: string };
    assert.notEqual(letterheadB.gstin, secretGstin);
    assert.notEqual(letterheadB.upiId, "clinic-a@upi");
    assert.notEqual(letterheadB.name, "Secret A Clinic");
  });

  it("keeps Lumera seed branding on the demo tenant", async () => {
    const token = await login("doctor@lumera.me");
    const getRes = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(getRes.status, 200, String(getRes.json.error || ""));
    const letterhead = getRes.json.letterhead as { gstin: string; upiId: string; name: string };
    assert.equal(letterhead.gstin, DEMO_LETTERHEAD.gstin);
    assert.equal(letterhead.upiId, DEMO_LETTERHEAD.upiId);
    assert.match(letterhead.name, /Lumera/i);

    const demoRow = getDb()
      .prepare("SELECT gstin, upi_id FROM tenants WHERE id = ?")
      .get(DEMO_TENANT_ID) as { gstin: string; upi_id: string };
    assert.equal(demoRow.gstin, DEMO_LETTERHEAD.gstin);
    assert.equal(demoRow.upi_id, DEMO_LETTERHEAD.upiId);
  });

  it("stamps tenant letterhead onto new prescriptions and PDF HTML", async () => {
    const clinic = createClinicUser("pdfLH");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    await jsonRequest(
      port,
      "PUT",
      "/api/tenant/letterhead",
      {
        name: "Narmada Ortho Clinic",
        address: "88 Ring Road",
        city: "Indore",
        gstin: "23AABCN8899K1Z2",
        upiId: "narmada@upi",
        sealText: "Narmada authorized seal",
        phone: "+91 73100 11111",
      },
      auth
    );

    const patientRes = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Anita Rao", phone: `+91 98111 ${clinic.tenantId.slice(-4)}`, age: 41, gender: "Female" },
      auth
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patient = patientRes.json.patient as { id: string };

    const rxRes = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      { patientId: patient.id, diagnosis: "Knee osteoarthritis", medicines: [] },
      auth
    );
    assert.equal(rxRes.status, 201, String(rxRes.json.error || ""));
    const prescription = rxRes.json.prescription as {
      id: string;
      clinicName: string;
      clinicAddress: string;
      clinicPhone: string;
    };
    assert.equal(prescription.clinicName, "Narmada Ortho Clinic");
    assert.match(prescription.clinicAddress, /88 Ring Road/);
    assert.equal(prescription.clinicPhone, "+91 73100 11111");

    const pdf = await fetch(`http://127.0.0.1:${port}/api/whatsapp/prescription/${prescription.id}/pdf`);
    assert.equal(pdf.status, 200);
    const html = await pdf.text();
    assert.match(html, /Narmada Ortho Clinic/);
    assert.match(html, /23AABCN8899K1Z2/);
    assert.match(html, /narmada@upi/);
    assert.doesNotMatch(html, /LUMERA HEALTHCARE POLYCLINIC/);
    assert.doesNotMatch(html, /19AABCL8899K1Z5/);
    assert.doesNotMatch(html, /lumerahealth@icici/);
  });

  it("forbids receptionist from updating letterhead but allows GET", async () => {
    const clinic = createClinicUser("lhR", "receptionist");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const getRes = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, auth);
    assert.equal(getRes.status, 200);
    const putRes = await jsonRequest(port, "PUT", "/api/tenant/letterhead", { gstin: "19LEAK" }, auth);
    assert.equal(putRes.status, 403);
  });
});
