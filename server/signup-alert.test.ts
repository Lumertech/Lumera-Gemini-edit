import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { createLiveRegistrationRouter } from "./live-registration-routes.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import {
  DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME,
  DEFAULT_SIGNUP_ALERT_WHATSAPP_TO,
  maybeEnsureFounderSignupAlertTemplate,
  notifyFounderNewUserSignup,
  resetSignupAlertStateForTests,
  retryFailedSignupAlertWithTemplate,
  sanitizeTemplateParam,
  setSignupAlertTestTransport,
} from "./signup-alert.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";

const SYNTH_GRAPH_TOKEN = "EAABsbCS1iHgBO7ZC9xLmN3qV5pRwK8uYzA1bCdEfGhIjKlMnOpQrStUvWxYz";

describe("founder WhatsApp new user signup alert (+919999973271)", () => {
  let server: TestHttpServer;
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "META_ACCESS_TOKEN",
    "META_PHONE_NUMBER_ID",
    "META_SIGNUP_ALERT_TEMPLATE_NAME",
    "META_SIGNUP_ALERT_TEMPLATE_LANGUAGE",
    "META_REMINDER_TEMPLATE_NAME",
    "META_UTILITY_TEMPLATE_LANGUAGE",
    "SIGNUP_ALERT_WHATSAPP_TO",
    "SIGNUP_ALERT_DISABLED",
    "SIGNUP_ALERT_ENABLED",
    "SIGNUP_ALERT_FORCE_TEMPLATE",
  ];

  before(async () => {
    for (const k of envKeys) savedEnv[k] = process.env[k];
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-signup-alert";
    initDatabase();
    resetSendOtpRateLimits();
    server = await startTestServer((app) => {
      app.use("/api", createLiveRegistrationRouter());
      app.use("/api", createApiRouter());
    });
  });

  afterEach(() => {
    resetSignupAlertStateForTests();
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  after(async () => {
    await server.close();
  });

  it("skips automated test runtime by default so CI suites never spam +919999973271", async () => {
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    const result = await notifyFounderNewUserSignup({
      userId: "user-ci-guard",
      name: "Dr. CI Guard",
      email: "ci.guard@realclinic.in",
      phone: "+91 98111 22334",
      clinicName: "CI Clinic",
      role: "doctor",
      specialty: "gp",
      source: "Practice Registration",
    });
    assert.equal(result.ok, true);
    assert.equal(result.delivered, false);
    if (!result.delivered && result.ok) {
      assert.equal(result.skipped, "test_runtime");
    }
  });

  it("skips demo and test-fixture accounts (@lumera.me, .example, tenant-demo-*)", async () => {
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    const calls: unknown[] = [];
    const mockFetch: typeof fetch = async () => {
      calls.push(true);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.never" }] }), { status: 200 });
    };

    for (const sample of [
      { email: "doctor@lumera.me", tenantId: "tenant-lumera-main" },
      { email: "qa@signup.example", tenantId: "tenant-abc123" },
      { email: "real@clinic.in", tenantId: "tenant-demo-gynecology" },
    ]) {
      const res = await notifyFounderNewUserSignup(
        {
          name: "Seed User",
          email: sample.email,
          tenantId: sample.tenantId,
          source: "Seed",
        },
        { fetchImpl: mockFetch }
      );
      assert.equal(res.delivered, false);
      if (res.ok && !res.delivered) {
        assert.equal(res.skipped, "seed_or_fixture");
      }
    }
    assert.equal(calls.length, 0);
  });

  it("uses dedicated template outside 24h window and automatically falls back to approved utility template if pending", async () => {
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    process.env.META_SIGNUP_ALERT_TEMPLATE_NAME = DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME;
    process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
    delete process.env.SIGNUP_ALERT_WHATSAPP_TO; // must default to +919999973271

    const sentPayloads: Array<Record<string, unknown>> = [];
    const mockFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      sentPayloads.push(body);
      const tpl = body.template as { name?: string } | undefined;
      if (tpl?.name === DEFAULT_SIGNUP_ALERT_TEMPLATE_NAME) {
        return new Response(
          JSON.stringify({ error: { message: "(#132001) Template name does not exist in the translation" } }),
          { status: 404 }
        );
      }
      return new Response(JSON.stringify({ messages: [{ id: "wamid.fallback.ok.1" }] }), { status: 200 });
    };

    const uid = `user-fb-${Date.now()}`;
    const email = `dr.kavita.${Date.now()}@sharmaclinic.in`;
    const result = await notifyFounderNewUserSignup(
      {
        userId: uid,
        tenantId: "tenant-sharma-01",
        name: "Dr. Kavita\nSharma",
        email,
        phone: "+91 98201 44556",
        clinicName: "Sharma Women's\tHospital",
        role: "doctor",
        specialty: "gynecology",
        source: "Practice Registration",
      },
      { fetchImpl: mockFetch, db: getDb() }
    );

    assert.equal(result.ok, true);
    assert.equal(result.delivered, true);
    if (result.ok && result.delivered) {
      assert.equal(result.recipient, "919999973271");
      assert.equal(result.mode, "utility_fallback_template");
      assert.equal(result.messageId, "wamid.fallback.ok.1");
    }

    assert.equal(sentPayloads.length, 2);
    assert.equal(sentPayloads[0].to, "919999973271");
    assert.equal((sentPayloads[0].template as { name: string }).name, "lumera_new_signup_alert");
    assert.equal(sentPayloads[1].to, "919999973271");
    assert.equal((sentPayloads[1].template as { name: string }).name, "lumera_appointment_reminder");

    // Verify zero newlines/tabs inside template parameters (Meta #132018 guard)
    const components = (sentPayloads[1].template as { components: Array<{ parameters: Array<{ text: string }> }> })
      .components;
    const paramTexts = components[0].parameters.map((p) => p.text);
    assert.equal(paramTexts.length, 5);
    for (const p of paramTexts) {
      assert.doesNotMatch(p, /[\r\n\t]/);
      assert.ok(p.length > 0);
    }
    assert.match(paramTexts[0], /Dr\. Kavita Sharma/);
    assert.match(paramTexts[2], new RegExp(email.replace(/\./g, "\\.")));

    // Verify deduplication: second call for same user/email must skip
    const dup = await notifyFounderNewUserSignup(
      {
        userId: uid,
        tenantId: "tenant-sharma-01",
        name: "Dr. Kavita Sharma",
        email,
        phone: "+91 98201 44556",
        clinicName: "Sharma Women's Hospital",
        role: "doctor",
        specialty: "gynecology",
        source: "WhatsApp Verified Signup",
      },
      { fetchImpl: mockFetch, db: getDb() }
    );
    assert.equal(dup.ok, true);
    assert.equal(dup.delivered, false);
    if (dup.ok && !dup.delivered) {
      assert.equal(dup.skipped, "duplicate");
    }
    assert.equal(sentPayloads.length, 2, "Duplicate signup for same user must not send a second WhatsApp alert");
  });

  it("fires non-blocking alert to +919999973271 on live POST /api/auth/register-practice without leaking password or OTP", async () => {
    resetSendOtpRateLimits();
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    process.env.META_OTP_TEMPLATE_NAME = "lumera_login_otp";
    process.env.META_SIGNUP_ALERT_TEMPLATE_NAME = "lumera_new_signup_alert";

    const graphRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
    setSignupAlertTestTransport({
      fetchImpl: async (input, init) => {
        graphRequests.push({
          url: String(input),
          body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.signup.${graphRequests.length}` }] }), {
          status: 200,
        });
      },
    });

    // Stub global fetch ONLY for the registration OTP Graph call so register-practice succeeds with META_ACCESS_TOKEN set
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.otp.1" }] }), { status: 200 });
      }
      return origFetch(input, init);
    }) as typeof fetch;

    try {
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const phone = `+9178${String(Date.now()).slice(-8)}`;
      const email = `dr.anita.${stamp}@lotuscare.in`;
      const secretPwd = "Sup3rS3cret!Pass9";

      const created = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
        clinicName: "Lotus Gynae & Fertility Centre",
        specialty: "Gynecology",
        phone,
        name: "Dr. Anita Deshmukh",
        email,
        password: secretPwd,
      });

      assert.equal(created.status, 200, String(created.json.error || created.status));

      // Allow async fire-and-forget microtask to settle
      for (let i = 0; i < 20 && graphRequests.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 15));
      }

      assert.equal(graphRequests.length, 1);
      const alertPayload = graphRequests[0].body;
      const serialized = JSON.stringify(alertPayload);
      assert.equal(alertPayload.to, toDigits(DEFAULT_SIGNUP_ALERT_WHATSAPP_TO));
      assert.match(serialized, /Dr\. Anita Deshmukh/);
      assert.match(serialized, new RegExp(email.replace(/\./g, "\\.")));
      assert.match(serialized, /Lotus Gynae/);
      assert.equal(serialized.includes(secretPwd), false, "Password must never appear in WhatsApp alert");
      if (created.json.devOtp) {
        assert.equal(serialized.includes(String(created.json.devOtp)), false, "OTP must never appear in founder alert");
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("retries with approved template if an in-window text alert fails asynchronously via webhook", async () => {
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    process.env.META_SIGNUP_ALERT_TEMPLATE_NAME = "lumera_new_signup_alert";

    // Simulate active 24h inbound window from +919999973271 on tenant-lumera-main
    const nowIso = new Date().toISOString();
    const existingConv = getDb()
      .prepare(
        "SELECT id, last_inbound_at FROM whatsapp_conversations WHERE tenant_id = 'tenant-lumera-main' AND patient_phone = '+919999973271'"
      )
      .get() as { id?: string; last_inbound_at?: string | null } | undefined;
    const createdConvId = existingConv?.id ? "" : `conv-founder-${Date.now()}`;
    if (existingConv?.id) {
      getDb()
        .prepare("UPDATE whatsapp_conversations SET last_inbound_at = ?, updated_at = ? WHERE id = ?")
        .run(nowIso, nowIso, existingConv.id);
    } else {
      getDb()
        .prepare(
          `INSERT INTO whatsapp_conversations
            (id, tenant_id, patient_phone, patient_name, last_message, last_message_time, last_inbound_at, unread_count, updated_at)
           VALUES (?, 'tenant-lumera-main', '+919999973271', 'Founder', 'Hi', '10:00 AM', ?, 0, ?)`
        )
        .run(createdConvId, nowIso, nowIso);
    }

    const calls: Array<Record<string, unknown>> = [];
    const mockFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push(body);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.msg.${calls.length}` }] }), { status: 200 });
    };

    try {
      const first = await notifyFounderNewUserSignup(
        {
          userId: `user-win-${Date.now()}`,
          tenantId: "tenant-win-01",
          name: "Dr. Rohan Kulkarni",
          email: `rohan.${Date.now()}@kulkarniclinic.in`,
          phone: "+91 98220 11223",
          clinicName: "Kulkarni Ortho Clinic",
          role: "doctor",
          specialty: "orthopedics",
          source: "Practice Registration",
        },
        { fetchImpl: mockFetch, db: getDb() }
      );
      assert.equal(first.ok, true);
      assert.equal(first.delivered, true);
      if (first.ok && first.delivered) {
        assert.equal(first.mode, "text");
      }
      assert.equal(calls[0].type, "text");

      // Now simulate Meta webhook reporting status=failed (e.g. 131047) for wamid.msg.1
      const retried = await retryFailedSignupAlertWithTemplate(getDb(), {
        messageId: "wamid.msg.1",
        status: "failed",
        fetchImpl: mockFetch,
        allowInTest: true,
      });
      assert.equal(retried, true);
      assert.equal(calls.length, 2);
      assert.equal(calls[1].type, "template");

      // Second webhook retry for same messageId must be idempotent (no 3rd send)
      const retriedAgain = await retryFailedSignupAlertWithTemplate(getDb(), {
        messageId: "wamid.msg.1",
        status: "failed",
        fetchImpl: mockFetch,
        allowInTest: true,
      });
      assert.equal(retriedAgain, false);
      assert.equal(calls.length, 2);
    } finally {
      if (existingConv?.id) {
        getDb()
          .prepare("UPDATE whatsapp_conversations SET last_inbound_at = ? WHERE id = ?")
          .run(existingConv.last_inbound_at ?? null, existingConv.id);
      } else if (createdConvId) {
        getDb().prepare("DELETE FROM whatsapp_conversations WHERE id = ?").run(createdConvId);
      }
    }
  });

  it("provisions lumera_new_signup_alert UTILITY template once per WABA ID", async () => {
    process.env.META_ACCESS_TOKEN = SYNTH_GRAPH_TOKEN;
    process.env.META_PHONE_NUMBER_ID = "1294483843748285";
    const urls: Array<{ method: string; url: string }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const method = init?.method || "GET";
      const url = String(input);
      urls.push({ method, url });
      if (method === "GET") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "tpl-123", status: "PENDING" }), { status: 200 });
    };

    const ok1 = await maybeEnsureFounderSignupAlertTemplate("398249018247019", {
      fetchImpl: mockFetch,
      allowInTest: true,
    });
    const ok2 = await maybeEnsureFounderSignupAlertTemplate("398249018247019", {
      fetchImpl: mockFetch,
      allowInTest: true,
    });
    assert.equal(ok1, true);
    assert.equal(ok2, false, "Should only provision once per WABA ID per process");
    assert.equal(urls.length, 2);
    assert.equal(urls[0].method, "GET");
    assert.equal(urls[1].method, "POST");
    assert.equal(sanitizeTemplateParam("  Hello\n\tWorld   Test  "), "Hello World Test");
  });
});

function toDigits(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

