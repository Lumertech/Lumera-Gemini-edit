import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { createLiveRegistrationRouter } from "./live-registration-routes.ts";
import { OTP_VERIFY_LOCK_ERROR } from "./otp-attempt.ts";
import { consumeSendOtpAttempt, resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";

const PASSWORD = "Lumera@2026";

function insertDoctor(label: string) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${label}.${stamp}@otp-limit.example`;
  const phone = `+91 96${stamp.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
  const now = new Date().toISOString();
  const userId = `user-otp-${stamp}`;
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, last_login, created_at)
       VALUES (?, 'tenant-lumera-main', ?, ?, ?, 'doctor', 'active', ?, 1, 'individual', ?, ?)`
    )
    .run(userId, email, hashPassword(PASSWORD), `Dr ${label}`, phone, now, now);
  return { email, phone, userId };
}

describe("OTP send and verify limits", () => {
  let server: TestHttpServer;

  before(async () => {
    initDatabase();
    resetSendOtpRateLimits();
    server = await startTestServer((app) => {
      app.use("/api", createLiveRegistrationRouter());
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    await server.close();
  });

  it("caps a public client IP at 3 code sends per 10 minutes across phones", () => {
    resetSendOtpRateLimits();
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const result = consumeSendOtpAttempt(`+1 555 010${i}`, "203.0.113.10", `email:ip-${i}@example`, now + i * 61_000);
      assert.equal(result.ok, true);
    }
    const blocked = consumeSendOtpAttempt("+1 555 0199", "203.0.113.10", "email:ip-4@example", now + 4 * 61_000);
    assert.equal(blocked.ok, false);
  });

  it("forgot-password reuses a pending code and returns 429 on the 4th request", async () => {
    resetSendOtpRateLimits();
    const doctor = insertDoctor("forgot");
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: doctor.email });
      assert.notEqual(res.status, 429, String(res.json.error || res.status));
      assert.equal(res.status, 200);
      assert.equal(res.json.phone, undefined);
      assert.equal(res.json.verificationId, undefined);
      assert.equal(res.json.message, "If this email is registered, we've sent a code.");
    }
    const stored = getDb()
      .prepare("SELECT id FROM otp_verifications WHERE lower(email) = ? AND purpose = 'password_reset'")
      .all(doctor.email.toLowerCase()) as { id: string }[];
    assert.equal(stored.length, 1);
    const blocked = await jsonRequest(server.port, "POST", "/api/auth/forgot-password", { email: doctor.email });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
  });

  it("login OTP step reuses a pending code and returns 429 on the 4th request", async () => {
    resetSendOtpRateLimits();
    const doctor = insertDoctor("login");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
        email: doctor.email,
        password: PASSWORD,
      });
      assert.equal(res.status, 200, String(res.json.error || res.status));
      assert.equal(res.json.requiresOtp, true);
      assert.equal(res.json.token, undefined);
      ids.push(String(res.json.verificationId || ""));
    }
    assert.equal(new Set(ids).size, 1);
    const blocked = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: PASSWORD,
    });
    assert.equal(blocked.status, 429);
  });

  it("oauth OTP step reuses a pending code and returns 429 on the 4th request", async () => {
    resetSendOtpRateLimits();
    const doctor = insertDoctor("oauth");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/oauth", {
        provider: "google",
        profile: { email: doctor.email, name: "OAuth Doctor" },
      });
      assert.equal(res.status, 200, String(res.json.error || res.status));
      assert.equal(res.json.requiresOtp, true);
      assert.equal(res.json.token, undefined);
      ids.push(String(res.json.verificationId || ""));
    }
    assert.equal(new Set(ids).size, 1);
    const blocked = await jsonRequest(server.port, "POST", "/api/auth/oauth", {
      provider: "google",
      profile: { email: doctor.email, name: "OAuth Doctor" },
    });
    assert.equal(blocked.status, 429);
  });

  it("register-practice returns 429 on the 4th send from one client IP", async () => {
    resetSendOtpRateLimits();
    const forwarded = { "X-Forwarded-For": "203.0.113.44" };
    for (let i = 0; i < 3; i += 1) {
      const stamp = `${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`;
      const res = await jsonRequest(
        server.port,
        "POST",
        "/api/auth/register-practice",
        {
          clinicName: `Limit Clinic ${i}`,
          specialty: "General Medicine",
          phone: `+91 95${String(10000000 + i).slice(0, 8)}`,
          name: `Director ${i}`,
          email: `reg.${stamp}@otp-limit.example`,
          password: PASSWORD,
        },
        forwarded
      );
      assert.equal(res.status, 200, String(res.json.error || res.status));
      assert.ok(res.json.verificationId);
    }
    const stamp = `${Date.now().toString(36)}x${Math.random().toString(36).slice(2, 5)}`;
    const email = `reg.${stamp}@otp-limit.example`;
    const blocked = await jsonRequest(
      server.port,
      "POST",
      "/api/auth/register-practice",
      {
        clinicName: "Limit Clinic blocked",
        specialty: "General Medicine",
        phone: "+91 9599999999",
        name: "Director Blocked",
        email,
        password: PASSWORD,
      },
      forwarded
    );
    assert.equal(blocked.status, 429);
    const row = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
    assert.equal(row, undefined);
  });

  it("verify-otp locks the code after 5 wrong attempts", async () => {
    resetSendOtpRateLimits();
    const doctor = insertDoctor("verify");
    const verificationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, '246810', 'login', '{}', ?, ?)`
      )
      .run(verificationId, doctor.phone, doctor.email, new Date().toISOString(), expiresAt);

    for (let i = 0; i < 4; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
        verificationId,
        otp: "000000",
      });
      assert.equal(res.status, 400, String(res.json.error || res.status));
    }
    const locked = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: "000000",
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.json.error, OTP_VERIFY_LOCK_ERROR);
    const correct = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: "246810",
    });
    assert.equal(correct.status, 429);

    const freshId = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, '135790', 'login', ?, ?, ?)`
      )
      .run(
        freshId,
        doctor.phone,
        doctor.email,
        JSON.stringify({ userId: doctor.userId, email: doctor.email }),
        new Date().toISOString(),
        expiresAt
      );
    const ok = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId: freshId,
      otp: "135790",
    });
    assert.equal(ok.status, 200, String(ok.json.error || ok.status));
  });

  it("seeded demo password login does not consume the OTP send limit", async () => {
    resetSendOtpRateLimits();
    for (let i = 0; i < 4; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
        email: "doctor@lumera.me",
        password: PASSWORD,
      });
      assert.equal(res.status, 200, String(res.json.error || res.status));
      assert.equal(res.json.requiresOtp, false);
    }
  });
});
