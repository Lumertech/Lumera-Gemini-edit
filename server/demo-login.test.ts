import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiRouter } from "./api.ts";
import { attachUser } from "./auth.ts";
import { initDatabase } from "./db.ts";
import { AUTH_RATE_LIMITED_PATHS } from "./http-security.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("explicit demo login guard", () => {
  let port = 0;
  let server: Server | undefined;
  const prevFlag = process.env.DEMO_LOGIN_ENABLED;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-demo-login";
    }
    delete process.env.DEMO_LOGIN_ENABLED;
    initDatabase();
    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (prevFlag === undefined) delete process.env.DEMO_LOGIN_ENABLED;
    else process.env.DEMO_LOGIN_ENABLED = prevFlag;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("stays off unless DEMO_LOGIN_ENABLED is set, and ignores client credentials", async () => {
    delete process.env.DEMO_LOGIN_ENABLED;
    const hidden = await jsonRequest(port, "POST", "/api/auth/demo-login", {});
    assert.equal(hidden.status, 404);
    assert.equal(hidden.json.token, undefined);

    const configOff = await jsonRequest(port, "GET", "/api/auth/oauth-config");
    assert.equal(configOff.json.demoLoginEnabled, false);

    process.env.DEMO_LOGIN_ENABLED = "true";
    const configOn = await jsonRequest(port, "GET", "/api/auth/oauth-config");
    assert.equal(configOn.json.demoLoginEnabled, true);

    const session = await jsonRequest(port, "POST", "/api/auth/demo-login", {
      email: "admin@lumera.me",
      password: "not-the-demo-password",
    });
    assert.equal(session.status, 200);
    assert.equal(session.json.requiresOtp, false);
    const user = session.json.user as { email?: string } | undefined;
    assert.equal(user?.email, "doctor@lumera.me");
    assert.equal(typeof session.json.token, "string");
    assert.equal(JSON.stringify(session.json).includes("Lumera@2026"), false);
    assert.ok(AUTH_RATE_LIMITED_PATHS.includes("/api/auth/demo-login"));
  });

  it("does not auto-login on boot or embed the demo password in the boot client", () => {
    const auth = fs.readFileSync(path.join(root, "src/auth/AuthContext.tsx"), "utf8");
    const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
    const login = fs.readFileSync(path.join(root, "src/pages/LoginPage.tsx"), "utf8");
    const effect = auth.slice(auth.indexOf("useEffect(() => {"), auth.indexOf("const login ="));
    assert.match(effect, /\/api\/auth\/me/);
    assert.doesNotMatch(effect, /demo-login|\/api\/auth\/login|Lumera@2026|doctor@lumera\.me/);
    assert.doesNotMatch(auth, /Lumera@2026/);
    assert.doesNotMatch(auth, /doctor@lumera\.me/);
    assert.match(auth, /\/api\/auth\/demo-login/);
    assert.doesNotMatch(app, /Lumera@2026/);
    assert.doesNotMatch(app, /doctor@lumera\.me/);
    assert.doesNotMatch(app, /\/api\/auth\/login/);
    assert.match(login, /demoLogin\(/);
    assert.match(login, /demoLoginEnabled/);
    assert.doesNotMatch(login, /login\(\s*["']doctor@lumera\.me["']/);
    assert.equal(login.includes('setPassword("Lumera@2026")'), false);

    const runtime = fs.readFileSync(path.join(root, "server/runtime.ts"), "utf8");
    const sql = fs.readFileSync(path.join(root, "server/sql-engine.ts"), "utf8");
    assert.equal(runtime.includes("STRICT_PRODUCTION"), false);
    assert.equal(runtime.includes("REQUIRE_PRODUCTION_DB"), false);
    assert.equal(runtime.includes("lumera-default-secret"), false);
    assert.equal(sql.includes("if (!strict) return false"), false);
  });
});
