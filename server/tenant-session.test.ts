import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import {
  INDIVIDUAL_DEMO_SLUG,
  INDIVIDUAL_DEMO_TENANT_ID,
  POLYCLINIC_DEMO_SLUG,
  POLYCLINIC_DEMO_TENANT_ID,
  ensureDemoWorkspaceTenants,
} from "./demo-workspace-tenants.ts";
import { getDb, initDatabase } from "./db.ts";
import { attachHttpSecurity } from "./http-security.ts";
import { startTestServer, type TestHttpServer } from "./test-http.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { META_REVIEW_TENANT_ID, SUNRISE_TENANT_ID } from "./tenant-slug.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cookiePair(raw: string, name: string): string {
  const match = new RegExp(`${name}=([^;\\s]*)`).exec(raw);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function login(port: number, email: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Lumera@2026" }),
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie().join("\n") : res.headers.get("set-cookie") || "";
  const json = (await res.json()) as {
    token?: string;
    user?: { email?: string; role?: string; tenantId?: string; workspaceSlug?: string };
    error?: string;
  };
  assert.equal(res.status, 200, json.error || email);
  const sid = cookiePair(setCookie, "lumera_sid");
  const csrf = cookiePair(setCookie, "lumera_csrf");
  assert.ok(sid, "login must set lumera_sid");
  assert.ok(csrf, "login must set lumera_csrf");
  return { setCookie, json, sid, csrf, cookie: `lumera_sid=${encodeURIComponent(sid)}; lumera_csrf=${encodeURIComponent(csrf)}` };
}

describe("P0 #120 cookie session and tenant isolation", () => {
  let server: TestHttpServer;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-tenant-session";
    initDatabase();
    ensureDemoWorkspaceTenants(getDb());
    server = await startTestServer((app) => {
      attachHttpSecurity(app);
      app.use("/api", createApiRouter());
      app.use("/api/whatsapp", createWhatsAppRouter());
    });
  });

  after(async () => {
    await server?.close();
  });

  it("refresh keeps the user logged in via the session cookie and GET /api/me", async () => {
    const session = await login(server.port, "doctor@lumera.me");
    assert.match(session.setCookie, /lumera_sid=/);
    assert.match(session.setCookie, /HttpOnly/i);
    assert.match(session.setCookie, /Secure/i);
    assert.match(session.setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(session.setCookie, /SameSite=None/i);

    const me = await fetch(`http://127.0.0.1:${server.port}/api/me`, {
      headers: { cookie: `lumera_sid=${encodeURIComponent(session.sid)}` },
    });
    const meJson = (await me.json()) as { user?: { email?: string; workspaceSlug?: string } | null };
    assert.equal(me.status, 200);
    assert.equal(meJson.user?.email, "doctor@lumera.me");
    assert.equal(meJson.user?.workspaceSlug, INDIVIDUAL_DEMO_SLUG);

    const again = await fetch(`http://127.0.0.1:${server.port}/api/me`, {
      headers: { cookie: `lumera_sid=${encodeURIComponent(session.sid)}` },
    });
    const againJson = (await again.json()) as { user?: { email?: string } | null };
    assert.equal(againJson.user?.email, "doctor@lumera.me");

    const missingCsrf = await fetch(`http://127.0.0.1:${server.port}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: session.cookie },
    });
    assert.equal(missingCsrf.status, 403);

    const loggedOut = await fetch(`http://127.0.0.1:${server.port}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
    });
    assert.equal(loggedOut.status, 200);
    const cleared =
      typeof loggedOut.headers.getSetCookie === "function"
        ? loggedOut.headers.getSetCookie().join("\n")
        : loggedOut.headers.get("set-cookie") || "";
    assert.match(cleared, /lumera_sid=;/);
    assert.match(cleared, /Max-Age=0/i);

    const after = await fetch(`http://127.0.0.1:${server.port}/api/me`, {
      headers: { cookie: `lumera_sid=${encodeURIComponent(session.sid)}` },
    });
    const afterJson = (await after.json()) as { user?: { email?: string } | null };
    assert.equal(afterJson.user ?? null, null);
  });

  it("does not persist an auth token in web storage", () => {
    const http = fs.readFileSync(path.join(__dirname, "../src/api/http.ts"), "utf8");
    const auth = fs.readFileSync(path.join(__dirname, "../src/auth/AuthContext.tsx"), "utf8");
    assert.doesNotMatch(http, /localStorage\.setItem|sessionStorage\.setItem/);
    assert.doesNotMatch(auth, /localStorage\.setItem|sessionStorage\.setItem/);
  });

  it("routes two tenants to different slugs and leaves Meta review and Sunrise untouched", async () => {
    const doctor = await login(server.port, "doctor@lumera.me");
    const clinic = await login(server.port, "clinic.admin@lumera.me");
    assert.equal(doctor.json.user?.tenantId, INDIVIDUAL_DEMO_TENANT_ID);
    assert.equal(doctor.json.user?.workspaceSlug, INDIVIDUAL_DEMO_SLUG);
    assert.equal(clinic.json.user?.tenantId, POLYCLINIC_DEMO_TENANT_ID);
    assert.equal(clinic.json.user?.workspaceSlug, POLYCLINIC_DEMO_SLUG);
    assert.notEqual(doctor.json.user?.workspaceSlug, clinic.json.user?.workspaceSlug);
    assert.notEqual(doctor.json.user?.workspaceSlug, "lumera-apex-polyclinic");

    const meta = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(META_REVIEW_TENANT_ID) as { name: string };
    assert.equal(meta.name, "Lumera Apex PolyClinic");
    const sunrise = getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { id: string } | undefined;
    assert.equal(sunrise, undefined);

    ensureDemoWorkspaceTenants(getDb());
    const slugs = getDb()
      .prepare("SELECT COUNT(*) AS c FROM tenants WHERE slug = ?")
      .get(INDIVIDUAL_DEMO_SLUG) as { c: number };
    assert.equal(slugs.c, 1);
    const doctorRow = getDb().prepare("SELECT tenant_id FROM users WHERE email = ?").get("doctor@lumera.me") as {
      tenant_id: string;
    };
    assert.equal(doctorRow.tenant_id, INDIVIDUAL_DEMO_TENANT_ID);
  });

  it("denies cross-tenant reads and writes even with a forged slug or tenant_id", async () => {
    const doctor = await login(server.port, "doctor@lumera.me");
    const auth = { Authorization: `Bearer ${doctor.json.token}`, cookie: doctor.cookie };
    const before = getDb()
      .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?")
      .get(POLYCLINIC_DEMO_TENANT_ID) as { c: number };

    const forgedRead = await fetch(
      `http://127.0.0.1:${server.port}/api/patients?tenant_id=${encodeURIComponent(POLYCLINIC_DEMO_TENANT_ID)}`,
      { headers: auth }
    );
    const forgedReadJson = (await forgedRead.json()) as { error?: string; patients?: unknown };
    assert.equal(forgedRead.status, 403);
    assert.equal(forgedReadJson.patients, undefined);

    const forgedHeader = await fetch(`http://127.0.0.1:${server.port}/api/patients`, {
      headers: { ...auth, "x-tenant-id": POLYCLINIC_DEMO_TENANT_ID },
    });
    assert.equal(forgedHeader.status, 403);

    const forgedWrite = await fetch(`http://127.0.0.1:${server.port}/api/patients`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Leaked Patient",
        phone: "+91 90000 00120",
        tenant_id: POLYCLINIC_DEMO_TENANT_ID,
        age: 40,
        gender: "Female",
      }),
    });
    const forgedWriteJson = (await forgedWrite.json()) as { patient?: unknown };
    assert.equal(forgedWrite.status, 403);
    assert.equal(forgedWriteJson.patient, undefined);
    const after = getDb()
      .prepare("SELECT COUNT(*) AS c FROM patients WHERE tenant_id = ?")
      .get(POLYCLINIC_DEMO_TENANT_ID) as { c: number };
    assert.equal(after.c, before.c);

    const wrongSlug = await fetch(`http://127.0.0.1:${server.port}/api/w/${POLYCLINIC_DEMO_SLUG}/patients`, {
      headers: auth,
    });
    const wrongSlugJson = (await wrongSlug.json()) as { patients?: unknown; error?: string };
    assert.equal(wrongSlug.status, 404);
    assert.equal(wrongSlugJson.patients, undefined);

    const ownSlug = await fetch(`http://127.0.0.1:${server.port}/api/w/${INDIVIDUAL_DEMO_SLUG}/patients`, {
      headers: { Authorization: `Bearer ${doctor.json.token}` },
    });
    const ownSlugJson = (await ownSlug.json()) as { patients?: Array<{ name: string }> };
    assert.equal(ownSlug.status, 200);
    assert.ok((ownSlugJson.patients || []).some((p) => /rajiv|sunita/i.test(p.name)));

    const anonBranches = await fetch(`http://127.0.0.1:${server.port}/api/branches`);
    assert.equal(anonBranches.status, 401);

    const doctorBranches = await fetch(`http://127.0.0.1:${server.port}/api/branches`, {
      headers: { Authorization: `Bearer ${doctor.json.token}` },
    });
    const doctorBranchJson = (await doctorBranches.json()) as { branches?: Array<{ id: string }> };
    assert.equal(doctorBranches.status, 200);
    assert.equal((doctorBranchJson.branches || []).some((b) => b.id === "b-1"), false);

    const clinic = await login(server.port, "clinic.admin@lumera.me");
    const clinicBranches = await fetch(`http://127.0.0.1:${server.port}/api/branches`, {
      headers: { Authorization: `Bearer ${clinic.json.token}` },
    });
    const clinicBranchJson = (await clinicBranches.json()) as { branches?: Array<{ id: string; tenant_id?: string }> };
    assert.equal(clinicBranches.status, 200);
    assert.ok((clinicBranchJson.branches || []).some((b) => b.id === "b-1"));
    assert.ok((clinicBranchJson.branches || []).every((b) => !b.tenant_id || b.tenant_id === POLYCLINIC_DEMO_TENANT_ID));

    const anonLab = await fetch(`http://127.0.0.1:${server.port}/api/whatsapp/lab-report/lab-101/pdf`);
    assert.equal(anonLab.status, 401);
    const stolenLab = await fetch(`http://127.0.0.1:${server.port}/api/whatsapp/lab-report/lab-101/pdf`, {
      headers: { Authorization: `Bearer ${doctor.json.token}` },
    });
    const stolenBody = await stolenLab.text();
    assert.equal(stolenLab.status, 404);
    assert.doesNotMatch(stolenBody, /Sunita|Rajiv|Lumera Central/i);
  });
});
