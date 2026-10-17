import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { appPublicUrl } from "./runtime.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { RX_NOT_FOUND, RX_NOT_SIGNED } from "./whatsapp-rx-bind.ts";

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `tenant-rxbind-${label}-${suffix}`;
  const userId = `user-rxbind-${label}-${suffix}`;
  const email = `rxbind.${label}.${suffix}@rx-bind.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label} ${suffix}`, `+91 80${suffix.slice(0, 8)}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, `+91 81${suffix.slice(0, 8)}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

describe("usage-billing Rx WhatsApp send is bound to the signed prescription", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createUsageBillingRouter());
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    return { Authorization: `Bearer ${String(res.json.token || "")}` };
  }

  async function createPatient(auth: Record<string, string>, name: string, phone: string) {
    const res = await jsonRequest(port, "POST", "/api/patients", { name, phone, age: 34, gender: "Female" }, auth);
    assert.ok(res.status === 200 || res.status === 201, String(res.json.error || res.status));
    return res.json.patient as { id: string; name: string; phone: string; uhid: string };
  }

  async function createRx(
    auth: Record<string, string>,
    patientId: string,
    opts: { diagnosis: string; reviewedBy?: string; drugName?: string }
  ) {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId,
        diagnosis: opts.diagnosis,
        medicines: [{ drugName: opts.drugName || "Paracetamol", dosage: "650 mg", frequency: "1-0-1" }],
        doctorName: "Dr Meera Shah",
        doctorSpecialty: "General Medicine",
        ...(opts.reviewedBy ? { reviewedBy: opts.reviewedBy } : {}),
      },
      auth
    );
    assert.equal(res.status, 201, String(res.json.error || JSON.stringify(res.json)));
    return res.json.prescription as { rxNumber: string };
  }

  it("returns 404 for a cross-tenant rxNumber and does not send", async () => {
    const owner = createClinic("owner");
    const other = createClinic("other");
    const ownerAuth = await login(owner.email);
    const otherAuth = await login(other.email);
    const phone = `+91 98210 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(ownerAuth, "Asha Rao", phone);
    const rx = await createRx(ownerAuth, patient.id, { diagnosis: "Viral fever", reviewedBy: owner.userId });
    const attackerPhone = `+91 90000 ${String(Date.now()).slice(-5)}`;
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send-rx",
      {
        rxNumber: rx.rxNumber,
        patientPhone: attackerPhone,
        patientName: "Not Asha",
        diagnosis: "CROSS_TENANT_LEAK",
        medicines: [{ drugName: "LEAK_DRUG" }],
      },
      otherAuth
    );
    assert.equal(res.status, 404);
    assert.equal(res.json.code, RX_NOT_FOUND);
    assert.equal(JSON.stringify(res.json).includes("Viral fever"), false);
    assert.equal(JSON.stringify(res.json).includes("CROSS_TENANT_LEAK"), false);
    const sent = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE patient_phone = ? OR content LIKE ?")
      .get(attackerPhone, "%CROSS_TENANT_LEAK%") as { c: number };
    assert.equal(sent.c, 0);
  });

  it("ignores body phone and text and fills portal_url from the server", async () => {
    const clinic = createClinic("bind");
    const auth = await login(clinic.email);
    const phone = `+91 98211 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Asha Rao", phone);
    const rx = await createRx(auth, patient.id, {
      diagnosis: "Viral fever",
      reviewedBy: clinic.userId,
      drugName: "Paracetamol",
    });
    const attackerPhone = `+91 91111 ${String(Date.now()).slice(-5)}`;
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send-rx",
      {
        rxNumber: rx.rxNumber,
        patientPhone: attackerPhone,
        patientName: "Not Asha",
        diagnosis: "LEAK_DIAGNOSIS",
        medicines: [{ drugName: "LEAK_DRUG", dosage: "999", frequency: "9-9-9" }],
        portal_url: "https://evil.example/phish",
        portalUrl: "https://evil.example/other",
        uhid: "UHID-LEAK",
      },
      auth
    );
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.deliveredTo, phone);
    const row = getDb()
      .prepare("SELECT patient_phone, content FROM whatsapp_messages WHERE patient_phone = ? ORDER BY created_at DESC LIMIT 1")
      .get(phone) as { patient_phone: string; content: string };
    assert.equal(row.patient_phone, phone);
    assert.match(row.content, /Asha Rao/);
    assert.match(row.content, /Viral fever/);
    assert.match(row.content, /Paracetamol/);
    const portal = appPublicUrl(`127.0.0.1:${port}`, "http").replace(/\/$/, "");
    assert.match(row.content, new RegExp(portal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(row.content.includes("{{portal_url}}"), false);
    assert.equal(row.content.includes(attackerPhone), false);
    assert.equal(row.content.includes("Not Asha"), false);
    assert.equal(row.content.includes("LEAK_DIAGNOSIS"), false);
    assert.equal(row.content.includes("LEAK_DRUG"), false);
    assert.equal(row.content.includes("evil.example"), false);
    assert.equal(row.content.includes("UHID-LEAK"), false);
    const attackerRow = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(attackerPhone);
    assert.equal(attackerRow, undefined);
  });

  it("rejects an unsigned prescription", async () => {
    const clinic = createClinic("unsigned");
    const auth = await login(clinic.email);
    const phone = `+91 98212 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Unsigned Patient", phone);
    const rx = await createRx(auth, patient.id, { diagnosis: "Unsigned note" });
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send-rx",
      { rxNumber: rx.rxNumber, patientPhone: "+91 90000 00000", diagnosis: "LEAK_UNSIGNED" },
      auth
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.code, RX_NOT_SIGNED);
    assert.equal(JSON.stringify(res.json).includes("Unsigned note"), false);
    assert.equal(JSON.stringify(res.json).includes("LEAK_UNSIGNED"), false);
    const sent = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
    assert.equal(sent, undefined);
  });
});
