import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import {
  PUBLIC_BRANCH_KEYS,
  PUBLIC_TENANT_KEYS,
  isClientSecretKey,
  publicBranch,
  publicTenant,
} from "./client-serializers.ts";
import { getDb, initDatabase, publicUser, type DbUser } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const TOKEN = "EAA_CANARY_META_ACCESS_TOKEN_do_not_ship_9f3a";
const EXPIRES = "2099-08-08T08:08:08.000Z-CANARY-EXPIRY";
const WEBHOOK = "whsec_canary_webhook_secret_4411";
const API_KEY = "sk_canary_api_key_7721";
const PIN = "canary-registration-pin-4419";
const ENCRYPTED = "enc_canary_token_ciphertext_2201";
const WABA_TOKEN = "EAA_CANARY_WABA_ACCESS_TOKEN_88cc";
const SEEDED_MAIN_TOKEN = "EAAJ...verified_system_user_token_lumera_prod_2026";
const SEEDED_REHAB_TOKEN = "EAAJ...verified_system_user_token_rehab_mumbai_2026";

const SECRET_KEYS = [
  "meta_access_token",
  "metaAccessToken",
  "meta_token_expires_at",
  "metaTokenExpiresAt",
  "password_hash",
  "passwordHash",
  "webhook_secret",
  "webhookSecret",
  "api_key",
  "apiKey",
  "encrypted_token",
  "encryptedToken",
  "waba_access_token",
  "wabaAccessToken",
  "waba_token",
  "registration_pin",
  "two_step_pin",
  "whatsapp_pin",
  "pin",
];

const CANARIES = [TOKEN, EXPIRES, WEBHOOK, API_KEY, PIN, ENCRYPTED, WABA_TOKEN, SEEDED_MAIN_TOKEN, SEEDED_REHAB_TOKEN];

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function assertNoSecrets(payload: unknown, label: string) {
  const keys = collectKeys(payload);
  for (const secret of SECRET_KEYS) {
    assert.equal(keys.includes(secret), false, `${label} included secret key ${secret}`);
  }
  const body = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(body.includes(canary), false, `${label} included secret value ${canary.slice(0, 24)}…`);
  }
}

