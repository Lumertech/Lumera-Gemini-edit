import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signAbdmCallback } from "./abdm-hmac.ts";
import { consentAllowsFetch } from "./abdm-internal.ts";
import { createApiRouter } from "./api.ts";
import { storeConsentArtefact } from "./clinical.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const GATEWAY_HMAC_SECRET = "test-abdm-callback-hmac-secret";
const FETCH_PATH = "/api/abdm/hiu/health-information/request";
const RECEIVE_PATH = "/api/abdm/hiu/health-information/on-receive";
const ON_REQUEST_PATH = "/api/abdm/hip/health-information/on-request";

describe("consentAllowsFetch", () => {
  const granted = {
    kind: "hiu_consent",
    source: "gateway_signed",
    status: "GRANTED",
    tenantId: "tenant-a",
    patientId: "patient-a",
    dateRange: { from: "2026-10-16", to: "2026-10-16" },
  };
  const opts = {
    tenantId: "tenant-a",
    patientId: "patient-a",
    now: Date.parse("2026-10-16T12:00:00.000Z"),
  };

  it("allows a gateway-signed GRANTED artefact only inside its date range", () => {
    assert.equal(consentAllowsFetch(granted, opts), true);
    assert.equal(consentAllowsFetch({ ...granted, kind: "hip_notify" }, opts), true);
    assert.equal(
      consentAllowsFetch(granted, { ...opts, now: Date.parse("2026-10-16T00:00:00.000Z") }),
      true
    );
    assert.equal(
      consentAllowsFetch(granted, { ...opts, now: Date.parse("2026-10-16T23:59:59.999Z") }),
      true
    );
    assert.equal(
      consentAllowsFetch(granted, { ...opts, now: Date.parse("2026-10-17T00:00:00.000Z") }),
      false
    );
    assert.equal(consentAllowsFetch({ ...granted, source: "staff" }, opts), false);
    assert.equal(consentAllowsFetch({ ...granted, kind: "hip_care_context" }, opts), false);
    assert.equal(consentAllowsFetch({ ...granted, status: "DENIED" }, opts), false);
    assert.equal(consentAllowsFetch({ ...granted, dateRange: undefined }, opts), false);
    assert.equal(consentAllowsFetch(granted, { ...opts, tenantId: "other" }), false);
    assert.equal(consentAllowsFetch(granted, { ...opts, patientId: "other" }), false);
    assert.equal(consentAllowsFetch(undefined, opts), false);
  });
});

