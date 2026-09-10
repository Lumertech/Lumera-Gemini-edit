import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, describe, it } from "node:test";
import express from "express";
import { createMetaRouter } from "./meta.ts";
import {
  buildMetaReadinessOverview,
  decideWebhookSignature,
  isUsableGraphToken,
  isUsablePhoneNumberId,
  verifyMetaHubSignature,
} from "./meta-security.ts";
import { resolveFederatedIdentity } from "./facebook-oauth.ts";
import { resolveGraphCredentials } from "./graph-whatsapp.ts";

function hmacSha256(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("Meta webhook signatures", () => {
  const secret = "test-app-secret";
  const body = '{"object":"whatsapp_business_account"}';

  it("accepts a valid X-Hub-Signature-256", () => {
    assert.equal(verifyMetaHubSignature(body, hmacSha256(secret, body), secret), true);
  });

  it("rejects a tampered payload", () => {
    assert.equal(verifyMetaHubSignature(body + "x", hmacSha256(secret, body), secret), false);
  });

  it("rejects missing signatures in production", () => {
    const decision = decideWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      appSecret: secret,
      production: true,
      allowUnsignedDevFlag: true,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  });

  it("allows unsigned webhooks only with the explicit non-prod DEV flag", () => {
    const allowed = decideWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      appSecret: secret,
      production: false,
      allowUnsignedDevFlag: true,
    });
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.unsignedDevBypass, true);

    const denied = decideWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      appSecret: secret,
      production: false,
      allowUnsignedDevFlag: false,
    });
    assert.equal(denied.ok, false);
  });
});

describe("Graph credential hygiene", () => {
  it("rejects seeded placeholder tokens and phone ids", () => {
    assert.equal(isUsableGraphToken("EAAJ...lumera_system_user_token_valid"), false);
    assert.equal(isUsablePhoneNumberId("phone_982345566701"), false);
    assert.equal(isUsableGraphToken("EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef"), true);
    assert.equal(isUsablePhoneNumberId("123456789012345"), true);
  });

  it("ignores env placeholders when resolving Graph credentials", () => {
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;
    process.env.META_ACCESS_TOKEN = "EAAJ...demo";
    process.env.META_PHONE_NUMBER_ID = "phone_demo";
    assert.equal(resolveGraphCredentials(null), null);
    process.env.META_ACCESS_TOKEN = prevToken;
    process.env.META_PHONE_NUMBER_ID = prevPhone;
  });
});

describe("Overview claims", () => {
  it("returns SANDBOX / NOT_SUBMITTED rather than Tech Provider APPROVED", () => {
    const overview = buildMetaReadinessOverview({
      connectedWabasCount: 1,
      totalClinics: 2,
      approvedTemplatesCount: 3,
      totalTemplatesCount: 4,
      totalMessagesSentAndReceived: 5,
      webhookUrl: "/api/meta/webhook",
      graphOtpConfigured: false,
      webhookSecretConfigured: false,
      verifyTokenConfigured: false,
      facebookOAuthConfigured: false,
    });
    assert.equal(overview.providerType.includes("SANDBOX"), true);
    assert.equal(overview.certificationStatus, "NOT_CERTIFIED");
    assert.equal(overview.appReviewStatus.status, "NOT_SUBMITTED");
    assert.match(JSON.stringify(overview), /not a certified Meta Tech Provider/i);
    assert.equal(overview.appReviewStatus.checklist.every((c) => c.passed), false);
  });
});

describe("Facebook OAuth identity", () => {
  const prevNode = process.env.NODE_ENV;
  const prevId = process.env.FACEBOOK_APP_ID;
  const prevSecret = process.env.FACEBOOK_APP_SECRET;

  after(() => {
    process.env.NODE_ENV = prevNode;
    process.env.FACEBOOK_APP_ID = prevId;
    process.env.FACEBOOK_APP_SECRET = prevSecret;
  });

  it("rejects client-supplied email in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.FACEBOOK_APP_ID = "123";
    process.env.FACEBOOK_APP_SECRET = "secret";
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "facebook",
          redirectUri: "http://localhost:3000/api/auth/facebook/callback",
          clientEmail: "attacker@example.com",
        }),
      /code or access token/i
    );
  });

  it("rejects Google client-email OAuth in production", async () => {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "google",
          redirectUri: "http://localhost:3000/callback",
          clientEmail: "attacker@example.com",
        }),
      /disabled in production/i
    );
  });

  it("labels non-prod client email as SANDBOX", async () => {
    process.env.NODE_ENV = "test";
    const identity = await resolveFederatedIdentity({
      provider: "facebook",
      redirectUri: "http://localhost:3000/api/auth/facebook/callback",
      clientEmail: "dev@example.com",
      clientName: "Dev User",
    });
    assert.equal(identity.sandbox, true);
    assert.equal(identity.email, "dev@example.com");
  });
});

describe("Production-gated simulate routes", () => {
  it("POST /api/meta/simulate-embedded-signup is 403 when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const app = express();
    app.use(express.json());
    app.use("/api/meta", createMetaRouter());
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/api/meta/simulate-embedded-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-lumera-main" }),
      });
      assert.equal(res.status, 403);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error || "", /disabled in production/i);
    } finally {
      process.env.NODE_ENV = prev;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("POST /api/meta/webhook rejects a bad signature", async () => {
    const prevSecret = process.env.META_APP_SECRET;
    const prevFlag = process.env.META_WEBHOOK_ALLOW_UNSIGNED;
    process.env.META_APP_SECRET = "unit-test-secret";
    process.env.META_WEBHOOK_ALLOW_UNSIGNED = "false";
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as express.Request).rawBody = buf;
        },
      })
    );
    app.use("/api/meta", createMetaRouter());
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      });
      assert.equal(res.status, 403);
    } finally {
      process.env.META_APP_SECRET = prevSecret;
      process.env.META_WEBHOOK_ALLOW_UNSIGNED = prevFlag;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
