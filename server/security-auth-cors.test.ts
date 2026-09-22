import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  AUTH_RATE_LIMITED_PATHS,
  canonicalHostRedirectMiddleware,
  attachHttpSecurity,
  corsAllowlistMiddleware,
  corsShouldReject,
  createAuthRateLimiter,
  csrfProtectionMiddleware,
  csrfShouldReject,
  isMissingOrNullOrigin,
  originAllowed,
  parseAllowedOrigins,
  resetAuthRateLimitStore,
  withWwwApexCompanions,
} from "./http-security.ts";
import { isBackendPath } from "./spa-fallback.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
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
    app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter()));
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
    const convId = String((sent.json.sentMessage as { sentMessage?: { conversationId?: string } } | undefined)?.sentMessage?.conversationId || (sent.json.sentMessage as { conversationId?: string } | undefined)?.conversationId || "");
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
    const passwordSrc = fs.readFileSync(path.join(__dirname, "password.ts"), "utf8");
    const liveSrc = fs.readFileSync(path.join(__dirname, "live-registration-password.ts"), "utf8");
    const apiUsesHelper = apiSrc.includes("liveRegistrationPasswordHash(");
    const apiCleared =
      !apiSrc.includes('hashPassword("Lumera@2026")') && !apiSrc.includes("hashPassword('Lumera@2026')");
    const passwordRewritesFallback = passwordSrc.includes("rewriteLiveRegistrationFallback");
    assert.equal(apiUsesHelper || apiCleared || passwordRewritesFallback, true);
    assert.equal(apiSrc.includes("hashPassword('Lumera@2026')"), false);
    assert.match(apiSrc, /generateTemporaryPassword\(\)/);
    assert.match(liveSrc, /function liveRegistrationPasswordHash/);
    assert.equal(PATIENTS_PHONE_UNIQUE, "UNIQUE(tenant_id, phone)");
  });

  it("requests from a disallowed origin are rejected", async () => {
    const res = await jsonRequest(port, "GET", "/api/whatsapp/conversations", undefined, {
      Origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.match(String(res.json.error || ""), /origin/i);
    const wabas = await jsonRequest(port, "GET", "/api/meta/wabas", undefined, {
      Origin: "https://evil.example",
    });
    assert.equal(wabas.status, 403);
    assert.match(String(wabas.json.error || ""), /origin/i);
    const overview = await jsonRequest(port, "GET", "/api/meta/overview", undefined, {
      Origin: "https://evil.example",
    });
    assert.equal(overview.status, 403);
    assert.match(String(overview.json.error || ""), /origin/i);

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

  it("production CORS allows SPA GETs without Origin or Origin null; rejects bad/missing Origin on API", () => {
    const prod = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://www.mylumera.in" } as NodeJS.ProcessEnv;
    assert.deepEqual(parseAllowedOrigins(prod).sort(), ["https://mylumera.in", "https://www.mylumera.in"].sort());
    assert.equal(originAllowed("https://www.mylumera.in", prod), true);
    assert.equal(originAllowed("https://mylumera.in", prod), true);
    assert.equal(originAllowed("https://evil.example", prod), false);
    assert.equal(originAllowed("http://localhost:3000", prod), false);
    assert.equal(isMissingOrNullOrigin(undefined), true);
    assert.equal(isMissingOrNullOrigin(""), true);
    assert.equal(isMissingOrNullOrigin("null"), true);
    assert.equal(isMissingOrNullOrigin(" NULL "), true);
    assert.equal(isMissingOrNullOrigin("https://www.mylumera.in"), false);

    const fakeReq = (origin: string | undefined, p = "/api/patients", method = "GET") =>
      ({ headers: origin !== undefined ? { origin } : {}, path: p, originalUrl: p, method }) as unknown as express.Request;

    assert.equal(corsShouldReject(fakeReq("https://evil.example"), prod), true);
    assert.equal(corsShouldReject(fakeReq("https://evil.example", "/login"), prod), true);
    // Missing Origin on API / mutating stays fail-closed in production.
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/patients"), prod), true);
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/auth/login", "POST"), prod), true);
    assert.equal(corsShouldReject(fakeReq(undefined, "/login", "POST"), prod), true);
    // Literal Origin: null on mutating / API stays fail-closed in production.
    assert.equal(corsShouldReject(fakeReq("null", "/api/auth/login", "POST"), prod), true);
    assert.equal(corsShouldReject(fakeReq("NULL", "/api/patients", "PUT"), prod), true);
    assert.equal(corsShouldReject(fakeReq(" null ", "/login", "DELETE"), prod), true);
    assert.equal(corsShouldReject(fakeReq("null", "/api/patients"), prod), true);
    // All SPA/HTML document GETs (not login-only): omit Origin or Origin: null — must not 403.
    // /w/* clinic deep links are SPA shells; isBackendPath must not classify them as API.
    assert.equal(isBackendPath("/w/lumera-apex-polyclinic/whatsapp"), false);
    assert.equal(isBackendPath("/w/dr-demo-physio/whatsapp"), false);
    assert.equal(isBackendPath("/app"), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/login"), prod), false);
    assert.equal(corsShouldReject(fakeReq("null", "/login"), prod), false);
    assert.equal(corsShouldReject(fakeReq("NULL", "/login", "HEAD"), prod), false);
    assert.equal(corsShouldReject(fakeReq(" null ", "/app"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/app"), prod), false);
    assert.equal(corsShouldReject(fakeReq("null", "/app", "HEAD"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/admin/tenants"), prod), false);
    assert.equal(
      corsShouldReject(fakeReq("null", "/w/lumera-apex-polyclinic/whatsapp"), prod),
      false
    );
    assert.equal(
      corsShouldReject(fakeReq("NULL", "/w/lumera-apex-polyclinic/whatsapp", "HEAD"), prod),
      false
    );
    assert.equal(corsShouldReject(fakeReq("null", "/w/dr-demo-physio/whatsapp"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/w/lumera-apex-polyclinic/whatsapp"), prod), false);
    // Allowlisted Origins (www + apex companion) still pass.
    assert.equal(corsShouldReject(fakeReq("https://www.mylumera.in"), prod), false);
    assert.equal(corsShouldReject(fakeReq("https://mylumera.in", "/api/auth/login", "POST"), prod), false);
    // Webhooks remain exempt even with Origin: null.
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/meta/webhook"), prod), false);
    assert.equal(corsShouldReject(fakeReq("null", "/api/meta/webhook", "POST"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/meta/deauthorize"), prod), false);
    assert.equal(corsShouldReject(fakeReq(undefined, "/api/billing/razorpay/webhook"), prod), false);
  });

  it("APP_URL-only production allowlist expands www↔apex companions", () => {
    const prod = { NODE_ENV: "production", APP_URL: "https://www.mylumera.in" } as NodeJS.ProcessEnv;
    assert.equal(originAllowed("https://www.mylumera.in", prod), true);
    assert.equal(originAllowed("https://mylumera.in", prod), true);
    assert.deepEqual(withWwwApexCompanions(["https://www.mylumera.in"]).sort(), [
      "https://mylumera.in",
      "https://www.mylumera.in",
    ].sort());
    assert.deepEqual(withWwwApexCompanions(["http://localhost:3000"]), ["http://localhost:3000"]);
  });

  it("canonical host middleware 301s apex document GETs to www", async () => {
    const prod = {
      NODE_ENV: "production",
      APP_URL: "https://www.mylumera.in",
      ALLOWED_ORIGINS: "https://www.mylumera.in",
    } as NodeJS.ProcessEnv;
    const app = express();
    app.use(canonicalHostRedirectMiddleware(prod));
    app.use(corsAllowlistMiddleware(prod));
    app.get("/login", (_req, res) => res.type("html").send("<!doctype html><title>login</title>"));
    app.get("/w/:slug/whatsapp", (_req, res) => res.type("html").send("<!doctype html><title>whatsapp</title>"));
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => srv.once("listening", () => resolve()));
    const addr = srv.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const p = addr.port;

    const noOrigin = await fetch(`http://127.0.0.1:${p}/login`, { redirect: "manual" });
    assert.equal(noOrigin.status, 200);
    assert.match(await noOrigin.text(), /login/i);

    const nullOrigin = await fetch(`http://127.0.0.1:${p}/login`, {
      headers: { Origin: "null" },
      redirect: "manual",
    });
    assert.equal(nullOrigin.status, 200);
    assert.match(await nullOrigin.text(), /login/i);

    const clinicNullOrigin = await fetch(`http://127.0.0.1:${p}/w/lumera-apex-polyclinic/whatsapp`, {
      headers: { Origin: "null" },
      redirect: "manual",
    });
    assert.equal(clinicNullOrigin.status, 200);
    assert.match(await clinicNullOrigin.text(), /whatsapp/i);

    const wwwOrigin = await fetch(`http://127.0.0.1:${p}/login`, {
      headers: { Origin: "https://www.mylumera.in" },
      redirect: "manual",
    });
    assert.equal(wwwOrigin.status, 200);

    const apexOriginApi = await fetch(`http://127.0.0.1:${p}/api/ping`, {
      headers: { Origin: "https://mylumera.in" },
      redirect: "manual",
    });
    assert.equal(apexOriginApi.status, 200);

    const evil = await fetch(`http://127.0.0.1:${p}/login`, {
      headers: { Origin: "https://evil.com" },
      redirect: "manual",
    });
    assert.equal(evil.status, 403);
    assert.match(await evil.text(), /Origin not allowed/);

    const nullOriginPost = await fetch(`http://127.0.0.1:${p}/api/ping`, {
      method: "POST",
      headers: { Origin: "null", "Content-Type": "application/json" },
      body: "{}",
      redirect: "manual",
    });
    assert.equal(nullOriginPost.status, 403);
    assert.match(await nullOriginPost.text(), /Origin not allowed/);

    const apexHost = await fetch(`http://127.0.0.1:${p}/login?x=1`, {
      headers: { Host: "mylumera.in", "X-Forwarded-Host": "mylumera.in" },
      redirect: "manual",
    });
    assert.equal(apexHost.status, 301);
    assert.equal(apexHost.headers.get("location"), "https://www.mylumera.in/login?x=1");

    // API on apex host is not redirected (CORS allowlist covers apex Origin).
    const apexApiHost = await fetch(`http://127.0.0.1:${p}/api/ping`, {
      headers: { Host: "mylumera.in", "X-Forwarded-Host": "mylumera.in", Origin: "https://mylumera.in" },
      redirect: "manual",
    });
    assert.equal(apexApiHost.status, 200);

    await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
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

    const deauthorizeReq = {
      method: "POST",
      path: "/api/meta/deauthorize",
      originalUrl: "/api/meta/deauthorize",
      headers: { cookie: "lumera_sid=abc.def" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(deauthorizeReq), false);
  });

  it("CSP is on SPA HTML and Origin: null document GETs stay open", async () => {
    const prod = {
      NODE_ENV: "production",
      APP_URL: "https://www.mylumera.in",
      ALLOWED_ORIGINS: "https://www.mylumera.in",
    } as NodeJS.ProcessEnv;
    const app = express();
    attachHttpSecurity(app, prod);
    app.get("/login", (_req, res) => res.type("html").send("<!doctype html><title>login</title>"));
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => srv.once("listening", () => resolve()));
    const addr = srv.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const origin = `http://127.0.0.1:${addr.port}`;
    try {
      const login = await fetch(`${origin}/login`, { headers: { Origin: "null" } });
      assert.equal(login.status, 200);
      const csp = login.headers.get("content-security-policy") || "";
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /https:\/\/connect\.facebook\.net/);
      assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
      assert.equal(login.headers.get("x-content-type-options"), "nosniff");
      assert.equal(login.headers.get("x-frame-options"), "DENY");
      assert.match(login.headers.get("permissions-policy") || "", /microphone=\(self\)/);
      assert.equal(login.headers.get("x-powered-by"), null);
      const missingOrigin = await fetch(`${origin}/login`);
      assert.equal(missingOrigin.status, 200);
      assert.match(missingOrigin.headers.get("content-security-policy") || "", /default-src 'self'/);

      const api = await fetch(`${origin}/api/ping`, { headers: { Origin: "https://www.mylumera.in" } });
      assert.equal(api.status, 200);
      assert.equal(api.headers.get("content-security-policy"), null);

      const apiNull = await fetch(`${origin}/api/ping`, { headers: { Origin: "null" } });
      assert.equal(apiNull.status, 403);
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
