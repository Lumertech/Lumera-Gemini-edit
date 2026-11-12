import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signJwtToken } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { createLiveRegistrationRouter } from "./live-registration-routes.ts";
import { hashOtp, otpMatches } from "./otp-hash.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import { RAZORPAY_PLAN_ENV, maybeStartTrialIfPending, recordPlanCheckout, settlePlanCheckoutWebhook } from "./trial-lifecycle.ts";
import { jsonRequest, startTestServer, type TestHttpServer } from "./test-http.ts";
import { upsertTenantSubscription } from "./platform-tenants-schema.ts";

async function authed(
  port: number,
  method: string,
  urlPath: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("production signup trial", () => {
  let server: TestHttpServer;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-production-signup";
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

  it("compares OTP hashes in constant time and still accepts a legacy plaintext code", () => {
    const hashed = hashOtp("135790");
    assert.equal(otpMatches(hashed, "135790"), true);
    assert.equal(otpMatches(hashed, "000000"), false);
    assert.equal(otpMatches("246810", "246810"), true);
    assert.equal(otpMatches("246810", "135790"), false);
  });

  it("does not start a trial until WhatsApp is verified, then blocks a second trial on that phone", async () => {
    resetSendOtpRateLimits();
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const national = `77${String(Date.now()).slice(-8)}`;
    const phone = `+91${national}`;
    const email = `trial.${stamp}@signup-test.example`;
    const created = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
      clinicName: "Trial One Clinic",
      specialty: "General Medicine",
      phone,
      name: "Trial Director",
      email,
      password: "Lumera@2026",
    });
    assert.equal(created.status, 200, String(created.json.error || created.status));
    assert.equal(created.json.trialPending, true);
    const tenantId = String(created.json.tenantId || "");
    const pending = getDb().prepare("SELECT lifecycle_status, trial_ends_at FROM tenants WHERE id = ?").get(tenantId) as {
      lifecycle_status: string;
      trial_ends_at: string;
    };
    assert.equal(pending.lifecycle_status, "pending_verification");
    assert.ok(Date.parse(pending.trial_ends_at) <= Date.now() + 5_000);

    const stored = getDb().prepare("SELECT otp FROM otp_verifications WHERE id = ?").get(String(created.json.verificationId)) as {
      otp: string;
    };
    assert.match(stored.otp, /^otp1:/);
    assert.notEqual(stored.otp, String(created.json.demoOtp || ""));
    assert.equal(otpMatches(stored.otp, String(created.json.demoOtp)), true);

    const verified = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId: created.json.verificationId,
      otp: created.json.demoOtp,
    });
    assert.equal(verified.status, 200, String(verified.json.error || verified.status));
    const started = getDb().prepare("SELECT lifecycle_status, trial_ends_at FROM tenants WHERE id = ?").get(tenantId) as {
      lifecycle_status: string;
      trial_ends_at: string;
    };
    assert.equal(started.lifecycle_status, "trial");
    const leftMs = Date.parse(started.trial_ends_at) - Date.now();
    assert.ok(leftMs > 6 * 24 * 60 * 60 * 1000 && leftMs < 8 * 24 * 60 * 60 * 1000);

    resetSendOtpRateLimits();
    const email2 = `trial2.${stamp}@signup-test.example`;
    const again = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
      clinicName: "Trial Two Clinic",
      specialty: "General Medicine",
      phone: national,
      name: "Second Director",
      email: email2,
      password: "Lumera@2026",
    });
    assert.equal(again.status, 200, String(again.json.error || again.status));
    const blocked = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId: again.json.verificationId,
      otp: again.json.demoOtp,
    });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.json.error), /free trial has already been used/i);
    const second = getDb().prepare("SELECT lifecycle_status FROM tenants WHERE id = ?").get(String(again.json.tenantId)) as {
      lifecycle_status: string;
    };
    assert.equal(second.lifecycle_status, "pending_verification");
  });

  it("rejects a weak signup password before creating a clinic", async () => {
    const res = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
      clinicName: "Weak Clinic",
      specialty: "General Medicine",
      phone: "+91 9800098000",
      name: "Weak Director",
      email: `weak.${Date.now().toString(36)}@signup-test.example`,
      password: "longpassword",
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json.error), /uppercase/i);
  });

  it("makes an expired trial read-only and still serves reads", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const tenantId = `tenant-lapsed-${stamp}`;
    const userId = `user-lapsed-${stamp}`;
    const email = `lapsed.${stamp}@signup-test.example`;
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, lifecycle_status)
         VALUES (?, 'Lapsed Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+919800011122', ?, 500, 0, 1, '', ?, ?, 'trial')`
      )
      .run(tenantId, past, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, created_at)
         VALUES (?, ?, ?, 'x', 'Dr Lapsed', 'doctor', 'active', '+919800011122', 'Lapsed Clinic', 1, 'individual', ?)`
      )
      .run(userId, tenantId, email, now);
    upsertTenantSubscription(getDb(), tenantId, {
      planCode: "trial",
      status: "trial",
      billingSource: "manual",
      endsAt: past,
    });
    const token = signJwtToken({ userId, tenantId, email, role: "doctor", name: "Dr Lapsed" });
    const read = await authed(server.port, "GET", "/api/doctors", token);
    assert.equal(read.status, 200, String(read.json.error || read.status));
    const write = await authed(server.port, "POST", "/api/doctors", token, { name: "New Doctor", specialty: "General Medicine" });
    assert.equal(write.status, 403);
    assert.equal(write.json.code, "TRIAL_READ_ONLY");
    assert.equal(write.json.upgradeRequired, true);

    const prevKey = process.env.RAZORPAY_KEY_ID;
    const prevSecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const pay = await authed(server.port, "POST", "/api/billing/plan-checkout", token, {
      planCode: "polyclinic",
      cycle: "monthly",
    });
    if (prevKey === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevKey;
    if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
    assert.equal(pay.status, 503);
    assert.equal(pay.json.configured, false);
    assert.equal(pay.json.paid, false);
    assert.deepEqual(pay.json.requiredEnv, [...RAZORPAY_PLAN_ENV]);
    assert.match(String(pay.json.error), /RAZORPAY_KEY_ID/);
  });

  it("does not start a trial on Google or Facebook sign-on until the phone is verified", () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const tenantId = `tenant-social-${stamp}`;
    const userId = `user-social-${stamp}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, lifecycle_status)
         VALUES (?, 'Social Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '', ?, 500, 0, 1, '', ?, ?, 'pending_verification')`
      )
      .run(tenantId, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, whatsapp_verified, clinic_name, created_at)
         VALUES (?, ?, ?, 'x', 'Social Director', 'doctor', 'active', '', 0, 'Social Clinic', ?)`
      )
      .run(userId, tenantId, `social.${stamp}@signup-test.example`, now);
    assert.equal(maybeStartTrialIfPending(getDb(), userId), null);
    const socialPhone = `+9166${String(Date.now()).slice(-8)}`;
    getDb().prepare("UPDATE users SET phone = ?, whatsapp_verified = 1 WHERE id = ?").run(socialPhone, userId);
    assert.equal(maybeStartTrialIfPending(getDb(), userId), null);
    getDb().prepare("UPDATE users SET phone_otp_verified_at = ? WHERE id = ?").run(new Date().toISOString(), userId);
    const started = maybeStartTrialIfPending(getDb(), userId);
    assert.equal(started?.ok, true);
    const row = getDb().prepare("SELECT lifecycle_status FROM tenants WHERE id = ?").get(tenantId) as { lifecycle_status: string };
    assert.equal(row.lifecycle_status, "trial");
  });

  it("does not let a register OTP or updatedPhone rewrite another clinic", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const victimId = `tenant-victim-${stamp}`;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, lifecycle_status)
         VALUES (?, 'Victim Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+919000000001', ?, 500, 0, 1, '', ?, ?, 'active')`
      )
      .run(victimId, future, now, now);
    const otp = "135791";
    const attackerPhone = `+9188${String(Date.now()).slice(-8)}`;
    const verificationId = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'register', ?, ?, ?)`
      )
      .run(
        verificationId,
        attackerPhone,
        `attacker.${stamp}@signup-test.example`,
        otp,
        JSON.stringify({ tenantId: victimId, phone: attackerPhone, email: `attacker.${stamp}@signup-test.example`, name: "Attacker" }),
        now,
        new Date(Date.now() + 5 * 60 * 1000).toISOString()
      );
    const res = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp,
      updatedPhone: "+919000000001",
    });
    assert.equal(res.status, 200, String(res.json.error || res.status));
    assert.notEqual(res.json.tenantId, victimId);
    const victim = getDb().prepare("SELECT lifecycle_status, phone FROM tenants WHERE id = ?").get(victimId) as {
      lifecycle_status: string;
      phone: string;
    };
    assert.equal(victim.lifecycle_status, "active");
    assert.equal(victim.phone, "+919000000001");
  });

  it("does not replace a paid clinic when a patient verifies a trial phone", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const tenantId = `tenant-paid-${stamp}`;
    const userId = `user-paid-${stamp}`;
    const email = `paid.${stamp}@signup-test.example`;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, lifecycle_status)
         VALUES (?, 'Paid Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+919222200011', ?, 500, 0, 1, '', ?, ?, 'active')`
      )
      .run(tenantId, future, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, created_at)
         VALUES (?, ?, ?, 'x', 'Patient', 'patient', 'active', '+919222200011', 'Paid Clinic', ?)`
      )
      .run(userId, tenantId, email, now);
    upsertTenantSubscription(getDb(), tenantId, {
      planCode: "clinic",
      status: "active",
      billingSource: "manual",
      endsAt: future,
    });
    const token = signJwtToken({ userId, tenantId, email, role: "patient", name: "Patient" });
    const otp = "246801";
    const verificationId = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, '+919333300022', ?, ?, 'trial_phone', ?, ?, ?)`
      )
      .run(verificationId, email, otp, JSON.stringify({ userId, tenantId }), now, new Date(Date.now() + 5 * 60 * 1000).toISOString());
    const res = await authed(server.port, "POST", "/api/auth/trial-phone/verify", token, { verificationId, otp });
    assert.equal(res.status, 403);
    const sub = getDb().prepare("SELECT status, plan_code FROM tenant_subscriptions WHERE tenant_id = ?").get(tenantId) as {
      status: string;
      plan_code: string;
    };
    assert.equal(sub.status, "active");
    assert.equal(sub.plan_code, "clinic");
  });

  it("activates a plan only for a server order paid in full", () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const tenantId = `tenant-pay-${stamp}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, lifecycle_status)
         VALUES (?, 'Pay Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+919444400033', ?, 500, 0, 1, '', ?, ?, 'trial')`
      )
      .run(tenantId, now, now, now);
    const orderId = `order_plan_${stamp}`;
    recordPlanCheckout(getDb(), {
      orderId,
      tenantId,
      planCode: "polyclinic",
      cycle: "monthly",
      amountPaise: 790482,
    });
    const noted = settlePlanCheckoutWebhook(getDb(), {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_small",
            amount: 100,
            order_id: orderId,
            notes: { purpose: "plan_subscription", tenant_id: "tenant-other", plan_code: "polyclinic", cycle: "annual" },
          },
        },
      },
    });
    assert.equal(noted.matched, true);
    assert.equal(noted.ok, false);
    const unpaid = getDb().prepare("SELECT lifecycle_status FROM tenants WHERE id = ?").get(tenantId) as { lifecycle_status: string };
    assert.equal(unpaid.lifecycle_status, "trial");
    const paid = settlePlanCheckoutWebhook(getDb(), {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_full", amount: 790482, order_id: orderId, notes: { purpose: "wallet_topup" } } } },
    });
    assert.equal(paid.matched, true);
    assert.equal(paid.ok, true);
    const row = getDb().prepare("SELECT lifecycle_status FROM tenants WHERE id = ?").get(tenantId) as { lifecycle_status: string };
    assert.equal(row.lifecycle_status, "active");
  });

  it("registers with WhatsApp OTP when Google, Facebook, and Razorpay keys are absent", async () => {
    const names = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "FACEBOOK_APP_ID",
      "FACEBOOK_APP_SECRET",
      "META_APP_ID",
      "META_APP_SECRET",
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "DEMO_LOGIN_ENABLED",
    ];
    const saved: Record<string, string | undefined> = {};
    for (const name of names) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    const prevNode = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const phone = `+9176${String(Date.now()).slice(-8)}`;
      const email = `nokeys.${stamp}@signup-test.example`;
      const created = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
        clinicName: "No Keys Clinic",
        specialty: "General Medicine",
        phone,
        name: "No Keys Director",
        email,
        password: "Lumera@2026",
      });
      assert.equal(created.status, 200, String(created.json.error || created.status));
      assert.equal(created.json.trialPending, true);
      const verified = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
        verificationId: created.json.verificationId,
        otp: created.json.demoOtp,
      });
      assert.equal(verified.status, 200, String(verified.json.error || verified.status));

      process.env.NODE_ENV = "production";
      const config = await jsonRequest(server.port, "GET", "/api/auth/oauth-config");
      assert.equal(config.status, 200);
      assert.equal(config.json.googleConfigured, false);
      assert.equal(config.json.facebookConfigured, false);
      assert.equal(config.json.sandboxClientOAuthAllowed, false);
      assert.equal(config.json.demoLoginEnabled, false);
      const blocked = await jsonRequest(server.port, "POST", "/api/auth/register-practice", {
        clinicName: "Prod No Meta",
        specialty: "General Medicine",
        phone: `+9175${String(Date.now()).slice(-8)}`,
        name: "Prod Director",
        email: `prod.${stamp}@signup-test.example`,
        password: "Lumera@2026",
      });
      assert.equal(blocked.status, 503);
      assert.match(String(blocked.json.error), /META_ACCESS_TOKEN/);
      assert.doesNotMatch(String(blocked.json.error), /GOOGLE_CLIENT|FACEBOOK_APP|RAZORPAY_KEY/);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
