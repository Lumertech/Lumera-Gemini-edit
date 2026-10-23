import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { createApiRouter, otpEventTenantId, uniqueOtpClinicId } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { applyWhatsAppOutboundStatus } from "./meta.ts";
import { hashPassword } from "./password.ts";
import { installWhatsAppRouterPatch, protectWhatsAppDashboard } from "./whatsapp-dashboard-guard.ts";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { ensureWhatsAppOwnershipSchema } from "./whatsapp-numbers-store.ts";
import { backfillWhatsAppTenantIds, WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";
import { META_REVIEW_TENANT_ID } from "./tenant-slug.ts";
import { consumeSendOtpAttempt, SEND_OTP_MAX_PER_PHONE, resetSendOtpRateLimits } from "./otp-rate-limit.ts";
import { startTestServer, type TestHttpServer } from "./test-http.ts";

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

function createClinic(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@wa-iso.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `Dr ${label}`, `+91 97000 ${suffix.slice(0, 5)}`, `Clinic ${label}`, now, now);
  return { tenantId, userId, email };
}

describe("WhatsApp tenant backfill", () => {
  it("assigns tenant_id from the WABA phone line or the patient and leaves the rest unassigned", () => {
    const file = path.join(os.tmpdir(), `lumera-wa-tenant-${process.pid}-${Date.now()}.db`);
    const db = new DatabaseSync(file);
    try {
      db.exec(`
        CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          waba_id TEXT,
          phone_number_id TEXT
        );
        CREATE TABLE patients (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          phone TEXT
        );
        CREATE TABLE whatsapp_conversations (
          id TEXT PRIMARY KEY,
          patient_phone TEXT,
          patient_id TEXT,
          tenant_id TEXT,
          phone_number_id TEXT,
          waba_id TEXT
        );
        CREATE TABLE whatsapp_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          tenant_id TEXT
        );
        CREATE TABLE whatsapp_numbers (
          phone_number_id TEXT,
          waba_id TEXT,
          owner_type TEXT,
          owner_id TEXT
        );
      `);
      const before = {
        name: "Lumera Apex PolyClinic",
        waba_id: "waba-meta-review",
        phone_number_id: "111122223333",
      };
      db.prepare("INSERT INTO tenants (id, name, waba_id, phone_number_id) VALUES (?, ?, ?, ?)").run(
        META_REVIEW_TENANT_ID,
        before.name,
        before.waba_id,
        before.phone_number_id
      );
      db.prepare("INSERT INTO tenants (id, name, waba_id, phone_number_id) VALUES (?, ?, ?, ?)").run(
        "tenant-b",
        "Clinic B",
        "waba-b",
        "444455556666"
      );
      db.prepare("INSERT INTO tenants (id, name, waba_id, phone_number_id) VALUES (?, ?, ?, ?)").run(
        "tenant-c",
        "Clinic C",
        "",
        ""
      );
      db.prepare("INSERT INTO patients (id, tenant_id, phone) VALUES (?, ?, ?)").run("pat-b", "tenant-b", "+91 98111 22222");
      db.prepare("INSERT INTO patients (id, tenant_id, phone) VALUES (?, ?, ?)").run("pat-meta", META_REVIEW_TENANT_ID, "+91 90000 11111");
      db.prepare("INSERT INTO patients (id, tenant_id, phone) VALUES (?, ?, ?)").run("pat-c", "tenant-c", "+91 97777 66666");
      db.prepare("INSERT INTO whatsapp_numbers (phone_number_id, waba_id, owner_type, owner_id) VALUES (?, ?, 'tenant', ?)").run(
        "444455556666",
        "waba-b",
        "tenant-b"
      );

      db.prepare(
        "INSERT INTO whatsapp_conversations (id, patient_phone, patient_id, tenant_id, phone_number_id, waba_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("conv-line", "+15550001", "", "", "444455556666", "");
      db.prepare(
        "INSERT INTO whatsapp_conversations (id, patient_phone, patient_id, tenant_id, phone_number_id, waba_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("conv-patient", "+91 98111 22222", "pat-b", "", "", "");
      db.prepare(
        "INSERT INTO whatsapp_conversations (id, patient_phone, patient_id, tenant_id, phone_number_id, waba_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("conv-phone", "+91 97777 66666", "", "", "", "");
      db.prepare(
        "INSERT INTO whatsapp_conversations (id, patient_phone, patient_id, tenant_id, phone_number_id, waba_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("conv-orphan", "+91 90000 00000", "", "", "", "");
      db.prepare(
        "INSERT INTO whatsapp_conversations (id, patient_phone, patient_id, tenant_id, phone_number_id, waba_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("conv-meta-kept", "+91 90000 11111", "pat-c", META_REVIEW_TENANT_ID, "", "");
      db.prepare("INSERT INTO whatsapp_messages (id, conversation_id, tenant_id) VALUES (?, ?, ?)").run(
        "msg-patient",
        "conv-patient",
        ""
      );
      db.prepare("INSERT INTO whatsapp_messages (id, conversation_id, tenant_id) VALUES (?, ?, ?)").run(
        "msg-orphan",
        "conv-orphan",
        ""
      );

      backfillWhatsAppTenantIds(db);

      const tenant = db.prepare("SELECT name, waba_id, phone_number_id FROM tenants WHERE id = ?").get(META_REVIEW_TENANT_ID) as {
        name: string;
        waba_id: string;
        phone_number_id: string;
      };
      assert.equal(tenant.name, before.name);
      assert.equal(tenant.waba_id, before.waba_id);
      assert.equal(tenant.phone_number_id, before.phone_number_id);

      const tenantOf = (id: string) =>
        String((db.prepare("SELECT tenant_id FROM whatsapp_conversations WHERE id = ?").get(id) as { tenant_id: string }).tenant_id || "");
      assert.equal(tenantOf("conv-line"), "tenant-b");
      assert.equal(tenantOf("conv-patient"), "tenant-b");
      assert.equal(tenantOf("conv-phone"), "tenant-c");
      assert.equal(tenantOf("conv-orphan"), WHATSAPP_QUARANTINE_TENANT_ID);
      assert.notEqual(tenantOf("conv-orphan"), "");
      assert.equal(tenantOf("conv-meta-kept"), META_REVIEW_TENANT_ID);
      assert.equal(
        String((db.prepare("SELECT tenant_id FROM whatsapp_messages WHERE id = ?").get("msg-patient") as { tenant_id: string }).tenant_id),
        "tenant-b"
      );
      assert.equal(
        String((db.prepare("SELECT tenant_id FROM whatsapp_messages WHERE id = ?").get("msg-orphan") as { tenant_id: string }).tenant_id || ""),
        WHATSAPP_QUARANTINE_TENANT_ID
      );
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
    }
  });
});

describe("WhatsApp tenant scope, send validation, OTP limit, invoice UHID", () => {
  let server: TestHttpServer;

  before(async () => {
    installWhatsAppRouterPatch();
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-wa-tenant";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    server = await startTestServer((app) => {
      app.use("/api/whatsapp", protectWhatsAppDashboard(createWhatsAppRouter()));
      app.use("/api", createApiRouter());
    });
  });

  after(async () => {
    await server.close();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(server.port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login failed"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("tenant A cannot list, read, or send in tenant B's conversation", async () => {
    const a = createClinic("waA");
    const b = createClinic("waB");
    const tokenA = await login(a.email);
    const tokenB = await login(b.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const phone = `+91 96${String(Date.now()).slice(-8)}`;
    const sent = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        conversationId: `conv-${a.tenantId.slice(-8)}`,
        patientPhone: phone,
        patientName: "Tenant A Only",
        sender: "agent",
        content: "Visible to clinic A only",
      },
      authA
    );
    assert.equal(sent.status, 201, String(sent.json.error || ""));
    const convId = String((sent.json.sentMessage as { conversationId?: string } | undefined)?.conversationId || "");
    assert.ok(convId);
    const stored = getDb().prepare("SELECT tenant_id FROM whatsapp_conversations WHERE id = ?").get(convId) as {
      tenant_id: string;
    };
    assert.equal(stored.tenant_id, a.tenantId);
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE conversation_id = ?").get(convId) as {
      c: number;
    };

    const listB = await jsonRequest(server.port, "GET", "/api/whatsapp/conversations", undefined, authB);
    assert.equal(listB.status, 200);
    const idsB = ((listB.json.conversations as Array<{ id: string }>) || []).map((row) => row.id);
    assert.equal(idsB.includes(convId), false);

    const forgedList = await jsonRequest(
      server.port,
      "GET",
      `/api/whatsapp/conversations?tenantId=${encodeURIComponent(a.tenantId)}`,
      undefined,
      authB
    );
    assert.ok(forgedList.status === 403 || forgedList.status === 404);

    const readB = await jsonRequest(server.port, "GET", `/api/whatsapp/conversations/${convId}`, undefined, authB);
    assert.equal(readB.status, 404);
    const threadB = await jsonRequest(server.port, "GET", `/api/whatsapp/messages/${encodeURIComponent(convId)}`, undefined, authB);
    assert.equal(threadB.status, 404);

    const sendB = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      {
        conversationId: convId,
        patientPhone: phone,
        patientName: "Intruder",
        sender: "agent",
        content: "should not land in clinic A",
      },
      authB
    );
    assert.equal(sendB.status, 404);
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE conversation_id = ?").get(convId) as {
      c: number;
    };
    assert.equal(after.c, before.c);

    const listA = await jsonRequest(server.port, "GET", "/api/whatsapp/conversations", undefined, authA);
    const idsA = ((listA.json.conversations as Array<{ id: string }>) || []).map((row) => row.id);
    assert.equal(idsA.includes(convId), true);
    const threadA = await jsonRequest(server.port, "GET", `/api/whatsapp/messages/${encodeURIComponent(convId)}`, undefined, authA);
    assert.equal(threadA.status, 200);
    const contents = ((threadA.json.messages as Array<{ content?: string }>) || []).map((row) => row.content);
    assert.equal(contents.includes("Visible to clinic A only"), true);
    assert.equal(contents.includes("should not land in clinic A"), false);
  });

  it("inbound webhook stamps the tenant from metadata.phone_number_id and leaves unknown lines unassigned", async () => {
    const clinic = createClinic("waHook");
    const phoneNumberId = `9${String(Date.now()).slice(-11)}`;
    getDb().prepare("UPDATE tenants SET phone_number_id = ?, waba_id = ? WHERE id = ?").run(phoneNumberId, `waba-${phoneNumberId}`, clinic.tenantId);
    const metaBefore = getDb()
      .prepare("SELECT name, waba_id, phone_number_id FROM tenants WHERE id = ?")
      .get(META_REVIEW_TENANT_ID) as { name: string; waba_id: string; phone_number_id: string };

    const secret = "wa-tenant-webhook-secret";
    const prevSecret = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = secret;
    const fromPhone = `1555${String(Date.now()).slice(-8)}`;
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: `waba-${phoneNumberId}`,
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId, display_phone_number: "15551230000" },
                messages: [{ from: fromPhone, text: { body: "Hello clinic" } }],
              },
            },
          ],
        },
      ],
    };
    try {
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const res = await fetch(`http://127.0.0.1:${server.port}/api/meta/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` },
        body: raw,
      });
      assert.equal(res.status, 200);
      const row = getDb()
        .prepare("SELECT id, tenant_id, phone_number_id, last_inbound_at FROM whatsapp_conversations WHERE patient_phone = ? AND tenant_id = ?")
        .get(fromPhone, clinic.tenantId) as { id: string; tenant_id: string; phone_number_id: string; last_inbound_at: string };
      assert.equal(row.tenant_id, clinic.tenantId);
      assert.equal(row.phone_number_id, phoneNumberId);
      assert.ok(String(row.last_inbound_at || "").trim());
      const otherClinic = createClinic("waHookB");
      const otherToken = await login(otherClinic.email);
      const otherList = await jsonRequest(server.port, "GET", "/api/whatsapp/conversations", undefined, {
        Authorization: `Bearer ${otherToken}`,
      });
      const otherIds = ((otherList.json.conversations as Array<{ id: string }>) || []).map((item) => item.id);
      assert.equal(otherIds.includes(row.id), false);
      const message = getDb()
        .prepare("SELECT tenant_id FROM whatsapp_messages WHERE patient_phone = ?")
        .get(fromPhone) as { tenant_id: string };
      assert.equal(message.tenant_id, clinic.tenantId);

      const unknownFrom = `1666${String(Date.now()).slice(-8)}`;
      const unknown = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba-unknown",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "000000009999" },
                  messages: [{ from: unknownFrom, text: { body: "unassigned" } }],
                },
              },
            ],
          },
        ],
      };
      const unknownRaw = JSON.stringify(unknown);
      const unknownSig = crypto.createHmac("sha256", secret).update(unknownRaw).digest("hex");
      const unknownRes = await fetch(`http://127.0.0.1:${server.port}/api/meta/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${unknownSig}` },
        body: unknownRaw,
      });
      assert.equal(unknownRes.status, 200);
      const orphan = getDb()
        .prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ?")
        .get(unknownFrom) as { id: string } | undefined;
      assert.equal(orphan, undefined);
      const orphanMessage = getDb()
        .prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?")
        .get(unknownFrom) as { id: string } | undefined;
      assert.equal(orphanMessage, undefined);
    } finally {
      if (prevSecret === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevSecret;
    }

    const metaAfter = getDb()
      .prepare("SELECT name, waba_id, phone_number_id FROM tenants WHERE id = ?")
      .get(META_REVIEW_TENANT_ID) as { name: string; waba_id: string; phone_number_id: string };
    assert.equal(metaAfter.name, metaBefore.name);
    assert.equal(metaAfter.waba_id, metaBefore.waba_id);
    assert.equal(metaAfter.phone_number_id, metaBefore.phone_number_id);
  });

  it("POST /api/whatsapp/send without fields returns 400 and does not use the Rajiv fallback", async () => {
    const clinic = createClinic("waSend");
    const token = await login(clinic.email);
    const before = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations WHERE patient_phone = ?").get("+91 98234 55667") as {
      c: number;
    };
    const missing = await jsonRequest(server.port, "POST", "/api/whatsapp/send", {}, { Authorization: `Bearer ${token}` });
    assert.equal(missing.status, 400);
    const phoneOnly = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send",
      { patientPhone: "+91 98100 00001" },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(phoneOnly.status, 400);
    const after = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations WHERE patient_phone = ?").get("+91 98234 55667") as {
      c: number;
    };
    assert.equal(after.c, before.c);
    const created = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations WHERE patient_name = 'Rajiv Saxena' AND tenant_id = ?")
      .get(clinic.tenantId) as { c: number };
    assert.equal(created.c, 0);
    const fallbackName = getDb()
      .prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations WHERE patient_name = 'Patient' AND tenant_id = ?")
      .get(clinic.tenantId) as { c: number };
    assert.equal(fallbackName.c, 0);
  });

  it("send-otp returns 429 after 3 requests for the same phone", async () => {
    resetSendOtpRateLimits();
    const phone = `+91 93${String(Date.now()).slice(-8)}`;
    const client = { "X-Forwarded-For": "203.0.113.44" };
    const statuses: number[] = [];
    const verificationIds: string[] = [];
    for (let i = 0; i < SEND_OTP_MAX_PER_PHONE + 1; i += 1) {
      const res = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", { phone, purpose: "login" }, client);
      statuses.push(res.status);
      if (res.status === 200) verificationIds.push(String(res.json.verificationId || ""));
    }
    assert.deepEqual(statuses.slice(0, SEND_OTP_MAX_PER_PHONE).includes(429), false);
    assert.equal(statuses[SEND_OTP_MAX_PER_PHONE], 429);
    assert.ok(verificationIds.length >= 2);
    assert.equal(new Set(verificationIds).size, 1);
    const otherPhone = await jsonRequest(
      server.port,
      "POST",
      "/api/auth/whatsapp/send-otp",
      {
        phone: `+91 94${String(Date.now()).slice(-8)}`,
        purpose: "login",
      },
      client
    );
    assert.equal(otherPhone.status, 429);
    resetSendOtpRateLimits();
  });

  it("creating an invoice copies the patient UHID", async () => {
    const clinic = createClinic("waBill");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const phone = `+91 95${String(Date.now()).slice(-8)}`;
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "UHID Patient", phone, age: 41, gender: "Female" },
      auth
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patient = patientRes.json.patient as { id: string; uhid: string; name: string; phone: string };
    assert.ok(patient.uhid);

    const created = await jsonRequest(
      server.port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        patientUhid: "WRONG-UHID",
        items: [{ description: "OPD consult", quantity: 1, unitPrice: 500, total: 500 }],
      },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const invoice = created.json.invoice as { patientUhid: string; id: string };
    assert.equal(invoice.patientUhid, patient.uhid);
    const row = getDb().prepare("SELECT patient_uhid FROM invoices WHERE id = ?").get(invoice.id) as { patient_uhid: string };
    assert.equal(row.patient_uhid, patient.uhid);
  });

  it("send-otp reuses the pending verification when the phone format changes", async () => {
    resetSendOtpRateLimits();
    const digits = `93${String(Date.now()).slice(-8)}`;
    const formatted = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    const first = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: formatted,
      purpose: "login",
    });
    assert.equal(first.status, 200, String(first.json.error || ""));
    const second = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: digits,
      purpose: "login",
    });
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.equal(second.json.reused, true);
    assert.equal(String(second.json.verificationId || ""), String(first.json.verificationId || ""));
    resetSendOtpRateLimits();
  });

  it("send-otp does not reuse a code across +1 and +91 numbers that share the last 10 digits", async () => {
    resetSendOtpRateLimits();
    const local = `93${String(Date.now()).slice(-8)}`;
    const email = `country.${local}@wa-iso.example`;
    const india = `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
    const us = `+1 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
    const first = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: india,
      email,
      purpose: "login",
    });
    assert.equal(first.status, 200, String(first.json.error || ""));
    resetSendOtpRateLimits();
    const second = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: us,
      email,
      purpose: "login",
    });
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.notEqual(second.json.reused, true);
    assert.notEqual(String(second.json.verificationId || ""), String(first.json.verificationId || ""));
    resetSendOtpRateLimits();
  });

  it("send-otp does not reuse a code locked after 5 wrong attempts", async () => {
    resetSendOtpRateLimits();
    const phone = `+91 92${String(Date.now()).slice(-8)}`;
    const email = `locked.${phone.replace(/\D/g, "")}@wa-iso.example`;
    const first = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone,
      email,
      purpose: "login",
    });
    assert.equal(first.status, 200, String(first.json.error || ""));
    const verificationId = String(first.json.verificationId || "");
    assert.ok(verificationId);
    for (let i = 0; i < 4; i += 1) {
      const wrong = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
        verificationId,
        otp: "000000",
      });
      assert.equal(wrong.status, 400, String(wrong.json.error || ""));
    }
    const locked = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: "000000",
    });
    assert.equal(locked.status, 429, String(locked.json.error || ""));
    resetSendOtpRateLimits();
    const second = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone,
      email,
      purpose: "login",
    });
    assert.equal(second.status, 200, String(second.json.error || ""));
    assert.notEqual(second.json.reused, true);
    assert.notEqual(String(second.json.verificationId || ""), verificationId);
    resetSendOtpRateLimits();
  });

  it("OTP threads ignore a shared last-10 suffix and status follows the sending line", async () => {
    const indiaClinic = createClinic("otpIn");
    const usClinic = createClinic("otpUs");
    const lineClinic = createClinic("otpLine");
    const local = `98${String(Date.now()).slice(-8)}`;
    const indiaPhone = `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
    const usPhone = `+1 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare("UPDATE users SET phone = ?, last_login = ? WHERE id = ?").run(indiaPhone, now, indiaClinic.userId);
    db.prepare("UPDATE users SET phone = ?, last_login = ? WHERE id = ?").run(usPhone, now, usClinic.userId);
    assert.equal(uniqueOtpClinicId(usPhone), usClinic.tenantId);
    assert.equal(uniqueOtpClinicId(indiaPhone), indiaClinic.tenantId);
    assert.notEqual(uniqueOtpClinicId(usPhone), indiaClinic.tenantId);

    const linePhoneNumberId = `9${String(Date.now()).slice(-11)}`;
    db.prepare("UPDATE tenants SET phone_number_id = ? WHERE id = ?").run(linePhoneNumberId, lineClinic.tenantId);
    const prevToken = process.env.META_ACCESS_TOKEN;
    const prevPhone = process.env.META_PHONE_NUMBER_ID;
    process.env.META_ACCESS_TOKEN = "EAA" + "a".repeat(40);
    process.env.META_PHONE_NUMBER_ID = linePhoneNumberId;
    try {
      assert.equal(otpEventTenantId(indiaPhone), lineClinic.tenantId);
      assert.notEqual(otpEventTenantId(indiaPhone), indiaClinic.tenantId);
      process.env.META_PHONE_NUMBER_ID = "000000001111";
      assert.equal(otpEventTenantId(indiaPhone), WHATSAPP_QUARANTINE_TENANT_ID);
    } finally {
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
      if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
      else process.env.META_PHONE_NUMBER_ID = prevPhone;
    }

    resetSendOtpRateLimits();
    const sent = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: usPhone,
      purpose: "login",
      name: "US Clinician",
    });
    assert.equal(sent.status, 200, String(sent.json.error || ""));
    const thread = db
      .prepare("SELECT tenant_id FROM whatsapp_conversations WHERE patient_phone = ?")
      .get(usPhone) as { tenant_id: string } | undefined;
    assert.equal(thread?.tenant_id, usClinic.tenantId);
    const wrong = db
      .prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ? AND tenant_id = ?")
      .get(usPhone, indiaClinic.tenantId) as { id?: string } | undefined;
    assert.equal(wrong, undefined);
    resetSendOtpRateLimits();
  });

  it("OTP, receipt, and Rx writes stay on the sending clinic and status can see that tenant", async () => {
    resetSendOtpRateLimits();
    const clinicA = createClinic("isoA");
    const clinicB = createClinic("isoB");
    const now = new Date().toISOString();
    const db = getDb();
    const sentinel = "clinic-b-must-stay";
    const tailOf = (phone: string) => phone.replace(/\D/g, "").slice(-8);
    const plant = (phone: string, id: string) => {
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES (?, ?, 'Clinic B Patient', ?, ?, ?)`
      ).run(id, phone, sentinel, now, clinicB.tenantId);
    };
    const assertForeign = (id: string) => {
      const foreign = db.prepare("SELECT tenant_id, last_message FROM whatsapp_conversations WHERE id = ?").get(id) as {
        tenant_id: string;
        last_message: string;
      };
      assert.equal(foreign.tenant_id, clinicB.tenantId);
      assert.equal(foreign.last_message, sentinel);
    };

    const otpPhone = `+91 97${String(Date.now()).slice(-8)}`;
    const otpId = `conv-otp-${tailOf(otpPhone)}`;
    plant(otpPhone, otpId);
    db.prepare("UPDATE users SET phone = ?, last_login = ? WHERE id = ?").run(otpPhone, now, clinicA.userId);
    const otp = await jsonRequest(server.port, "POST", "/api/auth/whatsapp/send-otp", {
      phone: otpPhone,
      purpose: "login",
      name: "Dr Iso",
    });
    assert.equal(otp.status, 200, String(otp.json.error || ""));
    assertForeign(otpId);
    const otpEvent = db
      .prepare(
        "SELECT id, tenant_id FROM whatsapp_outbound_events WHERE patient_phone = ? AND event_type = 'otp_verification' ORDER BY sent_at DESC LIMIT 1"
      )
      .get(otpPhone) as { id: string; tenant_id: string };
    assert.equal(otpEvent.tenant_id, clinicA.tenantId);
    const delivered = applyWhatsAppOutboundStatus(db, {
      recipientId: otpPhone.replace(/\D/g, ""),
      status: "delivered",
      sentAt: now,
      tenantId: clinicA.tenantId,
    });
    assert.equal(delivered, 1);
    const blocked = applyWhatsAppOutboundStatus(db, {
      recipientId: otpPhone.replace(/\D/g, ""),
      status: "failed",
      sentAt: now,
      tenantId: clinicB.tenantId,
    });
    assert.equal(blocked, 0);
    const afterStatus = db.prepare("SELECT status FROM whatsapp_outbound_events WHERE id = ?").get(otpEvent.id) as {
      status: string;
    };
    assert.equal(afterStatus.status, "delivered");

    const tokenA = await login(clinicA.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const receiptPhone = `+91 96${String(Date.now()).slice(-8)}`;
    const receiptId = `conv-rcpt-${tailOf(receiptPhone)}`;
    plant(receiptPhone, receiptId);
    const patientRes = await jsonRequest(
      server.port,
      "POST",
      "/api/patients",
      { name: "Receipt Patient", phone: receiptPhone, age: 40, gender: "Female" },
      authA
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patient = patientRes.json.patient as { id: string; name: string; phone: string };
    const invoiceRes = await jsonRequest(
      server.port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "OPD consult", quantity: 1, unitPrice: 500, total: 500 }],
      },
      authA
    );
    assert.equal(invoiceRes.status, 201, String(invoiceRes.json.error || ""));
    const invoiceId = String((invoiceRes.json.invoice as { id: string }).id);
    const paid = await jsonRequest(server.port, "POST", `/api/invoices/${invoiceId}/sandbox-pay`, {}, authA);
    assert.equal(paid.status, 200, String(paid.json.error || ""));
    const receipt = await jsonRequest(server.port, "POST", `/api/invoices/${invoiceId}/receipt`, {}, authA);
    assert.equal(receipt.status, 200, String(receipt.json.error || ""));
    assertForeign(receiptId);
    const receiptEvent = db
      .prepare(
        "SELECT tenant_id FROM whatsapp_outbound_events WHERE patient_phone = ? AND event_type = 'invoice_receipt' ORDER BY sent_at DESC LIMIT 1"
      )
      .get(receiptPhone) as { tenant_id: string };
    assert.equal(receiptEvent.tenant_id, clinicA.tenantId);

    const rxPhone = `+91 95${String(Date.now()).slice(-8)}`;
    const rxId = `conv-${tailOf(rxPhone)}`;
    plant(rxPhone, rxId);
    const rx = await jsonRequest(
      server.port,
      "POST",
      "/api/whatsapp/send-rx",
      {
        patientPhone: rxPhone,
        patientName: "Rx Patient",
        uhid: "UHID-ISO",
        rxNumber: `RX-ISO-${tailOf(rxPhone)}`,
        doctorName: "Dr Iso",
        medicines: [],
      },
      authA
    );
    assert.equal(rx.status, 200, String(rx.json.error || ""));
    assertForeign(rxId);
    const rxMessage = db
      .prepare("SELECT tenant_id FROM whatsapp_messages WHERE patient_phone = ? AND tenant_id = ? LIMIT 1")
      .get(rxPhone, clinicA.tenantId) as { tenant_id: string } | undefined;
    assert.equal(rxMessage?.tenant_id, clinicA.tenantId);
    resetSendOtpRateLimits();
  });

  it("inbound on a doctor-owned line uses that doctor's clinic, and a duplicated phone_number_id writes nothing", async () => {
    const doctorClinic = createClinic("docLine");
    const otherClinic = createClinic("docOther");
    const dupA = createClinic("dupA");
    const dupB = createClinic("dupB");
    const phoneNumberId = `8${String(Date.now()).slice(-11)}`;
    const duplicateId = `7${String(Date.now()).slice(-11)}`;
    const db = getDb();
    ensureWhatsAppOwnershipSchema(db);
    db.prepare("DELETE FROM whatsapp_numbers WHERE phone_number_id IN (?, ?)").run(phoneNumberId, duplicateId);
    db.prepare("UPDATE tenants SET phone_number_id = ? WHERE id = ?").run(phoneNumberId, otherClinic.tenantId);
    db.prepare("UPDATE tenants SET phone_number_id = ? WHERE id = ?").run(duplicateId, dupA.tenantId);
    db.prepare("UPDATE tenants SET phone_number_id = ? WHERE id = ?").run(duplicateId, dupB.tenantId);

    const practitionerId = `prac-${doctorClinic.userId}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO doctors (id, user_id, name, specialty, practitioner_id)
       VALUES (?, ?, 'Dr Owned Line', 'General Medicine', ?)`
    ).run(`doctor-${doctorClinic.userId}`, doctorClinic.userId, practitionerId);
    db.prepare(
      `INSERT INTO whatsapp_numbers (
         id, owner_type, owner_id, waba_id, phone_number_id, meta_waba_name, status, created_at, updated_at
       ) VALUES (?, 'doctor', ?, ?, ?, 'Doctor Line', 'connected', ?, ?)`
    ).run(`wan-${practitionerId}`, practitionerId, `waba-${phoneNumberId}`, phoneNumberId, now, now);

    const secret = "wa-doctor-line-secret";
    const prevSecret = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = secret;
    const fromDoctor = `1888${String(Date.now()).slice(-8)}`;
    const fromDup = `1999${String(Date.now()).slice(-8)}`;
    const postWebhook = async (lineId: string, from: string, text: string) => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: `waba-${lineId}`,
            changes: [
              {
                value: {
                  metadata: { phone_number_id: lineId },
                  messages: [{ from, text: { body: text } }],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const res = await fetch(`http://127.0.0.1:${server.port}/api/meta/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` },
        body: raw,
      });
      assert.equal(res.status, 200);
    };
    try {
      await postWebhook(phoneNumberId, fromDoctor, "doctor line");
      const row = db
        .prepare("SELECT tenant_id FROM whatsapp_conversations WHERE patient_phone = ?")
        .get(fromDoctor) as { tenant_id: string } | undefined;
      assert.equal(row?.tenant_id, doctorClinic.tenantId);
      const wrong = db
        .prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ? AND tenant_id = ?")
        .get(fromDoctor, otherClinic.tenantId) as { id?: string } | undefined;
      assert.equal(wrong, undefined);

      await postWebhook(duplicateId, fromDup, "duplicate line");
      const dupRow = db
        .prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ?")
        .get(fromDup) as { id?: string } | undefined;
      assert.equal(dupRow, undefined);
      const dupMessage = db
        .prepare("SELECT id FROM whatsapp_messages WHERE patient_phone = ?")
        .get(fromDup) as { id?: string } | undefined;
      assert.equal(dupMessage, undefined);
    } finally {
      if (prevSecret === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = prevSecret;
    }
  });
});

