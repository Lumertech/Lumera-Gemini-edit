import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { USER_PHONE_MISSING } from "./auth.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";

const PUBLIC_BODY = {
  ok: true,
  message: "If this email is registered, we've sent a code.",
};

function insertUser(label: string, phone: string) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${label}.${stamp}@reset-enum.example`;
  const now = new Date().toISOString();
  const userId = `user-reset-${stamp}`;
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, last_login, created_at)
       VALUES (?, 'tenant-lumera-main', ?, ?, ?, 'doctor', 'active', ?, 1, 'individual', ?, ?)`
    )
    .run(userId, email, hashPassword("Lumera@2026"), `Dr ${label}`, phone, now, now);
  return { email, phone, userId };
}

describe("forgot-password does not enumerate accounts", () => {
  let server: TestHttpServer;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    initDatabase();
    resetSendOtpRateLimits();
    server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    await server.close();
  });

  it("returns one body for an unknown email, a real email with no phone, and a real email with a phone", async () => {
    resetSendOtpRateLimits();
    const withPhone = insertUser("with-phone", `+91 97${String(Date.now()).slice(-8)}`);
    const noPhone = insertUser("no-phone", "");
    const unknown = `nobody.${Date.now().toString(36)}@reset-enum.example`;
    const since = new Date(Date.now() - 1000).toISOString();

    const unknownRes = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: unknown });
    const noPhoneRes = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: noPhone.email });
    const realRes = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: withPhone.email });

    assert.equal(unknownRes.status, 200);
    assert.equal(noPhoneRes.status, 200);
    assert.equal(realRes.status, 200);
    assert.deepEqual(unknownRes.json, PUBLIC_BODY);
    assert.deepEqual(noPhoneRes.json, realRes.json);
    assert.deepEqual(noPhoneRes.json, unknownRes.json);
    for (const body of [unknownRes.json, noPhoneRes.json, realRes.json]) {
      const text = JSON.stringify(body);
      assert.equal(text.includes(withPhone.phone), false);
      assert.equal(text.includes(withPhone.phone.replace(/\D/g, "")), false);
      assert.equal(/\d{8,}/.test(text), false);
      assert.equal(text.includes(unknown), false);
      assert.equal(text.includes(noPhone.email), false);
      assert.equal(text.includes(withPhone.email), false);
    }

    const otpFor = (email: string) =>
      (
        getDb()
          .prepare("SELECT COUNT(*) AS c FROM otp_verifications WHERE lower(email) = ? AND purpose = 'password_reset'")
          .get(email.toLowerCase()) as { c: number }
      ).c;
    assert.equal(otpFor(unknown), 0);
    assert.equal(otpFor(noPhone.email), 0);
    assert.equal(otpFor(withPhone.email), 1);
    const sentToPhone = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE patient_phone = ?")
      .get(withPhone.phone) as { c: number };
    assert.ok(sentToPhone.c >= 1);
    const leaked = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE content LIKE ? OR content LIKE ?")
      .get(`%${unknown}%`, `%${noPhone.email}%`) as { c: number };
    assert.equal(leaked.c, 0);

    const audits = getDb()
      .prepare(
        `SELECT user_id, user_name, action, details, entity_id
         FROM audit_logs
         WHERE action = 'password_reset_requested' AND timestamp >= ?`
      )
      .all(since) as Array<{ user_id: string; user_name: string; action: string; details: string; entity_id: string }>;
    assert.equal(audits.length, 3);
    const blob = JSON.stringify(audits);
    for (const secret of [unknown, noPhone.email, withPhone.email, withPhone.phone, withPhone.phone.replace(/\D/g, "")]) {
      assert.equal(blob.includes(secret), false, secret);
    }
    assert.ok(audits.some((row) => row.details === "outcome not_sent"));
    assert.ok(audits.some((row) => row.details === "outcome sent"));
  });

  it("checks the clinician phone only after the password matches", async () => {
    const doctor = insertUser("login-phone", "");
    const wrong = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: "wrong-password",
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, undefined);
    assert.equal(JSON.stringify(wrong.json).includes(USER_PHONE_MISSING), false);
    const missing = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email: "nobody-login@reset-enum.example",
      password: "Lumera@2026",
    });
    assert.equal(missing.status, 401);
    assert.equal(JSON.stringify(missing.json).includes(USER_PHONE_MISSING), false);
    const matched = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: "Lumera@2026",
    });
    assert.equal(matched.status, 422);
    assert.deepEqual(matched.json, { code: USER_PHONE_MISSING });
  });
});
