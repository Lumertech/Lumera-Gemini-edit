import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApiRouter, demoLoginRoleAllowed } from "./api.ts";
import { attachUser, isPlatformAdminRole } from "./auth.ts";
import { getDb, initDatabase } from "./db.ts";
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

  it("signs the clinic admin sandbox in and never returns a platform administrator", async () => {
    process.env.DEMO_LOGIN_ENABLED = "true";
    assert.equal(demoLoginRoleAllowed("super_admin"), false);
    assert.equal(demoLoginRoleAllowed("admin"), false);
    assert.equal(demoLoginRoleAllowed("CLINIC_ADMIN"), true);
    assert.equal(demoLoginRoleAllowed("polyclinic_admin"), true);
    assert.equal(demoLoginRoleAllowed("doctor"), true);

    const bodies: unknown[] = [{}, { demoRole: "doctor" }, { demoRole: "admin" }, { email: "admin@lumera.me", role: "super_admin" }];
    for (const body of bodies) {
      const res = await jsonRequest(port, "POST", "/api/auth/demo-login", body);
      if (res.status !== 200) continue;
      const user = res.json.user as { email?: string; role?: string } | undefined;
      assert.equal(isPlatformAdminRole(user?.role), false);
      assert.notEqual(user?.role, "super_admin");
      assert.notEqual(user?.role, "admin");
      assert.notEqual(user?.email, "admin@lumera.me");
    }

    const admin = await jsonRequest(port, "POST", "/api/auth/demo-login", { demoRole: "admin" });
    assert.equal(admin.status, 200);
    assert.equal(admin.json.requiresOtp, false);
    const adminUser = admin.json.user as { email?: string; role?: string; roleHome?: string } | undefined;
    assert.equal(adminUser?.email, "clinic.admin@lumera.me");
    assert.ok(adminUser?.role === "CLINIC_ADMIN" || adminUser?.role === "polyclinic_admin");
    assert.notEqual(adminUser?.roleHome, "admin");

    const doctor = await jsonRequest(port, "POST", "/api/auth/demo-login", { demoRole: "doctor" });
    assert.equal(doctor.status, 200);
    assert.equal((doctor.json.user as { email?: string; role?: string } | undefined)?.email, "doctor@lumera.me");
    assert.equal((doctor.json.user as { role?: string } | undefined)?.role, "doctor");

    for (const demoRole of ["receptionist", "patient", "super_admin", "clinic.admin@lumera.me"]) {
      const refused = await jsonRequest(port, "POST", "/api/auth/demo-login", { demoRole });
      assert.equal(refused.status, 403, demoRole);
      assert.equal(refused.json.user, undefined);
    }

    const spoof = await jsonRequest(port, "POST", "/api/auth/demo-login", {
      email: "admin@lumera.me",
      password: "not-the-demo-password",
      role: "super_admin",
    });
    assert.equal(spoof.status, 200);
    const spoofUser = spoof.json.user as { email?: string; role?: string } | undefined;
    assert.equal(spoofUser?.email, "doctor@lumera.me");
    assert.equal(isPlatformAdminRole(spoofUser?.role), false);
  });

  it("seeds a clinic-scoped admin when the preferred demo admin is a platform role", async () => {
    process.env.DEMO_LOGIN_ENABLED = "true";
    const db = getDb();
    const before = db.prepare("SELECT role FROM users WHERE email = ?").get("clinic.admin@lumera.me") as { role: string };
    db.prepare("UPDATE users SET role = 'super_admin' WHERE email = ?").run("clinic.admin@lumera.me");
    try {
      const res = await jsonRequest(port, "POST", "/api/auth/demo-login", { demoRole: "admin" });
      assert.equal(res.status, 200);
      const user = res.json.user as { email?: string; role?: string } | undefined;
      assert.equal(user?.email, "clinicadmin@lumera.me");
      assert.equal(user?.role, "CLINIC_ADMIN");
      assert.equal(isPlatformAdminRole(user?.role), false);
      const again = await jsonRequest(port, "POST", "/api/auth/demo-login", { demoRole: "admin" });
      assert.equal((again.json.user as { email?: string } | undefined)?.email, "clinicadmin@lumera.me");
    } finally {
      db.prepare("UPDATE users SET role = ? WHERE email = ?").run(before.role, "clinic.admin@lumera.me");
      db.prepare("DELETE FROM users WHERE email = ?").run("clinicadmin@lumera.me");
    }
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
    assert.doesNotMatch(login, /demoLogin\(/);
    assert.doesNotMatch(login, /Quick Demo/);
    assert.doesNotMatch(login, /quick-demo-login/);
    assert.doesNotMatch(login, /data-testid="demo-account-picker"/);
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
