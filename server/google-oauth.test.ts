import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiRouter } from "./api.ts";
import { attachUser } from "./auth.ts";
import { initDatabase } from "./db.ts";
import { resolveFederatedIdentity } from "./facebook-oauth.ts";
import {
  assertGoogleIdTokenAudience,
  googleLoginDialogUrl,
  googleOAuthConfigured,
  googleRedirectUri,
  GoogleOAuthError,
  signGoogleOAuthState,
  verifyGoogleIdentity,
  verifyGoogleOAuthState,
} from "./google-oauth.ts";

function saveEnv(names: string[]): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const name of names) prev[name] = process.env[name];
  return () => {
    for (const name of names) {
      if (prev[name] === undefined) delete process.env[name];
      else process.env[name] = prev[name];
    }
  };
}

describe("Google OAuth founder docs", () => {
  it("documents the exact www redirect URI in .env.example and the Cloud Run runbook", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const envEx = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    const runbook = fs.readFileSync(path.join(root, "docs/FIREBASE_CLOUD_RUN_DEPLOY.md"), "utf8");
    assert.match(envEx, /GOOGLE_CLIENT_ID=/);
    assert.match(envEx, /GOOGLE_CLIENT_SECRET=/);
    assert.match(envEx, /https:\/\/www\.mylumera\.in\/api\/auth\/google\/callback/);
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/auth\/google\/callback/);
    assert.match(runbook, /redirect_uri_mismatch/);
  });
});

describe("Google OAuth redirect URI + config", () => {
  const restore = saveEnv([
    "APP_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_CALLBACK_URL",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "NODE_ENV",
  ]);
  after(restore);

  it("uses APP_URL www callback (no trailing slash, not localhost)", () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.GOOGLE_CALLBACK_URL;
    process.env.APP_URL = "https://www.mylumera.in/";
    assert.equal(googleRedirectUri("run.app", "https"), "https://www.mylumera.in/api/auth/google/callback");
    assert.equal(googleRedirectUri().includes("localhost"), false);
    assert.equal(googleRedirectUri().endsWith("/"), false);
  });

  it("does not treat www and apex as the same host", () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    process.env.APP_URL = "https://www.mylumera.in";
    assert.equal(googleRedirectUri(), "https://www.mylumera.in/api/auth/google/callback");
    process.env.APP_URL = "https://mylumera.in";
    assert.equal(googleRedirectUri(), "https://mylumera.in/api/auth/google/callback");
  });

  it("honors GOOGLE_REDIRECT_URI override", () => {
    process.env.GOOGLE_REDIRECT_URI = "https://www.mylumera.in/api/auth/google/callback";
    process.env.APP_URL = "https://wrong.example";
    assert.equal(googleRedirectUri(), "https://www.mylumera.in/api/auth/google/callback");
  });

  it("treats placeholders as unset credentials", () => {
    process.env.GOOGLE_CLIENT_ID = "replace-with-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "replace-with-google-client-secret";
    assert.equal(googleOAuthConfigured(), false);
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    assert.equal(googleOAuthConfigured(), true);
  });

  it("builds accounts.google.com dialog with the exact redirect_uri", () => {
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    const url = new URL(
      googleLoginDialogUrl({
        redirectUri: "https://www.mylumera.in/api/auth/google/callback",
        state: "unit-state",
      })
    );
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("redirect_uri"), "https://www.mylumera.in/api/auth/google/callback");
    assert.equal(url.searchParams.get("client_id"), "1234567890-abc.apps.googleusercontent.com");
    assert.match(url.searchParams.get("scope") || "", /email/);
    assert.equal(url.searchParams.get("response_type"), "code");
  });
});

