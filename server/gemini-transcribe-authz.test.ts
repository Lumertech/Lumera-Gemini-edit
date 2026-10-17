import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api.ts";
import { AMBIENT_SCRIBE_CONSENT_ACTION } from "./ambient-scribe-consent.ts";
import { getDb, initDatabase } from "./db.ts";
import { writeAudit } from "./db-seed-maps.ts";
import { mountGeminiClinicalRoutes, setGeminiTranscribeGeneratorForTests } from "./gemini-clinical.ts";
import {
  GLOBAL_JSON_BODY_LIMIT,
  MAX_TRANSCRIBE_AUDIO_BYTES,
  maxTranscribeBase64Chars,
  TRANSCRIBE_JSON_BODY_LIMIT,
} from "./json-body.ts";
import { hashPassword } from "./password.ts";
import { resetTranscribeRateLimits, setTranscribeRateLimitForTests } from "./transcribe-rate-limit.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function seedDoctor(label: string, role = "doctor", tenantId?: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenant = tenantId || `tenant-tx-${label}-${suffix}`;
  const userId = `user-tx-${label}-${suffix}`;
  const email = `tx.${label}.${suffix}@transcribe-authz.example`.toLowerCase();
  const phone = `+91${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const now = new Date().toISOString();
  const db = getDb();
  if (!tenantId) {
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
    ).run(tenant, `Transcribe ${label} ${suffix}`, phone, now, now, now);
  }
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenant, email, hashPassword("Lumera@2026"), `Dr ${label}`, role, phone, `Clinic ${label}`, now, now);
  return { tenantId: tenant, email, userId };
}

describe("POST /api/gemini/transcribe auth and body limit", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;
  let echoHits = 0;
  let clinicA: { tenantId: string; email: string; userId: string };
  let clinicB: { tenantId: string; email: string; userId: string };
  const previousKey = process.env.GEMINI_API_KEY;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    delete process.env.GEMINI_API_KEY;
    resetTranscribeRateLimits();
    setGeminiTranscribeGeneratorForTests(undefined);
    try {
      getDb();
    } catch {
      initDatabase();
    }
    clinicA = seedDoctor("a");
    clinicB = seedDoctor("b");
    const server = await startTestServer((app) => {
      app.post("/api/echo-json", (_req, res) => {
        echoHits += 1;
        res.json({ ok: true });
      });
      app.use("/api", createApiRouter());
      mountGeminiClinicalRoutes(app);
      app.use((err: { status?: number; type?: string }, _req, res, _next) => {
        if (res.headersSent) return;
        res.status(err.status || 500).json({ type: err.type || "error" });
      });
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    resetTranscribeRateLimits();
    setGeminiTranscribeGeneratorForTests(undefined);
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    return String(res.json.token || "");
  }

  function grantConsent(tenantId: string, userId: string, appointmentId: string) {
    writeAudit(getDb(), userId, "Dr", AMBIENT_SCRIBE_CONSENT_ACTION, "Patient agreed to this recording.", {
      tenantId,
      patientId: "pat-transcribe-check",
      actorRole: "doctor",
      entityType: "appointment",
      entityId: appointmentId,
    });
  }

  function usageCount(tenantId: string) {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes'")
      .get(tenantId) as { c: number };
    return Number(row.c);
  }

  it("returns 401 for an anonymous post", async () => {
    const res = await jsonRequest(port, "POST", "/api/gemini/transcribe", {
      audioBase64: "AAAA",
      mimeType: "audio/webm",
    });
    assert.equal(res.status, 401);
    assert.match(String(res.json.error || ""), /authentication required/i);
  });

  it("rejects a forged tenant id and still accepts the session tenant", async () => {
    const token = await login(clinicA.email);
    const forged = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", tenantId: clinicB.tenantId },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(forged.status, 403);
    assert.equal(forged.json.success, undefined);
    assert.equal(forged.json.transcription, undefined);

    grantConsent(clinicA.tenantId, clinicA.userId, "apt-own-visit");
    const own = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", tenantId: clinicA.tenantId, appointmentId: "apt-own-visit" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(own.status, 503, String(own.json.error || JSON.stringify(own.json)));
    assert.equal(own.json.code, "transcribe_unavailable");
    assert.doesNotMatch(JSON.stringify(own.json), /gemini/i);
  });

  it("returns 413 for a clip past 8MB before checking the API key, and leaves the global 10mb limit", async () => {
    assert.equal(GLOBAL_JSON_BODY_LIMIT, "10mb");
    assert.equal(TRANSCRIBE_JSON_BODY_LIMIT, "11.5mb");
    assert.equal(MAX_TRANSCRIBE_AUDIO_BYTES, 8 * 1024 * 1024);
    const serverSource = fs.readFileSync(path.join(root, "server.ts"), "utf8");
    assert.match(serverSource, /globalJsonParser\(\)/);
    assert.doesNotMatch(serverSource, /limit:\s*["'](?:11\.5|12)mb["']/);

    const token = await login(clinicA.email);
    const tooLong = "A".repeat(maxTranscribeBase64Chars() + 1);
    const overClip = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: tooLong, mimeType: "audio/webm" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(overClip.status, 413);
    assert.match(String(overClip.json.error || ""), /too long to transcribe/i);

    echoHits = 0;
    const overGlobal = await jsonRequest(port, "POST", "/api/echo-json", {
      blob: "x".repeat(10 * 1024 * 1024 + 200_000),
    });
    assert.equal(overGlobal.status, 413);
    assert.equal(overGlobal.json.error, undefined);
    assert.equal(echoHits, 0);
  });

  it("accepts an authenticated body above the global 10mb parser on the transcribe route", async () => {
    const token = await login(clinicA.email);
    const audioBase64 = "A".repeat(Math.floor(10.5 * 1024 * 1024));
    const res = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64, mimeType: "audio/webm", durationMs: 1000, appointmentId: "apt-parser-check" },
      { Authorization: `Bearer ${token}` }
    );
    assert.notEqual(res.json.type, "entity.too.large");
    assert.equal(res.status, 413);
    assert.match(String(res.json.error || ""), /too long to transcribe/i);
  });

  it("returns 403 for patient, reception, and super_admin", async () => {
    for (const role of ["patient", "receptionist", "super_admin"]) {
      const staff = seedDoctor(role, role);
      const token = await login(staff.email);
      const res = await jsonRequest(
        port,
        "POST",
        "/api/gemini/transcribe",
        { audioBase64: "AAAA", mimeType: "audio/webm" },
        { Authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 403, role);
      assert.equal(res.json.code, "ROLE_DENIED");
      assert.equal(res.json.transcription, undefined);
    }
  });

  it("rejects a mime type outside the allowlist and a clip longer than 90 seconds before the API key", async () => {
    resetTranscribeRateLimits();
    const token = await login(clinicA.email);
    const auth = { Authorization: `Bearer ${token}` };
    const badMime = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/ogg" },
      auth
    );
    assert.equal(badMime.status, 415);
    assert.match(String(badMime.json.error || ""), /unsupported audio type/i);

    for (const mimeType of ["audio/webm", "audio/mp4", "audio/aac", "audio/mpeg", "audio/wav", "audio/webm;codecs=opus"]) {
      const allowed = await jsonRequest(
        port,
        "POST",
        "/api/gemini/transcribe",
        { audioBase64: "AAAA", mimeType, durationMs: 1000, appointmentId: "apt-mime-no-consent" },
        auth
      );
      assert.equal(allowed.status, 409, mimeType);
      assert.equal(allowed.json.code, "consent_required");
    }

    const tooLong = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 90_001 },
      auth
    );
    assert.equal(tooLong.status, 413);
    assert.match(String(tooLong.json.error || ""), /too long to transcribe/i);
    assert.notEqual(tooLong.json.code, "transcribe_unavailable");
  });

  it("meters duration and bytes only, and rate limits the user and the tenant", async () => {
    resetTranscribeRateLimits();
    const clinical = fs.readFileSync(path.join(root, "server/gemini-clinical.ts"), "utf8");
    assert.match(clinical, /DATA USE: production must use a paid, billing-enabled Gemini API project/);
    assert.match(clinical, /function prescriberOnly[\s\S]*denyUnlessPrescriber/);
    const route = clinical.slice(clinical.indexOf('"/api/gemini/transcribe"'));
    assert.match(route, /prescriberOnly/);
    assert.match(route, /meterSuccessfulTranscription/);
    assert.doesNotMatch(route, /err\.message/);
    assert.doesNotMatch(route, /transcript\s*:/);

    const token = await login(clinicA.email);
    const beforeUsage = usageCount(clinicA.tenantId);
    const missingVisit = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 1000 },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(missingVisit.status, 400);
    assert.equal(missingVisit.json.code, "appointment_required");

    const invalidVisit = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 1000, appointmentId: "bad id" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(invalidVisit.status, 400);
    assert.equal(invalidVisit.json.code, "appointment_required");

    const noRow = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 1000, appointmentId: "apt-no-consent-row" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(noRow.status, 409);
    assert.equal(noRow.json.code, "consent_required");
    assert.doesNotMatch(JSON.stringify(noRow.json), /gemini/i);

    grantConsent(clinicB.tenantId, clinicB.userId, "apt-other-tenant-visit");
    const otherTenant = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 1000, appointmentId: "apt-other-tenant-visit" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(otherTenant.status, 409);
    assert.equal(otherTenant.json.code, "consent_required");
    assert.equal(usageCount(clinicA.tenantId), beforeUsage);

    grantConsent(clinicA.tenantId, clinicA.userId, "apt-metered-visit");
    setGeminiTranscribeGeneratorForTests(async () => "phi-transcript-marker-not-stored");
    const metered = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm", durationMs: 4000, appointmentId: "apt-metered-visit" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(metered.status, 200, JSON.stringify(metered.json));
    assert.equal(metered.json.transcription, "phi-transcript-marker-not-stored");
    const row = getDb()
      .prepare(
        "SELECT quantity, metadata FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes' ORDER BY created_at DESC LIMIT 1"
      )
      .get(clinicA.tenantId) as { quantity: number; metadata: string };
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    assert.equal(metadata.durationMs, 4000);
    assert.equal(typeof metadata.audioBytes, "number");
    assert.equal("transcript" in metadata, false);
    assert.equal(JSON.stringify(row).includes("phi-transcript-marker-not-stored"), false);
    setGeminiTranscribeGeneratorForTests(undefined);

    setTranscribeRateLimitForTests({ userMax: 2, tenantMax: 5 });
    const auth = { Authorization: `Bearer ${token}` };
    const first = await jsonRequest(port, "POST", "/api/gemini/transcribe", { audioBase64: "AAAA", mimeType: "audio/webm" }, auth);
    const second = await jsonRequest(port, "POST", "/api/gemini/transcribe", { audioBase64: "AAAA", mimeType: "audio/webm" }, auth);
    const third = await jsonRequest(port, "POST", "/api/gemini/transcribe", { audioBase64: "AAAA", mimeType: "audio/webm" }, auth);
    assert.equal(first.status, 400);
    assert.equal(second.status, 400);
    assert.equal(third.status, 429);

    const colleague = seedDoctor("colleague", "doctor", clinicA.tenantId);
    const colleagueToken = await login(colleague.email);
    const colleagueHit = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm" },
      { Authorization: `Bearer ${colleagueToken}` }
    );
    assert.equal(colleagueHit.status, 400);

    setTranscribeRateLimitForTests({ userMax: 5, tenantMax: 1 });
    const tenantFirst = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm" },
      auth
    );
    const tenantSecond = await jsonRequest(
      port,
      "POST",
      "/api/gemini/transcribe",
      { audioBase64: "AAAA", mimeType: "audio/webm" },
      { Authorization: `Bearer ${colleagueToken}` }
    );
    assert.equal(tenantFirst.status, 400);
    assert.equal(tenantSecond.status, 429);
    resetTranscribeRateLimits();
  });
});
