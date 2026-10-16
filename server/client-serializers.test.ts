import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import {
  PATIENT_TENANT_KEYS,
  PUBLIC_BRANCH_KEYS,
  PUBLIC_TENANT_KEYS,
  isClientSecretKey,
  patientTenant,
  patientVisibleClinicPhone,
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

  it("patient tenant responses contain only the patient allowlist", () => {
    const ownerPhone = "+91 90000 77771";
    const ownerEmail = "owner.private@serializer-test.example";
    const published = patientTenant({
      id: "tenant-patient-scope",
      name: "Published Clinic",
      specialty: "General Medicine",
      address: "12 Public Road",
      city: "Pune",
      phone: "+91 20 4000 1000",
      email: "desk@published-clinic.example",
      whatsapp_number: "+91 98000 42424",
      upi_id: "publishedclinic@upi",
      gstin: "27CANARYGSTIN1Z5",
      reg_id: "CLINIC-REG-SECRET",
      owner_name: "Dr Hidden Owner",
      owner_email: ownerEmail,
      owner_phone: ownerPhone,
      owner_user_id: "user-owner-canary-91",
      waba_id: "waba_hidden_canary",
      phone_number_id: "pnid_hidden_canary",
      meta_waba_name: "Hidden WABA",
      meta_access_token: TOKEN,
      trial_ends_at: "2099-01-01T00:00:00.000Z",
      ai_scribe_minutes_limit: 500,
      practice_settings: JSON.stringify({
        walkInEnabled: true,
        tokenPrefix: "QCANARY",
        pan: "ABCDE1234F",
        owner_user_id: "user-owner-canary-91",
        meta_access_token: TOKEN,
        logo_url: "https://cdn.example/logo.png",
        opening_hours: "Mon-Sat 09:00-13:00",
        departments: ["General Medicine", "Dermatology"],
      }),
    });
    assert.ok(published);
    assert.deepEqual(Object.keys(published).sort(), [...PATIENT_TENANT_KEYS].sort());
    assert.equal(published.name, "Published Clinic");
    assert.equal(published.logo_url, "https://cdn.example/logo.png");
    assert.equal(published.address, "12 Public Road, Pune");
    assert.equal(published.phone, "+91 20 4000 1000");
    assert.equal(published.whatsapp_number, "+91 98000 42424");
    assert.equal(published.email, "desk@published-clinic.example");
    assert.equal(published.opening_hours, "Mon-Sat 09:00-13:00");
    assert.deepEqual(published.specialties, ["General Medicine", "Dermatology"]);
    assert.equal(published.upi_id, "publishedclinic@upi");
    const body = JSON.stringify(published);
    for (const forbidden of [
      ownerPhone,
      ownerEmail,
      "Dr Hidden Owner",
      "user-owner-canary-91",
      "27CANARYGSTIN1Z5",
      "ABCDE1234F",
      "waba_hidden_canary",
      "pnid_hidden_canary",
      "Hidden WABA",
      TOKEN,
      "QCANARY",
      "CLINIC-REG-SECRET",
      "walkInEnabled",
    ]) {
      assert.equal(body.includes(forbidden), false, forbidden);
    }
    const staff = publicTenant({
      name: "Published Clinic",
      owner_phone: ownerPhone,
      owner_email: ownerEmail,
      gstin: "27CANARYGSTIN1Z5",
      waba_id: "waba_hidden_canary",
    });
    assert.equal(staff?.owner_phone, ownerPhone);
    assert.equal(staff?.gstin, "27CANARYGSTIN1Z5");
    assert.equal(staff?.waba_id, "waba_hidden_canary");
  });

  it("returns null public contact when none is published and never falls back to the owner", () => {
    const ownerPhone = "+91 90000 77771";
    const ownerEmail = "owner.private@serializer-test.example";
    const published = patientTenant({
      name: "Quiet Clinic",
      phone: ownerPhone,
      email: ownerEmail,
      whatsapp_number: "",
      owner_name: "Dr Hidden Owner",
      owner_phone: ownerPhone,
      owner_email: ownerEmail,
      owner_user_id: "user-owner-canary-91",
      gstin: "27CANARYGSTIN1Z5",
      upi_id: "",
    });
    assert.ok(published);
    assert.deepEqual(Object.keys(published).sort(), [...PATIENT_TENANT_KEYS].sort());
    assert.equal(published.name, "Quiet Clinic");
    assert.equal(published.phone, null);
    assert.equal(published.email, null);
    assert.equal(published.whatsapp_number, null);
    assert.equal(published.upi_id, null);
    const body = JSON.stringify(published);
    assert.equal(body.includes(ownerPhone), false);
    assert.equal(body.includes(ownerEmail), false);
    assert.equal(body.includes("Dr Hidden Owner"), false);
    assert.equal(body.includes("user-owner-canary-91"), false);
    assert.equal(body.includes("27CANARYGSTIN1Z5"), false);

    const explicit = patientTenant({
      name: "Chosen Clinic",
      phone: ownerPhone,
      email: ownerEmail,
      owner_phone: "+91 90000 77771",
      owner_email: ownerEmail,
      practice_settings: {
        public_phone: ownerPhone,
        public_email: "desk@chosen-clinic.example",
        public_whatsapp: "",
      },
    });
    assert.equal(explicit?.phone, ownerPhone);
    assert.equal(explicit?.email, "desk@chosen-clinic.example");
    assert.equal(explicit?.whatsapp_number, null);
    assert.equal(JSON.stringify(explicit).includes(ownerEmail), false);

    const noFallback = patientTenant({
      phone: "",
      email: "",
      whatsapp_number: "",
      owner_phone: ownerPhone,
      owner_email: ownerEmail,
    });
    assert.equal(noFallback?.phone, null);
    assert.equal(noFallback?.email, null);
    assert.equal(noFallback?.whatsapp_number, null);
    const deskLine = patientTenant({
      name: "Desk Clinic",
      phone: "+91 20 4000 1000",
      email: "desk@published-clinic.example",
      whatsapp_number: "",
      owner_phone: ownerPhone,
      owner_email: ownerEmail,
    });
    assert.equal(deskLine?.phone, "+91 20 4000 1000");
    assert.equal(deskLine?.email, "desk@published-clinic.example");
    assert.equal(deskLine?.whatsapp_number, null);
    assert.equal(JSON.stringify(deskLine).includes(ownerPhone), false);
    assert.equal(JSON.stringify(deskLine).includes(ownerEmail), false);
    assert.equal(patientTenant(null), null);
  });

  it("redacts a 10-digit clinic phone when owner_phone is stored with a 91 prefix", () => {
    const card = patientTenant({
      name: "Prefix Clinic",
      phone: "9876543210",
      owner_phone: "919876543210",
    });
    assert.equal(card?.phone, null);
    assert.equal(JSON.stringify(card).includes("9876543210"), false);
  });

  it("returns null whatsapp_number when it matches the owner's personal phone", () => {
    const ownerPhone = "+91 90000 77771";
    const matched = patientTenant({
      name: "Owner Handset Clinic",
      phone: "+91 20 4000 1000",
      whatsapp_number: "919000077771",
      owner_phone: ownerPhone,
    });
    assert.equal(matched?.phone, "+91 20 4000 1000");
    assert.equal(matched?.whatsapp_number, null);
    assert.equal(JSON.stringify(matched).includes("9000077771"), false);

    const spaced = patientTenant({
      name: "Owner Handset Clinic",
      whatsapp_number: "+91 90000 77771",
      owner_phone: "91 90000 77771",
    });
    assert.equal(spaced?.whatsapp_number, null);

    const distinct = patientTenant({
      name: "Desk WhatsApp Clinic",
      whatsapp_number: "+91 98000 42424",
      owner_phone: ownerPhone,
    });
    assert.equal(distinct?.whatsapp_number, "+91 98000 42424");

    const explicit = patientTenant({
      name: "Chosen WhatsApp Clinic",
      whatsapp_number: "+91 98000 42424",
      owner_phone: ownerPhone,
      practice_settings: { public_whatsapp: ownerPhone },
    });
    assert.equal(explicit?.whatsapp_number, ownerPhone);
  });

  it("prints only a published clinic phone and drops an unlisted stamp", () => {
    assert.equal(
      patientVisibleClinicPhone("+91 91111 22222", {
        phone: "+91 20 4000 1000",
        owner_phone: "+91 90000 77771",
        whatsapp_number: "",
      }),
      "+91 20 4000 1000"
    );
    assert.equal(
      patientVisibleClinicPhone("+91 90000 77771", {
        phone: "+91 90000 77771",
        owner_phone: "+91 90000 77771",
      }),
      null
    );
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

  it("patient-scoped clinic routes return only the tenant allowlist and do not fall back to owner contact", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-patient-${suffix}`;
    const ownerPhone = "+91 90000 77771";
    const ownerEmail = `owner.private.${suffix}@serializer-test.example`;
    const ownerName = "Dr Hidden Owner";
    const ownerUserId = `user-owner-${suffix}`;
    const gstin = "27CANARYGSTIN1Z5";
    const pan = "ABCDE1234F";
    const doctorPhone = "+91 90000 88881";
    const doctorEmail = `doctor.private.${suffix}@serializer-test.example`;
    const doctorName = "Dr Rx Visible";
    const doctorReg = "REG-RX-4242";
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    const adminEmail = `admin.${suffix}@serializer-test.example`;
    const patientEmail = `patient.${suffix}@serializer-test.example`;
    const patientPhone = `+91 98${String(Date.now()).slice(-8)}`;
    const patientId = `pat-${suffix}`;

    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, email, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id,
           waba_id, phone_number_id, meta_access_token, meta_token_expires_at, meta_waba_name,
           meta_onboarding_status, address, city, gstin, reg_id, upi_id, whatsapp_number,
           owner_name, owner_email, owner_phone, practice_settings, created_at, updated_at, practice_type
         ) VALUES (
           ?, 'Minimised Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, ?,
           500, 0, 1, 'HFR-HIDDEN',
           'waba_hidden_canary', 'pnid_hidden_canary', ?, ?, 'Hidden WABA',
           'connected', '1 Public Lane', 'Pune', ?, 'CLINIC-REG-SECRET', 'publishedclinic@upi', '',
           ?, ?, ?, ?, ?, ?, 'individual'
         )`
      )
      .run(
        tenantId,
        ownerPhone,
        ownerEmail,
        now,
        TOKEN,
        EXPIRES,
        gstin,
        ownerName,
        ownerEmail,
        ownerPhone,
        JSON.stringify({
          walkInEnabled: true,
          tokenPrefix: "QCANARY",
          pan,
          owner_user_id: ownerUserId,
          meta_access_token: TOKEN,
          departments: ["General Medicine"],
        }),
        now,
        now
      );
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
           onboarding_completed, practice_type, specialty, last_login, created_at
         ) VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, 'Minimised Clinic', 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(ownerUserId, tenantId, adminEmail, passwordHash, ownerName, ownerPhone, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
           onboarding_completed, practice_type, specialty, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Portal Patient', 'patient', 'active', ?, 'Minimised Clinic', 1, 'individual', 'General Medicine', ?, ?, ?)`
      )
      .run(`user-patient-${suffix}`, tenantId, patientEmail, passwordHash, patientPhone, now, now, patientId);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, 'Portal Patient', 40, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(patientId, tenantId, `UHID-${suffix}`, patientPhone, patientEmail, now);
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, signature_url, active
         ) VALUES (?, ?, ?, '', ?, 'General Medicine', 0, 0, '', '[]', '09:00-13:00', ?, ?, '', '', '', '', 1)`
      )
      .run(`doc-${suffix}`, ownerUserId, doctorName, doctorReg, doctorPhone, doctorEmail);
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, follow_up_date, pdf_url, created_at, clinic_name, clinic_phone
         ) VALUES (?, ?, ?, ?, 'Portal Patient', ?, 'UHID-1', ?, ?, 'General Medicine', ?, '2026-10-16', 'Checkup', '[]', '[]', '[]', '', '', ?, 'Minimised Clinic', ?)`
      )
      .run(`rx-${suffix}`, tenantId, `RX-${suffix}`, patientId, patientPhone, `doc-${suffix}`, doctorName, doctorReg, now, ownerPhone);
    getDb()
      .prepare(
        `INSERT INTO invoices (
           id, tenant_id, invoice_number, patient_id, date, gstin, upi_id, total_amount, status, created_at,
           razorpay_order_id, issued_by, receipt_whatsapp_status
         ) VALUES (?, ?, ?, ?, '2026-10-16', ?, 'publishedclinic@upi', 500, 'Paid', ?, 'order_canary', 'Dr Hidden Owner', 'sent')`
      )
      .run(`inv-${suffix}`, tenantId, `INV-${suffix}`, patientId, gstin, now);

    const patientToken = await login(patientEmail);
    const patientAuth = { Authorization: `Bearer ${patientToken}` };
    const forbidden = [ownerPhone, ownerEmail, ownerName, ownerUserId, pan, TOKEN, doctorPhone, doctorEmail, "QCANARY", "waba_hidden_canary", "pnid_hidden_canary"];

    function assertAllowlistedTenant(tenant: Record<string, unknown>, label: string) {
      assert.deepEqual(Object.keys(tenant).sort(), [...PATIENT_TENANT_KEYS].sort(), label);
      assert.equal(tenant.name, "Minimised Clinic", label);
      assert.equal(tenant.phone, null, label);
      assert.equal(tenant.email, null, label);
      assert.equal(tenant.whatsapp_number, null, label);
      assert.equal(tenant.upi_id, "publishedclinic@upi", label);
      assert.equal(tenant.doctor_name, null, label);
      assert.equal(tenant.doctor_reg_number, null, label);
      assert.equal(tenant.opening_hours, "09:00-13:00", label);
      assert.deepEqual(tenant.specialties, ["General Medicine"], label);
      assert.equal(tenant.address, "1 Public Lane, Pune", label);
    }

    const paths = ["/api/me", "/api/auth/me", "/api/tenant/current", "/api/tenant/letterhead", "/api/appointments", "/api/doctors", "/api/prescriptions", "/api/invoices"];
    for (const path of paths) {
      const res = await jsonRequest(port, "GET", path, undefined, patientAuth);
      assert.equal(res.status, 200, `${path} ${String(res.json.error || "")}`);
      const tenant = res.json.tenant as Record<string, unknown>;
      assertAllowlistedTenant(tenant, path);
      assert.equal(JSON.stringify(tenant).includes(gstin), false, path);
      const body = JSON.stringify(res.json);
      for (const secret of forbidden) {
        assert.equal(body.includes(secret), false, `${path} leaked ${secret}`);
      }
    }

    const letterhead = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, patientAuth);
    const card = letterhead.json.letterhead as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(card, "gstin"), false);
    assert.equal(card.phone, null);
    assert.equal(card.email, null);
    assert.equal(card.whatsappNumber, null);

    const settings = await jsonRequest(port, "GET", "/api/billing/settings", undefined, patientAuth);
    assert.equal(settings.status, 403);

    const doctors = await jsonRequest(port, "GET", "/api/doctors", undefined, patientAuth);
    const doctor = (doctors.json.doctors as Record<string, unknown>[])[0];
    assert.equal(doctor.name, doctorName);
    assert.equal(doctor.regNumber, doctorReg);
    assert.equal(Object.prototype.hasOwnProperty.call(doctor, "phone"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(doctor, "email"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(doctor, "userId"), false);

    const rxs = await jsonRequest(port, "GET", "/api/prescriptions", undefined, patientAuth);
    const rx = (rxs.json.prescriptions as Array<{ doctorName: string; doctorRegNumber: string; clinicPhone: string }>)[0];
    assert.equal(rx.doctorName, doctorName);
    assert.equal(rx.doctorRegNumber, doctorReg);
    assert.equal(rx.clinicPhone, "");
    const oneRx = await jsonRequest(port, "GET", `/api/prescriptions/rx-${suffix}`, undefined, patientAuth);
    assert.equal(oneRx.status, 200);
    assert.equal((oneRx.json.tenant as { doctor_name?: string }).doctor_name, doctorName);
    assert.equal((oneRx.json.tenant as { doctor_reg_number?: string }).doctor_reg_number, doctorReg);

    const invoices = await jsonRequest(port, "GET", "/api/invoices", undefined, patientAuth);
    const invoice = (invoices.json.invoices as Record<string, unknown>[])[0];
    assert.equal(invoice.gstin, gstin);
    assert.equal(invoice.upiId, "publishedclinic@upi");
    assert.equal(Object.prototype.hasOwnProperty.call(invoice, "razorpayOrderId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(invoice, "issuedBy"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(invoice, "receiptWhatsAppStatus"), false);

    const me = await jsonRequest(port, "GET", "/api/auth/me", undefined, patientAuth);
    assert.equal(Object.prototype.hasOwnProperty.call(me.json.user, "gstin"), false);

    const staffToken = await login(adminEmail);
    const staffAuth = { Authorization: `Bearer ${staffToken}` };
    const staffMe = await jsonRequest(port, "GET", "/api/auth/me", undefined, staffAuth);
    assert.equal(staffMe.status, 200);
    const staffTenant = staffMe.json.tenant as Record<string, unknown>;
    assert.equal(staffTenant.owner_phone, ownerPhone);
    assert.equal(staffTenant.owner_email, ownerEmail);
    assert.equal(staffTenant.gstin, gstin);
    assert.equal(staffTenant.waba_id, "waba_hidden_canary");
    for (const key of Object.keys(staffTenant)) {
      assert.equal(PUBLIC_TENANT_KEYS.includes(key as (typeof PUBLIC_TENANT_KEYS)[number]), true, key);
    }
    const staffDoctors = await jsonRequest(port, "GET", "/api/doctors", undefined, staffAuth);
    assert.equal(staffDoctors.json.tenant, undefined);
    const staffDoctor = (staffDoctors.json.doctors as Array<{ phone: string; email: string; userId: string }>)[0];
    assert.equal(staffDoctor.phone, doctorPhone);
    assert.equal(staffDoctor.email, doctorEmail);
    assert.equal(staffDoctor.userId, ownerUserId);
    const staffInvoice = await jsonRequest(port, "GET", `/api/invoices/inv-${suffix}`, undefined, staffAuth);
    assert.equal((staffInvoice.json.invoice as { gstin?: string }).gstin, gstin);
    assert.equal(staffInvoice.json.tenant, undefined);
  });
});

function expectName(tenantId: string): string {
  const row = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name: string };
  return row.name;
}
