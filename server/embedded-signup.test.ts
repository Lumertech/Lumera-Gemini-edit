import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createMetaRouter } from "./meta.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  completeEmbeddedSignup,
  exchangeEmbeddedSignupCode,
  platformMetaCredentialsOverview,
  subscribeAppToCustomerWaba,
} from "./embedded-signup.ts";
import { clinicActor, getTenantWabaNumber } from "./whatsapp-numbers.ts";
import { buildMetaReadinessOverview } from "./meta-security.ts";
import { decideDataDeletionSignedRequest, signMetaSignedRequest } from "./meta-signed-request.ts";
import { wabaOnboardingCapsOverview } from "./waba-onboarding-caps.ts";

const APP_ID = "111222333444555";
const APP_SECRET = "embedded-signup-unit-secret";
const WABA_ID = "102290129340398";
const PHONE_ID = "106540352242922";
const BUSINESS_TOKEN = "EAAAN6tcBzAUBOwtDtTfmZCJ9n3FHpSDcDTH86ekf89XnnMZAtaitMUysPDE7LES3CXkA4MmbKCghdQeU1boHr0QZA05SShiILcoUy7ZAb2GE7hrUEpYHKLDuP2sYZCURkZCHGEvEGjScGLHzC4KDm8tq2slt4BsOQE1HHX8DzHahdT51MRDqBw0YaeZByrVFZkVAoVTxXUtuKgDDdrmJQXMnI4jqJYetsZCP1efj5ygGscZBm4OvvuCYB039ZAFlyNn";

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

