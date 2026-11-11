import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { treatingDoctorId } from "./clinical.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { appPublicUrl } from "./runtime.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { ensureWhatsAppOwnershipSchema } from "./whatsapp-numbers-store.ts";
import { resolveSignedRxWhatsAppSend, signedRxWhatsAppText, PATIENT_PHONE_MISSING, RX_NOT_FOUND, RX_NOT_SIGNED, RX_SEND_FAILED, SAFETY_REVIEW_REQUIRED } from "./whatsapp-rx-bind.ts";
import { recordPassingSafetyAuditForStoredRx } from "./rx-safety-store.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";

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
        ...(opts.reviewedBy ? { reviewedBy: opts.reviewedBy, doctorId: opts.reviewedBy } : {}),
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

  function openServiceWindow(tenantId: string, phone: string) {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO whatsapp_conversations (
          id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
          unread_count, last_message, last_message_time, updated_at, tenant_id, last_inbound_at
        ) VALUES (?, ?, 'Asha Rao', 'bot', 'Clinic', '[]', 'en', 0, 'hello', ?, ?, ?, ?)`
      )
      .run(`conv-window-${phone.replace(/\D/g, "").slice(-8)}`, phone, now, now, tenantId, now);
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

  function allowRxSend(tenantId: string, rxNumber: string, phone: string) {
    assert.equal(recordPassingSafetyAuditForStoredRx(getDb(), tenantId, rxNumber), true);
    recordWhatsAppOptIn(getDb(), { tenantId, phone, optedIn: true, source: "test", actorId: "test" });
  }

  function assertComposedText(content: string, attackerPhone: string) {
    assert.match(
      content,
      /^Prescription from .+, reviewed and signed by .+\. View: https:\/\/www\.mylumera\.in\/rx\/v\/[A-Za-z0-9_-]+$/
    );
    assert.equal(content.includes("Asha"), false);
    assert.equal(content.includes("Viral fever"), false);
    assert.equal(content.includes("Paracetamol"), false);
    assert.equal(/UHID/i.test(content), false);
    assert.equal(/lumera\.health/i.test(content), false);
    assert.equal(content.includes("/api/whatsapp/prescription"), false);
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
    allowRxSend(clinic.tenantId, rx.rxNumber, phone);
    const resolved = await resolveSignedRxWhatsAppSend(getDb(), clinic.tenantId, body, portal);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.phone, phone);
      assert.equal(resolved.text.includes(portal), false);
      assert.equal(resolved.text.includes("Asha"), false);
      assert.equal(resolved.text.includes("Viral fever"), false);
      const shaped = signedRxWhatsAppText({
        clinicName: resolved.clinicName,
        doctorName: resolved.doctorName,
        portalUrl: "https://www.mylumera.in/rx/v/opaqueexampletoken",
      });
      assertComposedText(shaped, attackerPhone);
    }
    const liveBefore = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM patient_link_tokens WHERE tenant_id = ? AND resource_id = ? AND purpose = 'rx' AND revoked_at IS NULL`
      )
      .get(clinic.tenantId, rx.rxNumber) as { c: number };
    const res = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", body, auth);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { success: false, channel: "sandbox", status: "sandbox" });
    const liveAfter = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM patient_link_tokens WHERE tenant_id = ? AND resource_id = ? AND purpose = 'rx' AND revoked_at IS NULL`
      )
      .get(clinic.tenantId, rx.rxNumber) as { c: number };
    assert.equal(liveAfter.c, liveBefore.c);
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
    openServiceWindow(clinic.tenantId, phone);
    allowRxSend(clinic.tenantId, rx.rxNumber, phone);
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
      assertComposedText(row.content, attackerPhone);
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
    openServiceWindow(clinic.tenantId, phone);
    allowRxSend(clinic.tenantId, rx.rxNumber, phone);
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

  it("lets only the treating doctor sign, and the WhatsApp line names that doctor", async () => {
    const clinic = createClinic("signer");
    const now = new Date().toISOString();
    const adminEmail = `admin.${clinic.userId}@rx-bind.example`;
    const deskEmail = `desk.${clinic.userId}@rx-bind.example`;
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Clinic Admin', 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
      )
      .run(
        `admin-${clinic.userId}`,
        clinic.tenantId,
        adminEmail,
        hashPassword("Lumera@2026"),
        "+91 98111 00001",
        `Clinic signer`,
        now,
        now
      );
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Front Desk', 'receptionist', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(
        `desk-${clinic.userId}`,
        clinic.tenantId,
        deskEmail,
        hashPassword("Lumera@2026"),
        "+91 98111 00002",
        `Clinic signer`,
        now,
        now
      );
    const doctorAuth = await login(clinic.email);
    const adminAuth = await login(adminEmail);
    const deskAuth = await login(deskEmail);
    const phone = `+91 98217 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(doctorAuth, "Signed Patient", phone);

    const signed = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Treating doctor note",
        medicines: [{ drugName: "Paracetamol", dosage: "650 mg", frequency: "1-0-1" }],
        doctorId: clinic.userId,
        doctorName: "Impostor Name",
        reviewedBy: "not-the-session",
      },
      doctorAuth
    );
    assert.equal(signed.status, 201, String(signed.json.error || ""));
    const signedRx = signed.json.prescription as { rxNumber: string; reviewedBy?: string; doctorId?: string };
    assert.equal(signedRx.reviewedBy, clinic.userId);
    assert.equal(signedRx.doctorId, clinic.userId);
    const portal = appPublicUrl(`127.0.0.1:${port}`, "http").replace(/\/$/, "");
    allowRxSend(clinic.tenantId, signedRx.rxNumber, phone);
    const resolved = await resolveSignedRxWhatsAppSend(getDb(), clinic.tenantId, { rxNumber: signedRx.rxNumber }, portal);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.match(resolved.text, /reviewed and signed by Dr signer/);
      assert.equal(resolved.text.includes("Impostor Name"), false);
    }
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber: signedRx.rxNumber }, doctorAuth);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual(sent.json, { success: false, channel: "sandbox", status: "sandbox" });

    const saved = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "admin unsigned note",
        medicines: [],
        doctorId: clinic.userId,
        doctorName: "Impostor Name",
        reviewedBy: clinic.userId,
      },
      adminAuth
    );
    assert.equal(saved.status, 201, String(saved.json.error || ""));
    const rx = saved.json.prescription as { rxNumber: string; reviewedBy?: string };
    assert.equal(rx.reviewedBy || "", "");
    const stored = getDb()
      .prepare("SELECT doctor_id, specialty_modules FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
      .get(rx.rxNumber, clinic.tenantId) as { doctor_id: string; specialty_modules: string };
    assert.equal(stored.doctor_id, clinic.userId);
    assert.equal(JSON.parse(stored.specialty_modules).reviewedBy || "", "");
    const refused = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber: rx.rxNumber }, adminAuth);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, RX_NOT_SIGNED);

    const adminId = `admin-${clinic.userId}`;
    assert.equal(treatingDoctorId(clinic.tenantId, adminId, "CLINIC_ADMIN", adminId), "");
    const selfSaved = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "admin own id stays unsigned",
        medicines: [],
        doctorId: adminId,
        reviewedBy: adminId,
      },
      adminAuth
    );
    assert.equal(selfSaved.status, 201, String(selfSaved.json.error || ""));
    const selfRx = selfSaved.json.prescription as { rxNumber: string; reviewedBy?: string; doctorId?: string };
    assert.equal(selfRx.reviewedBy || "", "");
    assert.equal(selfRx.doctorId, adminId);
    const selfStored = getDb()
      .prepare("SELECT doctor_id, specialty_modules FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
      .get(selfRx.rxNumber, clinic.tenantId) as { doctor_id: string; specialty_modules: string };
    assert.equal(selfStored.doctor_id, adminId);
    assert.equal(JSON.parse(selfStored.specialty_modules).reviewedBy || "", "");
    const selfRefused = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber: selfRx.rxNumber }, adminAuth);
    assert.equal(selfRefused.status, 409);
    assert.equal(selfRefused.json.code, RX_NOT_SIGNED);

    const deskId = `desk-${clinic.userId}`;
    const linkedDeskDoctor = `doc-desk-${clinic.userId}`;
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
         VALUES (?, ?, 'Front Desk', 'MBBS', ?, 'General Medicine', 1, 0, '', '[]', '', '', '', '', '', '', 1)`
      )
      .run(linkedDeskDoctor, deskId, `REG-${deskId}`);
    const beforeDesk = (
      getDb().prepare("SELECT COUNT(*) AS c FROM prescriptions WHERE tenant_id = ?").get(clinic.tenantId) as { c: number }
    ).c;
    const denied = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "receptionist must not write",
        medicines: [],
        doctorId: linkedDeskDoctor,
        reviewedBy: linkedDeskDoctor,
      },
      deskAuth
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, "ROLE_DENIED");
    const afterDesk = (
      getDb().prepare("SELECT COUNT(*) AS c FROM prescriptions WHERE tenant_id = ?").get(clinic.tenantId) as { c: number }
    ).c;
    assert.equal(afterDesk, beforeDesk);
    assert.equal(treatingDoctorId(clinic.tenantId, deskId, "receptionist", linkedDeskDoctor), "");
    assert.equal(treatingDoctorId(clinic.tenantId, deskId, "receptionist", deskId), "");

    const ownerId = `owner-${clinic.userId}`;
    const ownerDoctorId = `doc-owner-${clinic.userId}`;
    const ownerEmail = `owner.${clinic.userId}@rx-bind.example`;
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Owner Doctor', 'polyclinic_admin', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
      )
      .run(ownerId, clinic.tenantId, ownerEmail, hashPassword("Lumera@2026"), "+91 98111 00003", "Clinic signer", now, now);
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
         VALUES (?, ?, 'Owner Doctor', 'MBBS', ?, 'General Medicine', 12, 500, 'OPD-1', '[]', '', '', '', '', '', '', 1)`
      )
      .run(ownerDoctorId, ownerId, `REG-${ownerId}`);
    assert.equal(treatingDoctorId(clinic.tenantId, ownerId, "polyclinic_admin", ownerId), "");
    assert.equal(treatingDoctorId(clinic.tenantId, ownerId, "polyclinic_admin", ownerDoctorId), ownerDoctorId);
    const ownerAuth = await login(ownerEmail);
    const ownerSigned = await jsonRequest(
      port,
      "POST",
      "/api/prescriptions",
      {
        patientId: patient.id,
        diagnosis: "Owner doctor note",
        medicines: [{ drugName: "Paracetamol", dosage: "650 mg", frequency: "1-0-1" }],
        doctorId: ownerDoctorId,
        reviewedBy: "not-the-session",
      },
      ownerAuth
    );
    assert.equal(ownerSigned.status, 201, String(ownerSigned.json.error || ""));
    const ownerRx = ownerSigned.json.prescription as { reviewedBy?: string; doctorId?: string };
    assert.equal(ownerRx.reviewedBy, ownerDoctorId);
    assert.equal(ownerRx.doctorId, ownerDoctorId);
  });

  it("rejects a direct POST when the signed Rx has no passing audit and no override", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const whatsappRoute = fs.readFileSync(path.join(root, "whatsapp.ts"), "utf8");
    const usageRoute = fs.readFileSync(path.join(root, "usage-billing-api.ts"), "utf8");
    assert.match(whatsappRoute, /router\.post\("\/send-rx"[\s\S]{0,180}handleSignedRxWhatsAppSend/);
    assert.match(usageRoute, /api\.post\("\/whatsapp\/send-rx"[\s\S]{0,180}handleSignedRxWhatsAppSend/);

    const clinic = createClinic("unaudited");
    const auth = await login(clinic.email);
    const phone = `+91 98218 ${String(Date.now()).slice(-5)}`;
    const patient = await createPatient(auth, "Unaudited Patient", phone);
    const rx = await createRx(auth, patient.id, { diagnosis: "Needs an audit", reviewedBy: clinic.userId });
    recordWhatsAppOptIn(getDb(), { tenantId: clinic.tenantId, phone, optedIn: true, source: "test", actorId: "test" });
    const portal = appPublicUrl(`127.0.0.1:${port}`, "http").replace(/\/$/, "");
    const resolved = await resolveSignedRxWhatsAppSend(getDb(), clinic.tenantId, { rxNumber: rx.rxNumber }, portal);
    assert.equal(resolved.ok, false);
    if (resolved.ok === false) {
      assert.equal(resolved.status, 409);
      assert.equal(resolved.code, SAFETY_REVIEW_REQUIRED);
    }
    const sent = await jsonRequest(port, "POST", "/api/whatsapp/send-rx", { rxNumber: rx.rxNumber }, auth);
    assert.equal(sent.status, 409);
    assert.equal(sent.json.code, SAFETY_REVIEW_REQUIRED);
    assert.equal(JSON.stringify(sent.json).includes("Needs an audit"), false);
    const row = getDb().prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?").get(phone);
    assert.equal(row, undefined);
  });
});
