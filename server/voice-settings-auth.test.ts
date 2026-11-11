import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AuthUser } from "./auth.ts";
import { getDb, initDatabase } from "./db.ts";
import { mountGeminiClinicalRoutes } from "./gemini-clinical.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

describe("POST /api/whatsapp/voice-settings clinic manager guard", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-voice-settings";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use((req, _res, next) => {
        const role = String(req.headers["x-test-role"] || "");
        if (role) {
          const actor: AuthUser = {
            id: "user-voice-guard",
            role: role as AuthUser["role"],
            tenantId: "tenant-voice-guard",
            email: "voice-guard@example.com",
            name: "Voice Guard",
            status: "active",
            phone: "",
            lastLogin: null,
            createdAt: "2026-11-11T00:00:00.000Z",
          };
          req.user = actor;
        }
        next();
      });
      mountGeminiClinicalRoutes(app);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  it("lets a clinic manager save an Indian transfer number and refuses everyone else", async () => {
    const anon = await jsonRequest(port, "POST", "/api/whatsapp/voice-settings", {
      voiceEnabled: true,
      escalationPhone: "+91 98200 11111",
    });
    assert.equal(anon.status, 401);

    const reception = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-settings",
      { escalationPhone: "+91 98200 11111" },
      { "x-test-role": "receptionist" }
    );
    assert.equal(reception.status, 403);

    const doctor = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-settings",
      { voiceEnabled: true, escalationPhone: "+91 98200 11111" },
      { "x-test-role": "doctor" }
    );
    assert.equal(doctor.status, 403);

    const invalid = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-settings",
      { escalationPhone: "+1 202 555 0100" },
      { "x-test-role": "CLINIC_ADMIN" }
    );
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.json.error || ""), /Indian/);

    const platform = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-settings",
      { voiceEnabled: true, escalationPhone: "+91 98200 33333" },
      { "x-test-role": "super_admin" }
    );
    assert.equal(platform.status, 200);

    const saved = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/voice-settings",
      { voiceEnabled: false, escalationPhone: "+91 98200 11111", receptionistName: "Maya" },
      { "x-test-role": "CLINIC_ADMIN" }
    );
    assert.equal(saved.status, 200);
    const settings = saved.json.settings as { escalationPhone?: string; voiceEnabled?: boolean } | undefined;
    assert.equal(settings?.escalationPhone, "+91 98200 11111");
    assert.equal(settings?.voiceEnabled, false);
  });
});