function mockGraphFetch(
  calls: Array<{ url: string; method: string }>,
  opts: { wabaId?: string; phoneId?: string; appId?: string; passthrough?: typeof fetch } = {}
) {
  const rest = opts.passthrough || globalThis.fetch;
  const wabaId = opts.wabaId || WABA_ID;
  const phoneId = opts.phoneId || PHONE_ID;
  const appId = opts.appId || APP_ID;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (!url.includes("graph.facebook.com")) {
      return rest(input as RequestInfo, init);
    }
    calls.push({ url, method });

    if (url.includes("/oauth/access_token")) {
      assert.equal(url.includes("redirect_uri"), false, "Embedded Signup exchange must omit redirect_uri");
      assert.match(url, /graph\.facebook\.com\/v\d+\.\d+\/oauth\/access_token/);
      assert.match(url, /client_id=/);
      assert.match(url, /client_secret=/);
      assert.match(url, /code=/);
      return new Response(JSON.stringify({ access_token: BUSINESS_TOKEN, token_type: "bearer" }), { status: 200 });
    }
    if (url.includes("debug_token")) {
      return new Response(
        JSON.stringify({
          data: {
            app_id: appId,
            is_valid: true,
            expires_at: Math.floor(Date.now() / 1000) + 60 * 24 * 3600,
            scopes: ["whatsapp_business_management", "business_management", "whatsapp_business_messaging"],
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [wabaId] }],
          },
        }),
        { status: 200 }
      );
    }
    if (url.includes(`/${wabaId}/phone_numbers`)) {
      return new Response(JSON.stringify({ data: [{ id: phoneId, display_phone_number: "+15550001234" }] }), {
        status: 200,
      });
    }
    if (url.includes(`/${wabaId}/subscribed_apps`)) {
      assert.equal(method, "POST");
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
      assert.match(auth, /^Bearer /);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes(`/${wabaId}?fields=id,name`) || url.includes(`/${wabaId}?fields=`)) {
      return new Response(JSON.stringify({ id: wabaId, name: "Clinic Embedded WABA" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected graph url ${url}` } }), { status: 500 });
  };
}

describe("Embedded Signup v4 handshake", () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED: process.env.META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    JWT_SECRET: process.env.JWT_SECRET,
  };

  let port = 0;
  let server: Server | undefined;

  before(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-embedded-signup";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "config-es-v4-test";
    process.env.META_GRAPH_API_VERSION = "v21.0";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    bootWhatsAppOwnershipSchema();

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", practitionerLinkMiddleware);
    app.use("/api", createWhatsAppNumbersRouter());
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    }
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function seedClinic(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-es-${label}-${suffix}`;
    const userId = `user-es-${label}-${suffix}`;
    const email = `${label}.${suffix}@es-test.example`.toLowerCase();
    const phone = `+91 98${suffix.replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
    ).run(tenantId, `ES Clinic ${label}`, phone, now, now, now);
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
    ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Admin ${label}`, phone, `ES Clinic ${label}`, now, now);
    return { tenantId, userId, email, phone };
  }

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || `login failed for ${email}`));
    return String(loginRes.json.token || "");
  }

  it("exchanges the Embedded Signup code without redirect_uri and subscribes the app", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const exchanged = await exchangeEmbeddedSignupCode({
      code: "AQB-embedded-signup-code",
      fetchImpl: mockGraphFetch(calls) as typeof fetch,
    });
    assert.equal(exchanged.accessToken, BUSINESS_TOKEN);
    assert.equal(calls.some((c) => c.url.includes("/oauth/access_token") && !c.url.includes("redirect_uri")), true);

    await subscribeAppToCustomerWaba({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      fetchImpl: mockGraphFetch(calls) as typeof fetch,
    });
    assert.equal(calls.some((c) => c.method === "POST" && c.url.includes("/subscribed_apps")), true);
  });

  it("persists the business token on whatsapp_number_secrets via upsertWhatsAppNumber", async () => {
    const clinic = seedClinic("complete");
    const calls: Array<{ url: string; method: string }> = [];
    const wabaId = `10229${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
    const phoneId = `10654${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
    const result = await completeEmbeddedSignup({
      code: "AQB-embedded-signup-code",
      wabaId,
      phoneNumberId: phoneId,
      actor: clinicActor(clinic.tenantId),
      ownerType: "tenant",
      ownerId: clinic.tenantId,
      displayName: "ES Clinic",
      fetchImpl: mockGraphFetch(calls, { wabaId, phoneId }) as typeof fetch,
    });
    assert.equal(result.tokenStorage.table, "whatsapp_number_secrets");
    assert.equal(result.tokenStorage.column, "meta_access_token");
    const row = getTenantWabaNumber(clinic.tenantId);
    assert.ok(row);
    assert.equal(row!.waba_id, wabaId);
    assert.equal(row!.phone_number_id, phoneId);
    assert.equal(row!.connected_via, "embedded_signup");
    const secret = getDb()
      .prepare("SELECT meta_access_token FROM whatsapp_number_secrets WHERE id = ?")
      .get(row!.meta_token_ref) as { meta_access_token: string };
    assert.equal(secret.meta_access_token, BUSINESS_TOKEN);
    assert.equal(calls.some((c) => c.url.includes("/oauth/access_token")), true);
    assert.equal(calls.some((c) => c.url.includes("/subscribed_apps")), true);
  });

  it("rejects a phone_number_id that is not granted on the WABA", async () => {
    const clinic = seedClinic("mismatch");
    await assert.rejects(
      () =>
        completeEmbeddedSignup({
          code: "AQB-embedded-signup-code",
          wabaId: WABA_ID,
          phoneNumberId: "999999999999999",
          actor: clinicActor(clinic.tenantId),
          ownerType: "tenant",
          ownerId: clinic.tenantId,
          fetchImpl: mockGraphFetch([]) as typeof fetch,
        }),
      /phone_number_id is not granted/i
    );
  });

  it("GET /api/meta/embedded-signup-config requires auth and returns appId/configId", async () => {
    const anon = await jsonRequest(port, "GET", "/api/meta/embedded-signup-config");
    assert.equal(anon.status, 401);

    const token = await login("admin@lumera.me");
    const authed = await jsonRequest(port, "GET", "/api/meta/embedded-signup-config", undefined, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(authed.status, 200);
    assert.equal(authed.json.appId, APP_ID);
    assert.equal(authed.json.configId, "config-es-v4-test");
    assert.equal(authed.json.sandbox, true);
    assert.equal(authed.json.simulatorsEnabled, true);
  });

  it("GET /api/admin/meta/platform-credentials is Super Admin only and masks secrets", async () => {
    const anon = await jsonRequest(port, "GET", "/api/admin/meta/platform-credentials");
    assert.equal(anon.status, 401);

    const clinic = seedClinic("platform-creds");
    const clinicToken = await login(clinic.email);
    const clinicRes = await jsonRequest(port, "GET", "/api/admin/meta/platform-credentials", undefined, {
      Authorization: `Bearer ${clinicToken}`,
    });
    assert.equal(clinicRes.status, 403);

    const adminToken = await login("admin@lumera.me");
    const adminRes = await jsonRequest(port, "GET", "/api/admin/meta/platform-credentials", undefined, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.equal(adminRes.status, 200, String(adminRes.json.error || "platform credentials failed"));
    assert.equal(adminRes.json.appId, APP_ID);
    assert.equal(adminRes.json.appSecretConfigured, true);
    assert.match(String(adminRes.json.appSecretPreview || ""), /••••/);
    assert.equal(String(adminRes.json.appSecretPreview || "").includes(APP_SECRET), false);
    assert.match(String(adminRes.json.webhookUrl || ""), /\/api\/meta\/webhook/);
    assert.match(String(adminRes.json.notice || ""), /does not trigger Embedded Signup/);
    assert.match(String(adminRes.json.notice || ""), /META_GRAPH_TOKEN/);
  });

  it("platformMetaCredentialsOverview masks META_GRAPH_TOKEN and reports phone + WABA ids", () => {
    const prev = {
      META_GRAPH_TOKEN: process.env.META_GRAPH_TOKEN,
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
      WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
      META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
      META_WABA_ID: process.env.META_WABA_ID,
    };
    const live = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
    try {
      delete process.env.META_ACCESS_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      process.env.META_GRAPH_TOKEN = live;
      process.env.META_PHONE_NUMBER_ID = "1294483843748285";
      process.env.META_WABA_ID = "1042004418619457";
      const overview = platformMetaCredentialsOverview({ host: "www.mylumera.in", proto: "https" });
      assert.equal(overview.systemTokenConfigured, true);
      assert.equal(overview.graphTokenEnvName, "META_GRAPH_TOKEN");
      assert.equal(overview.phoneNumberId, "1294483843748285");
      assert.equal(overview.wabaId, "1042004418619457");
      assert.equal(String(overview.systemTokenPreview).includes(live), false);
      assert.match(overview.systemTokenPreview, /••••/);
      assert.match(overview.webhookUrl, /https:\/\/www\.mylumera\.in\/api\/meta\/webhook/);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("POST /api/whatsapp-numbers/embedded-signup/complete exchanges, subscribes, and stores the token", async () => {
    const clinic = seedClinic("http-complete");
    const token = await login(clinic.email);
    const calls: Array<{ url: string; method: string }> = [];
    const wabaId = `10229${Date.now().toString().slice(-8)}`;
    const phoneId = `10654${Date.now().toString().slice(-8)}`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockGraphFetch(calls, { wabaId, phoneId, passthrough: originalFetch }) as typeof fetch;
    try {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp-numbers/embedded-signup/complete",
        {
          ownerType: "tenant",
          code: "AQB-embedded-signup-code",
          wabaId,
          phoneNumberId: phoneId,
        },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 200, String(res.json.error || "complete failed"));
      const stored = getTenantWabaNumber(clinic.tenantId);
      assert.equal(stored?.waba_id, wabaId);
      const secret = getDb()
        .prepare("SELECT meta_access_token FROM whatsapp_number_secrets WHERE id = ?")
        .get(stored!.meta_token_ref) as { meta_access_token: string };
      assert.equal(secret.meta_access_token, BUSINESS_TOKEN);
      assert.equal(calls.some((c) => c.url.includes("/oauth/access_token") && !c.url.includes("redirect_uri")), true);
      assert.equal(calls.some((c) => c.method === "POST" && c.url.includes("/subscribed_apps")), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("simulate-embedded-signup still works outside production", async () => {
    const clinic = seedClinic("simulate-ok");
    const token = await login(clinic.email);
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp-numbers/simulate-embedded-signup",
      { ownerType: "tenant", displayName: "Sim Clinic" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 200, String(res.json.error || "simulate failed"));
    assert.equal(res.json.sandbox, true);
    assert.match(String(res.json.message || ""), /SANDBOX \/ DEV-ONLY/);
  });

  it("simulate-embedded-signup is unreachable when isProduction() is true", async () => {
    const clinic = seedClinic("simulate-prod");
    const token = await login(clinic.email);
    const prevNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await jsonRequest(
        port,
        "POST",
        "/api/whatsapp-numbers/simulate-embedded-signup",
        { ownerType: "tenant" },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 403);
      assert.match(String(res.json.error || ""), /disabled in production/i);
    } finally {
      process.env.NODE_ENV = prevNode;
    }
  });
});

describe("Data deletion signed_request", () => {
  it("accepts a valid HMAC-SHA256 signed_request and rejects a tampered one", () => {
    const secret = "deletion-hmac-secret";
    const signed = signMetaSignedRequest({ user_id: "218471", issued_at: 1291836800 }, secret);
    const ok = decideDataDeletionSignedRequest({ signedRequest: signed, appSecret: secret, production: true });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.userId, "218471");

    const tampered = signed.replace(/.$/, signed.endsWith("A") ? "B" : "A");
    const bad = decideDataDeletionSignedRequest({ signedRequest: tampered, appSecret: secret, production: true });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 403);
  });

  it("POST /api/meta/data-deletion verifies signed_request when META_APP_SECRET is set", async () => {
    const prevSecret = process.env.META_APP_SECRET;
    const prevNode = process.env.NODE_ENV;
    process.env.META_APP_SECRET = "deletion-http-secret";
    process.env.NODE_ENV = "test";
    const app = express();
    app.use(express.json());
    app.use("/api", createWhatsAppNumbersRouter());
    app.use("/api/meta", createMetaRouter());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as { port: number };
    try {
      const signed = signMetaSignedRequest({ user_id: "meta-user-42" }, "deletion-http-secret");
      const good = await jsonRequest(port, "POST", "/api/meta/data-deletion", { signed_request: signed });
      assert.equal(good.status, 200);
      assert.match(String(good.json.confirmation_code || ""), /^DEL-/);

      const bad = await jsonRequest(port, "POST", "/api/meta/data-deletion", {
        signed_request: signed.slice(0, -2) + "xx",
      });
      assert.equal(bad.status, 403);

      const missing = await jsonRequest(port, "POST", "/api/meta/data-deletion", { user_id: "no-sig" });
      assert.equal(missing.status, 403);
    } finally {
      process.env.META_APP_SECRET = prevSecret;
      process.env.NODE_ENV = prevNode;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("Embedded Signup checklist + onboarding caps", () => {
  it("adds config_id and App Review checklist items, SANDBOX-honest by default", () => {
    const prevConfig = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    const prevReview = process.env.META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED;
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    delete process.env.META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED;
    const overview = buildMetaReadinessOverview({
      connectedWabasCount: 0,
      totalClinics: 1,
      approvedTemplatesCount: 0,
      totalTemplatesCount: 0,
      totalMessagesSentAndReceived: 0,
      webhookUrl: "/api/meta/webhook",
      graphOtpConfigured: false,
      webhookSecretConfigured: false,
      verifyTokenConfigured: false,
      facebookOAuthConfigured: false,
    });
    const configItem = overview.appReviewStatus.checklist.find((c) => c.item === "Embedded Signup config_id configured");
    const reviewItem = overview.appReviewStatus.checklist.find((c) =>
      c.item.includes("whatsapp_business_management / business_management / whatsapp_business_messaging")
    );
    assert.ok(configItem);
    assert.equal(configItem!.passed, false);
    assert.ok(reviewItem);
    assert.equal(reviewItem!.passed, false);
    assert.equal(overview.appReviewStatus.status, "NOT_SUBMITTED");
    if (prevConfig === undefined) delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    else process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = prevConfig;
    if (prevReview === undefined) delete process.env.META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED;
    else process.env.META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED = prevReview;
  });

  it("counts rolling 7-day Embedded Signup onboardings against the unverified cap of 10", () => {
    const caps = wabaOnboardingCapsOverview();
    assert.equal(caps.windowDays, 7);
    assert.equal(caps.cap, 10);
    assert.equal(caps.businessVerifiedFlag, false);
    assert.match(caps.notice, /not Meta-business-verified/i);
  });
});
