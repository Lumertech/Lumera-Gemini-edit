import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { createMetaRouter } from "./meta.ts";

/**
 * Production mount order: WhatsApp-numbers aliases win for
 * POST /api/meta/waba-connect|disconnect. createMetaRouter still serves
 * templates and the unprefixed /meta mount.
 */
async function startProductionOrderServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(attachUser);
  app.use("/api", practitionerLinkMiddleware);
  app.use("/api", createWhatsAppNumbersRouter());
  app.use("/api", createApiRouter());
  app.use("/meta", createMetaRouter());
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

type GuardedCall = [string, string, Record<string, unknown> | undefined];

/** No foreign tenantId: a tenant mismatch must not be what produces the 403. */
const guardedCalls: GuardedCall[] = [
  ["POST", "/api/meta/waba-connect", { wabaId: "waba_role_probe", phoneNumberId: "phone_role_probe" }],
  ["POST", "/api/meta/waba-disconnect", {}],
  ["GET", "/api/meta/templates", undefined],
  ["POST", "/api/meta/templates", { name: "role_probe_tpl", category: "UTILITY", language: "en" }],
  ["DELETE", "/api/meta/templates/tpl-missing", undefined],
  ["POST", "/api/meta/simulate-embedded-signup", {}],
  ["POST", "/api/meta/templates/tpl-missing/approve", {}],
  ["POST", "/api/meta/send-test", { recipientPhone: "+910000000001" }],
  ["POST", "/meta/waba-connect", { wabaId: "waba_role_probe", phoneNumberId: "phone_role_probe" }],
  ["POST", "/meta/waba-disconnect", {}],
  ["GET", "/meta/templates", undefined],
  ["DELETE", "/meta/templates/tpl-missing", undefined],
];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const createdTenantIds: string[] = [];

function purgeTenant(tenantId: string) {
  const db = getDb();
  const run = (sql: string, ...params: string[]) => {
    try {
      db.prepare(sql).run(...params);
    } catch {
      /* optional table on a database that has not migrated that feature yet */
    }
  };
  try {
    const numbers = db
      .prepare("SELECT meta_token_ref FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .all(tenantId) as Array<{ meta_token_ref?: string }>;
    for (const number of numbers) {
      const ref = String(number.meta_token_ref || "").trim();
      if (ref) run("DELETE FROM whatsapp_number_secrets WHERE id = ?", ref);
    }
  } catch {
    /* whatsapp_numbers is created on first WABA boot */
  }
  run("DELETE FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?", tenantId);
  run("DELETE FROM meta_templates WHERE tenant_id = ?", tenantId);
  run("DELETE FROM tenant_subscriptions WHERE tenant_id = ? OR id = ?", tenantId, `tsub-${tenantId}`.slice(0, 40));
  run("DELETE FROM users WHERE tenant_id = ?", tenantId);
  run("DELETE FROM tenants WHERE id = ?", tenantId);
}

function purgeAuthzFixtures() {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM tenants WHERE id LIKE 'tenant-meta-authz-%' OR id LIKE 'tmaaz%'")
    .all() as Array<{ id: string }>;
  for (const row of rows) purgeTenant(row.id);
  try {
    db.prepare(
      `DELETE FROM tenant_subscriptions
       WHERE id LIKE 'tsub-tenant-meta-authz%' OR id LIKE 'tsub-tmaaz%'
          OR tenant_id LIKE 'tenant-meta-authz-%' OR tenant_id LIKE 'tmaaz%'`
    ).run();
  } catch {
    /* subscription table is created with platform tenant migration */
  }
  try {
    db.prepare("DELETE FROM meta_templates WHERE name = ?").run("role_probe_tpl");
  } catch {
    /* templates table missing only before migrate */
  }
}

function seedClinic(label: string) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const tenantId = `tmaaz${label.slice(0, 3)}${suffix}`;
  const userId = `umaz${label.slice(0, 3)}${suffix}`;
  const email = `${label.slice(0, 8)}.${suffix}@meta-authz-test.example`.toLowerCase();
  createdTenantIds.push(tenantId);
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, waba_id, phone_number_id, meta_onboarding_status)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?, '', '', 'disconnected')`
  ).run(tenantId, `Meta AuthZ Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', '+91 90000 00000', ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Admin ${label}`, `Meta AuthZ Clinic ${label}`, now, now);
  return { tenantId, email };
}

function tenantWaba(tenantId: string) {
  return getDb()
    .prepare("SELECT waba_id, phone_number_id, meta_onboarding_status FROM tenants WHERE id = ?")
    .get(tenantId) as { waba_id: string; phone_number_id: string; meta_onboarding_status: string };
}