describe("client row serializers", () => {
  it("treats Meta/WABA tokens, PINs, webhook secrets, and API keys as secret keys", () => {
    for (const key of SECRET_KEYS) {
      assert.equal(isClientSecretKey(key), true, key);
    }
    for (const key of ["id", "name", "waba_id", "phone_number_id", "meta_waba_name", "practice_settings", "upi_id", "active_status", "slug", "secretary", "tokenPrefix", "token_prefix"]) {
      assert.equal(isClientSecretKey(key), false, key);
    }
  });

  it("allowlists tenant fields and drops every secret column", () => {
    const published = publicTenant({
      id: "tenant-canary",
      name: "Canary Clinic",
      specialty: "General Medicine",
      waba_id: "waba_public_id",
      phone_number_id: "phone_public_id",
      meta_waba_name: "Canary WABA",
      meta_onboarding_status: "connected",
      practice_settings: JSON.stringify({ tokenPrefix: "OPD", walkInEnabled: true }),
      gstin: "27CANARY0000Z1Z5",
      meta_access_token: TOKEN,
      metaAccessToken: TOKEN,
      meta_token_expires_at: EXPIRES,
      metaTokenExpiresAt: EXPIRES,
      webhook_secret: WEBHOOK,
      api_key: API_KEY,
      encrypted_token: ENCRYPTED,
      waba_access_token: WABA_TOKEN,
      registration_pin: PIN,
      two_step_pin: PIN,
      password_hash: "should-not-ride-along",
      not_a_real_column: "dropped because it is not allowlisted",
    });
    assert.ok(published);
    assert.equal(published.id, "tenant-canary");
    assert.equal(published.name, "Canary Clinic");
    assert.equal(published.waba_id, "waba_public_id");
    assert.equal(published.phone_number_id, "phone_public_id");
    assert.equal(published.meta_waba_name, "Canary WABA");
    assert.equal(published.gstin, "27CANARY0000Z1Z5");
    const settings = JSON.parse(String(published.practice_settings)) as { walkInEnabled?: boolean; tokenPrefix?: string };
    assert.equal(settings.walkInEnabled, true);
    assert.equal(settings.tokenPrefix, "OPD");
    for (const key of Object.keys(published)) {
      assert.equal(PUBLIC_TENANT_KEYS.includes(key as (typeof PUBLIC_TENANT_KEYS)[number]), true, key);
      assert.equal(isClientSecretKey(key), false, key);
    }
    assertNoSecrets(published, "publicTenant");
    assert.equal(JSON.stringify(published).includes("not_a_real_column"), false);
    assert.equal(JSON.stringify(published).includes("should-not-ride-along"), false);
    assert.equal(publicTenant(null), null);
    assert.equal(publicTenant(undefined), null);
  });

  it("strips secret keys nested inside a practice_settings JSON string", () => {
    const published = publicTenant({
      id: "tenant-json",
      name: "Json Clinic",
      practice_settings: JSON.stringify({
        walkInEnabled: true,
        sharedQueue: true,
        tokenPrefix: "CC",
        departments: ["General Medicine"],
        slotDurationMinutes: 15,
        meta_access_token: TOKEN,
        metaTokenExpiresAt: EXPIRES,
        webhook_secret: WEBHOOK,
        nested: {
          label: "kept",
          apiKey: API_KEY,
          registration_pin: PIN,
          encrypted_token: ENCRYPTED,
          waba_access_token: WABA_TOKEN,
          again: JSON.stringify({ password_hash: "nested-hash-canary", room: "OPD-2" }),
        },
      }),
      address: "not-json",
    });
    assert.ok(published);
    assert.equal(published.address, "not-json");
    const settings = JSON.parse(String(published.practice_settings)) as {
      walkInEnabled?: boolean;
      sharedQueue?: boolean;
      tokenPrefix?: string;
      departments?: string[];
      slotDurationMinutes?: number;
      meta_access_token?: string;
      metaTokenExpiresAt?: string;
      webhook_secret?: string;
      nested?: { label?: string; apiKey?: string; registration_pin?: string; encrypted_token?: string; waba_access_token?: string; again?: string };
    };
    assert.equal(settings.walkInEnabled, true);
    assert.equal(settings.sharedQueue, true);
    assert.equal(settings.tokenPrefix, "CC");
    assert.equal(settings.meta_access_token, undefined);
    assert.equal(settings.metaTokenExpiresAt, undefined);
    assert.equal(settings.nested?.encrypted_token, undefined);
    assert.equal(settings.nested?.waba_access_token, undefined);
    assert.deepEqual(settings.departments, ["General Medicine"]);
    assert.equal(settings.slotDurationMinutes, 15);
    assert.equal(settings.webhook_secret, undefined);
    assert.equal(settings.nested?.label, "kept");
    assert.equal(settings.nested?.apiKey, undefined);
    assert.equal(settings.nested?.registration_pin, undefined);
    const inner = JSON.parse(String(settings.nested?.again)) as { password_hash?: string; room?: string };
    assert.equal(inner.room, "OPD-2");
    assert.equal(inner.password_hash, undefined);
    assertNoSecrets(published, "practice_settings");
    assert.equal(JSON.stringify(published).includes("nested-hash-canary"), false);
  });

  it("reads camelCase tenant input but still emits the allowlisted snake_case shape", () => {
    const published = publicTenant({
      id: "tenant-camel",
      name: "Camel Clinic",
      wabaId: "waba_camel",
      metaAccessToken: TOKEN,
      metaTokenExpiresAt: EXPIRES,
    });
    assert.equal(published?.waba_id, "waba_camel");
    assert.equal(published?.wabaId, undefined);
    assertNoSecrets(published, "camel tenant");
  });

  it("allowlists branch fields and drops secret columns that are not on the table today", () => {
    const published = publicBranch({
      id: "b-canary",
      tenant_id: "tenant-canary",
      name: "Canary Branch",
      address: "1 Clinic Road",
      phone: "+91 90000 00000",
      opd_hours: "09:00-17:00",
      active_doctors: 2,
      status: "Operating",
      meta_access_token: TOKEN,
      webhook_secret: WEBHOOK,
      api_key: API_KEY,
      registration_pin: PIN,
      encrypted_token: ENCRYPTED,
    });
    assert.deepEqual(published, {
      id: "b-canary",
      tenant_id: "tenant-canary",
      name: "Canary Branch",
      address: "1 Clinic Road",
      phone: "+91 90000 00000",
      opd_hours: "09:00-17:00",
      active_doctors: 2,
      status: "Operating",
    });
    for (const key of Object.keys(published || {})) {
      assert.equal(PUBLIC_BRANCH_KEYS.includes(key as (typeof PUBLIC_BRANCH_KEYS)[number]), true, key);
    }
    assertNoSecrets(published, "publicBranch");
    assert.equal(publicBranch(undefined), null);
  });
});

