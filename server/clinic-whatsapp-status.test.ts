import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";

function seedAdmin() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-waba-status-${suffix}`;
  const userId = `user-waba-status-${suffix}`;
  const email = `waba.status.${suffix}@clinic-status.example`.toLowerCase();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
    )
    .run(tenantId, `Status Clinic ${suffix}`, `+9170${suffix.slice(0, 8)}`, now, now, now);
  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, 'Clinic Admin', 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
    )
    .run(userId, tenantId, email, hashPassword("Lumera@2026"), `+9171${suffix.slice(0, 8)}`, `Status Clinic`, now, now);
  return { tenantId, email };
}

describe("clinic WhatsApp status with no WABA", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    bootWhatsAppOwnershipSchema();
    const server = await startTestServer((app) => {
      app.use("/api", practitionerLinkMiddleware);
      app.use("/api", createWhatsAppNumbersRouter());
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  it("shows a clinic admin as not connected and returns no template rows", async () => {
    const clinic = seedAdmin();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
         VALUES (?, ?, '204800000000000', 'clinic_appointment_reminder', 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
      )
      .run(`tpl-status-${clinic.tenantId}`, clinic.tenantId, now, now);
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinic.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || "login"));
    const auth = { Authorization: `Bearer ${String(login.json.token || "")}` };
    const status = await jsonRequest(port, "GET", "/api/meta/whatsapp-clinic-status", undefined, auth);
    assert.equal(status.status, 200, JSON.stringify(status.json));
    assert.equal(status.json.connected, false);
    assert.deepEqual(status.json.templates, []);
    assert.equal(JSON.stringify(status.json.templates).includes("clinic_appointment_reminder"), false);
    const mine = await jsonRequest(port, "GET", "/api/whatsapp-numbers/mine", undefined, auth);
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    const tenantNumber = mine.json.tenantNumber as { status?: string } | null;
    assert.equal(tenantNumber, null);
  });
});