describe("OTP subject buckets", () => {
  it("returns 429 on the 4th attempt for the same user across phones and IPs", () => {
    resetSendOtpRateLimits();
    const now = Date.now();
    for (let i = 0; i < SEND_OTP_MAX_PER_PHONE; i += 1) {
      const attempt = consumeSendOtpAttempt(`+1555000000${i}`, `10.0.0.${i}`, "user:same", now + i);
      assert.equal(attempt.ok, true);
    }
    const blocked = consumeSendOtpAttempt("+15550000009", "10.0.0.9", "user:same", now + 10);
    assert.equal(blocked.ok, false);
    resetSendOtpRateLimits();
  });
});

describe("guard files stay in place", () => {
  it("does not drop JWT fail-fast, CSP frame-ancestors, demo login, or the Sunrise OTP allowlist", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const auth = fs.readFileSync(path.join(root, "server/auth.ts"), "utf8");
    const headers = fs.readFileSync(path.join(root, "server/html-security-headers.ts"), "utf8");
    const runtime = fs.readFileSync(path.join(root, "server/runtime.ts"), "utf8");
    assert.match(auth, /JWT_SECRET environment variable is required/);
    assert.match(auth, /ananya\.sunrise@lumera\.me/);
    assert.match(auth, /reception\.sunrise@lumera\.me/);
    assert.match(headers, /frame-ancestors 'none'/);
    assert.match(runtime, /DEMO_LOGIN_ENABLED/);
  });
});
