import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  allowOtpEcho,
  allowSkipOtp,
  attachUser,
  getJwtSecret,
  requireAuth,
  signJwtToken,
  verifyJwtToken,
} from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";

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

  it("production login ignores skipOtp and omits demoOtp", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email: "doctor@lumera.me",
        password: "Lumera@2026",
        skipOtp: true,
      });
      assert.equal(login.status, 200);
      assert.equal(login.json.requiresOtp, true);
      assert.equal(login.json.token, undefined);
      assert.equal(login.json.demoOtp, undefined);
      assert.ok(login.json.verificationId);
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
