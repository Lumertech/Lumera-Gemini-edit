import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signAbdmCallback } from "./abdm-hmac.ts";
import { authorizeAbdmCallbackWrite } from "./abdm-internal.ts";
import type { AbdmCallbackAuth } from "./abdm-hmac.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const unsigned: AbdmCallbackAuth = { ok: true, matched: false, sandboxTolerant: true };
const signed: AbdmCallbackAuth = { ok: true, matched: true };
const rejected: AbdmCallbackAuth = { ok: false, status: 401, error: "Invalid X-ABDM-Signature" };
const GATEWAY_HMAC_SECRET = "test-abdm-callback-hmac-secret";

const GATEWAY_ONLY_PATHS = [
  "/api/abdm/hip/consent/on-notify",
  "/api/abdm/hiu/consent-request/on-status",
  "/api/abdm/hiu/health-information/request",
  "/api/abdm/hiu/health-information/on-receive",
  "/api/abdm/hip/link/on-confirm",
] as const;

describe("ABDM callback write authorization", () => {
  it("accepts a matched signature or an unsigned staff care context, and never a patient session", () => {
    assert.equal(authorizeAbdmCallbackWrite({ role: undefined, hmac: signed }).accept, true);
    assert.equal(authorizeAbdmCallbackWrite({ role: "doctor", hmac: unsigned }).accept, true);

    const staffInvalid = authorizeAbdmCallbackWrite({ role: "receptionist", hmac: rejected });
    assert.equal(staffInvalid.accept, false);
    if (!staffInvalid.accept) assert.equal(staffInvalid.status, 401);

    const patientUnsigned = authorizeAbdmCallbackWrite({ role: "patient", hmac: unsigned });
    assert.equal(patientUnsigned.accept, false);
    if (!patientUnsigned.accept) {
      assert.equal(patientUnsigned.status, 403);
      assert.equal(patientUnsigned.code, "ROLE_DENIED");
    }
    const patientSigned = authorizeAbdmCallbackWrite({ role: "patient", hmac: signed });
    assert.equal(patientSigned.accept, false);
    if (!patientSigned.accept) assert.equal(patientSigned.status, 403);

    const anonymous = authorizeAbdmCallbackWrite({ role: undefined, hmac: unsigned });
    assert.equal(anonymous.accept, false);
    if (!anonymous.accept) assert.equal(anonymous.status, 401);

    const anonymousRejected = authorizeAbdmCallbackWrite({ role: null, hmac: rejected });
    assert.equal(anonymousRejected.accept, false);
    if (!anonymousRejected.accept) assert.equal(anonymousRejected.status, 401);
  });

  it("requires a matched signature on gateway-only routes and still allows staff care contexts", () => {
    const staffMissing = authorizeAbdmCallbackWrite({ role: "doctor", hmac: unsigned, gatewayOnly: true });
    assert.equal(staffMissing.accept, false);
    if (!staffMissing.accept) assert.equal(staffMissing.status, 401);
    const staffBad = authorizeAbdmCallbackWrite({ role: "receptionist", hmac: rejected, gatewayOnly: true });
    assert.equal(staffBad.accept, false);
    if (!staffBad.accept) assert.equal(staffBad.status, 401);

    assert.equal(authorizeAbdmCallbackWrite({ role: undefined, hmac: signed, gatewayOnly: true }).accept, true);
    assert.equal(authorizeAbdmCallbackWrite({ role: "doctor", hmac: signed, gatewayOnly: true }).accept, true);
    assert.equal(authorizeAbdmCallbackWrite({ role: "receptionist", hmac: unsigned }).accept, true);
  });
});

describe("gateway-only ABDM routes", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-abdm-callback-authz";
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

  it("returns 401 for a receptionist with an invalid signature and stores nothing", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-gw-${suffix}`;
    const now = new Date().toISOString();
    const hfr = `HFR-GW-${suffix}`;
    const patientId = `pat-gw-${suffix}`;
    const email = `reception.${suffix}@example.com`;
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Gateway Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, ?, ?, ?)`
      )
      .run(tenantId, now, hfr, now, now);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, ?, 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(patientId, tenantId, `UHID-${patientId}`, patientId, `+91 96141${suffix.slice(0, 4)}`, `chart.${suffix}@example.com`, now);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Reception', 'receptionist', 'active', ?, ?, ?, '')`
      )
      .run(`user-gw-${suffix}`, tenantId, email, hashPassword("Lumera@2026"), "+91 96000 10041", now, now);

    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || "login"));
    const staffAuth = { Authorization: `Bearer ${String(login.json.token || "")}` };
    const artefactCount = () =>
      (
        getDb()
          .prepare("SELECT COUNT(*) AS n FROM abdm_consent_artefacts WHERE tenant_id = ? AND patient_id = ?")
          .get(tenantId, patientId) as { n: number }
      ).n;
    const before = artefactCount();
    const body = {
      patientId,
      encounterId: "enc-gw",
      consentArtefact: { consentId: `grant-${suffix}`, status: "GRANTED", purpose: "forged" },
    };
    const badSignature = "sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const previous = process.env.ABDM_CALLBACK_SECRET;
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      for (const path of GATEWAY_ONLY_PATHS) {
        const denied = await jsonRequest(port, "POST", path, body, {
          ...staffAuth,
          "X-ABDM-Signature": badSignature,
        });
        assert.equal(denied.status, 401, `${path} ${String(denied.json.error || "")}`);
      }
      assert.equal(artefactCount(), before);

      const signedBody = {
        patientId,
        consentArtefact: { consentId: `grant-ok-${suffix}`, status: "GRANTED", purpose: "gateway" },
      };
      const signed = await jsonRequest(port, "POST", "/api/abdm/hiu/consent-request/on-status", signedBody, {
        "X-HIP-ID": hfr,
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(signedBody)),
      });
      assert.equal(signed.status, 202, String(signed.json.error || "signed gateway"));
      assert.equal(signed.json.patientId, patientId);
      assert.equal(artefactCount(), before + 1);
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }

    const care = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/link/care-context",
      { patientId, encounterId: "enc-staff", display: "OPD" },
      staffAuth
    );
    assert.equal(care.status, 200, String(care.json.error || "staff care-context"));
    assert.equal(care.json.patientId, patientId);

    const init = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hiu/consent-request/init",
      { patientId, purpose: "staff init" },
      staffAuth
    );
    assert.equal(init.status, 200, String(init.json.error || "staff init"));
    assert.equal(init.json.patientId, patientId);
  });
});