function insertTemplate(tenantId: string, name: string) {
  const id = `tpl-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, meta_template_id, rejection_reason, created_at, updated_at)
       VALUES (?, ?, 'waba_test', ?, 'UTILITY', 'en', 'PENDING', '[]', '', NULL, ?, ?)`
    )
    .run(id, tenantId, name, now, now);
  return id;
}

describe("Meta WABA and template AuthZ", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-meta-authz";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    purgeAuthzFixtures();
    const server = await startProductionOrderServer();
    port = server.port;
    close = server.close;
  });

  after(async () => {
    try {
      for (const tenantId of createdTenantIds) purgeTenant(tenantId);
      purgeAuthzFixtures();
    } catch {
      /* init never ran */
    }
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || `${email} login failed`));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("anonymous callers are 401 and Meta callbacks stay signature-gated", async () => {
    for (const [method, path, body] of guardedCalls) {
      const res = await jsonRequest(port, method, path, body);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error, "Authentication required");
    }

    for (const path of [
      "/api/meta/webhook",
      "/api/meta/deauthorize",
      "/api/meta/data-deletion",
      "/meta/webhook",
      "/meta/deauthorize",
      "/meta/data-deletion",
    ]) {
      const res = await jsonRequest(port, "POST", path, {});
      assert.notEqual(res.status, 401, path);
      assert.notEqual(res.json.error, "Authentication required");
    }

    for (const path of ["/api/meta/wabas", "/api/meta/overview"]) {
      const res = await jsonRequest(port, "GET", path);
      assert.equal(res.status, 401, path);
      assert.equal(res.json.error, "Authentication required");
    }
  });

  it("patient and receptionist are 403", async () => {
    const patient = await login("patient@lumera.me");
    const reception = await login("reception@lumera.me");
    for (const token of [patient, reception]) {
      for (const [method, path, body] of guardedCalls) {
        const res = await jsonRequest(port, method, path, body, auth(token));
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal(res.json.error, "Insufficient permissions");
      }
    }
  });

  it("clinic A cannot act on clinic B, and template lists stay on the session tenant", async () => {
    const a = seedClinic("a");
    const b = seedClinic("b");
    getDb().prepare("UPDATE tenants SET waba_id = ?, phone_number_id = ? WHERE id = ?").run("waba_b_keep", "phone_b_keep", b.tenantId);
    const bTemplate = insertTemplate(b.tenantId, "clinic_b_private");
    const tokenA = await login(a.email);
    const headers = auth(tokenA);

    const connectApi = await jsonRequest(
      port,
      "POST",
      "/api/meta/waba-connect",
      { tenantId: b.tenantId, wabaId: "waba_stolen", phoneNumberId: "phone_stolen" },
      headers
    );
    assert.equal(connectApi.status, 403);
    const connectBare = await jsonRequest(
      port,
      "POST",
      "/meta/waba-connect",
      { tenantId: b.tenantId, wabaId: "waba_stolen_bare", phoneNumberId: "phone_stolen_bare" },
      headers
    );
    assert.equal(connectBare.status, 403);
    const disconnectApi = await jsonRequest(port, "POST", "/api/meta/waba-disconnect", { tenantId: b.tenantId }, headers);
    assert.equal(disconnectApi.status, 403);
    const disconnectBare = await jsonRequest(port, "POST", "/meta/waba-disconnect", { tenantId: b.tenantId }, headers);
    assert.equal(disconnectBare.status, 403);
    const kept = tenantWaba(b.tenantId);
    assert.equal(kept.waba_id, "waba_b_keep");
    assert.equal(kept.phone_number_id, "phone_b_keep");
    assert.equal(kept.meta_onboarding_status, "disconnected");

    const createForeign = await jsonRequest(
      port,
      "POST",
      "/api/meta/templates",
      { tenantId: b.tenantId, name: "stolen_from_a", category: "UTILITY", language: "en" },
      headers
    );
    assert.equal(createForeign.status, 403);
    const stolen = getDb()
      .prepare("SELECT id FROM meta_templates WHERE tenant_id = ? AND name = ?")
      .get(b.tenantId, "stolen_from_a") as { id?: string } | undefined;
    assert.equal(stolen, undefined);

    const remove = await jsonRequest(port, "DELETE", `/api/meta/templates/${bTemplate}`, undefined, headers);
    assert.equal(remove.status, 404);
    const approve = await jsonRequest(port, "POST", `/api/meta/templates/${bTemplate}/approve`, {}, headers);
    assert.equal(approve.status, 404);
    const still = getDb()
      .prepare("SELECT status FROM meta_templates WHERE id = ? AND tenant_id = ?")
      .get(bTemplate, b.tenantId) as { status: string };
    assert.equal(still.status, "PENDING");

    const listed = await jsonRequest(port, "GET", "/api/meta/templates", undefined, headers);
    assert.equal(listed.status, 200);
    const templates = listed.json.templates as Array<{ id: string; tenantId: string; name: string }>;
    assert.ok(Array.isArray(templates));
    assert.equal(templates.some((row) => row.tenantId === b.tenantId || row.id === bTemplate || row.name === "clinic_b_private"), false);

    const queried = await jsonRequest(port, "GET", `/api/meta/templates?tenantId=${encodeURIComponent(b.tenantId)}`, undefined, headers);
    assert.equal(queried.status, 403);
    assert.equal(JSON.stringify(queried.json).includes("clinic_b_private"), false);
    assert.equal(JSON.stringify(queried.json).includes(bTemplate), false);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/meta/templates",
      { name: "clinic_a_only", category: "UTILITY", language: "en" },
      headers
    );
    assert.equal(created.status, 200, String(created.json.error || "create own template failed"));
    const ownId = String(created.json.templateId || "");
    const ownRow = getDb()
      .prepare("SELECT tenant_id, name FROM meta_templates WHERE id = ?")
      .get(ownId) as { tenant_id: string; name: string };
    assert.equal(ownRow.tenant_id, a.tenantId);
    assert.equal(ownRow.name, "clinic_a_only");

    const scoped = await jsonRequest(port, "GET", "/api/meta/templates", undefined, headers);
    const scopedRows = scoped.json.templates as Array<{ id: string; tenantId: string }>;
    assert.equal(scopedRows.some((row) => row.id === ownId && row.tenantId === a.tenantId), true);
    assert.equal(scopedRows.some((row) => row.tenantId !== a.tenantId), false);

    const ownConnect = await jsonRequest(
      port,
      "POST",
      "/meta/waba-connect",
      { tenantId: b.tenantId, wabaId: "waba_should_not_apply", phoneNumberId: "phone_should_not_apply" },
      headers
    );
    assert.equal(ownConnect.status, 403);
    const sessionConnect = await jsonRequest(
      port,
      "POST",
      "/meta/waba-connect",
      { wabaId: "waba_a_session", phoneNumberId: "phone_a_session", metaWabaName: "Clinic A" },
      headers
    );
    assert.equal(sessionConnect.status, 200, String(sessionConnect.json.error || "session connect failed"));
    assert.equal(tenantWaba(a.tenantId).waba_id, "waba_a_session");
    assert.equal(tenantWaba(b.tenantId).waba_id, "waba_b_keep");
  });

  it("super_admin template writes stay on the session tenant; the audited WABA alias can still name a clinic", async () => {
    const b = seedClinic("admin-target");
    const bTemplate = insertTemplate(b.tenantId, "not_for_platform_list");
    const admin = await login("admin@lumera.me");
    const headers = auth(admin);

    const listed = await jsonRequest(port, "GET", "/api/meta/templates", undefined, headers);
    assert.equal(listed.status, 200);
    const templates = listed.json.templates as Array<{ id: string; tenantId: string }>;
    assert.equal(templates.some((row) => row.id === bTemplate || row.tenantId === b.tenantId), false);

    const create = await jsonRequest(
      port,
      "POST",
      "/api/meta/templates",
      { tenantId: b.tenantId, name: "admin_must_not_write_b", category: "UTILITY", language: "en" },
      headers
    );
    assert.equal(create.status, 403);
    const leaked = getDb()
      .prepare("SELECT id FROM meta_templates WHERE tenant_id = ? AND name = ?")
      .get(b.tenantId, "admin_must_not_write_b") as { id?: string } | undefined;
    assert.equal(leaked, undefined);

    const bare = await jsonRequest(
      port,
      "POST",
      "/meta/waba-connect",
      { tenantId: b.tenantId, wabaId: "waba_admin_bare", phoneNumberId: "phone_admin_bare" },
      headers
    );
    assert.equal(bare.status, 403);
    assert.equal(tenantWaba(b.tenantId).waba_id, "");

    const alias = await jsonRequest(
      port,
      "POST",
      "/api/meta/waba-connect",
      {
        tenantId: b.tenantId,
        wabaId: "waba_admin_alias",
        phoneNumberId: `phone_admin_alias_${b.tenantId.slice(-6)}`,
        metaWabaName: "Platform alias",
      },
      headers
    );
    assert.equal(alias.status, 200, String(alias.json.error || "platform alias connect failed"));
    const row = getDb()
      .prepare("SELECT owner_id, connected_via FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ?")
      .get(b.tenantId) as { owner_id: string; connected_via: string };
    assert.equal(row.owner_id, b.tenantId);
    assert.equal(row.connected_via, "master_admin");
  });
});
