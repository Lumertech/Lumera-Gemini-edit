import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { backfillUnboundPatientUsers, backfillUserPatientIdsOnce, bindUnboundPatientUser } from "./patient-tenant.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

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

  function insertLogin(tenantId: string, id: string, phone: string, email: string, now: string, patientId = "") {
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Linker', 'patient', 'active', ?, ?, ?, ?)`
      )
      .run(id, tenantId, email, hashPassword("Lumera@2026"), phone, now, now, patientId);
  }

  it("binds one chart, leaves an ambiguous phone unbound, and does not move an existing binding", () => {
    const { tenantId, now, suffix } = seedClinic("match");
    const phone = `+91 96111${suffix.slice(-5)}`;
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

  it("does not backfill logins created after the one-time pass", () => {
    const { tenantId, now, suffix } = seedClinic("once");
    const phone = `+91 96333${suffix.slice(-5)}`;
    insertPatient(tenantId, `pat-late-${suffix}`, phone, `late.${suffix}@example.com`, now);
    insertLogin(tenantId, `user-late-${suffix}`, phone, `late.${suffix}@example.com`, now);
    backfillUserPatientIdsOnce(getDb());
    const skipped = getDb().prepare("SELECT patient_id FROM users WHERE id = ?").get(`user-late-${suffix}`) as {
      patient_id: string;
    };
    assert.equal(String(skipped.patient_id || "").trim(), "");
    assert.equal(backfillUnboundPatientUsers(getDb()) >= 1, true);
    const bound = getDb().prepare("SELECT patient_id FROM users WHERE id = ?").get(`user-late-${suffix}`) as {
      patient_id: string;
    };
    assert.equal(bound.patient_id, `pat-late-${suffix}`);
  });

  it("sets patient_id when the login OTP is verified and ignores a replacement phone", async () => {
    const { tenantId, now, suffix } = seedClinic("otp");
    const phone = `+91 96444${suffix.slice(-5)}`;
    const other = `+91 96555${suffix.slice(-5)}`;
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
});
