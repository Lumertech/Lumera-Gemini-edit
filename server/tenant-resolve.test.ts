import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import {
  INDIVIDUAL_DEMO_SLUG,
  INDIVIDUAL_DEMO_TENANT_ID,
  POLYCLINIC_DEMO_SLUG,
  ensureDemoWorkspaceTenants,
} from "./demo-workspace-tenants.ts";
import { getDb, initDatabase } from "./db.ts";
import { resolveTenantSlug } from "./tenant-resolve.ts";
import { startTestServer, type TestHttpServer } from "./test-http.ts";

describe("resolveTenantSlug", () => {
  it("returns the session tenant for its own slug and never another tenant id", () => {
    const own = resolveTenantSlug({
      role: "doctor",
      sessionSlug: INDIVIDUAL_DEMO_SLUG,
      sessionTenantId: INDIVIDUAL_DEMO_TENANT_ID,
      requestedSlug: INDIVIDUAL_DEMO_SLUG,
    });
    assert.equal(own.status, 200);
    assert.equal(own.body.slug, INDIVIDUAL_DEMO_SLUG);
    assert.equal(own.body.tenantId, INDIVIDUAL_DEMO_TENANT_ID);
    assert.equal(JSON.stringify(own.body).includes(POLYCLINIC_DEMO_SLUG), false);

    const other = resolveTenantSlug({
      role: "doctor",
      sessionSlug: INDIVIDUAL_DEMO_SLUG,
      sessionTenantId: INDIVIDUAL_DEMO_TENANT_ID,
      requestedSlug: POLYCLINIC_DEMO_SLUG,
    });
    const unknown = resolveTenantSlug({
      role: "doctor",
      sessionSlug: INDIVIDUAL_DEMO_SLUG,
      sessionTenantId: INDIVIDUAL_DEMO_TENANT_ID,
      requestedSlug: "not-a-clinic",
    });
    assert.equal(other.status, 404);
    assert.equal(unknown.status, 404);
    assert.equal(JSON.stringify(other), JSON.stringify(unknown));
    assert.deepEqual(other.body, { error: "Not found", slug: INDIVIDUAL_DEMO_SLUG });
    assert.equal("tenantId" in other.body, false);
    assert.equal(JSON.stringify(other.body).includes("tenant-demo-polyclinic"), false);

    const admin = resolveTenantSlug({
      role: "super_admin",
      sessionSlug: "lumera-apex-polyclinic",
      sessionTenantId: "tenant-lumera-main",
      requestedSlug: INDIVIDUAL_DEMO_SLUG,
    });
    assert.equal(admin.status, 403);
    assert.equal(admin.body.redirect, "/admin");
    assert.equal(admin.body.tenantId, undefined);
    assert.equal(JSON.stringify(admin.body).includes(INDIVIDUAL_DEMO_TENANT_ID), false);
  });
});

describe("GET /api/tenant/resolve", () => {
  let server: TestHttpServer;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-tenant-resolve";
    initDatabase();
    ensureDemoWorkspaceTenants(getDb());
    server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      app.use("/api", (_req, res) => {
        res.status(404).json({ error: "Not found" });
      });
    });
  });

  after(async () => {
    await server?.close();
  });

  async function login(email: string) {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Lumera@2026" }),
    });
    const json = (await res.json()) as { token?: string; error?: string };
    assert.equal(res.status, 200, json.error || email);
    return { Authorization: `Bearer ${json.token}` };
  }

  async function resolve(headers: Record<string, string>, slug: string) {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/tenant/resolve?slug=${encodeURIComponent(slug)}`,
      { headers }
    );
    const text = await res.text();
    const body = JSON.parse(text) as { slug?: string; tenantId?: string; error?: string; redirect?: string };
    return { status: res.status, text, body };
  }

  it("200 own slug, identical 404 for foreign and unknown slugs, 403 Super Admin on /w", async () => {
    const doctor = await login("doctor@lumera.me");
    const own = await resolve(doctor, INDIVIDUAL_DEMO_SLUG);
    assert.equal(own.status, 200);
    assert.equal(own.body.slug, INDIVIDUAL_DEMO_SLUG);
    assert.equal(own.body.tenantId, INDIVIDUAL_DEMO_TENANT_ID);

    const other = await resolve(doctor, POLYCLINIC_DEMO_SLUG);
    const unknown = await resolve(doctor, "not-a-real-clinic");
    assert.equal(other.status, 404);
    assert.equal(unknown.status, 404);
    assert.equal(other.text, unknown.text);
    assert.equal(other.text, JSON.stringify({ error: "Not found", slug: INDIVIDUAL_DEMO_SLUG }));
    assert.equal(other.body.tenantId, undefined);
    assert.equal(other.text.includes("tenant-demo-polyclinic"), false);

    const anon = await fetch(`http://127.0.0.1:${server.port}/api/tenant/resolve?slug=${INDIVIDUAL_DEMO_SLUG}`);
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get("content-type") || "", /json/);

    const admin = await login("admin@lumera.me");
    const onW = await resolve(admin, INDIVIDUAL_DEMO_SLUG);
    assert.equal(onW.status, 403);
    assert.equal(onW.body.redirect, "/admin");
    assert.equal(onW.body.tenantId, undefined);

    const missingApi = await fetch(`http://127.0.0.1:${server.port}/api/nope`);
    const missingText = await missingApi.text();
    assert.equal(missingApi.status, 404);
    assert.match(missingApi.headers.get("content-type") || "", /json/);
    assert.equal(JSON.parse(missingText).error, "Not found");
    assert.doesNotMatch(missingText, /<html/i);
  });
});
