import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { appPublicUrl } from "./runtime.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { ensureWhatsAppOwnershipSchema } from "./whatsapp-numbers-store.ts";
import { resolveSignedRxWhatsAppSend, PATIENT_PHONE_MISSING, RX_NOT_FOUND, RX_NOT_SIGNED, RX_SEND_FAILED } from "./whatsapp-rx-bind.ts";

const GRAPH_TOKEN = "EAAGraphTokenWithoutEllipsis0123456789abcdef";
const META_REJECT = "Meta rejected the recipient because it is not on the allow-list";

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

  function connectClinicLine(tenantId: string, rxNumber: string) {
    const db = getDb();
    ensureWhatsAppOwnershipSchema(db);
    const now = new Date().toISOString();
    const numberId = `wan-${rxNumber}`;
    const secretId = `wsec-${rxNumber}`;
    const phoneNumberId = `9${Date.now()}${Math.floor(Math.random() * 1000)}`.replace(/\D/g, "").slice(0, 15);
    db.prepare(
      `INSERT INTO whatsapp_numbers
        (id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, connected_via, meta_token_ref, meta_token_expires_at, created_at, updated_at)
       VALUES (?, 'tenant', ?, ?, ?, 'Clinic', 'connected', 'embedded_signup', ?, '', ?, ?)`
    ).run(numberId, tenantId, `2048${phoneNumberId}`, phoneNumberId, secretId, now, now);
    db.prepare(
      `INSERT INTO whatsapp_number_secrets (id, whatsapp_number_id, meta_access_token, registration_pin, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`
    ).run(secretId, numberId, GRAPH_TOKEN, now, now);
  }

  function leakBody(rxNumber: string, attackerPhone: string) {
    return {
      rxNumber,
      patientPhone: attackerPhone,
      patientName: "Not Asha",
      diagnosis: "LEAK_DIAGNOSIS",
      medicines: [{ drugName: "LEAK_DRUG", dosage: "999", frequency: "9-9-9" }],
      portal_url: "https://evil.example/phish",
      portalUrl: "https://evil.example/other",
      uhid: "UHID-LEAK",
    };
  }

  function assertComposedText(content: string, attackerPhone: string, portal: string) {
    assert.match(content, /Prescription from /);
    assert.equal(content.includes("Official"), false);
    assert.equal(content.includes("Download"), false);
    assert.equal(/lumera/i.test(content), false);
    assert.equal(content.includes("/api/whatsapp/prescription"), false);
    assert.match(content, /Asha Rao/);
    assert.match(content, /Viral fever/);
    assert.match(content, /Paracetamol/);
    assert.match(content, new RegExp(portal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(content.includes("{{portal_url}}"), false);
    assert.equal(content.includes(attackerPhone), false);
    assert.equal(content.includes("Not Asha"), false);
    assert.equal(content.includes("LEAK_DIAGNOSIS"), false);
    assert.equal(content.includes("LEAK_DRUG"), false);
    assert.equal(content.includes("evil.example"), false);
    assert.equal(content.includes("UHID-LEAK"), false);
  }

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
    const body = leakBody(rx.rxNumber, attackerPhone);
    const portal = appPublicUrl(`127.0.0.1:${port}`, "http").replace(/\/$/, "");
    const resolved = resolveSignedRxWhatsAppSend(getDb(), clinic.tenantId, body, portal);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.phone, phone);
      assertComposedText(resolved.text, attackerPhone, portal);
    }
    const res = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", body, auth);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { success: false, channel: "sandbox", status: "sandbox" });
    const row = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
    assert.equal(row, undefined);
    const attackerRow = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(attackerPhone);
    assert.equal(attackerRow, undefined);
    const stored = getDb()
      .prepare("SELECT whatsapp_sent_status FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
      .get(rx.rxNumber, clinic.tenantId) as { whatsapp_sent_status: string };
    assert.notEqual(stored.whatsapp_sent_status, "sent");
    assert.notEqual(stored.whatsapp_sent_status, "delivered");
  });

  it("stores Meta's wamid as sent and ignores the request body", async () => {
    const clinic = createClinic("graph");
    const auth = await login(clinic.email);
    const phone = `+91 98213 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Asha Rao", phone);
    const rx = await createRx(auth, patient.id, {
      diagnosis: "Viral fever",
      reviewedBy: clinic.userId,
      drugName: "Paracetamol",
    });
    connectClinicLine(clinic.tenantId, rx.rxNumber);
    const attackerPhone = `+91 92222 ${String(Date.now()).slice(-5)}`;
    const wamid = `wamid.RX_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ messages: [{ id: wamid }] }), { status: 200 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const res = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", leakBody(rx.rxNumber, attackerPhone), auth);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.deepEqual(res.json, { success: true, status: "sent", messageId: wamid, channel: "graph" });
      const row = getDb()
        .prepare("SELECT id, patient_phone, content, status, tenant_id FROM whatsapp_messages WHERE id = ?")
        .get(wamid) as { id: string; patient_phone: string; content: string; status: string; tenant_id: string };
      assert.equal(row.patient_phone, phone);
      assert.equal(row.status, "sent");
      assert.equal(row.tenant_id, clinic.tenantId);
      const portal = appPublicUrl(`127.0.0.1:${port}`, "http").replace(/\/$/, "");
      assertComposedText(row.content, attackerPhone, portal);
      const stored = getDb()
        .prepare("SELECT whatsapp_sent_status, diagnosis FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
        .get(rx.rxNumber, clinic.tenantId) as { whatsapp_sent_status: string; diagnosis: string };
      assert.equal(stored.whatsapp_sent_status, "sent");
      assert.equal(stored.diagnosis, "Viral fever");
      const outbound = getDb()
        .prepare("SELECT tenant_id, status FROM whatsapp_outbound_events WHERE id = ?")
        .get(wamid) as { tenant_id: string; status: string };
      assert.equal(outbound.tenant_id, clinic.tenantId);
      assert.equal(outbound.status, "sent");
      const attackerRow = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(attackerPhone);
      assert.equal(attackerRow, undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns only a code when Meta rejects and does not mark the Rx sent", async () => {
    const clinic = createClinic("reject");
    const auth = await login(clinic.email);
    const phone = `+91 98214 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Asha Rao", phone);
    const rx = await createRx(auth, patient.id, {
      diagnosis: "SECRET_DIAGNOSIS_TEXT",
      reviewedBy: clinic.userId,
    });
    connectClinicLine(clinic.tenantId, rx.rxNumber);
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
        port,
        "POST",
        "/api/whatsapp/send-rx",
        { rxNumber: rx.rxNumber, patientPhone: "+91 90000 00000", diagnosis: "HACKED_DIAGNOSIS" },
        auth
      );
      assert.deepEqual(sent.json, { code: RX_SEND_FAILED });
      const bodyText = JSON.stringify(sent.json);
      assert.equal(bodyText.includes(META_REJECT), false);
      assert.equal(bodyText.includes("SECRET_DIAGNOSIS_TEXT"), false);
      assert.equal(bodyText.includes("HACKED_DIAGNOSIS"), false);
      const message = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
      assert.equal(message, undefined);
      const outbound = getDb()
        .prepare("SELECT id FROM whatsapp_outbound_events WHERE patient_phone = ? AND event_type = 'whatsapp_rx_send'")
        .get(phone);
      assert.equal(outbound, undefined);
      const stored = getDb()
        .prepare("SELECT whatsapp_sent_status, diagnosis FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
        .get(rx.rxNumber, clinic.tenantId) as { whatsapp_sent_status: string; diagnosis: string };
      assert.notEqual(stored.whatsapp_sent_status, "sent");
      assert.notEqual(stored.whatsapp_sent_status, "delivered");
      assert.equal(stored.diagnosis, "SECRET_DIAGNOSIS_TEXT");
      const audit = getDb()
        .prepare(
          "SELECT tenant_id, user_id, details FROM audit_logs WHERE action = 'whatsapp_rx_send' AND entity_id = ? ORDER BY timestamp DESC LIMIT 1"
        )
        .get(rx.rxNumber) as { tenant_id: string; user_id: string; details: string };
      assert.equal(audit.tenant_id, clinic.tenantId);
      assert.equal(audit.user_id, clinic.userId);
      assert.match(audit.details, /outcome failed/);
      assert.match(audit.details, new RegExp(`code ${RX_SEND_FAILED}`));
      assert.equal(audit.details.includes("SECRET_DIAGNOSIS_TEXT"), false);
      assert.equal(audit.details.includes("HACKED_DIAGNOSIS"), false);
      assert.equal(audit.details.includes(phone.replace(/\D/g, "")), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns 422 when the saved patient has no phone and does not send", async () => {
    const clinic = createClinic("nophone");
    const auth = await login(clinic.email);
    const phone = `+91 98215 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "No Phone", phone);
    const rx = await createRx(auth, patient.id, { diagnosis: "Needs a phone", reviewedBy: clinic.userId });
    getDb().prepare("UPDATE patients SET phone = '' WHERE id = ? AND tenant_id = ?").run(patient.id, clinic.tenantId);
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber: rx.rxNumber }, auth);
    assert.equal(sent.status, 422);
    assert.deepEqual(sent.json, { code: PATIENT_PHONE_MISSING });
    const row = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
    assert.equal(row, undefined);
    const stored = getDb()
      .prepare("SELECT whatsapp_sent_status FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
      .get(rx.rxNumber, clinic.tenantId) as { whatsapp_sent_status: string };
    assert.notEqual(stored.whatsapp_sent_status, "sent");
    assert.notEqual(stored.whatsapp_sent_status, "delivered");
  });

  it("does not send when production has no APP_URL", async () => {
    const clinic = createClinic("appurl");
    const auth = await login(clinic.email);
    const phone = `+91 98216 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Portal Patient", phone);
    const rx = await createRx(auth, patient.id, { diagnosis: "Portal", reviewedBy: clinic.userId });
    const previousEnv = process.env.NODE_ENV;
    const previousUrl = process.env.APP_URL;
    process.env.NODE_ENV = "production";
    delete process.env.APP_URL;
    try {
      const sent = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp/send-rx",
        { rxNumber: rx.rxNumber, portal_url: "https://evil.example/phish" },
        auth
      );
      assert.equal(sent.status, 500);
      assert.deepEqual(sent.json, { code: RX_SEND_FAILED });
      assert.equal(JSON.stringify(sent.json).includes("evil.example"), false);
      assert.equal(JSON.stringify(sent.json).includes("host"), false);
      const row = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
      assert.equal(row, undefined);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      if (previousUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousUrl;
    }
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
