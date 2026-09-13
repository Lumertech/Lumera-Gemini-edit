import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  AUTH_RATE_LIMITED_PATHS,
  corsAllowlistMiddleware,
  corsShouldReject,
  createAuthRateLimiter,
  csrfProtectionMiddleware,
  csrfShouldReject,
  originAllowed,
  parseAllowedOrigins,
  resetAuthRateLimitStore,
} from "./http-security.ts";
import { installWhatsAppRouterPatch } from "./whatsapp-dashboard-guard.ts";
import { PATIENTS_PHONE_UNIQUE } from "../src/db/patients-tenant-phone.unique.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown>; raw?: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { raw };
  }
  return { status: res.status, json, raw };
}

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@sec-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, `+91 91000 ${label.slice(0, 5).padEnd(5, "0")}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

const DASHBOARD_GETS = [
  "/api/whatsapp/conversations",
  "/api/whatsapp/conversations/conv-rajiv",
  "/api/whatsapp/messages",
  "/api/whatsapp/messages/conv-rajiv",
  "/api/whatsapp/outbound/events",
  "/api/whatsapp/outbound-events",
];

const DASHBOARD_POSTS = [
  "/api/whatsapp/conversations/conv-rajiv/handover",
  "/api/whatsapp/conversations/conv-rajiv/assign",
  "/api/whatsapp/conversations/conv-rajiv/tags",
  "/api/whatsapp/send",
  "/api/whatsapp/emr-action",
  "/api/whatsapp/voice-process",
  "/api/whatsapp/translate",
  "/api/whatsapp/send-rx",
  "/api/whatsapp/outbound/trigger",
  "/api/whatsapp/outbound-trigger",
  "/api/whatsapp/reminders/run",
];

describe("Auth / tenant isolation / CORS / CSRF / rate limit", () => {
  let port = 0;
  let server: Server | undefined;
  const rateStore = new Map();

  before(async () => {
    installWhatsAppRouterPatch();
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-auth-cors";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(corsAllowlistMiddleware({ ALLOWED_ORIGINS: "https://www.mylumera.in,http://127.0.0.1" } as NodeJS.ProcessEnv));
    app.use(csrfProtectionMiddleware());
    app.use(createAuthRateLimiter({ windowMs: 60_000, max: 5, store: rateStore }));
    app.use(express.json());
    app.use(attachUser);
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

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("unauthenticated requests to dashboard WhatsApp routes return 401", async () => {
    for (const pathName of DASHBOARD_GETS) {
      const res = await jsonRequest(port, "GET", pathName);
      assert.equal(res.status, 401, pathName);
      assert.equal(res.json.error, "Authentication required");
    }
    for (const pathName of DASHBOARD_POSTS) {
      const res = await jsonRequest(port, "POST", pathName, { mode: "bot", tags: [], eventType: "queue_token_update" });
      assert.equal(res.status, 401, pathName);
      assert.equal(res.json.error, "Authentication required");
    }
  });

  it("tenant A cannot read tenant B's WhatsApp conversations or messages", async () => {
    const a = createClinic("isoA");
    const b = createClinic("isoB");
    const tokenA = await login(a.email);
    const tokenB = await login(b.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const phone = `+91 9911${String(Date.now()).slice(-6)}`;

    const sent = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send",
      {
        conversationId: `conv-${a.tenantId.slice(-8)}`,
        patientPhone: phone,
        patientName: "Tenant A Patient",
        sender: "agent",
        content: "Hello from clinic A only",
      },
      authA
    );
    assert.equal(sent.status, 201, String(sent.json.error || ""));
    const convId = String((sent.json.sentMessage as { conversationId?: string } | undefined)?.conversationId || "");
    assert.ok(convId);

    const listB = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, authB);
    assert.equal(listB.status, 200);
    const idsB = ((listB.json.conversations as Array<{ id: string }>) || []).map((c) => c.id);
    assert.equal(idsB.includes(convId), false);

    const stolen = await jsonRequest(port, "GET", `/api/whatsapp/conversations/${convId}`, undefined, authB);
    assert.equal(stolen.status, 404);

    const msgs = await jsonRequest(
      port,
      "GET",
      `/api/whatsapp/messages/${encodeURIComponent(convId)}`,
      undefined,
      authB
    );
    assert.equal(msgs.status, 404);

    const listA = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, authA);
    const idsA = ((listA.json.conversations as Array<{ id: string }>) || []).map((c) => c.id);
    assert.equal(idsA.includes(convId), true);
  });

  it("two tenants can register patients sharing a phone number", async () => {
    const a = createClinic("phoneA");
    const b = createClinic("phoneB");
    const tokenA = await login(a.email);
    const tokenB = await login(b.email);
    const sharedPhone = `+91 9888${String(Date.now()).slice(-6)}`;
    const body = { name: "Shared Mobile Patient", phone: sharedPhone, age: 40, gender: "Female" };

    const createdA = await jsonRequest(port, "POST", "/api/patients", body, { Authorization: `Bearer ${tokenA}` });
    const createdB = await jsonRequest(port, "POST", "/api/patients", body, { Authorization: `Bearer ${tokenB}` });
    assert.equal(createdA.status, 201, String(createdA.json.error || "tenant A patient"));
    assert.equal(createdB.status, 201, String(createdB.json.error || "tenant B patient"));
    const idA = String((createdA.json.patient as { id?: string } | undefined)?.id || "");
    const idB = String((createdB.json.patient as { id?: string } | undefined)?.id || "");
    assert.ok(idA && idB);
    assert.notEqual(idA, idB);

    const indexes = getDb().prepare("PRAGMA index_list(patients)").all() as Array<{ name: string; unique: number }>;
    const uniqueNames = indexes.filter((i) => i.unique).map((i) => i.name);
    assert.ok(uniqueNames.includes("idx_patients_tenant_phone"));
    for (const name of uniqueNames) {
      const info = getDb().prepare(`PRAGMA index_info("${name.replace(/"/g, "\"\"")}")`).all() as Array<{ name: string }>;
      const cols = info.map((c) => c.name);
      assert.equal(cols.length === 1 && cols[0] === "phone", false, `legacy UNIQUE(phone) still present on ${name}`);
    }
  });

  it("live registration handlers do not hardcode Lumera@2026", () => {
    const apiSrc = fs.readFileSync(path.join(__dirname, "api.ts"), "utf8");
    assert.equal(apiSrc.includes('hashPassword("Lumera@2026")'), false);
    assert.equal(apiSrc.includes("hashPassword('Lumera@2026')"), false);
    assert.match(apiSrc, /generateTemporaryPassword\(\)/);
    assert.equal(PATIENTS_PHONE_UNIQUE, "UNIQUE(tenant_id, phone)");
  });

  it("requests from a disallowed origin are rejected", async () => {
    const res = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, {
      Origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.match(String(res.json.error || ""), /origin/i);

    const webhook = await jsonRequest(port, "POST", "/api/billing/razorpay/webhook", { event: "ping" }, {
      Origin: "https://evil.example",
    });
    assert.notEqual(String(webhook.json.error || ""), "Origin not allowed");
  });

  it("repeated failed OTP/login attempts are rate-limited", async () => {
    resetAuthRateLimitStore(rateStore);
    let limited = 0;
    for (let i = 0; i < 8; i += 1) {
      const res = await jsonRequest(port, "POST", "/api/auth/login", {
        email: `brute.${i}@sec-test.example`,
        password: "wrong-password-!!",
      });
      if (res.status === 429) limited += 1;
    }
    assert.ok(limited >= 1);
    const otp = await jsonRequest(port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: "+91 90000 00000",
      purpose: "login",
    });
    resetAuthRateLimitStore(rateStore);
    let otpLimited = 0;
    for (let i = 0; i < 8; i += 1) {
      const res = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
        verificationId: "missing",
        otp: "000000",
      });
      if (res.status === 429) otpLimited += 1;
    }
    assert.ok(otpLimited >= 1);
    assert.ok(AUTH_RATE_LIMITED_PATHS.includes("/api/auth/forgot-password"));
    assert.ok(AUTH_RATE_LIMITED_PATHS.includes("/api/auth/reset-password"));
    void otp;
  });

  it("production CORS is fail-closed for missing and unknown origins", () => {
    const prod = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://www.mylumera.in" } as NodeJS.ProcessEnv;
    assert.deepEqual(parseAllowedOrigins(prod), ["https://www.mylumera.in"]);
    assert.equal(originAllowed("https://www.mylumera.in", prod), true);
    assert.equal(originAllowed("https://evil.example", prod), false);
    const fakeReq = (origin?: string, p = "/api/patients") =>
      ({ headers: origin ? { origin } : {}, path: p, originalUrl: p, method: "GET" }) as unknown as express.Request;
    assert.equal(corsShouldReject(fakeReq("https://evil.example"), prod), true);
    assert.equal(corsShouldReject(fakeReq(undefined), prod), true);
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/meta/webhook"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/billing/razorpay/webhook"), prod), false);
    assert.equal(corsShouldReject(fakeReq("https://www.mylumera.in"), prod), false);
  });

  it("cookie-authenticated mutating requests require a matching X-CSRF-Token header", () => {
    const rejectReq = {
      method: "POST",
      path: "/api/patients",
      originalUrl: "/api/patients",
      headers: { cookie: "lumera_sid=abc.def" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(rejectReq), true);

    const okReq = {
      method: "POST",
      path: "/api/patients",
      originalUrl: "/api/patients",
      headers: {
        cookie: "lumera_sid=abc.def; lumera_csrf=token-1",
        "x-csrf-token": "token-1",
      },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(okReq), false);

    const bearerReq = {
      method: "POST",
      path: "/api/patients",
      originalUrl: "/api/patients",
      headers: {
        cookie: "lumera_sid=abc.def",
        authorization: "Bearer jwt-here",
      },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(bearerReq), false);

    const webhookReq = {
      method: "POST",
      path: "/api/billing/razorpay/webhook",
      originalUrl: "/api/billing/razorpay/webhook",
      headers: { cookie: "lumera_sid=abc.def" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(webhookReq), false);
  });
});
