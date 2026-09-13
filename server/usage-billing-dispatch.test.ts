import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createUsageBillingRouter } from "./usage-billing-api.ts";
import { getDb, initDatabase } from "./db.ts";
import { dispatchWhatsAppCloudMessage, sendPaymentReceipt } from "./graph-whatsapp.ts";
import { hashPassword } from "./password.ts";
import {
  bookWhatsAppAppointment,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
} from "./whatsapp-calendar.ts";
import {
  applyWalletTransaction,
  publicWalletStatus,
} from "./usage-billing.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function createUsers(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const clinicEmail = `${label}.clinic.${suffix}@usage-test.example`.toLowerCase();
  const adminEmail = `${label}.admin.${suffix}@usage-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(
    `user-clinic-${suffix}`,
    tenantId,
    clinicEmail,
    hashPassword("Lumera@2026"),
    `Clinic ${label}`,
    "+91 90000 11111",
    `Clinic ${label}`,
    now,
    now
  );
  applyWalletTransaction(tenantId, "adjustment", 1000, {
    note: "Test seed credit",
    createdBy: "system",
  });
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon","Tue","Wed","Thu","Fri"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
  ).run(`doc-${suffix}`, `user-clinic-${suffix}`, `Clinic ${label}`, `REG-${suffix}`, "+91 90000 11111", clinicEmail);
  return { tenantId, clinicEmail, adminEmail, doctorId: `doc-${suffix}` };
}

describe("Usage wallet billing dispatch paths", () => {
  let port = 0;
  let server: Server | undefined;
  let clinicAuth: Record<string, string> = {};
  let tenantId = "";
  let clinicEmail = "";
  let doctorId = "";

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-usage-wallet";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "test";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as express.Request).rawBody = buf;
        },
      })
    );
    app.use(attachUser);
    app.use("/api", createUsageBillingRouter());
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    port = addr.port;
    const a = createUsers("wd");
    tenantId = a.tenantId;
    clinicEmail = a.clinicEmail;
    doctorId = a.doctorId;
    const clinicLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinicEmail,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(clinicLogin.status, 200, String(clinicLogin.json.error || "clinic login"));
    clinicAuth = { Authorization: `Bearer ${String(clinicLogin.json.token)}` };
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  });

  it("calendar reminder, book confirmation, receipt, and patient replies meter patient phones with tenantId", async () => {
    const patientPhone = `+91 98111 ${String(Date.now()).slice(-5)}`;
    const booked = bookWhatsAppAppointment({
      tenantId,
      patientPhone,
      patientName: "Metered Patient",
      doctorId,
      date: "2026-09-21",
      timeSlot: "10:00 AM",
    });
    const userMatch = getDb()
      .prepare("SELECT id FROM users WHERE phone LIKE ?")
      .get(`%${patientPhone.replace(/\D/g, "").slice(-10)}`);
    assert.equal(userMatch, undefined);

    const before = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };

    const reminder = await dispatchAppointmentReminder({
      tenantId,
      appointment: booked.appointment,
      window: "24h",
    });
    assert.equal(reminder.ok, true);

    const confirm = await dispatchWhatsAppBookConfirmation({
      tenantId,
      appointment: booked.appointment,
    });
    assert.equal(confirm.ok, true);

    const receipt = await sendPaymentReceipt({
      to: patientPhone,
      patientName: "Metered Patient",
      amount: 700,
      invoiceId: "INV-METER-1",
      db: getDb(),
      tenantId,
    });
    assert.equal(receipt.ok, true);

    const reply = await dispatchWhatsAppCloudMessage({
      to: patientPhone,
      kind: "text",
      textBody: "Staff reply to patient",
      db: getDb(),
      tenantId,
      inCustomerServiceWindow: true,
    });
    assert.equal(reply.ok, true);

    const events = getDb()
      .prepare(
        `SELECT metadata FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message' ORDER BY created_at DESC LIMIT 12`
      )
      .all(tenantId) as { metadata: string }[];
    const kinds = events.map((row) => {
      try {
        return String((JSON.parse(row.metadata || "{}") as { kind?: string }).kind || "");
      } catch {
        return "";
      }
    });
    assert.ok(kinds.includes("appointment_reminder"), String(kinds));
    assert.ok(kinds.includes("book_confirmation"), String(kinds));
    assert.ok(kinds.includes("payment_receipt"), String(kinds));
    assert.ok(kinds.includes("text"), String(kinds));

    const count = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    assert.ok(count.c >= before.c + 4);

    const clinicUserPhone = "+91 98888 12121";
    getDb().prepare("UPDATE users SET phone = ? WHERE email = ?").run(clinicUserPhone, clinicEmail);
    const otpBefore = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    const otp = await dispatchWhatsAppCloudMessage({
      to: clinicUserPhone,
      kind: "otp",
      otp: "654321",
      purpose: "login",
      textBody: "otp",
      db: getDb(),
    });
    assert.equal(otp.ok, true);
    const otpAfter = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    assert.ok(otpAfter.c >= otpBefore.c + 1);

    const agentBefore = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    const agentSend = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send",
      {
        conversationId: `conv-meter-${Date.now()}`,
        patientPhone,
        patientName: "Metered Patient",
        sender: "agent",
        staffName: "Clinic Staff",
        content: "Staff reply metered via usage router",
        tenantId,
      },
      clinicAuth
    );
    assert.equal(agentSend.status, 201, String(agentSend.json.error || "agent send"));
    const agentAfter = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    assert.ok(agentAfter.c >= agentBefore.c + 1, "staff /whatsapp/send must insert usage_events");

    const rxBefore = agentAfter.c;
    const rxSend = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/send-rx",
      {
        patientPhone,
        patientName: "Metered Patient",
        uhid: "LUM-METER-1",
        rxNumber: `RX-METER-${Date.now()}`,
        doctorName: "Dr Meter",
        diagnosis: "Usage wallet check",
        medicines: [{ drugName: "Paracetamol", dosage: "650 mg", frequency: "1-0-1" }],
        tenantId,
      },
      clinicAuth
    );
    assert.ok(rxSend.status === 200 || rxSend.status === 201, String(rxSend.json.error || "send-rx"));
    const rxAfter = getDb()
      .prepare("SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message'")
      .get(tenantId) as { c: number };
    assert.ok(rxAfter.c >= rxBefore + 1, "send-rx must insert usage_events");

    const calendarSrc = fs.readFileSync(path.join(__dirname, "whatsapp-calendar.ts"), "utf8");
    const billingSrc = fs.readFileSync(path.join(__dirname, "billing.ts"), "utf8");
    const apiSrc = fs.readFileSync(path.join(__dirname, "api.ts"), "utf8");
    const whatsappSrc = fs.readFileSync(path.join(__dirname, "whatsapp.ts"), "utf8");
    const metaSrc = fs.readFileSync(path.join(__dirname, "meta.ts"), "utf8");
    const usageApiSrc = fs.readFileSync(path.join(__dirname, "usage-billing-api.ts"), "utf8");
    const patientDispatchSrc = fs.readFileSync(path.join(__dirname, "whatsapp-patient-dispatch.ts"), "utf8");
    assert.match(calendarSrc, /tenantId: opts.tenantId/);
    assert.match(billingSrc, /tenantId: invoice.tenantId/);
    assert.match(apiSrc, /dispatchWhatsAppOtpMessage\([\s\S]*tenantId/);
    assert.match(patientDispatchSrc + usageApiSrc + whatsappSrc, /dispatchPatientCloudText/);
    assert.match(usageApiSrc, /\/whatsapp\/send/);
    assert.match(usageApiSrc, /\/whatsapp\/send-rx/);
    assert.match(metaSrc, /dispatchWhatsAppCloudMessage/);
    const serverSrc = fs.readFileSync(path.join(__dirname, "../server.ts"), "utf8");
    const restSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-rest.ts"), "utf8");
    const helperSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-helpers.ts"), "utf8");
    const combined = serverSrc.split("\n").length + restSrc.split("\n").length + helperSrc.split("\n").length;
    assert.ok(combined >= 649, `combined gemini handlers vs main 649; got ${combined}`);
    assert.match(serverSrc, /blockedAiScribeResponse/);
    assert.match(serverSrc, /meterSuccessfulGeminiScribe/);
    assert.match(serverSrc, /ai\.models\.generateContent/);
    assert.match(serverSrc, /createUsageBillingRouter/);
    assert.match(serverSrc, /clinical-synthesis-engine/);
  });

});
