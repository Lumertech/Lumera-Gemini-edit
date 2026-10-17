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

const RESET_FAILURE = {
  error: "Invalid or expired reset code. Please request a fresh OTP.",
};

function comparableHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key === "date") return;
    out[key] = value;
  });
  return out;
}

async function waitFor(check: () => boolean) {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(check(), true);
}

function passwordHash(userId: string) {
  return (getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string })
    .password_hash;
}

function insertResetOtp(email: string, otp: string, expiresAt?: string) {
  const id = `otp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
       VALUES (?, '+91 90000 11111', ?, ?, 'password_reset', '{}', ?, ?)`
    )
    .run(id, email, otp, now, expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString());
  return id;
}

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
    assert.deepEqual(comparableHeaders(unknownRes.headers), comparableHeaders(noPhoneRes.headers));
    assert.deepEqual(comparableHeaders(unknownRes.headers), comparableHeaders(realRes.headers));
    assert.equal(unknownRes.headers.get("retry-after"), null);
    assert.equal(noPhoneRes.headers.get("retry-after"), null);
    assert.equal(realRes.headers.get("retry-after"), null);
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
    await waitFor(() => {
      const sentToPhone = getDb()
        .prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE patient_phone = ?")
        .get(withPhone.phone) as { c: number };
      return sentToPhone.c >= 1;
    });
    const leaked = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE content LIKE ? OR content LIKE ?")
      .get(`%${unknown}%`, `%${noPhone.email}%`) as { c: number };
    assert.equal(leaked.c, 0);

    const loadAudits = () =>
      getDb()
        .prepare(
          `SELECT user_id, user_name, action, details, entity_id
           FROM audit_logs
           WHERE action = 'password_reset_requested' AND timestamp >= ?`
        )
        .all(since) as Array<{ user_id: string | null; user_name: string; action: string; details: string; entity_id: string }>;
    await waitFor(() => loadAudits().length >= 3);
    const audits = loadAudits();
    assert.equal(audits.length, 3);
    for (const row of audits) assert.equal(row.user_id, null);
    const blob = JSON.stringify(audits);
    for (const secret of [unknown, noPhone.email, withPhone.email, withPhone.phone, withPhone.phone.replace(/\D/g, "")]) {
      assert.equal(blob.includes(secret), false, secret);
    }
    assert.ok(audits.some((row) => row.details === "outcome not_sent"));
    assert.ok(audits.some((row) => row.details === "outcome sent"));

    const resent = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: withPhone.email });
    assert.equal(resent.status, 200);
    assert.deepEqual(resent.json, PUBLIC_BODY);
    assert.deepEqual(comparableHeaders(resent.headers), comparableHeaders(realRes.headers));
    assert.equal(resent.headers.get("retry-after"), null);
    assert.equal(otpFor(withPhone.email), 1);
    await waitFor(() => loadAudits().length >= 4);
    for (const row of loadAudits()) assert.equal(row.user_id, null);
  });

  it("keeps the same 200, body, and headers after each address is rate limited", async () => {
    resetSendOtpRateLimits();
    const withPhone = insertUser("limited-phone", `+91 96${String(Date.now()).slice(-8)}`);
    const noPhone = insertUser("limited-nophone", "");
    const unknown = `nobody.limited.${Date.now().toString(36)}@reset-enum.example`;
    const cases = [unknown, noPhone.email, withPhone.email];

    for (const email of cases) {
      for (let i = 0; i < 3; i += 1) {
        const allowed = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email });
        assert.equal(allowed.status, 200, email);
        assert.deepEqual(allowed.json, PUBLIC_BODY);
      }
    }
    const blocked = [];
    for (const email of cases) {
      blocked.push(await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email }));
    }
    for (const res of blocked) {
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, PUBLIC_BODY);
      assert.equal(res.headers.get("retry-after"), null);
    }
    assert.deepEqual(comparableHeaders(blocked[0].headers), comparableHeaders(blocked[1].headers));
    assert.deepEqual(comparableHeaders(blocked[0].headers), comparableHeaders(blocked[2].headers));
    const otpFor = (email: string) =>
      (
        getDb()
          .prepare("SELECT COUNT(*) AS c FROM otp_verifications WHERE lower(email) = ? AND purpose = 'password_reset'")
          .get(email.toLowerCase()) as { c: number }
      ).c;
    assert.equal(otpFor(unknown), 0);
    assert.equal(otpFor(noPhone.email), 0);
    assert.equal(otpFor(withPhone.email), 1);
  });

  it("rate limits forgot-password by client IP before looking the address up", async () => {
    resetSendOtpRateLimits();
    const ip = { "x-forwarded-for": "203.0.113.50" };
    const real = insertUser("ip-real", `+91 95${String(Date.now()).slice(-8)}`);
    const first = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: `a.${Date.now().toString(36)}@reset-enum.example` }, ip);
    const second = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: real.email }, ip);
    const third = await jsonRequest(
      server.port,
      "POST",
      "/api/auth/forgot-password",
      { email: `c.${Date.now().toString(36)}@reset-enum.example` },
      ip
    );
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 200);
    const blockedUnknown = await jsonRequest(
      server.port,
      "POST",
      "/api/auth/forgot-password",
      { email: `blocked-unknown.${Date.now().toString(36)}@reset-enum.example` },
      ip
    );
    const freshReal = insertUser("ip-blocked-real", `+91 94${String(Date.now()).slice(-8)}`);
    const blockedReal = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: freshReal.email }, ip);
    assert.equal(blockedUnknown.status, 200);
    assert.equal(blockedReal.status, 200);
    assert.deepEqual(blockedUnknown.json, PUBLIC_BODY);
    assert.deepEqual(blockedReal.json, blockedUnknown.json);
    assert.deepEqual(comparableHeaders(blockedUnknown.headers), comparableHeaders(blockedReal.headers));
    assert.equal(blockedUnknown.headers.get("retry-after"), null);
    assert.equal(blockedReal.headers.get("retry-after"), null);
    const freshCount = (
      getDb()
        .prepare("SELECT COUNT(*) AS c FROM otp_verifications WHERE lower(email) = ?")
        .get(freshReal.email.toLowerCase()) as { c: number }
    ).c;
    assert.equal(freshCount, 0);

    const otherIp = await jsonRequest(
      server.port,
      "POST",
      "/api/auth/forgot-password",
      { email: freshReal.email },
      { "x-forwarded-for": "203.0.113.51" }
    );
    assert.equal(otherIp.status, 200);
    assert.deepEqual(otherIp.json, PUBLIC_BODY);
    await waitFor(() => {
      const count = (
        getDb()
          .prepare("SELECT COUNT(*) AS c FROM otp_verifications WHERE lower(email) = ?")
          .get(freshReal.email.toLowerCase()) as { c: number }
      ).c;
      return count === 1;
    });
  });

  it("returns one 400 for an unknown, wrong, expired, locked, or reused reset code", async () => {
    const doctor = insertUser("reset-cap", `+91 93${String(Date.now()).slice(-8)}`);
    const other = insertUser("reset-other", `+91 92${String(Date.now()).slice(-8)}`);
    const beforeDoctor = passwordHash(doctor.userId);
    const beforeOther = passwordHash(other.userId);
    const idA = insertResetOtp(doctor.email, "135791");
    const idB = insertResetOtp(other.email, "246802");
    const expiredId = insertResetOtp(doctor.email, "333333", new Date(Date.now() - 60_000).toISOString());
    const post = (body: Record<string, unknown>) =>
      jsonRequest(server.port, "POST", "/api/auth/reset-password", body);

    const unknown = await post({
      email: `nobody.${Date.now().toString(36)}@reset-enum.example`,
      otp: "135791",
      newPassword: "FreshPass1",
    });
    const wrong = await post({ verificationId: idA, otp: "000000", newPassword: "FreshPass1" });
    const expired = await post({ verificationId: expiredId, otp: "333333", newPassword: "FreshPass1" });
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.json, RESET_FAILURE);
    assert.deepEqual(wrong.json, unknown.json);
    assert.deepEqual(expired.json, unknown.json);
    assert.equal(wrong.status, 400);
    assert.equal(expired.status, 400);
    assert.equal(unknown.headers.get("retry-after"), null);
    assert.equal(wrong.headers.get("retry-after"), null);

    for (let i = 0; i < 4; i += 1) {
      const again = await post({ verificationId: idA, otp: "000000", newPassword: "FreshPass1" });
      assert.equal(again.status, 400);
      assert.deepEqual(again.json, RESET_FAILURE);
    }
    const locked = await post({ verificationId: idA, otp: "135791", newPassword: "FreshPass1" });
    assert.equal(locked.status, 400);
    assert.deepEqual(locked.json, RESET_FAILURE);
    assert.equal(locked.headers.get("retry-after"), null);
    assert.equal(passwordHash(doctor.userId), beforeDoctor);
    const attemptsA = (
      getDb().prepare("SELECT failed_attempts, otp FROM otp_verifications WHERE id = ?").get(idA) as {
        failed_attempts: number;
        otp: string;
      }
    );
    assert.ok(attemptsA.failed_attempts >= 5);
    assert.equal(String(attemptsA.otp || ""), "");
    const attemptsB = (
      getDb().prepare("SELECT failed_attempts FROM otp_verifications WHERE id = ?").get(idB) as { failed_attempts: number | null }
    ).failed_attempts;
    assert.equal(Number(attemptsB || 0), 0);

    const changed = await post({ verificationId: idB, otp: "246802", newPassword: "FreshPass1" });
    assert.equal(changed.status, 200);
    const afterChange = passwordHash(other.userId);
    assert.notEqual(afterChange, beforeOther);
    const reused = await post({ verificationId: idB, otp: "246802", newPassword: "OtherPass9" });
    assert.equal(reused.status, 400);
    assert.deepEqual(reused.json, RESET_FAILURE);
    assert.equal(passwordHash(other.userId), afterChange);
    const afterReuse = passwordHash(other.userId);
    const reusedAgain = await post({ email: other.email, otp: "246802", newPassword: "OtherPass9" });
    assert.equal(reusedAgain.status, 400);
    assert.deepEqual(reusedAgain.json, RESET_FAILURE);
    assert.equal(passwordHash(other.userId), afterReuse);
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
