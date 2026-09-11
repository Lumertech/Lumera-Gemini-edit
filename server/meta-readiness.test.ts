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
import { facebookOAuthConfigured, resolveFederatedIdentity, signFacebookOAuthState, verifyFacebookOAuthState } from "./facebook-oauth.ts";
import { resolveGraphCredentials } from "./graph-whatsapp.ts";
import { isUnsetOrPlaceholder } from "./runtime.ts";
import { attachUser, verifyJwtToken } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { initDatabase } from "./db.ts";

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

  it("allows unsigned webhooks in non-prod when the secret is not provisioned", () => {
    const allowed = decideWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      appSecret: "",
      production: false,
      allowUnsignedDevFlag: false,
    });
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.unsignedDevBypass, true);
  });

  it("hard-fails unsigned webhooks in production when META_APP_SECRET is absent", () => {
    const decision = decideWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      appSecret: "",
      production: true,
      allowUnsignedDevFlag: true,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 500);
  });

  it("allows unsigned webhooks with the explicit non-prod DEV flag even when a secret is set", () => {
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

  it("treats .env.example placeholders as unset credentials", () => {
    assert.equal(isUnsetOrPlaceholder(""), true);
    assert.equal(isUnsetOrPlaceholder("replace-with-facebook-app-id"), true);
    assert.equal(isUnsetOrPlaceholder("replace-with-meta-app-secret"), true);
    assert.equal(isUnsetOrPlaceholder("change-me-to-a-long-random-secret"), true);
    assert.equal(isUnsetOrPlaceholder("EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef"), false);

    const prevId = process.env.FACEBOOK_APP_ID;
    const prevSecret = process.env.FACEBOOK_APP_SECRET;
    const prevMeta = process.env.META_APP_SECRET;
    process.env.FACEBOOK_APP_ID = "replace-with-facebook-app-id";
    process.env.FACEBOOK_APP_SECRET = "replace-with-facebook-app-secret";
    process.env.META_APP_SECRET = "replace-with-meta-app-secret";
    assert.equal(facebookOAuthConfigured(), false);
    if (prevId === undefined) delete process.env.FACEBOOK_APP_ID;
    else process.env.FACEBOOK_APP_ID = prevId;
    if (prevSecret === undefined) delete process.env.FACEBOOK_APP_SECRET;
    else process.env.FACEBOOK_APP_SECRET = prevSecret;
    if (prevMeta === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = prevMeta;
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
    assert.match(JSON.stringify(overview), /credentials are optional until provisioned/i);
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
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      await assert.rejects(
        () =>
          resolveFederatedIdentity({
            provider: "google",
            redirectUri: "https://www.mylumera.in/api/auth/google/callback",
            clientEmail: "attacker@example.com",
          }),
        /GOOGLE_CLIENT_ID|not configured/i
      );
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
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

  it("OAuth state signing fails closed without JWT_SECRET", () => {
    const prevJwt = process.env.JWT_SECRET;
    const prevState = process.env.FACEBOOK_OAUTH_STATE_SECRET;
    try {
      delete process.env.JWT_SECRET;
      delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
      assert.throws(() => signFacebookOAuthState(), /JWT_SECRET/);
      assert.equal(verifyFacebookOAuthState("not-a-state"), false);
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevState === undefined) delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
      else process.env.FACEBOOK_OAUTH_STATE_SECRET = prevState;
    }
  });

  it("OAuth state uses JWT_SECRET (or dedicated FACEBOOK_OAUTH_STATE_SECRET) with no hardcoded fallback", () => {
    const prevJwt = process.env.JWT_SECRET;
    const prevState = process.env.FACEBOOK_OAUTH_STATE_SECRET;
    try {
      delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
      process.env.JWT_SECRET = "unit-test-oauth-state-jwt";
      const state = signFacebookOAuthState();
      assert.equal(verifyFacebookOAuthState(state), true);
      assert.equal(verifyFacebookOAuthState("tampered." + state), false);

      process.env.FACEBOOK_OAUTH_STATE_SECRET = "dedicated-facebook-state-secret";
      const dedicated = signFacebookOAuthState();
      assert.equal(verifyFacebookOAuthState(dedicated), true);
      delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
      assert.equal(verifyFacebookOAuthState(dedicated), false);
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevState === undefined) delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
      else process.env.FACEBOOK_OAUTH_STATE_SECRET = prevState;
    }
  });
});

describe("Facebook OAuth session mint (JWT parity)", () => {
  it("POST /api/auth/oauth mints a JWT and /auth/me hydrates with credentials", async () => {
    const prevJwt = process.env.JWT_SECRET;
    const prevNode = process.env.NODE_ENV;
    const prevId = process.env.FACEBOOK_APP_ID;
    const prevSecret = process.env.FACEBOOK_APP_SECRET;
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    }
    process.env.NODE_ENV = "test";
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    initDatabase();

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
      const port = addr.port;

      const oauthRes = await fetch(`http://127.0.0.1:${port}/api/auth/oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "facebook",
          profile: { email: "doctor@lumera.me", name: "Dr. Rajiv Saxena" },
          skipOtp: true,
        }),
      });
      assert.equal(oauthRes.status, 200);
      const oauthJson = (await oauthRes.json()) as {
        token?: string;
        user?: { email?: string };
        sandbox?: boolean;
        requiresOtp?: boolean;
      };
      assert.equal(oauthJson.requiresOtp, false);
      assert.equal(oauthJson.sandbox, true);
      assert.equal(oauthJson.user?.email, "doctor@lumera.me");
      const token = String(oauthJson.token || "");
      const payload = verifyJwtToken(token);
      assert.ok(payload);
      assert.equal(payload.email, "doctor@lumera.me");
      assert.equal(payload.userId.startsWith("eyJ"), false);
      assert.equal(token.split(".").length, 3);

      const setCookie = oauthRes.headers.get("set-cookie") || "";
      assert.match(setCookie, /lumera_sid=/);

      const meBearer = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(meBearer.status, 200);
      const meBearerJson = (await meBearer.json()) as { user?: { email?: string }; token?: string };
      assert.equal(meBearerJson.user?.email, "doctor@lumera.me");
      assert.equal(meBearerJson.token, token);

      const meCookie = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
        headers: { Cookie: `lumera_sid=${encodeURIComponent(token)}` },
      });
      assert.equal(meCookie.status, 200);
      const meCookieJson = (await meCookie.json()) as { user?: { email?: string }; token?: string };
      assert.equal(meCookieJson.user?.email, "doctor@lumera.me");
      assert.equal(meCookieJson.token, token);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevId === undefined) delete process.env.FACEBOOK_APP_ID;
      else process.env.FACEBOOK_APP_ID = prevId;
      if (prevSecret === undefined) delete process.env.FACEBOOK_APP_SECRET;
      else process.env.FACEBOOK_APP_SECRET = prevSecret;
    }
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
