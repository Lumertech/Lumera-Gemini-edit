import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express, { type Request } from "express";
import { createApiRouter } from "./api.ts";
import { attachUser } from "./auth.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  attachHttpSecurity,
  clientMayUseSessionToken,
  csrfShouldReject,
  resetAuthRateLimitStore,
  unpackHostSession,
} from "./http-security.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function asReq(headers: Record<string, string>, method = "POST"): Request {
  return {
    method,
    path: "/api/patients",
    originalUrl: "/api/patients",
    headers,
  } as unknown as Request;
}

function setCookieLines(res: Response): string[] {
  return typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
}

function issuedSession(lines: string[]): string {
  const line = lines.find((entry) => /^__session=[^;]/.test(entry) && !/max-age=0/i.test(entry));
  assert.ok(line, "response must set a host __session");
  return decodeURIComponent(line.split(";")[0].slice("__session=".length));
}

describe("session token for native clients only", () => {
  let port = 0;
  let server: Server | undefined;
  const prevDemo = process.env.DEMO_LOGIN_ENABLED;
  const prevNode = process.env.NODE_ENV;
  const prevOrigins = process.env.ALLOWED_ORIGINS;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-native-session";
    delete process.env.NODE_ENV;
    initDatabase();
    const app = express();
    app.use(express.json());
    attachHttpSecurity(app);
    app.use(attachUser);
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (prevDemo === undefined) delete process.env.DEMO_LOGIN_ENABLED;
    else process.env.DEMO_LOGIN_ENABLED = prevDemo;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = prevOrigins;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function postJson(urlPath: string, body: unknown, headers: Record<string, string> = {}) {
    resetAuthRateLimitStore();
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  }

  async function login(headers: Record<string, string> = {}) {
    return postJson("/api/auth/login", { email: "doctor@lumera.me", password: "Lumera@2026" }, headers);
  }

  function credentialOf(res: Response): string {
    return unpackHostSession(issuedSession(setCookieLines(res))).credential;
  }

  it("treats any Sec-Fetch-Site as a browser even when X-Client marks native", () => {
    assert.equal(clientMayUseSessionToken(asReq({})), true);
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "same-origin" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "none" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "cross-site" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "same-site" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ origin: "http://127.0.0.1:3000" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ origin: "null" })), false);
    for (const site of ["same-origin", "none", "cross-site", "same-site"]) {
      for (const mark of ["mobile", "ios", "android", "native", "iOS", "Android"]) {
        assert.equal(
          clientMayUseSessionToken(asReq({ "sec-fetch-site": site, origin: "http://127.0.0.1:3000", "x-client": mark })),
          false,
          `${site} ${mark}`
        );
      }
    }
    for (const mark of ["mobile", "ios", "android", "native"]) {
      assert.equal(clientMayUseSessionToken(asReq({ origin: "http://127.0.0.1:3000", "x-client": mark })), true, mark);
    }
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "same-origin", "x-client": "web" })), false);
    assert.equal(clientMayUseSessionToken(asReq({ "sec-fetch-site": "same-origin", "x-client": "browser" })), false);

    const cookie = "lumera_sid=abc.def";
    assert.equal(
      csrfShouldReject(asReq({ cookie, authorization: "Bearer jwt", "sec-fetch-site": "same-origin" })),
      true
    );
    assert.equal(
      csrfShouldReject(asReq({ cookie, "x-session-token": "jwt", origin: "http://127.0.0.1:3000" })),
      true
    );
    assert.equal(
      csrfShouldReject(asReq({ cookie, authorization: "Bearer jwt", "sec-fetch-site": "same-origin", "x-client": "ios" })),
      true
    );
    assert.equal(
      csrfShouldReject(asReq({ authorization: "Bearer jwt", origin: "http://127.0.0.1:3000", "x-client": "ios" })),
      false
    );
    assert.equal(csrfShouldReject(asReq({ cookie, authorization: "Bearer jwt" })), false);
  });

  it("omits token on browser login and returns it for native clients", async () => {
    const browser = await login({ "Sec-Fetch-Site": "same-origin" });
    assert.equal(browser.res.status, 200, String(browser.json.error || "browser login"));
    const browserCredential = credentialOf(browser.res);
    assert.ok(browserCredential);
    assert.equal(browser.json.token, undefined);
    assert.equal(JSON.stringify(browser.json).includes(browserCredential), false);
    assert.equal(browser.json.csrfToken, unpackHostSession(issuedSession(setCookieLines(browser.res))).csrf);

    const originOnly = await login({ Origin: "http://127.0.0.1:3000" });
    assert.equal(originOnly.res.status, 200, String(originOnly.json.error || "origin login"));
    assert.equal(originOnly.json.token, undefined);
    assert.equal(JSON.stringify(originOnly.json).includes(credentialOf(originOnly.res)), false);

    const curl = await login();
    assert.equal(curl.res.status, 200, String(curl.json.error || "curl login"));
    assert.equal(curl.json.token, credentialOf(curl.res));

    const mobile = await login({ "Sec-Fetch-Site": "same-origin", "X-Client": "mobile" });
    assert.equal(mobile.res.status, 200, String(mobile.json.error || "mobile login"));
    assert.equal(mobile.json.token, undefined);
    assert.equal(JSON.stringify(mobile.json).includes(credentialOf(mobile.res)), false);

    const ios = await login({ Origin: "http://127.0.0.1:3000", "X-Client": "iOS" });
    assert.equal(ios.res.status, 200, String(ios.json.error || "ios login"));
    assert.equal(ios.json.token, credentialOf(ios.res));

    const android = await login({
      "Sec-Fetch-Site": "cross-site",
      Origin: "http://127.0.0.1:3000",
      "X-Client": "android",
    });
    assert.equal(android.res.status, 200, String(android.json.error || "android login"));
    assert.equal(android.json.token, undefined);
    assert.equal(JSON.stringify(android.json).includes(credentialOf(android.res)), false);

    const web = await login({ "Sec-Fetch-Site": "same-origin", "X-Client": "web" });
    assert.equal(web.res.status, 200);
    assert.equal(web.json.token, undefined);
  });

  it("omits token on browser demo-login, OTP verify, and OAuth JSON", async () => {
    process.env.DEMO_LOGIN_ENABLED = "true";
    const demoBrowser = await postJson("/api/auth/demo-login", {}, { "Sec-Fetch-Site": "same-origin" });
    assert.equal(demoBrowser.res.status, 200, String(demoBrowser.json.error || "demo browser"));
    assert.equal(demoBrowser.json.token, undefined);
    assert.equal(JSON.stringify(demoBrowser.json).includes(credentialOf(demoBrowser.res)), false);
    const demoNative = await postJson("/api/auth/demo-login", {}, { "X-Client": "native" });
    assert.equal(demoNative.res.status, 200, String(demoNative.json.error || "demo native"));
    assert.equal(demoNative.json.token, credentialOf(demoNative.res));

    const seeded = await login();
    const user = seeded.json.user as { id?: string; email?: string; phone?: string };
    assert.ok(user.id);
    const verificationId = `otp-native-${Date.now().toString(36)}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, '112233', 'login', ?, ?, ?)`
      )
      .run(
        verificationId,
        user.phone || "+91 98234 55667",
        user.email,
        JSON.stringify({ userId: user.id, email: user.email }),
        new Date().toISOString(),
        expiresAt
      );
    const otpBrowser = await postJson(
      "/api/auth/whatsapp/verify-otp",
      { verificationId, otp: "112233" },
      { "Sec-Fetch-Site": "same-origin" }
    );
    assert.equal(otpBrowser.res.status, 200, String(otpBrowser.json.error || "otp browser"));
    assert.equal(otpBrowser.json.token, undefined);
    assert.equal(JSON.stringify(otpBrowser.json).includes(credentialOf(otpBrowser.res)), false);

    const verificationIdIos = `otp-ios-${Date.now().toString(36)}`;
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, '445566', 'login', ?, ?, ?)`
      )
      .run(
        verificationIdIos,
        user.phone || "+91 98234 55667",
        user.email,
        JSON.stringify({ userId: user.id, email: user.email }),
        new Date().toISOString(),
        expiresAt
      );
    const otpIos = await postJson(
      "/api/auth/whatsapp/verify-otp",
      { verificationId: verificationIdIos, otp: "445566" },
      { Origin: "http://127.0.0.1:3000", "X-Client": "ios" }
    );
    assert.equal(otpIos.res.status, 200, String(otpIos.json.error || "otp ios"));
    assert.equal(otpIos.json.token, credentialOf(otpIos.res));

    const oauthBrowser = await postJson(
      "/api/auth/oauth",
      { provider: "google", profile: { email: "doctor@lumera.me", name: "Doctor" }, skipOtp: true },
      { "Sec-Fetch-Site": "same-origin" }
    );
    assert.equal(oauthBrowser.res.status, 200, String(oauthBrowser.json.error || "oauth browser"));
    assert.equal(oauthBrowser.json.requiresOtp, false);
    assert.equal(oauthBrowser.json.token, undefined);
    assert.equal(JSON.stringify(oauthBrowser.json).includes(credentialOf(oauthBrowser.res)), false);

    const oauthAndroid = await postJson(
      "/api/auth/oauth",
      { provider: "google", profile: { email: "doctor@lumera.me", name: "Doctor" }, skipOtp: true },
      { Origin: "http://127.0.0.1:3000", "X-Client": "android" }
    );
    assert.equal(oauthAndroid.res.status, 200, String(oauthAndroid.json.error || "oauth android"));
    assert.equal(oauthAndroid.json.token, credentialOf(oauthAndroid.res));

    const callback = await fetch(`http://127.0.0.1:${port}/api/auth/google/callback?error=access_denied`, {
      redirect: "manual",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    const location = callback.headers.get("location") || "";
    assert.equal(callback.status, 302);
    assert.match(location, /oauth=google/);
    assert.doesNotMatch(location, /[?&]token=/);
    assert.equal((await callback.text()).includes("eyJ"), false);
  });

  it("rejects Bearer and X-Session-Token from browsers and accepts them for native clients", async () => {
    const issued = await login();
    const token = String(issued.json.token || "");
    assert.ok(token);
    const packed = issuedSession(setCookieLines(issued.res));
    const csrf = unpackHostSession(packed).csrf;
    assert.ok(csrf);
    assert.notEqual(csrf, "not-the-secret");

    const browserBearer = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(browserBearer.status, 401);

    const originBearer = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "http://127.0.0.1:3000" },
    });
    assert.equal(originBearer.status, 401);

    const nullOrigin = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "null" },
    });
    assert.equal(nullOrigin.status, 401);

    const headerToken = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { "X-Session-Token": token, "Sec-Fetch-Site": "none" },
    });
    assert.equal(headerToken.status, 401);

    const nativeBearer = await fetch(`http://127.0.0.1:${port}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const nativeJson = (await nativeBearer.json()) as { user?: { email?: string } | null; token?: unknown };
    assert.equal(nativeBearer.status, 200);
    assert.equal(nativeJson.user?.email, "doctor@lumera.me");
    assert.equal(nativeJson.token, undefined);
    assert.equal(JSON.stringify(nativeJson).includes(token), false);

    const iosSpoof = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: {
        "X-Session-Token": token,
        Origin: "http://127.0.0.1:3000",
        "Sec-Fetch-Site": "cross-site",
        "X-Client": "ios",
      },
    });
    assert.equal(iosSpoof.status, 401);

    const ios = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: {
        "X-Session-Token": token,
        Origin: "http://127.0.0.1:3000",
        "X-Client": "ios",
      },
    });
    assert.equal(ios.status, 200, await ios.clone().text());

    const cookieAndBearer = await fetch(`http://127.0.0.1:${port}/api/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        cookie: `__session=${encodeURIComponent(packed)}`,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const cookieJson = (await cookieAndBearer.json()) as { user?: { email?: string } | null; token?: unknown };
    assert.equal(cookieAndBearer.status, 200);
    assert.equal(cookieJson.user?.email, "doctor@lumera.me");
    assert.equal(cookieJson.token, undefined);

    const csrfBypass = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        cookie: `__session=${encodeURIComponent(packed)}`,
        "x-csrf-token": "not-the-secret",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const csrfJson = (await csrfBypass.json()) as { code?: string };
    assert.equal(csrfBypass.status, 403);
    assert.equal(csrfJson.code, undefined);
    assert.equal(setCookieLines(csrfBypass).length, 0);

    const stillValid = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(stillValid.status, 200);

    const browserMarkedLogout = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Sec-Fetch-Site": "same-origin",
        "X-Client": "mobile",
      },
    });
    assert.equal(browserMarkedLogout.status, 200);
    const bearerStillValid = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(bearerStillValid.status, 200);

    const nativeLogout = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Client": "mobile" },
    });
    assert.equal(nativeLogout.status, 200);
    const revoked = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}`, "X-Client": "android" },
    });
    assert.equal(revoked.status, 401);
  });

  it("keeps production CORS closed and still serves Android and iOS that send X-Client", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://www.mylumera.in";
    try {
      const noMetadata = await login({ "X-Client": "mobile" });
      assert.equal(noMetadata.res.status, 403);
      assert.match(String(noMetadata.json.error || ""), /origin/i);
      assert.equal(noMetadata.json.token, undefined);

      const browser = await login({ "Sec-Fetch-Site": "same-origin" });
      assert.equal(browser.res.status, 200, String(browser.json.error || "prod browser login"));
      assert.equal(browser.json.token, undefined);
      assert.equal(JSON.stringify(browser.json).includes(credentialOf(browser.res)), false);

      const android = await login({ "Sec-Fetch-Site": "same-origin", "X-Client": "android" });
      assert.equal(android.res.status, 200, String(android.json.error || "prod android login"));
      assert.equal(android.json.token, undefined);
      assert.equal(JSON.stringify(android.json).includes(credentialOf(android.res)), false);

      const ios = await login({ Origin: "https://www.mylumera.in", "X-Client": "ios" });
      assert.equal(ios.res.status, 200, String(ios.json.error || "prod ios login"));
      const token = String(ios.json.token || "");
      assert.equal(token, credentialOf(ios.res));

      const rejected = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
        headers: { Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "same-origin" },
      });
      assert.equal(rejected.status, 401);

      const markedBrowser = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
        headers: { Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "same-origin", "X-Client": "android" },
      });
      assert.equal(markedBrowser.status, 401);

      const allowed = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
        headers: { Authorization: `Bearer ${token}`, Origin: "https://www.mylumera.in", "X-Client": "android" },
      });
      assert.equal(allowed.status, 200);

      const navigation = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
        headers: { "X-Session-Token": token, "Sec-Fetch-Site": "none" },
      });
      assert.equal(navigation.status, 401);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = prevOrigins;
    }
  });

  it("same-origin with X-Client mobile returns no token and does not authenticate Bearer", async () => {
    const browser = { "Sec-Fetch-Site": "same-origin", "X-Client": "mobile" };

    const loggedIn = await login(browser);
    assert.equal(loggedIn.res.status, 200, String(loggedIn.json.error || "login"));
    const packed = issuedSession(setCookieLines(loggedIn.res));
    const session = unpackHostSession(packed);
    assert.equal(loggedIn.json.token, undefined);
    assert.equal(JSON.stringify(loggedIn.json).includes(session.credential), false);

    const userRow = getDb().prepare("SELECT id, tenant_id FROM users WHERE email = ?").get("doctor@lumera.me") as {
      id: string;
      tenant_id: string;
    };
    const userBefore = getDb()
      .prepare(
        "SELECT onboarding_completed, practice_type, specialty, pack_id, name, clinic_name, role FROM users WHERE id = ?"
      )
      .get(userRow.id) as {
      onboarding_completed: number | null;
      practice_type: string | null;
      specialty: string | null;
      pack_id: string | null;
      name: string | null;
      clinic_name: string | null;
      role: string | null;
    };
    const tenantBefore = userRow.tenant_id
      ? (getDb()
          .prepare("SELECT name, specialty, address, city, practice_settings FROM tenants WHERE id = ?")
          .get(userRow.tenant_id) as {
          name: string | null;
          specialty: string | null;
          address: string | null;
          city: string | null;
          practice_settings: string | null;
        } | undefined)
      : undefined;
    try {
      const onboard = await postJson(
        "/api/auth/complete-onboarding",
        {},
        {
          ...browser,
          cookie: `__session=${encodeURIComponent(packed)}`,
          "x-csrf-token": String(loggedIn.json.csrfToken || session.csrf),
        }
      );
      assert.equal(onboard.res.status, 200, String(onboard.json.error || "onboarding"));
      const onboarded = unpackHostSession(issuedSession(setCookieLines(onboard.res)));
      assert.equal(onboard.json.token, undefined);
      assert.equal(JSON.stringify(onboard.json).includes(onboarded.credential), false);
    } finally {
      getDb()
        .prepare(
          `UPDATE users
           SET onboarding_completed = ?, practice_type = ?, specialty = ?, pack_id = ?, name = ?, clinic_name = ?, role = ?
           WHERE id = ?`
        )
        .run(
          userBefore.onboarding_completed,
          userBefore.practice_type,
          userBefore.specialty,
          userBefore.pack_id,
          userBefore.name,
          userBefore.clinic_name,
          userBefore.role,
          userRow.id
        );
      if (tenantBefore && userRow.tenant_id) {
        getDb()
          .prepare(
            `UPDATE tenants SET name = ?, specialty = ?, address = ?, city = ?, practice_settings = ? WHERE id = ?`
          )
          .run(
            tenantBefore.name,
            tenantBefore.specialty,
            tenantBefore.address,
            tenantBefore.city,
            tenantBefore.practice_settings,
            userRow.tenant_id
          );
      }
    }

    const oauth = await postJson(
      "/api/auth/oauth",
      { provider: "google", profile: { email: "doctor@lumera.me", name: "Doctor" }, skipOtp: true },
      browser
    );
    assert.equal(oauth.res.status, 200, String(oauth.json.error || "oauth"));
    assert.equal(oauth.json.token, undefined);
    assert.equal(JSON.stringify(oauth.json).includes(credentialOf(oauth.res)), false);

    const native = await login();
    const token = String(native.json.token || "");
    assert.ok(token);
    const bearer = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "same-origin", "X-Client": "mobile" },
    });
    assert.equal(bearer.status, 401);
    const sessionHeader = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { "X-Session-Token": token, "Sec-Fetch-Site": "same-origin", "X-Client": "mobile" },
    });
    assert.equal(sessionHeader.status, 401);
    const stillNative = await fetch(`http://127.0.0.1:${port}/api/tenant/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(stillNative.status, 200);
  });

  it("does not put the session JWT on a raw token field in the API router", () => {
    const src = fs.readFileSync(path.join(root, "server/api.ts"), "utf8");
    assert.equal(src.includes("token: jwtToken"), false);
    assert.match(src, /withSessionCredential/);
    assert.match(src, /clientMayUseSessionToken/);
  });
});
