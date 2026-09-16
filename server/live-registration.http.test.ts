import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { verifyPassword } from "./password.ts";
import { createLiveRegistrationRouter } from "./live-registration-routes.ts";

/**
 * HTTP coverage for the production live-registration override.
 * Mount order matches server.ts (override before createApiRouter).
 * Does not assert api.ts:LINE:COL stack frames — those vanish in dist/server.cjs.
 */
async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("live registration override HTTP", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-live-registration";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createLiveRegistrationRouter());
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("empty-password register-practice does not hash the demo seed and returns temporaryPassword", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `live.${stamp}@sec-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "Live Override Clinic",
      specialty: "General Medicine",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 97000 ${stamp.slice(0, 5)}`,
      name: "Live Director",
      email,
    });
    assert.equal(res.status, 200, String(res.json.error || "register-practice failed"));
    const temporaryPassword = String(res.json.temporaryPassword || "");
    assert.ok(temporaryPassword, "empty-password signup must return temporaryPassword");
    assert.notEqual(temporaryPassword, "Lumera@2026");
    assert.match(temporaryPassword, /^Tmp\./);

    const row = getDb().prepare("SELECT password_hash FROM users WHERE email = ?").get(email) as
      | { password_hash: string }
      | undefined;
    assert.ok(row?.password_hash);
    assert.equal(verifyPassword("Lumera@2026", row.password_hash), false);
    assert.equal(verifyPassword(temporaryPassword, row.password_hash), true);

    const okLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: temporaryPassword,
      skipOtp: true,
    });
    assert.equal(okLogin.status, 200, String(okLogin.json.error || "temp password login failed"));

    const badLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(badLogin.status, 401);
  });

  it("register-purpose verify-otp without passwordHash does not hash the demo seed", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `otp.${stamp}@sec-test.example`;
    const phone = `+91 97100 ${stamp.slice(0, 5)}`;
    const otp = "424242";
    const verificationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'register', ?, ?, ?)`
      )
      .run(
        verificationId,
        phone,
        email,
        otp,
        JSON.stringify({
          practiceName: "OTP Fallback Clinic",
          specialty: "gp",
          phone,
          name: "OTP Director",
          email,
        }),
        now,
        expiresAt
      );

    const res = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp,
    });
    assert.equal(res.status, 200, String(res.json.error || "verify-otp register failed"));
    const row = getDb().prepare("SELECT password_hash FROM users WHERE email = ?").get(email) as
      | { password_hash: string }
      | undefined;
    assert.ok(row?.password_hash);
    assert.equal(verifyPassword("Lumera@2026", row.password_hash), false);
    const temporaryPassword = String(res.json.temporaryPassword || "");
    assert.ok(temporaryPassword, "register verify-otp without hash must return temporaryPassword");
    assert.equal(verifyPassword(temporaryPassword, row.password_hash), true);
  });
});