describe("tenant, user, and branch HTTP responses omit secrets", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  const createdBranchIds: string[] = [];

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-client-serializers";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    for (const id of createdBranchIds) {
      try {
        getDb().prepare("DELETE FROM branches WHERE id = ?").run(id);
      } catch {
        /* test db already closed */
      }
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
    assert.ok(token, email);
    return token;
  }

  function seedClinic() {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-secret-${suffix}`;
    const email = `secret.${suffix}@serializer-test.example`.toLowerCase();
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id,
           waba_id, phone_number_id, meta_access_token, meta_token_expires_at, meta_waba_name,
           meta_onboarding_status, created_at, updated_at, practice_type
         ) VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000009991', ?, 500, 0, 1, 'HFR-CANARY', ?, ?, ?, ?, 'Canary WABA', 'connected', ?, ?, 'polyclinic')`
      )
      .run(tenantId, `Canary Clinic ${suffix}`, now, "waba_canary_public", "phone_canary_public", TOKEN, EXPIRES, now, now);
    getDb()
      .prepare("UPDATE tenants SET practice_settings = ? WHERE id = ?")
      .run(
        JSON.stringify({
          walkInEnabled: true,
          sharedQueue: false,
          tokenPrefix: "OPD",
          meta_access_token: TOKEN,
          webhook_secret: WEBHOOK,
          nested: { api_key: API_KEY, registration_pin: PIN, label: "front-desk" },
        }),
        tenantId
      );
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
           onboarding_completed, practice_type, specialty, last_login, created_at
         ) VALUES (?, ?, ?, ?, 'Dr Canary', 'CLINIC_ADMIN', 'active', '+91 90000 11991', 'Canary Clinic', 1, 'polyclinic', 'General Medicine', ?, ?)`
      )
      .run(`user-secret-${suffix}`, tenantId, email, passwordHash, now, now);
    return { tenantId, email, passwordHash };
  }

  it("GET /api/me, /api/auth/me, and /api/tenant/current omit tenant and user secrets", async () => {
    const clinic = seedClinic();
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    for (const path of ["/api/me", "/api/auth/me"]) {
      const me = await jsonRequest(port, "GET", path, undefined, auth);
      assert.equal(me.status, 200, path);
      const tenant = me.json.tenant as Record<string, unknown>;
      const user = me.json.user as Record<string, unknown>;
      assert.equal(tenant.id, clinic.tenantId);
      assert.equal(tenant.name, expectName(clinic.tenantId));
      assert.equal(tenant.waba_id, "waba_canary_public");
      assert.equal(tenant.phone_number_id, "phone_canary_public");
      assert.equal(tenant.meta_waba_name, "Canary WABA");
      const settings = JSON.parse(String(tenant.practice_settings)) as {
        walkInEnabled?: boolean;
        tokenPrefix?: string;
        meta_access_token?: string;
        webhook_secret?: string;
        nested?: { api_key?: string; registration_pin?: string; label?: string };
      };
      assert.equal(settings.walkInEnabled, true);
      assert.equal(settings.tokenPrefix, "OPD");
      assert.equal(settings.meta_access_token, undefined);
      assert.equal(settings.webhook_secret, undefined);
      assert.equal(settings.nested?.label, "front-desk");
      assert.equal(settings.nested?.api_key, undefined);
      assert.equal(settings.nested?.registration_pin, undefined);
      assert.equal(user.email, clinic.email);
      assert.equal(JSON.stringify(me.json).includes(clinic.passwordHash), false, path);
      assert.equal(JSON.stringify(me.json).includes(token), false, path);
      for (const key of Object.keys(tenant)) {
        assert.equal(PUBLIC_TENANT_KEYS.includes(key as (typeof PUBLIC_TENANT_KEYS)[number]), true, `${path} ${key}`);
      }
      assertNoSecrets(me.json, path);
    }

    const current = await jsonRequest(port, "GET", "/api/tenant/current", undefined, auth);
    assert.equal(current.status, 200);
    const currentTenant = current.json.tenant as Record<string, unknown>;
    assert.equal(currentTenant.id, clinic.tenantId);
    assert.equal(currentTenant.waba_id, "waba_canary_public");
    assert.ok(current.json.letterhead);
    for (const key of Object.keys(currentTenant)) {
      assert.equal(PUBLIC_TENANT_KEYS.includes(key as (typeof PUBLIC_TENANT_KEYS)[number]), true, key);
    }
    assertNoSecrets(current.json, "/api/tenant/current");

    const users = await jsonRequest(port, "GET", "/api/users", undefined, auth);
    assert.equal(users.status, 200);
    assert.equal(JSON.stringify(users.json).includes(clinic.passwordHash), false);
    assertNoSecrets(users.json, "/api/users");

    const team = await jsonRequest(port, "GET", "/api/clinic/team", undefined, auth);
    assert.equal(team.status, 200);
    assert.equal(JSON.stringify(team.json).includes(clinic.passwordHash), false);
    assertNoSecrets(team.json, "/api/clinic/team");
  });

  it("branch list, create, and update responses are allowlisted", async () => {
    const clinic = seedClinic();
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await jsonRequest(
      port,
      "POST",
      "/api/branches",
      {
        name: "Canary Branch",
        address: "9 Secret Lane",
        phone: "+91 90000 22211",
        meta_access_token: TOKEN,
        webhook_secret: WEBHOOK,
        api_key: API_KEY,
        registration_pin: PIN,
      },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || "create branch"));
    const branch = created.json.branch as Record<string, unknown>;
    createdBranchIds.push(String(branch.id));
    assert.equal(branch.name, "Canary Branch");
    assert.equal(branch.tenant_id, clinic.tenantId);
    assert.deepEqual(Object.keys(branch).sort(), [...PUBLIC_BRANCH_KEYS].sort());
    assertNoSecrets(created.json, "POST /api/branches");

    const patched = await jsonRequest(
      port,
      "PATCH",
      `/api/branches/${branch.id}`,
      { name: "Canary Branch Renamed", meta_access_token: TOKEN, webhook_secret: WEBHOOK },
      auth
    );
    assert.equal(patched.status, 200, String(patched.json.error || "patch branch"));
    const renamed = patched.json.branch as Record<string, unknown>;
    assert.equal(renamed.name, "Canary Branch Renamed");
    assert.deepEqual(Object.keys(renamed).sort(), [...PUBLIC_BRANCH_KEYS].sort());
    assertNoSecrets(patched.json, "PATCH /api/branches");

    const listed = await jsonRequest(port, "GET", "/api/branches", undefined, auth);
    assert.equal(listed.status, 200);
    const rows = listed.json.branches as Record<string, unknown>[];
    assert.ok(rows.some((row) => row.id === branch.id));
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        assert.equal(PUBLIC_BRANCH_KEYS.includes(key as (typeof PUBLIC_BRANCH_KEYS)[number]), true, String(key));
      }
    }
    assertNoSecrets(listed.json, "GET /api/branches");
  });

  it("admin tenant list and detail do not echo stored Meta tokens", async () => {
    const adminToken = await login("admin@lumera.me");
    const auth = { Authorization: `Bearer ${adminToken}` };
    const main = getDb()
      .prepare("SELECT meta_access_token, meta_token_expires_at FROM tenants WHERE id = ?")
      .get("tenant-lumera-main") as { meta_access_token?: string; meta_token_expires_at?: string } | undefined;
    assert.ok(main, "seeded platform tenant");
    getDb()
      .prepare("UPDATE tenants SET meta_access_token = ?, meta_token_expires_at = ? WHERE id = ?")
      .run(TOKEN, EXPIRES, "tenant-lumera-main");
    try {
      const listed = await jsonRequest(port, "GET", "/api/admin/tenants", undefined, auth);
      assert.equal(listed.status, 200, String(listed.json.error || "list tenants"));
      assert.ok(Array.isArray(listed.json.tenants));
      assertNoSecrets(listed.json, "GET /api/admin/tenants");

      const detail = await jsonRequest(port, "GET", "/api/admin/tenants/tenant-lumera-main", undefined, auth);
      assert.equal(detail.status, 200, String(detail.json.error || "tenant detail"));
      assert.equal((detail.json.tenant as { id?: string }).id, "tenant-lumera-main");
      assertNoSecrets(detail.json, "GET /api/admin/tenants/:id");
    } finally {
      getDb()
        .prepare("UPDATE tenants SET meta_access_token = ?, meta_token_expires_at = ? WHERE id = ?")
        .run(main.meta_access_token || "", main.meta_token_expires_at || "", "tenant-lumera-main");
    }
  });

  it("publicUser drops password hashes and secret columns even when the row has them", () => {
    const row = {
      id: "user-canary",
      tenant_id: "",
      email: "canary@serializer-test.example",
      password_hash: hashPassword("Lumera@2026"),
      name: "Canary",
      role: "doctor",
      status: "active",
      phone: "+91 90000 00000",
      last_login: null,
      created_at: new Date().toISOString(),
      api_key: API_KEY,
      webhook_secret: WEBHOOK,
      meta_access_token: TOKEN,
      registration_pin: PIN,
    } as DbUser & Record<string, string>;
    const published = publicUser(row);
    assert.equal(published.email, row.email);
    assert.equal(published.name, "Canary");
    assertNoSecrets(published, "publicUser");
    assert.equal(JSON.stringify(published).includes(row.password_hash), false);
  });
});

function expectName(tenantId: string): string {
  const row = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name: string };
  return row.name;
}
