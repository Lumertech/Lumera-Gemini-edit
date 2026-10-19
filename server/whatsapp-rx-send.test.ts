import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { ensureWhatsAppOwnershipSchema } from "./whatsapp-numbers-store.ts";

const META_REJECT = "Meta rejected +91 9000099911 because it is not on the allow-list";

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const email = `${label}.${suffix}@rx-send.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(
    `user-${label}-${suffix}`,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    "+91 90000 11111",
    `Clinic ${label}`,
    now,
    now
  );
  return { tenantId, email, userId: `user-${label}-${suffix}` };
}

async function login(port: number, email: string) {
  const res = await jsonRequest(port, "POST", "/api/auth/login", {
    email,
    password: "Lumera@2026",
    skipOtp: true,
  });
  assert.equal(res.status, 200, String(res.json.error || "login"));
  return { Authorization: `Bearer ${String(res.json.token)}` };
}

async function createRx(port: number, auth: Record<string, string>, phone: string, diagnosis: string) {
  const patient = await jsonRequest(
    port,
    "POST",
    "/api/patients",
    { name: "Rx Patient", phone, age: 42, gender: "Female" },
    auth
  );
  assert.equal(patient.status, 201, String(patient.json.error || "patient"));
  const patientId = String((patient.json.patient as { id: string }).id);
  const rx = await jsonRequest(
    port,
    "POST",
    "/api/prescriptions",
    { patientId, diagnosis, doctorName: "Dr Sender", medicines: [{ drugName: "Paracetamol", dosage: "650 mg", frequency: "1-0-1" }] },
    auth
  );
  assert.equal(rx.status, 201, String(rx.json.error || "prescription"));
  const prescription = rx.json.prescription as { rxNumber: string; id: string };
  return { patientId, rxNumber: prescription.rxNumber };
}

describe("WhatsApp send-rx server honesty", () => {
  let server: TestHttpServer;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    process.env.NODE_ENV = "test";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    server = await startTestServer((app) => {
      app.use("/api", createUsageBillingRouter());
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    await server.close();
  });

  it("returns only a code when Meta rejects, and does not mark the Rx delivered", async () => {
    const clinic = createClinic("reject");
    const auth = await login(server.port, clinic.email);
    const phone = `+91 98111${String(Date.now()).slice(-5)}`;
    const diagnosis = "SECRET_DIAGNOSIS_TEXT";
    const created = await createRx(server.port, auth, phone, diagnosis);
    const now = new Date().toISOString();
    const db = getDb();
    ensureWhatsAppOwnershipSchema(db);
    const numberId = `wan-${created.rxNumber}`;
    const secretId = `wsec-${created.rxNumber}`;
    const phoneNumberId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`.replace(/\D/g, "").slice(0, 15);
    db.prepare(
      `INSERT INTO whatsapp_numbers
        (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
       VALUES (?, 'tenant', ?, ?, ?, 'Clinic', 'connected', 'embedded_signup', ?, '', ?, ?)`
    ).run(numberId, clinic.tenantId, `2048${phoneNumberId}`, phoneNumberId, secretId, now, now);
    db.prepare(
      `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, registration_pin, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`
    ).run(secretId, numberId, "EAARejectTokenWithoutEllipsis0123456789abcdef", now, now);

    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ error: { message: META_REJECT } }), { status: 400 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const sent = await jsonRequest(
        server.port,
        "POST",
        "/api/whatsapp/send-rx",
        {
          rxNumber: created.rxNumber,
          patientPhone: "+91 98234 55667",
          diagnosis: "HACKED_DIAGNOSIS",
          medicines: [{ drugName: "Unprescribed" }],
        },
        auth
      );
      assert.deepEqual(Object.keys(sent.json).sort(), ["code"]);
      assert.equal(sent.json.code, "WHATSAPP_SEND_FAILED");
      const bodyText = JSON.stringify(sent.json);
      assert.equal(bodyText.includes(META_REJECT), false);
      assert.equal(bodyText.includes("9000099911"), false);
      assert.equal(bodyText.includes(diagnosis), false);
      assert.equal(bodyText.includes("HACKED_DIAGNOSIS"), false);
      assert.equal(bodyText.includes("98234"), false);

      const message = db
        .prepare("SELECT id, status FROM whatsapp_messages WHERE patient_phone = ?")
        .get(phone) as { id: string; status: string } | undefined;
      assert.equal(message, undefined);
      const outbound = db
        .prepare("SELECT id FROM whatsapp_outbound_events WHERE patient_phone = ? AND event_type = 'whatsapp_rx_send'")
        .get(phone) as { id: string } | undefined;
      assert.equal(outbound, undefined);
      const rx = db
        .prepare("SELECT whatsapp_sent_status, diagnosis FROM prescriptions WHERE tenant_id = ? AND rx_number = ?")
        .get(clinic.tenantId, created.rxNumber) as { whatsapp_sent_status: string; diagnosis: string };
      assert.notEqual(rx.whatsapp_sent_status, "delivered");
      assert.notEqual(rx.whatsapp_sent_status, "sent");
      assert.equal(rx.diagnosis, diagnosis);

      const audit = db
        .prepare(
          "SELECT user_id, tenant_id, details FROM audit_logs WHERE action = 'whatsapp_rx_send' AND entity_id = ? ORDER BY timestamp DESC LIMIT 1"
        )
        .get(created.rxNumber) as { user_id: string; tenant_id: string; details: string };
      assert.equal(audit.tenant_id, clinic.tenantId);
      assert.equal(audit.user_id, clinic.userId);
      assert.match(audit.details, /outcome failed/);
      assert.match(audit.details, /code WHATSAPP_SEND_FAILED/);
      assert.match(audit.details, new RegExp(`rxNumber ${created.rxNumber}`));
      assert.equal(audit.details.includes(phone.replace(/\D/g, "")), false);
      assert.equal(audit.details.includes("98234"), false);
      assert.equal(audit.details.includes(diagnosis), false);
      assert.equal(audit.details.includes("HACKED_DIAGNOSIS"), false);
      assert.equal(audit.details.includes("Paracetamol"), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns PATIENT_PHONE_REQUIRED when the saved patient has no phone", async () => {
    const clinic = createClinic("nophone");
    const auth = await login(server.port, clinic.email);
    const created = await createRx(server.port, auth, `+91 98222${String(Date.now()).slice(-5)}`, "Phone missing later");
    const db = getDb();
    db.prepare("UPDATE patients SET phone = '' WHERE id = ? AND tenant_id = ?").run(created.patientId, clinic.tenantId);
    db.prepare("UPDATE prescriptions SET patient_phone = '' WHERE rx_number = ? AND tenant_id = ?").run(
      created.rxNumber,
      clinic.tenantId
    );
    const sent = await jsonRequest(server.port, "POST", "/api/whatsapp/send-rx", { rxNumber: created.rxNumber }, auth);
    assert.equal(sent.status, 400);
    assert.deepEqual(sent.json, { code: "PATIENT_PHONE_REQUIRED" });
    const rx = db
      .prepare("SELECT whatsapp_sent_status FROM prescriptions WHERE tenant_id = ? AND rx_number = ?")
      .get(clinic.tenantId, created.rxNumber) as { whatsapp_sent_status: string };
    assert.notEqual(rx.whatsapp_sent_status, "delivered");
  });

  it("does not update another clinic's prescription", async () => {
    const owner = createClinic("owner");
    const other = createClinic("other");
    const ownerAuth = await login(server.port, owner.email);
    const otherAuth = await login(server.port, other.email);
    const created = await createRx(server.port, ownerAuth, `+91 98333${String(Date.now()).slice(-5)}`, "Owner diagnosis");
    const sent = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send-rx",
      { rxNumber: created.rxNumber, patientPhone: "+91 98234 55667", diagnosis: "Stolen" },
      otherAuth
    );
    assert.equal(sent.status, 404);
    assert.deepEqual(sent.json, { code: "RX_NOT_FOUND" });
    const rx = getDb()
      .prepare("SELECT tenant_id, diagnosis, whatsapp_sent_status FROM prescriptions WHERE rx_number = ?")
      .get(created.rxNumber) as { tenant_id: string; diagnosis: string; whatsapp_sent_status: string };
    assert.equal(rx.tenant_id, owner.tenantId);
    assert.equal(rx.diagnosis, "Owner diagnosis");
    assert.notEqual(rx.whatsapp_sent_status, "delivered");
  });
});
