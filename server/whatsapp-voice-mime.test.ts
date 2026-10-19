import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { setVertexClientForTests } from "./vertex-gemini.ts";
import { installWhatsAppRouterPatch } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";

function seedDoctor() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-wa-mime-${suffix}`;
  const userId = `user-wa-mime-${suffix}`;
  const email = `wa.mime.${suffix}@voice-mime.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Voice ${suffix}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), "Dr Mime", phone, `Clinic ${suffix}`, now, now);
  return { email };
}

describe("WhatsApp voice-process audio limits", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let modelCalls = 0;
  let token = "";

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    modelCalls = 0;
    setVertexClientForTests({
      models: {
        generateContent: async () => {
          modelCalls += 1;
          return { text: "{\"transcription\":\"should-not-run\"}" };
        },
      },
    } as unknown as GoogleGenAI);
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const doctor = seedDoctor();
    installWhatsAppRouterPatch();
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
      app.use("/api/whatsapp", createWhatsAppRouter());
    });
    port = server.port;
    close = server.close;
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: doctor.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || ""));
    token = String(login.json.token || "");
  });

  after(async () => {
    setVertexClientForTests(undefined);
    await close?.();
  });

  it("rejects a mime outside the transcribe allowlist with 415 before the model", async () => {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-process",
      { audioBase64: "AAAA", mimeType: "audio/ogg" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 415);
    assert.equal(modelCalls, 0);
    assert.doesNotMatch(JSON.stringify(res.json), /gemini/i);
  });

  it("rejects an over-long clip with 413 before the model", async () => {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-process",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 120_000 },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 413);
    assert.equal(modelCalls, 0);
  });
});
