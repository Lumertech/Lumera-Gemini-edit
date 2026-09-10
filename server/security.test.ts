import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  allowOtpEcho,
  allowPasswordLoginWithoutOtp,
  allowSkipOtp,
  attachUser,
  getJwtSecret,
  requireAuth,
  signJwtToken,
  verifyJwtToken,
} from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("Wave 1A PHI / auth lock", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    }
    initDatabase();

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api/gemini", requireAuth);
    app.use("/api", createApiRouter());
    app.post("/api/gemini/copilot", (_req, res) => {
      res.json({ ok: true, source: "test-stub" });
    });
    app.post("/api/gemini/generate-soap", (_req, res) => {
      res.json({ ok: true, source: "test-stub" });
    });

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

  it("does not honor skipOtp in production", () => {
    assert.equal(allowSkipOtp("production"), false);
    assert.equal(allowSkipOtp("development"), true);
    assert.equal(allowSkipOtp("test"), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "super_admin", email: "admin@lumera.me" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "doctor", email: "doctor@lumera.me" }), false);
  });

  it("password session without OTP is reserved for admin roles", () => {
    assert.equal(allowPasswordLoginWithoutOtp({ role: "super_admin" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "admin" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ email: "admin@lumera.me", role: "doctor" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "CLINIC_ADMIN" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "polyclinic_admin" }), true);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "doctor" }), false);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "receptionist" }), false);
    assert.equal(allowPasswordLoginWithoutOtp({ role: "patient" }), false);
  });

  it("does not echo OTP codes in production", () => {
    assert.equal(allowOtpEcho("production"), false);
    assert.equal(allowOtpEcho("development"), true);
  });

  it("JWT fails closed without JWT_SECRET", () => {
    const prev = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      assert.throws(() => getJwtSecret(), /JWT_SECRET/);
      assert.throws(
        () => signJwtToken({ userId: "u1", tenantId: "t1" }),
        /JWT_SECRET/
      );
      assert.equal(verifyJwtToken("not-a-token"), null);
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev;
    }
  });

  it("signs and verifies JWT when secret is set", () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-secret";
    try {
      const token = signJwtToken({
        userId: "user-doctor",
        tenantId: "tenant-lumera-main",
        email: "doctor@lumera.me",
      });
      const payload = verifyJwtToken(token);
      assert.ok(payload);
      assert.equal(payload.userId, "user-doctor");
      assert.equal(payload.tenantId, "tenant-lumera-main");
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev;
    }
  });

  it("unauthenticated clients cannot list patients or appointments or patch ABHA", async () => {
    const patients = await jsonRequest(port, "GET", "/api/patients");
    assert.equal(patients.status, 401);
    assert.equal(patients.json.error, "Authentication required");
    assert.equal(patients.json.patients, undefined);

    const appointments = await jsonRequest(port, "GET", "/api/appointments");
    assert.equal(appointments.status, 401);
    assert.equal(appointments.json.appointments, undefined);

    const abha = await jsonRequest(port, "PATCH", "/api/patients/pat-1/abha", {
      abhaNumber: "91-0000-0000-0000",
      abhaAddress: "attacker@abha",
    });
    assert.equal(abha.status, 401);

    const linkAbha = await jsonRequest(port, "POST", "/api/patients/link-abha", {
      abhaNumber: "91-0000-0000-0000",
      source: "aadhaar_otp",
      abdmMode: "stub",
    });
    assert.equal(linkAbha.status, 401);

    const prescriptions = await jsonRequest(port, "GET", "/api/prescriptions");
    assert.equal(prescriptions.status, 401);
    assert.equal(prescriptions.json.prescriptions, undefined);
  });

  it("unauthenticated clients cannot call Gemini clinical routes", async () => {
    const copilot = await jsonRequest(port, "POST", "/api/gemini/copilot", {
      query: "dose of paracetamol",
    });
    assert.equal(copilot.status, 401);

    const soap = await jsonRequest(port, "POST", "/api/gemini/generate-soap", {
      transcript: "Patient has fever for two days",
    });
    assert.equal(soap.status, 401);
  });

  it("demo login skipOtp still works outside production and can read demo PHI", async () => {
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: "doctor@lumera.me",
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.requiresOtp, false);
    const token = String(login.json.token || "");
    assert.ok(token);
    const jwtPayload = verifyJwtToken(token);
    assert.ok(jwtPayload);
    assert.equal(jwtPayload.email, "doctor@lumera.me");
    assert.equal(jwtPayload.tenantId, "tenant-lumera-main");

    const patients = await jsonRequest(port, "GET", "/api/patients", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(patients.status, 200);
    assert.ok(Array.isArray(patients.json.patients));

    const gemini = await jsonRequest(
      port,
      "POST",
      "/api/gemini/copilot",
      { query: "hello" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(gemini.status, 200);

    const me = await jsonRequest(port, "GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(me.status, 200);
    assert.equal((me.json.user as { email?: string } | null)?.email, "doctor@lumera.me");
    assert.equal(me.json.token, token);
  });

  it("admin@lumera.me / Lumera@2026 logs in without an OTP step", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email: "admin@lumera.me",
        password: "Lumera@2026",
      });
      assert.equal(login.status, 200);
      assert.equal(login.json.requiresOtp, false);
      assert.ok(login.json.token);
      assert.equal((login.json.user as { role?: string; email?: string } | undefined)?.role, "super_admin");
      assert.equal((login.json.user as { email?: string } | undefined)?.email, "admin@lumera.me");
      assert.equal(login.json.demoOtp, undefined);
      assert.equal(login.json.verificationId, undefined);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("role alias admin completes production password login without OTP", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `alias.admin.${stamp}@um-test.example`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, last_login, created_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, 1, 'polyclinic', ?, ?)`
      )
      .run(
        `user-alias-admin-${stamp}`,
        "tenant-lumera-main",
        email,
        hashPassword("Lumera@2026"),
        "Alias Admin Smoke",
        "+91 97000 00002",
        now,
        now
      );
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email,
        password: "Lumera@2026",
      });
      assert.equal(login.status, 200);
      assert.equal(login.json.requiresOtp, false);
      assert.ok(login.json.token);
      assert.equal(login.json.verificationId, undefined);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("CLINIC_ADMIN password login is not blocked on WhatsApp OTP", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `clinic.admin.${stamp}@um-test.example`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, last_login, created_at)
         VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, 1, 'polyclinic', ?, ?)`
      )
      .run(
        `user-ca-${stamp}`,
        "tenant-lumera-main",
        email,
        hashPassword("Lumera@2026"),
        "Clinic Admin Smoke",
        "+91 97000 00000",
        now,
        now
      );
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email,
        password: "Lumera@2026",
      });
      assert.equal(login.status, 200);
      assert.equal(login.json.requiresOtp, false);
      assert.ok(login.json.token);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("polyclinic_admin password login is not blocked on WhatsApp OTP", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `poly.admin.${stamp}@um-test.example`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, onboarding_completed, practice_type, last_login, created_at)
         VALUES (?, ?, ?, ?, ?, 'polyclinic_admin', 'active', ?, 1, 'polyclinic', ?, ?)`
      )
      .run(
        `user-pa-${stamp}`,
        "tenant-lumera-main",
        email,
        hashPassword("Lumera@2026"),
        "Poly Admin Smoke",
        "+91 97000 00001",
        now,
        now
      );
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email,
        password: "Lumera@2026",
      });
      assert.equal(login.status, 200);
      assert.equal(login.json.requiresOtp, false);
      assert.ok(login.json.token);
      assert.equal(login.json.verificationId, undefined);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("production login ignores skipOtp and does not mint a session", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email: "doctor@lumera.me",
        password: "Lumera@2026",
        skipOtp: true,
      });
      // skipOtp is ignored in production. Without Graph OTP credentials, delivery hard-fails
      // (no fake wamid / no sandbox echo). The important lock is: no token/session.
      assert.equal(login.status, 503);
      assert.equal(login.json.token, undefined);
      assert.equal(login.json.user, undefined);
      assert.equal(login.json.demoOtp, undefined);
      assert.equal(login.json.otpDelivered, false);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("production email+password login for super_admin mints a session without WhatsApp OTP", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email: "admin@lumera.me",
        password: "Lumera@2026",
      });
      assert.equal(login.status, 200, String(login.json.error || "admin prod login"));
      assert.equal(login.json.requiresOtp, false);
      assert.ok(login.json.token);
      assert.equal((login.json.user as { role?: string } | undefined)?.role, "super_admin");
      assert.equal(login.json.otpDelivered, undefined);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("OTP login does not fall back to an arbitrary doctor when lookup fails", async () => {
    const src = fs.readFileSync(path.join(__dirname, "api.ts"), "utf8");
    assert.equal(src.includes("role IN ('doctor', 'CLINIC_ADMIN') LIMIT 1"), false);

    const verificationId = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'login', ?, ?, ?)`
      )
      .run(
        verificationId,
        "+19990000000",
        "nobody-limit1@example.test",
        "654321",
        "{}",
        new Date().toISOString(),
        new Date(Date.now() + 5 * 60 * 1000).toISOString()
      );

    const res = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: "654321",
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.token, undefined);
    assert.match(String(res.json.error || ""), /could not be located/i);
  });
});