describe("Google OAuth identity", () => {
  const restore = saveEnv([
    "NODE_ENV",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "JWT_SECRET",
    "GOOGLE_OAUTH_STATE_SECRET",
  ]);
  after(restore);

  it("rejects client-supplied email in production when Google is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "google",
          redirectUri: "https://www.mylumera.in/api/auth/google/callback",
          clientEmail: "attacker@example.com",
        }),
      /GOOGLE_CLIENT_ID|not configured/i
    );
  });

  it("rejects production Google login without a code even when credentials exist", async () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "google",
          redirectUri: "https://www.mylumera.in/api/auth/google/callback",
          clientEmail: "attacker@example.com",
        }),
      /authorization code or access token/i
    );
  });

  it("exchanges a code and requires a verified Google email", async () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        const body = String(init?.body || "");
        assert.match(body, /redirect_uri=https%3A%2F%2Fwww.mylumera.in%2Fapi%2Fauth%2Fgoogle%2Fcallback/);
        assert.match(body, /code=unit-code/);
        return new Response(JSON.stringify({ access_token: "ya29.unit", token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("oauth2/v3/userinfo")) {
        assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer ya29.unit");
        return new Response(
          JSON.stringify({
            sub: "google-sub-1",
            email: "doctor@lumera.me",
            email_verified: true,
            name: "Dr. Rajiv Saxena",
            picture: "https://example.com/a.png",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const identity = await resolveFederatedIdentity({
      provider: "google",
      code: "unit-code",
      redirectUri: "https://www.mylumera.in/api/auth/google/callback",
      clientEmail: "attacker@example.com",
      fetchImpl,
    });
    assert.equal(identity.sandbox, undefined);
    assert.equal(identity.email, "doctor@lumera.me");
    assert.equal(identity.name, "Dr. Rajiv Saxena");
    assert.equal(identity.googleId, "google-sub-1");
    assert.equal(identity.provider, "google");
  });

  it("rejects unverified Google emails", async () => {
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ email: "unverified@example.com", email_verified: false, sub: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      () =>
        verifyGoogleIdentity({
          accessToken: "ya29.unit",
          redirectUri: "https://www.mylumera.in/api/auth/google/callback",
          fetchImpl,
        }),
      /not verified/i
    );
  });

  it("rejects ID tokens whose audience is not GOOGLE_CLIENT_ID", () => {
    process.env.GOOGLE_CLIENT_ID = "expected-client-id";
    const payload = Buffer.from(
      JSON.stringify({ aud: "other-client", iss: "https://accounts.google.com" }),
      "utf8"
    ).toString("base64url");
    const token = `hdr.${payload}.sig`;
    assert.throws(() => assertGoogleIdTokenAudience(token, "expected-client-id"), GoogleOAuthError);
  });

  it("OAuth state uses JWT_SECRET (or dedicated GOOGLE_OAUTH_STATE_SECRET)", () => {
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    process.env.JWT_SECRET = "unit-test-google-oauth-state-jwt";
    const state = signGoogleOAuthState();
    assert.equal(verifyGoogleOAuthState(state), true);
    assert.equal(verifyGoogleOAuthState("tampered." + state), false);

    process.env.GOOGLE_OAUTH_STATE_SECRET = "dedicated-google-state-secret";
    const dedicated = signGoogleOAuthState();
    assert.equal(verifyGoogleOAuthState(dedicated), true);
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    assert.equal(verifyGoogleOAuthState(dedicated), false);
  });
});

describe("Google OAuth HTTP routes", () => {
  const restore = saveEnv([
    "NODE_ENV",
    "JWT_SECRET",
    "APP_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
  ]);
  after(restore);

  it("GET /api/auth/oauth-config exposes googleConfigured + www redirect URI", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";
    delete process.env.GOOGLE_REDIRECT_URI;

    const app = express();
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/oauth-config`);
      assert.equal(res.status, 200);
      const json = (await res.json()) as {
        googleConfigured?: boolean;
        googleRedirectUri?: string;
        sandboxClientOAuthAllowed?: boolean;
      };
      assert.equal(json.googleConfigured, true);
      assert.equal(json.googleRedirectUri, "https://www.mylumera.in/api/auth/google/callback");
      assert.equal(json.sandboxClientOAuthAllowed, false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /api/auth/google redirects to accounts.google.com with the www callback", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-unit-test-not-a-real-secret";

    const app = express();
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/google`, { redirect: "manual" });
      assert.equal(res.status, 302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
      assert.equal(url.searchParams.get("redirect_uri"), "https://www.mylumera.in/api/auth/google/callback");
      assert.ok(url.searchParams.get("state"));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /api/auth/google is 503 in production when credentials are missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const app = express();
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/google`, { redirect: "manual" });
      assert.equal(res.status, 503);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error || "", /GOOGLE_CLIENT_ID/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("POST /api/auth/oauth rejects production client-email Google login", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    initDatabase();

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          profile: { email: "attacker@example.com", name: "Attacker" },
          skipOtp: true,
        }),
      });
      assert.equal(res.status, 503);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error || "", /GOOGLE_CLIENT_ID|not configured/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
