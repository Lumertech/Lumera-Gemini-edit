import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser, requireAuth } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import {
  applyWalletTransaction,
  billedAmountFromRaw,
  getMarkupPercent,
  listWalletTransactions,
  publicWalletStatus,
  recordAiScribeUsage,
  scribeQuantityMinutes,
  transcriptScribeMinutes,
} from "./usage-billing.ts";
import { GEMINI_SCRIBE_RAW_COST_INR } from "./usage-rates.ts";
import {
  blockedAiScribeResponse,
  meterSuccessfulGeminiScribe,
  runMeteredGeminiScribe,
} from "./gemini-scribe-meter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOAP_TRANSCRIPT =
  "Patient reports cough and fever for three days. No chest pain. Advise rest and fluids.";

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

function createClinic(label: string, creditRupees: number) {
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
  const tenantId = `tenant-scribe-${label}-${suffix}`;
  const clinicEmail = `${label}.scribe.${suffix}@usage-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Scribe ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(
    `user-scribe-${suffix}`,
    tenantId,
    clinicEmail,
    hashPassword("Lumera@2026"),
    `Scribe ${label}`,
    "+91 90000 33333",
    `Scribe ${label}`,
    now,
    now
  );
  publicWalletStatus(tenantId);
  if (creditRupees > 0) {
    applyWalletTransaction(tenantId, "adjustment", creditRupees, {
      note: "Scribe test seed credit",
      createdBy: "system",
    });
  }
  return { tenantId, clinicEmail };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function usageCount(tenantId: string) {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes'")
      .get(tenantId) as { c: number }
  ).c;
}

function debitCount(tenantId: string) {
  return listWalletTransactions(tenantId, 50).filter((t) => t.type === "usage_debit").length;
}

describe("Gemini ambient-scribe usage meter", () => {
  let port = 0;
  let server: Server | undefined;
  let generateCalls = 0;
  let generateImpl: () => Promise<Record<string, unknown>> = async () => ({
    subjective: { chiefComplaints: ["cough"] },
  });

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-gemini-scribe-meter";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_SCRIBE_RAW_COST_INR;
    process.env.NODE_ENV = "test";
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api/gemini", requireAuth);
    app.use("/api", createApiRouter());
    app.post("/api/gemini/generate-soap", async (req, res) => {
      try {
        const transcript = String((req.body || {}).transcript || "");
        if (!transcript || transcript.trim().length < 5) {
          return res.status(400).json({ error: "Consultation transcript is required" });
        }
        const tenantId = String(req.user?.tenantId || "").trim();
        const blocked = blockedAiScribeResponse(tenantId);
        if (blocked) {
          return res.status(blocked.status).json(blocked.body);
        }
        generateCalls += 1;
        const soap = await generateImpl();
        meterSuccessfulGeminiScribe({
          tenantId,
          durationMinutes: (req.body || {}).durationMinutes,
          transcript,
          metadata: { source: "gemini-3.7-flash", endpoint: "generate-soap" },
        });
        return res.json({ success: true, soap, source: "gemini-3.7-flash" });
      } catch (error: any) {
        return res.status(500).json({ error: "Failed to generate SOAP note", details: error.message });
      }
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    port = addr.port;
  });

  after(async () => {
    delete process.env.GEMINI_SCRIBE_RAW_COST_INR;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  });

  it("over-quota / empty wallet blocks the Gemini call with 402 and does not record usage_debit", async () => {
    const { tenantId, clinicEmail } = createClinic("empty", 0);
    assert.equal(publicWalletStatus(tenantId).balance, 0);
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinicEmail,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || "login"));
    const auth = { Authorization: `Bearer ${String(login.json.token)}` };
    const beforeCalls = generateCalls;
    const beforeUsage = usageCount(tenantId);
    const beforeDebits = debitCount(tenantId);
    const generateWasCalled = { value: false };
    const result = await runMeteredGeminiScribe({
      tenantId,
      durationMinutes: 2,
      transcript: SOAP_TRANSCRIPT,
      metadata: { test: "over-quota" },
      generate: async () => {
        generateWasCalled.value = true;
        return { ok: true };
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 402);
      assert.match(String(result.body.error), /Top up now/i);
    }
    assert.equal(generateWasCalled.value, false);
    const soap = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript: SOAP_TRANSCRIPT, durationMinutes: 2 },
      auth
    );
    assert.equal(soap.status, 402);
    assert.equal(soap.json.code, "WALLET_INSUFFICIENT");
    assert.match(String(soap.json.error), /Top up now/i);
    assert.equal("success" in soap.json, false);
    assert.equal(generateCalls, beforeCalls);
    assert.equal(usageCount(tenantId), beforeUsage);
    assert.equal(debitCount(tenantId), beforeDebits);
  });

  it("within quota records usage_events and usage_debit after a successful mocked Gemini response", async () => {
    const prev = process.env.GEMINI_SCRIBE_RAW_COST_INR;
    process.env.GEMINI_SCRIBE_RAW_COST_INR = "1";
    try {
      const { tenantId, clinicEmail } = createClinic("funded", 1000);
      const login = await jsonRequest(port, "POST", "/api/auth/login", {
        email: clinicEmail,
        password: "Lumera@2026",
        skipOtp: true,
      });
      assert.equal(login.status, 200, String(login.json.error || "login"));
      const auth = { Authorization: `Bearer ${String(login.json.token)}` };
      const before = publicWalletStatus(tenantId).balance;
      const beforeUsage = usageCount(tenantId);
      generateImpl = async () => ({ subjective: { chiefComplaints: ["fever"] } });
      const soap = await jsonRequest(
        port,
        "POST",
        "/api/gemini/generate-soap",
        { transcript: SOAP_TRANSCRIPT, durationMinutes: 1 },
        auth
      );
      assert.equal(soap.status, 200, String(soap.json.error || "soap"));
      assert.equal(soap.json.success, true);
      assert.equal(soap.json.source, "gemini-3.7-flash");
      assert.ok(usageCount(tenantId) >= beforeUsage + 1);
      const event = getDb()
        .prepare(
          `SELECT * FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes' ORDER BY created_at DESC LIMIT 1`
        )
        .get(tenantId) as { quantity: number; raw_cost: number | null; metadata: string };
      assert.equal(event.quantity, scribeQuantityMinutes({ transcript: SOAP_TRANSCRIPT, durationMinutes: 1 }));
      assert.equal(Number(event.raw_cost), 1);
      const meta = JSON.parse(event.metadata || "{}") as { endpoint?: string };
      assert.equal(meta.endpoint, "generate-soap");
      const markup = getMarkupPercent(tenantId, "ai_scribe_minutes");
      const billed = billedAmountFromRaw(1, markup);
      assert.ok(billed > 0);
      assert.equal(round4(publicWalletStatus(tenantId).balance), round4(before - billed));
      const debit = listWalletTransactions(tenantId, 8).find((t) => t.type === "usage_debit");
      assert.ok(debit);
      assert.equal(round4(debit!.amount), round4(-billed));
    } finally {
      if (prev === undefined) delete process.env.GEMINI_SCRIBE_RAW_COST_INR;
      else process.env.GEMINI_SCRIBE_RAW_COST_INR = prev;
    }
  });

  it("wildly understated client durationMinutes does not reduce billed quantity", async () => {
    const { tenantId, clinicEmail } = createClinic("understated", 500);
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinicEmail,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || "login"));
    const auth = { Authorization: `Bearer ${String(login.json.token)}` };
    const transcript = Array.from({ length: 650 }, (_, i) => `symptom${i}`).join(" ");
    const estimated = transcriptScribeMinutes(transcript);
    assert.ok(estimated > 1);
    const soap = await jsonRequest(
      port,
      "POST",
      "/api/gemini/generate-soap",
      { transcript, durationMinutes: 0.1 },
      auth
    );
    assert.equal(soap.status, 200, String(soap.json.error || "soap"));
    const event = getDb()
      .prepare(
        `SELECT * FROM usage_events WHERE tenant_id = ? AND resource = 'ai_scribe_minutes' ORDER BY created_at DESC LIMIT 1`
      )
      .get(tenantId) as { quantity: number };
    assert.equal(event.quantity, estimated);
    assert.ok(event.quantity > 0.1);
    assert.equal(scribeQuantityMinutes({ transcript, durationMinutes: 0.1 }), estimated);
  });

  it("failed Gemini generate does not insert usage_events or debit", async () => {
    const prev = process.env.GEMINI_SCRIBE_RAW_COST_INR;
    process.env.GEMINI_SCRIBE_RAW_COST_INR = "1";
    try {
      const { tenantId } = createClinic("fail", 500);
      const beforeBal = publicWalletStatus(tenantId).balance;
      const beforeUsage = usageCount(tenantId);
      await assert.rejects(
        () =>
          runMeteredGeminiScribe({
            tenantId,
            durationMinutes: 3,
            transcript: SOAP_TRANSCRIPT,
            generate: async () => {
              throw new Error("gemini-down");
            },
          }),
        /gemini-down/
      );
      assert.equal(usageCount(tenantId), beforeUsage);
      assert.equal(publicWalletStatus(tenantId).balance, beforeBal);
    } finally {
      if (prev === undefined) delete process.env.GEMINI_SCRIBE_RAW_COST_INR;
      else process.env.GEMINI_SCRIBE_RAW_COST_INR = prev;
    }
  });

  it("null GEMINI_SCRIBE_RAW_COST_INR still records minutes but does not invent a debit", () => {
    delete process.env.GEMINI_SCRIBE_RAW_COST_INR;
    assert.equal(GEMINI_SCRIBE_RAW_COST_INR, null);
    const { tenantId } = createClinic("null-cost", 200);
    const before = publicWalletStatus(tenantId).balance;
    const recorded = recordAiScribeUsage({ tenantId, quantityMinutes: 2, metadata: { test: true } });
    assert.ok(recorded);
    assert.equal(recorded!.rawCost, null);
    assert.equal(recorded!.billedAmount, 0);
    assert.equal(publicWalletStatus(tenantId).balance, before);
  });

  it("server.ts instruments the real generateContent call site and is not truncated", () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, "../server.ts"), "utf8");
    const restSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-rest.ts"), "utf8");
    const helperSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-helpers.ts"), "utf8");
    const combined =
      serverSrc.split("\n").length + restSrc.split("\n").length + helperSrc.split("\n").length;
    assert.ok(
      combined >= 649,
      `generate-soap plus gemini-clinical-rest/helpers must stay at/above main server.ts (649); got ${combined}`
    );
    assert.match(serverSrc, /blockedAiScribeResponse/);
    assert.match(serverSrc, /meterSuccessfulGeminiScribe/);
    assert.match(serverSrc, /ai\.models\.generateContent/);
    assert.match(serverSrc, /clinical-synthesis-engine/);
    assert.match(serverSrc, /createUsageBillingRouter/);
    assert.match(restSrc, /\/api\/gemini\/copilot/);
    assert.match(restSrc, /startLumeraServer/);
    const usageApi = fs.readFileSync(path.join(__dirname, "usage-billing-api.ts"), "utf8");
    assert.equal(/api\.post\("\/gemini\/generate-soap"/.test(usageApi), false);
  });
});