describe("ABDM health-information consent", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-abdm-consent-allow";
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

  function seed(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const tenantId = `tenant-allow-${label}-${suffix}`;
    const now = new Date().toISOString();
    const hfr = `HFR-ALLOW-${label}-${suffix}`;
    const patientId = `pat-allow-${label}-${suffix}`;
    const phone = `+91 8${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Allow Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, ?, ?, ?)`
      )
      .run(tenantId, now, hfr, now, now);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, ?, 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(patientId, tenantId, `UHID-${patientId}`, patientId, phone, `chart.${label}.${suffix}@example.com`, now);
    return { tenantId, now, suffix, hfr, patientId, phone };
  }

  function insertStaff(tenantId: string, suffix: string, now: string) {
    const email = `reception.allow.${suffix}@example.com`;
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Reception', 'receptionist', 'active', ?, ?, ?, '')`
      )
      .run(`user-allow-${suffix}`, tenantId, email, hashPassword("Lumera@2026"), `+91 7${suffix.replace(/\D/g, "").slice(0, 9).padStart(9, "1")}`, now, now);
    return email;
  }

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    return String(res.json.token || "");
  }

  async function signedPost(urlPath: string, body: Record<string, unknown>, hfr: string) {
    const previous = process.env.ABDM_CALLBACK_SECRET;
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      return await jsonRequest(port, "POST", urlPath, body, {
        "X-HIP-ID": hfr,
        "X-ABDM-Signature": signAbdmCallback(GATEWAY_HMAC_SECRET, JSON.stringify(body)),
      });
    } finally {
      if (previous === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previous;
    }
  }

  function artefactSource(tenantId: string, consentId: string): string {
    const row = getDb()
      .prepare("SELECT source FROM abdm_consent_artefacts WHERE tenant_id = ? AND consent_id = ?")
      .get(tenantId, consentId) as { source: string } | undefined;
    return String(row?.source || "");
  }

  it("returns 403 when consentId is missing or unknown", async () => {
    const { tenantId, hfr, patientId } = seed("missing");
    storeConsentArtefact(tenantId, patientId, {
      consentId: `grant-present-${patientId}`,
      kind: "hiu_consent",
      status: "GRANTED",
      dateRange: { from: "2026-01-01", to: "2026-12-31" },
    }, undefined, "gateway_signed");

    for (const path of [FETCH_PATH, RECEIVE_PATH, ON_REQUEST_PATH]) {
      const missing = await signedPost(path, { patientId, encounterId: "enc-missing" }, hfr);
      assert.equal(missing.status, 403, `${path} missing ${String(missing.json.error || "")}`);
      const unknown = await signedPost(
        path,
        { patientId, consentId: `missing-${patientId}`, encounterId: "enc-missing" },
        hfr
      );
      assert.equal(unknown.status, 403, `${path} unknown ${String(unknown.json.error || "")}`);
    }
  });

  it("returns 403 when consentId is a care-context reference", async () => {
    const clinic = seed("care");
    const email = insertStaff(clinic.tenantId, clinic.suffix, clinic.now);
    const token = await login(email);
    const linked = await jsonRequest(
      port,
      "POST",
      "/api/abdm/hip/link/care-context",
      {
        patientId: clinic.patientId,
        encounterId: "enc-care",
        source: "gateway_signed",
        status: "GRANTED",
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(linked.status, 200, String(linked.json.error || "care-context"));
    const ref = String(linked.json.careContextReference || "");
    assert.match(ref, /^CARE-CTX-/);
    assert.equal(artefactSource(clinic.tenantId, ref), "staff");

    storeConsentArtefact(
      clinic.tenantId,
      clinic.patientId,
      {
        consentId: `grant-beside-${clinic.suffix}`,
        kind: "hiu_consent",
        status: "GRANTED",
        source: "gateway_signed",
        dateRange: { from: "2026-01-01", to: "2026-12-31" },
      },
      undefined,
      "gateway_signed"
    );

    for (const path of [FETCH_PATH, RECEIVE_PATH, ON_REQUEST_PATH]) {
      const denied = await signedPost(
        path,
        { patientId: clinic.patientId, consentId: ref, encounterId: "enc-care" },
        clinic.hfr
      );
      assert.equal(denied.status, 403, `${path} care-context ${String(denied.json.error || "")}`);
    }
  });

  it("returns 403 for a staff-written GRANTED artefact and ignores a body source", async () => {
    const { tenantId, hfr, patientId, suffix } = seed("staff-grant");
    const consentId = `staff-grant-${suffix}`;
    storeConsentArtefact(tenantId, patientId, {
      consentId,
      kind: "hiu_consent",
      status: "GRANTED",
      source: "gateway_signed",
      dateRange: { from: "2026-01-01", to: "2026-12-31" },
    });
    assert.equal(artefactSource(tenantId, consentId), "staff");

    for (const path of [FETCH_PATH, RECEIVE_PATH, ON_REQUEST_PATH]) {
      const denied = await signedPost(path, { patientId, consentId, encounterId: "enc-staff" }, hfr);
      assert.equal(denied.status, 403, `${path} staff artefact ${String(denied.json.error || "")}`);
    }
  });

  it("returns 403 for an expired gateway-signed artefact", async () => {
    const { hfr, patientId, suffix } = seed("expired");
    const consentId = `expired-${suffix}`;
    const stored = await signedPost(
      "/api/abdm/hiu/consent-request/on-status",
      {
        patientId,
        consentArtefact: {
          consentId,
          status: "GRANTED",
          source: "gateway_signed",
          dateRange: { from: "2020-01-01", to: "2020-01-02" },
          purpose: "expired",
        },
      },
      hfr
    );
    assert.equal(stored.status, 202, String(stored.json.error || "expired grant"));

    for (const path of [FETCH_PATH, RECEIVE_PATH, ON_REQUEST_PATH]) {
      const denied = await signedPost(path, { patientId, consentId, encounterId: "enc-expired" }, hfr);
      assert.equal(denied.status, 403, `${path} expired ${String(denied.json.error || "")}`);
    }
  });

  it("allows a signed GRANTED artefact in range and uses the same tenant's doctor", async () => {
    const clinic = seed("granted");
    const other = seed("other-doc");
    const consentId = `grant-ok-${clinic.suffix}`;
    const encounterId = `enc-${clinic.suffix}`;
    const otherDoctorId = `doc-other-${other.suffix}`;
    const ownDoctorId = `doc-own-${clinic.suffix}`;

    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
         ) VALUES (?, NULL, ?, 'MBBS', ?, 'General Medicine', 1, 0, '', '[]', '', '', '', '', '', '', 1)`
      )
      .run(otherDoctorId, "Dr Other Clinic", `REG-OTHER-${other.suffix}`);
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
         ) VALUES (?, NULL, ?, 'MBBS', ?, 'General Medicine', 1, 0, '', '[]', '', '', '', '', '', '', 1)`
      )
      .run(ownDoctorId, "Dr Same Tenant", `REG-OWN-${clinic.suffix}`);
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'Dr Other Clinic', 'General Medicine', '2026-10-16', '09:00', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(
        `apt-other-${other.suffix}`,
        other.tenantId,
        other.patientId,
        other.patientId,
        other.phone,
        `UHID-${other.patientId}`,
        otherDoctorId,
        other.now
      );
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'Dr Same Tenant', 'General Medicine', '2026-10-16', '10:00', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(
        encounterId,
        clinic.tenantId,
        clinic.patientId,
        clinic.patientId,
        clinic.phone,
        `UHID-${clinic.patientId}`,
        ownDoctorId,
        clinic.now
      );

    const stored = await signedPost(
      "/api/abdm/hiu/consent-request/on-status",
      {
        patientId: clinic.patientId,
        consentArtefact: {
          consentId,
          status: "GRANTED",
          source: "staff",
          dateRange: { from: "2026-01-01", to: "2026-12-31" },
          purpose: "gateway",
        },
      },
      clinic.hfr
    );
    assert.equal(stored.status, 202, String(stored.json.error || "grant"));
    assert.equal(artefactSource(clinic.tenantId, consentId), "gateway_signed");

    for (const path of [FETCH_PATH, RECEIVE_PATH]) {
      const allowed = await signedPost(path, { patientId: clinic.patientId, consentId }, clinic.hfr);
      assert.equal(allowed.status, 200, `${path} ${String(allowed.json.error || "")}`);
    }

    const shared = await signedPost(
      ON_REQUEST_PATH,
      { patientId: clinic.patientId, consentId, encounterId, transactionId: `tx-${clinic.suffix}` },
      clinic.hfr
    );
    assert.equal(shared.status, 200, String(shared.json.error || "on-request"));
    assert.equal(shared.json.doctorId, ownDoctorId);
    assert.notEqual(shared.json.doctorId, otherDoctorId);
    assert.equal(shared.json.careContextReference, `CARE-CTX-UHID-${clinic.patientId}-${encounterId}`);

    const blank = await signedPost(
      ON_REQUEST_PATH,
      { patientId: clinic.patientId, consentId, encounterId: `missing-${clinic.suffix}` },
      clinic.hfr
    );
    assert.equal(blank.status, 200, String(blank.json.error || "blank doctor"));
    assert.equal(blank.json.doctorId, "");
  });

  it("lets a staff session link a care context with no signature", async () => {
    const clinic = seed("session");
    const email = insertStaff(clinic.tenantId, clinic.suffix, clinic.now);
    const token = await login(email);
    const previousNode = process.env.NODE_ENV;
    const previousSecret = process.env.ABDM_CALLBACK_SECRET;
    process.env.NODE_ENV = "production";
    process.env.ABDM_CALLBACK_SECRET = GATEWAY_HMAC_SECRET;
    try {
      const linked = await jsonRequest(
        port,
        "POST",
        "/api/abdm/hip/link/care-context",
        {
          patientId: clinic.patientId,
          encounterId: "enc-session",
          source: "gateway_signed",
        },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(linked.status, 200, String(linked.json.error || "staff care-context"));
      assert.equal(linked.json.patientId, clinic.patientId);
      const ref = String(linked.json.careContextReference || "");
      assert.equal(artefactSource(clinic.tenantId, ref), "staff");
    } finally {
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousSecret === undefined) delete process.env.ABDM_CALLBACK_SECRET;
      else process.env.ABDM_CALLBACK_SECRET = previousSecret;
    }
  });
});
