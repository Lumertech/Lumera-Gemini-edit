import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiRouter } from "./api.ts";
import { attachUser } from "./auth.ts";
import { initDatabase } from "./db.ts";
import {
  exchangeFacebookAuthorizationCode,
  facebookLoginDialogUrl,
  facebookOAuthConfigured,
  facebookRedirectUri,
  parseFacebookOAuthState,
  resolveFederatedIdentity,
  signFacebookOAuthState,
  verifyFacebookIdentity,
  verifyFacebookOAuthState,
} from "./facebook-oauth.ts";

const APP_ID = "111222333444555";
const APP_SECRET = "facebook-login-unit-secret";
const CALLBACK = "https://www.mylumera.in/api/auth/facebook/callback";

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

function mockFacebookGraph(opts: {
  email?: string;
  scopes?: string[];
  appId?: string;
  userId?: string;
} = {}): typeof fetch {
  const email = opts.email ?? "doctor@lumera.me";
  const scopes = opts.scopes ?? ["email", "public_profile"];
  const appId = opts.appId ?? APP_ID;
  const userId = opts.userId ?? "fb-user-1";
  return async (input) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) {
      assert.match(url, /redirect_uri=/);
      assert.match(url, /client_id=/);
      assert.match(url, /client_secret=/);
      assert.match(url, /code=/);
      assert.equal(url.includes("redirect_uri=" + encodeURIComponent(CALLBACK)) || url.includes("redirect_uri=https"), true);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("redirect_uri"), CALLBACK);
      assert.equal(parsed.searchParams.get("client_id"), APP_ID);
      return new Response(JSON.stringify({ access_token: "EAA_unit_user_token", token_type: "bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("debug_token")) {
      return new Response(
        JSON.stringify({
          data: {
            app_id: appId,
            is_valid: true,
            user_id: userId,
            scopes,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/me?")) {
      return new Response(
        JSON.stringify({
          id: userId,
          email,
          name: "Dr. Rajiv Saxena",
          picture: { data: { url: "https://example.com/fb.png" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

describe("Facebook OAuth founder docs", () => {
  it("documents the exact www redirect URI in .env.example and the Cloud Run runbook", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const envEx = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    const runbook = fs.readFileSync(path.join(root, "docs/FIREBASE_CLOUD_RUN_DEPLOY.md"), "utf8");
    assert.match(envEx, /FACEBOOK_APP_ID=/);
    assert.match(envEx, /FACEBOOK_APP_SECRET=/);
    assert.match(envEx, /https:\/\/www\.mylumera\.in\/api\/auth\/facebook\/callback/);
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/auth\/facebook\/callback/);
    assert.match(runbook, /Client OAuth Login/);
    assert.match(runbook, /not a certified Meta Tech Provider/i);
  });
});

describe("Facebook OAuth redirect URI + config", () => {
  const restore = saveEnv([
    "APP_URL",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "FACEBOOK_REDIRECT_URI",
    "FACEBOOK_CALLBACK_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "NODE_ENV",
  ]);
  after(restore);

  it("uses APP_URL www callback (no trailing slash, not localhost)", () => {
    delete process.env.FACEBOOK_REDIRECT_URI;
    delete process.env.FACEBOOK_CALLBACK_URL;
    process.env.APP_URL = "https://www.mylumera.in/";
    assert.equal(facebookRedirectUri("run.app", "https"), CALLBACK);
    assert.equal(facebookRedirectUri().includes("localhost"), false);
    assert.equal(facebookRedirectUri().endsWith("/"), false);
  });

  it("treats x-forwarded-proto lists as https when APP_URL is unset", () => {
    delete process.env.APP_URL;
    delete process.env.FACEBOOK_REDIRECT_URI;
    assert.equal(
      facebookRedirectUri("www.mylumera.in", "https, http"),
      CALLBACK
    );
  });

  it("does not treat www and apex as the same host", () => {
    delete process.env.FACEBOOK_REDIRECT_URI;
    process.env.APP_URL = "https://www.mylumera.in";
    assert.equal(facebookRedirectUri(), CALLBACK);
    process.env.APP_URL = "https://mylumera.in";
    assert.equal(facebookRedirectUri(), "https://mylumera.in/api/auth/facebook/callback");
  });

  it("honors FACEBOOK_REDIRECT_URI override without a trailing slash", () => {
    process.env.FACEBOOK_REDIRECT_URI = `${CALLBACK}/`;
    process.env.APP_URL = "https://wrong.example";
    assert.equal(facebookRedirectUri(), CALLBACK);
  });

  it("treats placeholders as unset credentials", () => {
    process.env.FACEBOOK_APP_ID = "replace-with-facebook-app-id";
    process.env.FACEBOOK_APP_SECRET = "replace-with-facebook-app-secret";
    assert.equal(facebookOAuthConfigured(), false);
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    assert.equal(facebookOAuthConfigured(), true);
  });

  it("builds facebook.com dialog/oauth with code + email scope + exact redirect_uri", () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    const url = new URL(
      facebookLoginDialogUrl({
        redirectUri: CALLBACK,
        state: "unit-state",
      })
    );
    assert.match(url.origin + url.pathname, /facebook\.com\/v\d+\.\d+\/dialog\/oauth/);
    assert.equal(url.searchParams.get("redirect_uri"), CALLBACK);
    assert.equal(url.searchParams.get("client_id"), APP_ID);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "email,public_profile");
  });
});

describe("Facebook OAuth identity", () => {
  const restore = saveEnv([
    "NODE_ENV",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "JWT_SECRET",
    "FACEBOOK_OAUTH_STATE_SECRET",
    "APP_URL",
  ]);
  after(restore);

  it("rejects client-supplied email in production when Facebook is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "facebook",
          redirectUri: CALLBACK,
          clientEmail: "attacker@example.com",
        }),
      /FACEBOOK_APP_ID|not configured/i
    );
  });

  it("rejects production Facebook login without a code even when credentials exist", async () => {
    process.env.NODE_ENV = "production";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    await assert.rejects(
      () =>
        resolveFederatedIdentity({
          provider: "facebook",
          redirectUri: CALLBACK,
          clientEmail: "attacker@example.com",
        }),
      /authorization code or access token/i
    );
  });

  it("exchanges a code, debug_tokens the user token, and requires Graph email", async () => {
    process.env.NODE_ENV = "production";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    const identity = await resolveFederatedIdentity({
      provider: "facebook",
      code: "unit-code",
      redirectUri: CALLBACK,
      clientEmail: "attacker@example.com",
      fetchImpl: mockFacebookGraph(),
    });
    assert.equal(identity.sandbox, undefined);
    assert.equal(identity.email, "doctor@lumera.me");
    assert.equal(identity.name, "Dr. Rajiv Saxena");
    assert.equal(identity.facebookId, "fb-user-1");
    assert.equal(identity.provider, "facebook");
  });

  it("rejects a user token that belongs to another app id", async () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    await assert.rejects(
      () =>
        verifyFacebookIdentity({
          accessToken: "EAA_other",
          redirectUri: CALLBACK,
          fetchImpl: mockFacebookGraph({ appId: "999" }),
        }),
      /invalid for this app/i
    );
  });

  it("rejects tokens that omit the email permission", async () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    await assert.rejects(
      () =>
        verifyFacebookIdentity({
          accessToken: "EAA_no_email",
          redirectUri: CALLBACK,
          fetchImpl: mockFacebookGraph({ scopes: ["public_profile"] }),
        }),
      /email permission/i
    );
  });

  it("binds redirect_uri into OAuth state", () => {
    delete process.env.FACEBOOK_OAUTH_STATE_SECRET;
    process.env.JWT_SECRET = "unit-test-facebook-oauth-state-jwt";
    const state = signFacebookOAuthState(CALLBACK);
    assert.equal(verifyFacebookOAuthState(state), true);
    const parsed = parseFacebookOAuthState(state);
    assert.equal(parsed?.redirectUri, CALLBACK);
    assert.equal(verifyFacebookOAuthState("tampered." + state), false);
  });
});

describe("Facebook OAuth HTTP routes", () => {
  const restore = saveEnv([
    "NODE_ENV",
    "JWT_SECRET",
    "APP_URL",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "FACEBOOK_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
  ]);
  after(restore);

  it("GET /api/auth/oauth-config exposes facebookConfigured + www redirect URI", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    delete process.env.FACEBOOK_REDIRECT_URI;

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
        facebookConfigured?: boolean;
        facebookRedirectUri?: string;
        sandboxClientOAuthAllowed?: boolean;
      };
      assert.equal(json.facebookConfigured, true);
      assert.equal(json.facebookRedirectUri, CALLBACK);
      assert.equal(json.sandboxClientOAuthAllowed, false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /api/auth/facebook redirects to facebook.com dialog/oauth with the www callback", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;

    const app = express();
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/facebook`, { redirect: "manual" });
      assert.equal(res.status, 302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      assert.match(url.origin + url.pathname, /facebook\.com\/v\d+\.\d+\/dialog\/oauth/);
      assert.equal(url.searchParams.get("redirect_uri"), CALLBACK);
      assert.equal(url.searchParams.get("response_type"), "code");
      const state = url.searchParams.get("state") || "";
      assert.ok(state);
      assert.equal(parseFacebookOAuthState(state)?.redirectUri, CALLBACK);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /api/auth/facebook is 503 in production when credentials are missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;

    const app = express();
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/facebook`, { redirect: "manual" });
      assert.equal(res.status, 503);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error || "", /FACEBOOK_APP_ID/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /api/auth/facebook/callback exchanges the code and issues a session cookie", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
    process.env.APP_URL = "https://www.mylumera.in";
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    initDatabase();

    const origFetch = globalThis.fetch;
    const graphFetch = mockFacebookGraph();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) return graphFetch(input, init);
      return origFetch(input, init);
    }) as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const start = await fetch(`http://127.0.0.1:${addr.port}/api/auth/facebook`, { redirect: "manual" });
      const dialog = new URL(start.headers.get("location") || "");
      const state = dialog.searchParams.get("state") || "";
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/api/auth/facebook/callback?code=unit-code&state=${encodeURIComponent(state)}`,
        { redirect: "manual" }
      );
      assert.equal(res.status, 302);
      const location = res.headers.get("location") || "";
      assert.match(location, /oauth=facebook/);
      assert.match(location, /status=ok/);
      assert.match(res.headers.get("set-cookie") || "", /lumera_sid=/);
    } finally {
      globalThis.fetch = origFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("POST /api/auth/oauth rejects production client-email Facebook login", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-jwt-secret-lock-phi";
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
      if (!addr || typeof addr === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/auth/oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "facebook",
          profile: { email: "attacker@example.com", name: "Attacker" },
          skipOtp: true,
        }),
      });
      assert.equal(res.status, 503);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error || "", /FACEBOOK_APP_ID|not configured/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("Facebook authorization-code exchange URI match", () => {
  const restore = saveEnv(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "META_APP_ID", "META_APP_SECRET"]);
  after(restore);

  it("sends the same redirect_uri used in the Login dialog", async () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    const token = await exchangeFacebookAuthorizationCode({
      code: "unit-code",
      redirectUri: CALLBACK,
      fetchImpl: mockFacebookGraph(),
    });
    assert.equal(token, "EAA_unit_user_token");
  });
});
