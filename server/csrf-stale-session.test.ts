import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { apiFetch, clearRememberedCsrfToken } from "../src/api/http.ts";
import { createApiRouter } from "./api.ts";
import { ensureDemoWorkspaceTenants } from "./demo-workspace-tenants.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  CSRF_REFRESHED_CODE,
  attachHttpSecurity,
  cookieDomainsToExpire,
  cookiesForwardedByFirebaseHosting,
  csrfProtectionMiddleware,
  csrfShouldReject,
  packHostSession,
  refreshSessionExpiryLines,
  resetAuthRateLimitStore,
  selectHostSession,
  sessionCookieExpiryLines,
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
      // Partitioned clears a CHIPS cookie only. It must not drop the Lax __session.
      if (attr.includes("partitioned")) continue;
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

  beforeEach(() => {
    clearRememberedCsrfToken();
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

      const stripped = await previousFetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": "from-lumera-csrf",
        },
        body: "{}",
      });
      const strippedJson = (await stripped.json()) as { code?: string; csrfToken?: string };
      const strippedCookies = typeof stripped.headers.getSetCookie === "function" ? stripped.headers.getSetCookie() : [];
      assert.equal(stripped.status, 403);
      assert.equal(strippedJson.code, CSRF_REFRESHED_CODE);
      assert.ok(strippedJson.csrfToken);
      const issued = strippedCookies.find((line) => /^__session=[^;]/.test(line) && !/max-age=0/i.test(line));
      assert.ok(issued, "refresh must set __session when the token arrived without one");
      assert.match(issued, /SameSite=Lax/i);
      assert.doesNotMatch(issued, /Partitioned|SameSite=None/i);
      assert.equal(strippedCookies.some((line) => /partitioned/i.test(line) && !/max-age=0/i.test(line)), false);

      const crossStripped = await previousFetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
          "X-CSRF-Token": "from-lumera-csrf",
        },
        body: "{}",
      });
      const crossJson = (await crossStripped.json()) as { code?: string };
      const crossCookies = typeof crossStripped.headers.getSetCookie === "function" ? crossStripped.headers.getSetCookie() : [];
      assert.equal(crossStripped.status, 403);
      assert.equal(crossJson.code, undefined);
      assert.equal(crossCookies.length, 0);
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

  it("picks the __session whose csrf matches the header, not only the last cookie", () => {
    const older = packHostSession("anon.older", "older-csrf");
    const newer = packHostSession("anon.newer", "newer-csrf");
    const header = `__session=${encodeURIComponent(older)}; __session=${encodeURIComponent(newer)}`;
    assert.equal(selectHostSession(header, "older-csrf"), older);
    assert.equal(selectHostSession(header, "newer-csrf"), newer);
    assert.equal(selectHostSession(header, "neither"), newer);
    const matchesOlder = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: { cookie: header, "x-csrf-token": "older-csrf" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(matchesOlder), false);
    const matchesNeither = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: { cookie: header, "x-csrf-token": "nope" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(matchesNeither), true);

    const tokenWithoutSession = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: { "x-csrf-token": "from-lumera-csrf" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(tokenWithoutSession), true);
    const barePost = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: {},
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(barePost), false);
    const directCloudRun = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login",
      headers: { cookie: "lumera_sid=abc.def; lumera_csrf=token-1", "x-csrf-token": "token-1" },
    } as unknown as express.Request;
    assert.equal(csrfShouldReject(directCloudRun), false);
  });

  it("expiry lines cover Domain and Path variants of the allowlisted host only", () => {
    const env = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://www.mylumera.in" } as NodeJS.ProcessEnv;
    assert.deepEqual(cookieDomainsToExpire("www.mylumera.in"), [
      "www.mylumera.in",
      ".www.mylumera.in",
      "mylumera.in",
      ".mylumera.in",
    ]);
    assert.deepEqual(cookieDomainsToExpire("localhost"), []);
    assert.deepEqual(cookieDomainsToExpire("127.0.0.1"), []);
    const lines = refreshSessionExpiryLines(env);
    const clears = (name: string, path: "/" | "/api", domain?: string) =>
      lines.some((line) => {
        if (!line.toLowerCase().startsWith(`${name}=`)) return false;
        if (!/max-age=0/i.test(line)) return false;
        const pathOk = path === "/" ? /path=\/(?:;|$)/i.test(line) : /path=\/api(?:;|$)/i.test(line);
        if (!pathOk) return false;
        if (!domain) return !/domain=/i.test(line);
        return new RegExp(`domain=${domain.replace(/\./g, "\\.")}(?:;|$)`, "i").test(line);
      });
    for (const name of ["__session", "lumera_csrf"]) {
      for (const path of ["/", "/api"] as const) {
        assert.equal(clears(name, path), true, `host-only ${name} ${path}`);
        assert.equal(clears(name, path, ".mylumera.in"), true, `Domain=.mylumera.in ${name} ${path}`);
        assert.equal(clears(name, path, "mylumera.in"), true, `Domain=mylumera.in ${name} ${path}`);
      }
    }
    assert.equal(lines.some((line) => /path=\/login(?:;|$)/i.test(line) || /path=\/api\/auth(?:;|$)/i.test(line)), false);
    assert.equal(lines.some((line) => /partitioned/i.test(line) && !/max-age=0/i.test(line)), false);
    for (const name of ["__session", "lumera_csrf"]) {
      assert.ok(
        lines.some((line) => line.startsWith(`${name}=`) && /partitioned/i.test(line) && /samesite=none/i.test(line) && /max-age=0/i.test(line)),
        `partitioned clear ${name}`
      );
    }
    assert.equal(lines.some((line) => /domain=\.in(?:;|$)/i.test(line)), false);
    assert.equal(lines.some((line) => /domain=evil/i.test(line)), false);
    const local = refreshSessionExpiryLines({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    assert.equal(local.some((line) => /domain=/i.test(line)), false);
    assert.ok(local.some((line) => line.startsWith("__session=") && /path=\/(?:;|$)/i.test(line)));
    assert.equal(sessionCookieExpiryLines({ NODE_ENV: "test" } as NodeJS.ProcessEnv).length, 0);
  });

  it("a Chrome jar with a Domain cookie and a stale lumera_csrf can still log in", async () => {
    resetAuthRateLimitStore();
    const previousOrigins = process.env.ALLOWED_ORIGINS;
    const previousAppUrl = process.env.APP_URL;
    process.env.ALLOWED_ORIGINS = "https://www.mylumera.in";
    process.env.APP_URL = "https://www.mylumera.in";

    type JarCookie = {
      name: string;
      value: string;
      domain: string | null;
      path: string;
      httpOnly: boolean;
      created: number;
    };
    const host = "www.mylumera.in";
    const loginPath = "/api/auth/login";
    let clock = 3;
    const jar: JarCookie[] = [];
    const matches = (cookie: JarCookie) => {
      if (cookie.path !== "/" && !loginPath.startsWith(cookie.path)) return false;
      if (!cookie.domain) return true;
      const domain = cookie.domain.replace(/^\./, "");
      return host === domain || host.endsWith(`.${domain}`);
    };
    const ordered = (includeHttpOnly: boolean) =>
      jar
        .filter((cookie) => matches(cookie) && (includeHttpOnly || !cookie.httpOnly))
        .sort((a, b) => b.path.length - a.path.length || a.created - b.created);
    const cookieHeader = () => ordered(true).map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join("; ");
    const documentCookie = () => ordered(false).map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join("; ");
    const apply = (setCookies: string[]) => {
      for (const line of setCookies) {
        const [pair, ...attrs] = line.split(";").map((part) => part.trim());
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq);
        const rawValue = pair.slice(eq + 1);
        const attrMap = new Map<string, string>();
        for (const attr of attrs) {
          const idx = attr.indexOf("=");
          if (idx === -1) attrMap.set(attr.toLowerCase(), "");
          else attrMap.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
        }
        if (attrMap.has("partitioned")) continue;
        const domain = attrMap.has("domain") ? (attrMap.get("domain") || "").toLowerCase() : null;
        const path = attrMap.get("path") || "/";
        const httpOnly = attrMap.has("httponly");
        const same = (cookie: JarCookie) =>
          cookie.name === name &&
          cookie.path === path &&
          ((domain == null && cookie.domain == null) ||
            (domain != null && (cookie.domain || "").replace(/^\./, "") === domain.replace(/^\./, "")));
        for (let i = jar.length - 1; i >= 0; i--) if (same(jar[i])) jar.splice(i, 1);
        if (attrMap.get("max-age") === "0" || rawValue.length === 0) continue;
        clock += 1;
        let value = rawValue;
        try {
          value = decodeURIComponent(rawValue);
        } catch {
          /* keep raw */
        }
        jar.push({ name, value, domain, path, httpOnly, created: clock });
      }
    };
    const remember = (cookie: JarCookie) => jar.push(cookie);

    const storage = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const previousLocal = globalThis.localStorage;
    const previousSession = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage, configurable: true });

    try {
      const primed = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
      });
      const primedCookies = typeof primed.headers.getSetCookie === "function" ? primed.headers.getSetCookie() : [];
      const primedJson = (await primed.json()) as { error?: string };
      assert.equal(primed.status, 200, primedJson.error || "prime login");
      const primedSession = primedCookies.find((line) => /^__session=[^;]/.test(line) && !/max-age=0/i.test(line));
      assert.ok(primedSession);
      const primedValue = decodeURIComponent(primedSession.split(";")[0].slice("__session=".length));
      const primedCsrf = unpackHostSession(primedValue).csrf;
      assert.ok(primedCsrf);

      const staleSecret = "domain-cookie-csrf";
      assert.notEqual(staleSecret, primedCsrf);
      remember({
        name: "__session",
        value: packHostSession("anon.domain-stale", staleSecret),
        domain: ".mylumera.in",
        path: "/",
        httpOnly: true,
        created: 1,
      });
      remember({
        name: "lumera_csrf",
        value: staleSecret,
        domain: ".mylumera.in",
        path: "/",
        httpOnly: false,
        created: 1,
      });
      remember({
        name: "__session",
        value: packHostSession("anon.path-stale", "path-csrf"),
        domain: null,
        path: "/api",
        httpOnly: true,
        created: 2,
      });
      remember({
        name: "__session",
        value: primedValue,
        domain: null,
        path: "/",
        httpOnly: true,
        created: 3,
      });
      remember({
        name: "lumera_csrf",
        value: "host-only-newer-csrf",
        domain: null,
        path: "/",
        httpOnly: false,
        created: 3,
      });
      storage.set("lumera_session_token", "storage-token-must-not-be-sent");
      storage.set("lumera_csrf", "storage-csrf-must-not-be-sent");

      const seen: Array<{ cookie: string; csrf: string; body: string; setCookie: string[] }> = [];
      globalThis.fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        const cookie = cookieHeader();
        if (cookie) headers.set("cookie", cookie);
        const bodyText = typeof init?.body === "string" ? init.body : "";
        const res = await previousFetch(input, { ...init, headers, body: init?.body });
        const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
        apply(setCookie);
        seen.push({ cookie, csrf: headers.get("x-csrf-token") || "", body: bodyText, setCookie });
        return res;
      };
      setDocumentCookie(documentCookie());

      const loggedIn = await apiFetch<{ user?: { email?: string } }>(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
      });
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      assert.equal(seen.length, 1, "matching duplicate must pass CSRF without a refresh retry");
      assert.equal(seen[0].csrf, staleSecret);
      assert.notEqual(seen[0].csrf, "storage-csrf-must-not-be-sent");
      assert.match(seen[0].body, /doctor@lumera\.me/);
      assert.match(seen[0].cookie, /__session=.*__session=/);
      const clears = seen[0].setCookie.filter((line) => /max-age=0/i.test(line));
      assert.ok(clears.some((line) => /domain=\.mylumera\.in/i.test(line) && line.startsWith("__session=")));
      assert.ok(clears.some((line) => /domain=mylumera\.in/i.test(line) && line.startsWith("lumera_csrf=")));
      assert.ok(clears.some((line) => /path=\/api(?:;|$)/i.test(line) && line.startsWith("__session=")));
      assert.equal(
        jar.some((cookie) => cookie.name === "__session" && cookie.domain === ".mylumera.in"),
        false
      );
      assert.equal(
        jar.some((cookie) => cookie.name === "__session" && cookie.path === "/api"),
        false
      );

      const me = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
        headers: { cookie: cookiesForwardedByFirebaseHosting(cookieHeader()) },
      });
      const meJson = (await me.json()) as { user?: { email?: string } | null };
      assert.equal(me.status, 200);
      assert.equal(meJson.user?.email, "doctor@lumera.me");
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
      if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previousOrigins;
      if (previousAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousAppUrl;
      if (previousLocal === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", { value: previousLocal, configurable: true });
      if (previousSession === undefined) delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
      else Object.defineProperty(globalThis, "sessionStorage", { value: previousSession, configurable: true });
    }
  });

  it("refresh deletes a Domain cookie the host-only clear cannot, then the retry logs in", async () => {
    resetAuthRateLimitStore();
    const previousOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://www.mylumera.in";
    const host = "www.mylumera.in";
    type JarCookie = { name: string; value: string; domain: string | null; path: string; httpOnly: boolean; created: number };
    let clock = 1;
    const jar: JarCookie[] = [
      {
        name: "__session",
        value: packHostSession("anon.legacy", "legacy-secret"),
        domain: ".mylumera.in",
        path: "/",
        httpOnly: true,
        created: 1,
      },
      {
        name: "lumera_csrf",
        value: "readable-stale-not-the-secret",
        domain: ".mylumera.in",
        path: "/",
        httpOnly: false,
        created: 1,
      },
    ];
    const apply = (setCookies: string[]) => {
      for (const line of setCookies) {
        const [pair, ...attrs] = line.split(";").map((part) => part.trim());
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq);
        const rawValue = pair.slice(eq + 1);
        const attrMap = new Map<string, string>();
        for (const attr of attrs) {
          const idx = attr.indexOf("=");
          if (idx === -1) attrMap.set(attr.toLowerCase(), "");
          else attrMap.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
        }
        if (attrMap.has("partitioned")) continue;
        const domain = attrMap.has("domain") ? (attrMap.get("domain") || "").toLowerCase() : null;
        const path = attrMap.get("path") || "/";
        const same = (cookie: JarCookie) =>
          cookie.name === name &&
          cookie.path === path &&
          ((domain == null && cookie.domain == null) ||
            (domain != null && (cookie.domain || "").replace(/^\./, "") === domain.replace(/^\./, "")));
        for (let i = jar.length - 1; i >= 0; i--) if (same(jar[i])) jar.splice(i, 1);
        if (attrMap.get("max-age") === "0" || rawValue.length === 0) continue;
        clock += 1;
        let value = rawValue;
        try {
          value = decodeURIComponent(rawValue);
        } catch {
          /* keep */
        }
        jar.push({ name, value, domain, path, httpOnly: attrMap.has("httponly"), created: clock });
      }
    };
    const headerFor = (target: string) =>
      jar
        .filter((cookie) => {
          if (cookie.path !== "/" && !target.startsWith(cookie.path)) return false;
          if (!cookie.domain) return true;
          const domain = cookie.domain.replace(/^\./, "");
          return host === domain || host.endsWith(`.${domain}`);
        })
        .sort((a, b) => b.path.length - a.path.length || a.created - b.created)
        .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
        .join("; ");

    const bodies: string[] = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const target = String(input);
      headers.set("cookie", headerFor(new URL(target).pathname));
      if (typeof init?.body === "string") bodies.push(init.body);
      const res = await previousFetch(input, { ...init, headers });
      const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      apply(setCookie);
      return res;
    };
    setDocumentCookie("lumera_csrf=readable-stale-not-the-secret");
    try {
      const loggedIn = await apiFetch<{ user?: { email?: string } }>(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
      });
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
      assert.equal(
        jar.some((cookie) => cookie.domain === ".mylumera.in"),
        false,
        "Domain=.mylumera.in cookies must be expired on refresh"
      );
      assert.ok(jar.some((cookie) => cookie.name === "__session" && cookie.domain == null && cookie.value.includes("~")));
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
      if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previousOrigins;
    }
  });

  it("duplicate __session and lumera_csrf cookies log in after one retry", async () => {
    resetAuthRateLimitStore();
    const previousOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://www.mylumera.in";
    const host = "www.mylumera.in";
    type JarCookie = { name: string; value: string; domain: string | null; path: string; httpOnly: boolean; created: number };
    let clock = 4;
    const jar: JarCookie[] = [
      {
        name: "__session",
        value: packHostSession("anon.domain-old", "secret-domain"),
        domain: ".mylumera.in",
        path: "/",
        httpOnly: true,
        created: 1,
      },
      {
        name: "__session",
        value: packHostSession("anon.path-old", "secret-path"),
        domain: null,
        path: "/api",
        httpOnly: true,
        created: 2,
      },
      {
        name: "lumera_csrf",
        value: "readable-stale-first",
        domain: ".mylumera.in",
        path: "/",
        httpOnly: false,
        created: 1,
      },
      {
        name: "lumera_csrf",
        value: "readable-stale-second",
        domain: null,
        path: "/",
        httpOnly: false,
        created: 3,
      },
    ];
    const apply = (setCookies: string[]) => {
      for (const line of setCookies) {
        const [pair, ...attrs] = line.split(";").map((part) => part.trim());
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq);
        const rawValue = pair.slice(eq + 1);
        const attrMap = new Map<string, string>();
        for (const attr of attrs) {
          const idx = attr.indexOf("=");
          if (idx === -1) attrMap.set(attr.toLowerCase(), "");
          else attrMap.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
        }
        if (attrMap.has("partitioned")) continue;
        const domain = attrMap.has("domain") ? (attrMap.get("domain") || "").toLowerCase() : null;
        const path = attrMap.get("path") || "/";
        const same = (cookie: JarCookie) =>
          cookie.name === name &&
          cookie.path === path &&
          ((domain == null && cookie.domain == null) ||
            (domain != null && (cookie.domain || "").replace(/^\./, "") === domain.replace(/^\./, "")));
        for (let i = jar.length - 1; i >= 0; i--) if (same(jar[i])) jar.splice(i, 1);
        if (attrMap.get("max-age") === "0" || rawValue.length === 0) continue;
        clock += 1;
        let value = rawValue;
        try {
          value = decodeURIComponent(rawValue);
        } catch {
          /* keep */
        }
        jar.push({ name, value, domain, path, httpOnly: attrMap.has("httponly"), created: clock });
      }
    };
    const headerFor = () =>
      jar
        .filter((cookie) => {
          if (cookie.path !== "/" && !"/api/auth/login".startsWith(cookie.path)) return false;
          if (!cookie.domain) return true;
          const domain = cookie.domain.replace(/^\./, "");
          return host === domain || host.endsWith(`.${domain}`);
        })
        .sort((a, b) => b.path.length - a.path.length || a.created - b.created)
        .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
        .join("; ");
    const documentCookie = () =>
      jar
        .filter((cookie) => !cookie.httpOnly)
        .sort((a, b) => a.created - b.created)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

    const seen: Array<{ cookie: string; csrf: string; setCookie: string[] }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const cookie = headerFor();
      headers.set("cookie", cookie);
      const res = await previousFetch(input, { ...init, headers });
      const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      apply(setCookie);
      seen.push({ cookie, csrf: headers.get("x-csrf-token") || "", setCookie });
      return res;
    };
    setDocumentCookie(documentCookie());
    try {
      const loggedIn = await apiFetch<{ user?: { email?: string } }>(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
      });
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      assert.equal(seen.length, 2);
      assert.equal((seen[0].cookie.match(/__session=/g) || []).length, 2);
      assert.equal((seen[0].cookie.match(/lumera_csrf=/g) || []).length, 2);
      assert.equal(seen[0].csrf, "readable-stale-first");
      const clears = seen[0].setCookie.filter((line) => /max-age=0/i.test(line));
      for (const name of ["__session", "lumera_csrf"]) {
        for (const path of ["/", "/api"] as const) {
          const pathRe = path === "/" ? /path=\/(?:;|$)/i : /path=\/api(?:;|$)/i;
          assert.ok(
            clears.some((line) => line.startsWith(`${name}=`) && pathRe.test(line) && !/domain=/i.test(line)),
            `host-only ${name} ${path}`
          );
          assert.ok(
            clears.some((line) => line.startsWith(`${name}=`) && pathRe.test(line) && /domain=\.mylumera\.in(?:;|$)/i.test(line)),
            `Domain=.mylumera.in ${name} ${path}`
          );
          assert.ok(
            clears.some(
              (line) =>
                line.startsWith(`${name}=`) &&
                pathRe.test(line) &&
                /domain=mylumera\.in(?:;|$)/i.test(line) &&
                !/domain=\.mylumera\.in/i.test(line)
            ),
            `Domain=mylumera.in ${name} ${path}`
          );
        }
      }
      assert.notEqual(seen[1].csrf, "readable-stale-first");
      assert.equal((seen[1].cookie.match(/__session=/g) || []).length, 1);
      assert.doesNotMatch(seen[1].cookie, /secret-domain|secret-path|readable-stale/);
      const me = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
        headers: { cookie: cookiesForwardedByFirebaseHosting(headerFor()) },
      });
      const meJson = (await me.json()) as { user?: { email?: string } | null };
      assert.equal(meJson.user?.email, "doctor@lumera.me");
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
      if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previousOrigins;
    }
  });

  it("Firebase-stripped bootstrap still logs in with only __session", async () => {
    resetAuthRateLimitStore();
    clearRememberedCsrfToken();
    type JarCookie = {
      name: string;
      value: string;
      path: string;
      httpOnly: boolean;
      partitioned: boolean;
      sameSite: string;
    };
    const jar: JarCookie[] = [
      { name: "lumera_csrf", value: "partitioned-readable", path: "/", httpOnly: false, partitioned: true, sameSite: "None" },
      { name: "lumera_sid", value: "partitioned-sid", path: "/", httpOnly: true, partitioned: true, sameSite: "None" },
      { name: "lumera_csrf", value: "lax-readable", path: "/", httpOnly: false, partitioned: false, sameSite: "Lax" },
      { name: "lumera_sid", value: "lax-sid", path: "/", httpOnly: true, partitioned: false, sameSite: "Lax" },
    ];
    const apply = (setCookies: string[]) => {
      for (const line of setCookies) {
        const [pair, ...attrs] = line.split(";").map((part) => part.trim());
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq);
        const rawValue = pair.slice(eq + 1);
        const attrMap = new Map<string, string>();
        for (const attr of attrs) {
          const idx = attr.indexOf("=");
          if (idx === -1) attrMap.set(attr.toLowerCase(), "");
          else attrMap.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
        }
        const partitioned = attrMap.has("partitioned");
        const same = (cookie: JarCookie) => cookie.name === name && cookie.path === (attrMap.get("path") || "/") && cookie.partitioned === partitioned;
        for (let i = jar.length - 1; i >= 0; i--) if (same(jar[i])) jar.splice(i, 1);
        if (attrMap.get("max-age") === "0" || rawValue.length === 0) continue;
        let value = rawValue;
        try {
          value = decodeURIComponent(rawValue);
        } catch {
          /* keep */
        }
        jar.push({
          name,
          value,
          path: attrMap.get("path") || "/",
          httpOnly: attrMap.has("httponly"),
          partitioned,
          sameSite: attrMap.get("samesite") || "",
        });
      }
    };
    const forwarded = () =>
      jar
        .filter((cookie) => cookie.name === "__session" && cookie.value)
        .map((cookie) => `__session=${encodeURIComponent(cookie.value)}`)
        .join("; ");
    const documentCookie = () =>
      jar
        .filter((cookie) => !cookie.httpOnly)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

    const seen: Array<{ path: string; cookie: string; csrf: string }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const cookie = forwarded();
      if (cookie) headers.set("cookie", cookie);
      else headers.delete("cookie");
      const res = await previousFetch(input, { ...init, headers });
      const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      apply(setCookie);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seen.push({ path: new URL(url).pathname, cookie, csrf: headers.get("x-csrf-token") || "" });
      return res;
    };
    setDocumentCookie(documentCookie());
    try {
      assert.equal(jar.some((cookie) => cookie.name === "__session"), false);
      const me = await apiFetch<{ user?: { email?: string } | null; csrfToken?: string }>(
        `http://127.0.0.1:${server.port}/api/auth/me`,
        { headers: { "Sec-Fetch-Site": "same-origin" } }
      );
      assert.equal(me.user ?? null, null);
      assert.ok(me.csrfToken);
      assert.equal(seen[0].path, "/api/auth/me");
      assert.equal(seen[0].cookie, "");
      assert.equal(seen[0].csrf, "partitioned-readable");
      const session = jar.find((cookie) => cookie.name === "__session" && !cookie.partitioned);
      assert.ok(session, "bootstrap must set a host-only __session");
      assert.match(session.value, /~/);
      assert.equal(unpackHostSession(session.value).csrf, me.csrfToken);
      assert.equal(session.sameSite.toLowerCase(), "lax");
      assert.equal(jar.some((cookie) => cookie.partitioned), false);
      assert.equal(jar.some((cookie) => cookie.sameSite.toLowerCase() === "none" && cookie.value), false);

      const loggedIn = await apiFetch<{ user?: { email?: string } }>(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" }),
      });
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      const login = seen.filter((entry) => entry.path === "/api/auth/login");
      assert.equal(login.length, 1);
      assert.match(login[0].cookie, /^__session=/);
      assert.doesNotMatch(login[0].cookie, /lumera_csrf|lumera_sid/);
      assert.equal(login[0].csrf, me.csrfToken);
      assert.notEqual(login[0].csrf, "partitioned-readable");
      assert.notEqual(login[0].csrf, "lax-readable");

      const after = await previousFetch(`http://127.0.0.1:${server.port}/api/auth/me`, {
        headers: { cookie: cookiesForwardedByFirebaseHosting(forwarded()) },
      });
      const afterJson = (await after.json()) as { user?: { email?: string } | null };
      assert.equal(afterJson.user?.email, "doctor@lumera.me");
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
      clearRememberedCsrfToken();
    }
  });

  it("apiFetch retries a stream body instead of throwing, and ignores storage", async () => {
    const bodies: string[] = [];
    const tokens: string[] = [];
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      tokens.push(headers.get("x-csrf-token") || "");
      if (init?.body instanceof ReadableStream) {
        bodies.push(await new Response(init.body).text());
      } else {
        bodies.push(typeof init?.body === "string" ? init.body : "");
      }
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: "CSRF token missing or invalid", code: CSRF_REFRESHED_CODE, csrfToken: "from-refresh" }),
          { status: 403, headers: { "Content-Type": "application/json", "X-CSRF-Token": "from-refresh" } }
        );
      }
      return new Response(JSON.stringify({ user: { email: "doctor@lumera.me" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const payload = JSON.stringify({ email: "doctor@lumera.me", password: "Lumera@2026" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const storage = new Map<string, string>([
      ["lumera_session_token", "from-local-storage"],
      ["lumera_csrf", "from-session-storage"],
    ]);
    const memoryStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const previousLocal = globalThis.localStorage;
    const previousSession = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage, configurable: true });
    setDocumentCookie("lumera_csrf=stale-from-cookie; lumera_csrf=second-cookie-not-used-on-retry");
    try {
      const loggedIn = await apiFetch<{ user?: { email?: string } }>("http://127.0.0.1/api/auth/login", {
        method: "POST",
        body: stream,
      });
      assert.equal(loggedIn.user?.email, "doctor@lumera.me");
      assert.equal(calls, 2);
      assert.equal(tokens[0], "stale-from-cookie");
      assert.notEqual(tokens[0], "from-local-storage");
      assert.notEqual(tokens[0], "from-session-storage");
      assert.equal(tokens[1], "from-refresh");
      assert.equal(bodies[0], payload);
      assert.equal(bodies[1], payload);
    } finally {
      globalThis.fetch = previousFetch;
      setDocumentCookie(null);
      if (previousLocal === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", { value: previousLocal, configurable: true });
      if (previousSession === undefined) delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
      else Object.defineProperty(globalThis, "sessionStorage", { value: previousSession, configurable: true });
    }
  });
});
