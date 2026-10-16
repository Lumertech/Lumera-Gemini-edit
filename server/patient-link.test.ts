import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { signAbdmCallback } from "./abdm-hmac.ts";
import { callbackTenantId } from "./abdm-internal.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { bindUnboundPatientUser } from "./patient-tenant.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_HMAC_SECRET = "test-abdm-callback-hmac-secret";

describe("patient logins bind to users.patient_id", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-patient-link";
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

  function seedClinic(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-link-${label}-${suffix}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Link Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, now, now, now);
    return { tenantId, now, suffix };
  }

  function insertPatient(tenantId: string, id: string, phone: string, email: string, now: string) {
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, ?, 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(id, tenantId, `UHID-${id}`, id, phone, email, now);
  }

  function insertLogin(
    tenantId: string,
    id: string,
    phone: string,
    email: string,
    now: string,
    patientId = "",
    role = "patient"
  ) {
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Linker', ?, 'active', ?, ?, ?, ?)`
      )
      .run(id, tenantId, email, hashPassword("Lumera@2026"), role, phone, now, now, patientId);
  }

  function localPhone(tag: string): string {
    const tail = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    return `+91 ${tag}${tail}`;
  }

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("binds one chart, leaves an ambiguous phone unbound, and does not move an existing binding", () => {
    const { tenantId, now, suffix } = seedClinic("match");
    const phone = localPhone("96111");
    const email = `link.${suffix}@example.com`;
    insertPatient(tenantId, `pat-one-${suffix}`, phone, email, now);
    insertLogin(tenantId, `user-one-${suffix}`, phone, email, now);
    assert.equal(bindUnboundPatientUser(`user-one-${suffix}`), `pat-one-${suffix}`);
    getDb().prepare("UPDATE users SET phone = ? WHERE id = ?").run("+91 90000 11111", `user-one-${suffix}`);
    assert.equal(bindUnboundPatientUser(`user-one-${suffix}`), `pat-one-${suffix}`);

    const sharedDigits = `96222${suffix.replace(/\D/g, "").slice(-5).padStart(5, "0")}`;
    insertPatient(tenantId, `pat-dup-a-${suffix}`, `+91 ${sharedDigits}`, `a.${suffix}@example.com`, now);
    insertPatient(tenantId, `pat-dup-b-${suffix}`, sharedDigits, `b.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-dup-${suffix}`, `+91 ${sharedDigits}`, `nobody.${suffix}@example.com`, now);
    assert.equal(bindUnboundPatientUser(`user-dup-${suffix}`), null);
    const unbound = getDb().prepare("SELECT patient_id FROM users WHERE id = ?").get(`user-dup-${suffix}`) as {
      patient_id: string;
    };
    assert.equal(String(unbound.patient_id || "").trim(), "");

    insertLogin(tenantId, `user-taken-${suffix}`, phone, `taken.${suffix}@example.com`, now);
    assert.equal(bindUnboundPatientUser(`user-taken-${suffix}`), null);
  });

  it("links the OTP-verified phone and ignores another patient's email", () => {
    const { tenantId, now, suffix } = seedClinic("email");
    const phoneOwn = localPhone("96666");
    const phoneB = localPhone("96777");
    const emailB = `chart.b.${suffix}@example.com`;
    insertPatient(tenantId, `pat-own-${suffix}`, phoneOwn, `chart.own.${suffix}@example.com`, now);
    insertPatient(tenantId, `pat-b-${suffix}`, phoneB, emailB, now);
    insertLogin(tenantId, `user-own-${suffix}`, phoneOwn, emailB, now);
    assert.equal(bindUnboundPatientUser(`user-own-${suffix}`), `pat-own-${suffix}`);

    insertPatient(tenantId, `pat-email-${suffix}`, localPhone("96999"), `chart.email.${suffix}@example.com`, now);
    insertLogin(
      tenantId,
      `user-email-${suffix}`,
      localPhone("96888"),
      `chart.email.${suffix}@example.com`,
      now
    );
    assert.equal(bindUnboundPatientUser(`user-email-${suffix}`), null);
    const unbound = getDb().prepare("SELECT patient_id FROM users WHERE id = ?").get(`user-email-${suffix}`) as {
      patient_id: string;
    };
    assert.equal(String(unbound.patient_id || "").trim(), "");
  });

  it("sets patient_id when the login OTP is verified and ignores a replacement phone", async () => {
    const { tenantId, now, suffix } = seedClinic("otp");
    const phone = localPhone("96444");
    const other = localPhone("96555");
    const email = `otp.${suffix}@example.com`;
    insertPatient(tenantId, `pat-otp-${suffix}`, phone, email, now);
    insertPatient(tenantId, `pat-otp-b-${suffix}`, other, `other.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-otp-${suffix}`, phone, email, now);
    const verificationId = `ver-${suffix}`;
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, '123456', 'login', ?, ?, ?)`
      )
      .run(verificationId, phone, email, JSON.stringify({ userId: `user-otp-${suffix}`, email }), now, expires);
    const verified = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: "123456",
      updatedPhone: other,
    });
    assert.equal(verified.status, 200, String(verified.json.error || "verify"));
    const row = getDb().prepare("SELECT phone, patient_id, whatsapp_verified FROM users WHERE id = ?").get(`user-otp-${suffix}`) as {
      phone: string;
      patient_id: string;
      whatsapp_verified: number;
    };
    assert.equal(row.phone, phone);
    assert.equal(row.patient_id, `pat-otp-${suffix}`);
    assert.equal(Number(row.whatsapp_verified), 1);
  });

  it("denies patients ABHA search, mobile search, and the HIU consent list", async () => {
    const { tenantId, now, suffix } = seedClinic("abdm");
    const phone = localPhone("96100");
    const patientEmail = `patient.abdm.${suffix}@example.com`;
    const staffEmail = `staff.abdm.${suffix}@example.com`;
    const patientId = `pat-abdm-${suffix}`;
    insertPatient(tenantId, patientId, phone, `chart.abdm.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-abdm-${suffix}`, phone, patientEmail, now, patientId);
    insertLogin(tenantId, `user-staff-${suffix}`, "+91 96000 10001", staffEmail, now, "", "doctor");
    const patientAuth = { Authorization: `Bearer ${await login(patientEmail)}` };
    const staffAuth = { Authorization: `Bearer ${await login(staffEmail)}` };

    for (const path of ["/api/abdm/search/searchByAbha", "/api/abdm/search/searchByMobile"] as const) {
      const denied = await jsonRequest(port, "POST", path, { abhaAddress: "own@sbx", mobile: phone }, patientAuth);
      assert.equal(denied.status, 403, path);
      assert.equal(denied.json.code, "ROLE_DENIED");
      const allowed = await jsonRequest(port, "POST", path, { abhaAddress: "own@sbx", mobile: phone }, staffAuth);
      assert.equal(allowed.status, 200, `${path} ${String(allowed.json.error || "")}`);
      assert.notEqual(allowed.json.code, "ROLE_DENIED");
    }

    const anonymous = await jsonRequest(port, "GET", `/api/abdm/hiu/consents?patientId=${patientId}`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.code, undefined);
    const deniedList = await jsonRequest(
      port,
      "GET",
      `/api/abdm/hiu/consents?patientId=${patientId}`,
      undefined,
      patientAuth
    );
    assert.equal(deniedList.status, 403);
    assert.equal(deniedList.json.code, "ROLE_DENIED");
    const staffList = await jsonRequest(
      port,
      "GET",
      `/api/abdm/hiu/consents?patientId=${patientId}`,
      undefined,
      staffAuth
    );
    assert.equal(staffList.status, 200, String(staffList.json.error || "consents"));
    assert.notEqual(staffList.json.code, "ROLE_DENIED");
  });

  it("rejects a user session on HIP discover and on-request unless the gateway signature matches", async () => {
    const { tenantId, now, suffix } = seedClinic("hip");
    const phone = localPhone("96101");
    const patientEmail = `patient.hip.${suffix}@example.com`;
    const staffEmail = `staff.hip.${suffix}@example.com`;
    const patientId = `pat-hip-${suffix}`;
    insertPatient(tenantId, patientId, phone, `chart.hip.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-hip-${suffix}`, phone, patientEmail, now, patientId);
    insertLogin(tenantId, `user-hip-staff-${suffix}`, "+91 96000 10002", staffEmail, now, "", "doctor");
    const patientAuth = { Authorization: `Bearer ${await login(patientEmail)}` };
    const staffAuth = { Authorization: `Bearer ${await login(staffEmail)}` };
    const discoverBody = { abhaNumber: "91-1111-2222-3333" };
    const onRequestBody = { patientId, consentId: `consent-${suffix}` };

    for (const auth of [patientAuth, staffAuth]) {
      const discover = await jsonRequest(port, "POST", "/api/abdm/hip/patient-discover", discoverBody, auth);
      assert.equal(discover.status, 401, String(discover.json.error || "discover"));
      const onRequest = await jsonRequest(
        port,
        "POST",
        "/api/abdm/hip/health-information/on-request",
        onRequestBody,
        auth
      );
      assert.equal(onRequest.status, 401, String(onRequest.json.error || "on-request"));
    }

    const previous = process.env.ABDM_CALLBACK_SECRET;
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      const raw = JSON.stringify(discoverBody);
      const signed = await jsonRequest(port, "POST", "/api/abdm/hip/patient-discover", discoverBody, {
        ...patientAuth,
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, raw),
      });
      assert.equal(signed.status, 200, String(signed.json.error || "signed discover"));
      const signedOnRequest = await jsonRequest(
        port,
        "POST",
        "/api/abdm/hip/health-information/on-request",
        onRequestBody,
        {
          ...patientAuth,
          "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(onRequestBody)),
        }
      );
      assert.equal(signedOnRequest.status, 200, String(signedOnRequest.json.error || "signed on-request"));
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
  });

  it("ignores body.tenantId and uses X-HIP-ID only after the callback signature matches", async () => {
    const { tenantId, now, suffix } = seedClinic("hipid");
    const other = seedClinic("other");
    const hfr = `HFR-LINK-${suffix}`;
    const phone = localPhone("96102");
    const patientId = `pat-hipid-${suffix}`;
    getDb().prepare("UPDATE tenants SET hfr_id = ? WHERE id = ?").run(hfr, tenantId);
    insertPatient(tenantId, patientId, phone, `chart.hipid.${suffix}@example.com`, now);
    const body = { patientId, encounterId: "enc-hip", tenantId: other.tenantId, tenant_id: other.tenantId };
    const unsigned = await jsonRequest(port, "POST", "/api/abdm/hip/link/care-context", body, {
      "X-HIP-ID": hfr,
    });
    assert.equal(unsigned.status, 401, String(unsigned.json.error || "unsigned hip"));
    assert.equal(
      callbackTenantId({ headers: { "x-hip-id": hfr }, body: { tenantId: other.tenantId } }),
      null
    );
    assert.equal(
      callbackTenantId(
        { headers: { "x-hip-id": hfr }, body: { tenantId: other.tenantId } },
        { signatureMatched: true }
      ),
      tenantId
    );
    assert.equal(
      callbackTenantId({ headers: {}, body: { tenantId: other.tenantId } }, { signatureMatched: true }),
      null
    );

    const previous = process.env.ABDM_CALLBACK_SECRET;
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      const signed = await jsonRequest(port, "POST", "/api/abdm/hip/link/care-context", body, {
        "X-HIP-ID": hfr,
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(body)),
      });
      assert.equal(signed.status, 200, String(signed.json.error || "signed hip header"));
      assert.equal(signed.json.patientId, patientId);
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
  });

  it("rejects a patient session writing another patient's ABDM callback records", async () => {
    const { tenantId, now, suffix } = seedClinic("cb");
    const phoneA = localPhone("96121");
    const phoneB = localPhone("96122");
    const emailA = `patient.a.${suffix}@example.com`;
    const emailB = `patient.b.${suffix}@example.com`;
    const staffEmail = `staff.cb.${suffix}@example.com`;
    const patientA = `pat-a-${suffix}`;
    const patientB = `pat-b-${suffix}`;
    insertPatient(tenantId, patientA, phoneA, `chart.a.${suffix}@example.com`, now);
    insertPatient(tenantId, patientB, phoneB, `chart.b.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-a-${suffix}`, phoneA, emailA, now, patientA);
    insertLogin(tenantId, `user-b-${suffix}`, phoneB, emailB, now, patientB);
    insertLogin(tenantId, `user-staff-cb-${suffix}`, "+91 96000 10021", staffEmail, now, "", "doctor");
    const patientAuth = { Authorization: `Bearer ${await login(emailA)}` };
    const staffAuth = { Authorization: `Bearer ${await login(staffEmail)}` };
    const artefactCount = (patientId: string) =>
      (
        getDb().prepare("SELECT COUNT(*) AS n FROM abdm_consent_artefacts WHERE tenant_id = ? AND patient_id = ?").get(tenantId, patientId) as {
          n: number;
        }
      ).n;

    const beforeB = artefactCount(patientB);
    const careBody = { patientId: patientB, encounterId: "enc-stolen" };
    const care = await jsonRequest(port, "POST", "/api/abdm/hip/link/care-context", careBody, patientAuth);
    assert.equal(care.status, 403, String(care.json.error || "care-context"));
    assert.equal(care.json.code, "ROLE_DENIED");

    const notify = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/consent/on-notify",
      { patientId: patientB, consentId: `stolen-${suffix}`, purpose: "stolen" },
      patientAuth
    );
    assert.equal(notify.status, 403, String(notify.json.error || "notify"));
    assert.equal(notify.json.code, "ROLE_DENIED");

    const onStatus = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/on-status",
      { patientId: patientB, consentArtefact: { consentId: `status-${suffix}`, status: "GRANTED" } },
      patientAuth
    );
    assert.equal(onStatus.status, 403);
    assert.equal(onStatus.json.code, "ROLE_DENIED");
    assert.equal(artefactCount(patientB), beforeB);

    const previous = process.env.ABDM_CALLBACK_SECRET;
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      const signed = await jsonRequest(port, "POST", "/api/abdm/hip/link/care-context", careBody, {
        ...patientAuth,
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(careBody)),
      });
      assert.equal(signed.status, 403, String(signed.json.error || "signed patient"));
      assert.equal(signed.json.code, "ROLE_DENIED");
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
    assert.equal(artefactCount(patientB), beforeB);

    const staffCare = await jsonRequest(port, "POST", "/api/abdm/hip/link/care-context", careBody, staffAuth);
    assert.equal(staffCare.status, 200, String(staffCare.json.error || "staff care-context"));
    assert.equal(staffCare.json.patientId, patientB);

    const anonInit = await jsonRequest(port, "POST", "/api/abdm/hiu/consent-request/init", {
      patientId: patientB,
      purpose: "anon",
    });
    assert.equal(anonInit.status, 401);
    const patientInit = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/init",
      { patientId: patientB, purpose: "patient" },
      patientAuth
    );
    assert.equal(patientInit.status, 403);
    assert.equal(patientInit.json.code, "ROLE_DENIED");
    const initBody = { patientId: patientB, purpose: "signed-anon" };
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      const signedAnonInit = await jsonRequest(port, "POST", "/api/abdm/hiu/consent-request/init", initBody, {
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(initBody)),
      });
      assert.equal(signedAnonInit.status, 401, String(signedAnonInit.json.error || "signed anon init"));
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
    const staffInit = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/init",
      { patientId: patientB, purpose: "staff init" },
      staffAuth
    );
    assert.equal(staffInit.status, 200, String(staffInit.json.error || "staff init"));
    assert.equal(staffInit.json.patientId, patientB);
    const ownInit = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/init",
      { patientId: patientA, purpose: "own chart" },
      patientAuth
    );
    assert.equal(ownInit.status, 403);
    assert.equal(ownInit.json.code, "ROLE_DENIED");
  });

  it("shows unlinked patients the WhatsApp OTP record prompt", () => {
    const portal = fs.readFileSync(path.join(root, "src/components/PatientPortal.tsx"), "utf8");
    assert.match(portal, /Verify via WhatsApp OTP to see your records/);
    const app = fs.readFileSync(path.join(root, "src/PatientPortalApp.tsx"), "utf8");
    const clinician = fs.readFileSync(path.join(root, "src/ClinicianApp.tsx"), "utf8");
    assert.match(app, /user\?\.role === "patient" && !user\.chartLinked/);
    assert.match(clinician, /user\?\.role === 'patient' && !user\.chartLinked/);
  });
});
