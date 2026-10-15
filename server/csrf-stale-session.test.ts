import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { apiFetch } from "../src/api/http.ts";
import { createApiRouter } from "./api.ts";
import { ensureDemoWorkspaceTenants } from "./demo-workspace-tenants.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  CSRF_REFRESHED_CODE,
  attachHttpSecurity,
  cookiesForwardedByFirebaseHosting,
  csrfProtectionMiddleware,
  packHostSession,
  resetAuthRateLimitStore,
  unpackHostSession,
} from "./http-security.ts";
import { startTestServer, type TestHttpServer } from "./test-http.ts";

/**
 * Browser jar for tests. Firebase Hosting forwards only `__session`, so the
 * Cookie header that hits the app is reduced the same way.
 */
function createHostingJar(initial: Record<string, string>) {
  const jar = new Map<string, string>(Object.entries(initial));
  const apply = (setCookies: string[]) => {
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(";").map((part) => part.trim());
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const attr = attrs.join(";").toLowerCase();
      if (attr.includes("max-age=0") || value.length === 0) jar.delete(name);
      else jar.set(name, value);
    }
  };
  const forwarded = () => cookiesForwardedByFirebaseHosting([...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
  return { apply, forwarded, jar };
}

describe("stale anonymous __session CSRF refresh", () => {
  let server: TestHttpServer;
  const previousFetch = globalThis.fetch;
  let previousDocument: Document | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-csrf-refresh";
    initDatabase();
    ensureDemoWorkspaceTenants(getDb());
    resetAuthRateLimitStore();
    server = await startTestServer((app) => {
      attachHttpSecurity(app);
      app.use("/api", createApiRouter());
    });
    previousDocument = globalThis.document;
  });

  after(async () => {
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      globalThis.document = previousDocument;
    }
    await server?.close();
  });

  function setDocumentCookie(cookie: string | null) {
    if (cookie == null) {
      delete (globalThis as { document?: Document }).document;
      return;
    }
    Object.defineProperty(globalThis, "document", {
      value: { cookie },
      configurable: true,
      writable: true,
    });
  }

  it("a stale pre-#126 __session cookie can still log in after one client retry", async () => {
    // Credential is a JWT this server will not accept (pre-#126 / rotated secret).
    // Packed as credential~csrf. The page still holds a different lumera_csrf.
    const staleCredential = jwt.sign(
      { userId: "pre-126-user", tenantId: "pre-126-tenant", email: "stale@pre126.example" },
      "pre-126-not-the-server-secret",
      { expiresIn: "7d" }
    );
    const staleSecret = "pre-126-csrf-secret";
    const browserCsrf = "pre-126-browser-csrf";
    assert.notEqual(staleSecret, browserCsrf);
    const hosting = createHostingJar({
      __session: encodeURIComponent(packHostSession(staleCredential, staleSecret)),
      lumera_sid: encodeURIComponent(staleCredential),
      lumera_csrf: encodeURIComponent(browserCsrf),
    });

    const seen: Array<{ status: number; cookie: string; csrf: string; setCookie: string[] }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const cookie = hosting.forwarded();
      if (cookie) headers.set("cookie", cookie);
      const res = await previousFetch(input, { ...init, headers });
      const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      hosting.apply(setCookie);
      seen.push({
        status: res.status,
        cookie,
        csrf: headers.get("x-csrf-token") || "",
        setCookie,
      });
      return res;
    };

    setDocumentCookie(`lumera_csrf=${browserCsrf}`);
    try {
      const loggedIn = await apiFetch<{ user?: { email?: string }; token?: string }>(
        `http://127.0.0.1:${server.port}/api/auth/login`,
        {
          method: "POST",
          headers: { "Sec-Fetch-Site": "same-origin" },
          body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
        }
      );
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      assert.equal(seen.length, 2);
      assert.equal(seen[0].status, 403);
      assert.equal(seen[0].csrf, browserCsrf);
      assert.match(seen[0].cookie, /^__session=/);
      assert.doesNotMatch(seen[0].cookie, /lumera_sid/);
      assert.doesNotMatch(seen[0].cookie, /lumera_csrf/);

      const refreshed = seen[0].setCookie.find((line) => /__session=[^;\s]/.test(line) && !/__session=;/.test(line) && !/max-age=0/i.test(line));
      assert.ok(refreshed, "anonymous CSRF failure must set a fresh __session");
      assert.match(refreshed, /HttpOnly/i);
      assert.match(refreshed, /Secure/i);
      assert.match(refreshed, /SameSite=Lax/i);
      assert.doesNotMatch(refreshed, /SameSite=None/i);
      const readable = seen[0].setCookie.find((line) => line.startsWith("lumera_csrf=") && !/max-age=0/i.test(line));
      assert.ok(readable);
      assert.doesNotMatch(readable, /HttpOnly/i);

      const issued = unpackHostSession(decodeURIComponent(refreshed.split(";")[0].slice("__session=".length)));
      assert.match(issued.credential, /^anon\./);
      assert.equal(seen[1].status, 200);
      assert.equal(seen[1].csrf, issued.csrf);
      assert.notEqual(seen[1].csrf, browserCsrf);
      assert.match(seen[1].cookie, /^__session=/);

      const me = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
        headers: { cookie: hosting.forwarded() },
      });
      const meJson = (await me.json()) as { user?: { email?: string } | null };
      assert.equal(me.status, 200);
      assert.equal(meJson.user?.email, "doctor@lumera.me");
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
    }
  });

  it("a cross-site request does not refresh CSRF or clear the session cookie", async () => {
    const stale = `__session=${encodeURIComponent(packHostSession("pre-126-stale-credential", "pre-126-csrf-secret"))}`;
    const env = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://www.mylumera.in" } as NodeJS.ProcessEnv;
    const app = express();
    app.use(express.json());
    app.use(csrfProtectionMiddleware(env));
    app.post("/api/auth/login", (_req, res) => res.json({ ok: true }));
    const srv = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => srv.once("listening", () => resolve()));
    const addr = srv.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;

    async function post(headers: Record<string, string>) {
      const res = await previousFetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: stale, ...headers },
        body: "{}",
      });
      const json = (await res.json()) as { error?: string; code?: string; csrfToken?: string };
      const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      return { status: res.status, json, cookies, csrfHeader: res.headers.get("x-csrf-token") };
    }

    try {
      const crossSite = await post({ "Sec-Fetch-Site": "cross-site" });
      assert.equal(crossSite.status, 403);
      assert.equal(crossSite.json.error, "CSRF token missing or invalid");
      assert.equal(crossSite.json.code, undefined);
      assert.equal(crossSite.json.csrfToken, undefined);
      assert.equal(crossSite.csrfHeader, null);
      assert.equal(crossSite.cookies.length, 0);

      const foreign = await post({ Origin: "https://evil.example" });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.json.error, "CSRF token missing or invalid");
      assert.equal(foreign.json.code, undefined);
      assert.equal(foreign.json.csrfToken, undefined);
      assert.equal(foreign.csrfHeader, null);
      assert.equal(foreign.cookies.length, 0);

      const both = await post({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" });
      assert.equal(both.status, 403);
      assert.equal(both.json.code, undefined);
      assert.equal(both.cookies.length, 0);
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("authenticated POST with a bad or missing CSRF token stays 403 and does not reissue", async () => {
    resetAuthRateLimitStore();
    const login = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
    });
    const setCookie = typeof login.headers.getSetCookie === "function" ? login.headers.getSetCookie() : [];
    const loginJson = (await login.json()) as { user?: { email?: string }; error?: string };
    assert.equal(login.status, 200, loginJson.error || "login");
    const jar = createHostingJar({});
    jar.apply(setCookie);
    const forwarded = jar.forwarded();
    assert.match(forwarded, /^__session=/);
    const packed = unpackHostSession(decodeURIComponent(forwarded.slice("__session=".length)));
    assert.ok(packed.csrf);

    async function mutate(headers: Record<string, string>) {
      const res = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/logout`, {
        method: "POST",
        headers,
      });
      const json = (await res.json()) as { error?: string; code?: string; csrfToken?: string };
      const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      return { status: res.status, json, cookies, csrfHeader: res.headers.get("x-csrf-token") };
    }

    const bad = await mutate({ cookie: forwarded, "x-csrf-token": "not-the-secret" });
    assert.equal(bad.status, 403);
    assert.equal(bad.json.error, "CSRF token missing or invalid");
    assert.equal(bad.json.code, undefined);
    assert.equal(bad.json.csrfToken, undefined);
    assert.equal(bad.csrfHeader, null);
    assert.equal(bad.cookies.length, 0);

    const missing = await mutate({ cookie: forwarded });
    assert.equal(missing.status, 403);
    assert.equal(missing.json.error, "CSRF token missing or invalid");
    assert.equal(missing.json.code, undefined);
    assert.equal(missing.json.csrfToken, undefined);
    assert.equal(missing.cookies.length, 0);

    const sid = jar.jar.get("lumera_sid") || "";
    assert.ok(sid);
    const masked = await mutate({
      cookie: `lumera_sid=${sid}; __session=${encodeURIComponent(packHostSession("pre-126-masking-credential", "other-secret"))}`,
      "x-csrf-token": "not-the-secret",
    });
    assert.equal(masked.status, 403);
    assert.equal(masked.json.code, undefined);
    assert.equal(masked.cookies.length, 0);

    const me = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
      headers: { cookie: forwarded },
    });
    const meJson = (await me.json()) as { user?: { email?: string } | null };
    assert.equal(me.status, 200);
    assert.equal(meJson.user?.email, "doctor@lumera.me");

    const sidMe = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
      headers: { cookie: `lumera_sid=${sid}` },
    });
    const sidJson = (await sidMe.json()) as { user?: { email?: string } | null };
    assert.equal(sidJson.user?.email, "doctor@lumera.me");

    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      headers.set("cookie", forwarded);
      return previousFetch(input, { ...init, headers });
    };
    setDocumentCookie("lumera_csrf=not-the-secret");
    try {
      await assert.rejects(
        () => apiFetch(`http://127.0.0.1:${server.port}/api/auth/logout`, { method: "POST" }),
        /CSRF token missing or invalid/
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
    }

    const still = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
      headers: { cookie: forwarded },
    });
    const stillJson = (await still.json()) as { user?: { email?: string } | null };
    assert.equal(stillJson.user?.email, "doctor@lumera.me");
  });

  it("apiFetch retries a CSRF refresh at most once", async () => {
    const tokens: string[] = [];
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      tokens.push(headers.get("x-csrf-token") || "");
      const body = JSON.stringify({
        error: "CSRF token missing or invalid",
        code: CSRF_REFRESHED_CODE,
        csrfToken: `refreshed-${calls}`,
      });
      return new Response(body, {
        status: 403,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": `refreshed-${calls}` },
      });
    };
    setDocumentCookie("lumera_csrf=stale-browser-csrf");
    try {
      await assert.rejects(
        () =>
          apiFetch("http://127.0.0.1/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: "a@b.c", password: "x" }),
          }),
        /CSRF token missing or invalid/
      );
      assert.equal(calls, 2);
      assert.equal(tokens[0], "stale-browser-csrf");
      assert.equal(tokens[1], "refreshed-1");
      assert.notEqual(tokens[1], "refreshed-2");
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
    }
  });
});
