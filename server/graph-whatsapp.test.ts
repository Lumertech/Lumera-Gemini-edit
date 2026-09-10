import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  dispatchWhatsAppCloudMessage,
  lookupAppointmentForWhatsAppSend,
  sendAppointmentReminder,
  sendBookConfirmation,
  sendPaymentReceipt,
  sendWhatsAppGraphMessage,
} from "./graph-whatsapp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
const LIVE_PHONE_ID = "123456789012345";

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

function mockGraphFetch(captured: Array<{ url: string; body: Record<string, unknown> }>, messageId = "wamid.TEST_GRAPH_OK") {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    captured.push({ url: href, body });
    return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: messageId }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("Wave 2 Meta Graph dual-path send (#24 / #25 assist)", () => {
  const prevToken = process.env.META_ACCESS_TOKEN;
  const prevPhone = process.env.META_PHONE_NUMBER_ID;
  const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevWaPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const prevNode = process.env.NODE_ENV;
  const prevTpl = process.env.META_REMINDER_TEMPLATE_NAME;
  const prevOtpTpl = process.env.META_OTP_TEMPLATE_NAME;

  function restoreEnv() {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
    if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
    else process.env.META_PHONE_NUMBER_ID = prevPhone;
    if (prevWaToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = prevWaToken;
    if (prevWaPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = prevWaPhone;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevTpl === undefined) delete process.env.META_REMINDER_TEMPLATE_NAME;
    else process.env.META_REMINDER_TEMPLATE_NAME = prevTpl;
    if (prevOtpTpl === undefined) delete process.env.META_OTP_TEMPLATE_NAME;
    else process.env.META_OTP_TEMPLATE_NAME = prevOtpTpl;
  }

  after(restoreEnv);

  it("Graph path sends reminder / confirmation / receipt / OTP when creds are set (mock fetch OK)", async () => {
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE_ID;
    process.env.NODE_ENV = "test";
    delete process.env.META_REMINDER_TEMPLATE_NAME;
    delete process.env.META_OTP_TEMPLATE_NAME;

    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = mockGraphFetch(captured);
    const creds = { token: LIVE_TOKEN, phoneNumberId: LIVE_PHONE_ID, source: "env" as const };

    const otp = await sendWhatsAppGraphMessage({
      credentials: creds,
      to: "+91 98234 55667",
      otp: "123456",
      purpose: "login",
      fetchImpl,
    });
    assert.equal(otp.ok, true);
    if (otp.ok) assert.equal(otp.messageId, "wamid.TEST_GRAPH_OK");

    const reminder = await sendAppointmentReminder({
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      appointment: {
        doctorName: "Dr. Test",
        specialty: "GP",
        date: "2026-09-11",
        timeSlot: "10:00 AM",
        tokenNumber: 4,
      },
      db: null,
      fetchImpl,
    });
    assert.equal(reminder.ok, true);
    assert.equal(reminder.channel, "graph");

    const confirm = await sendBookConfirmation({
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      appointment: {
        doctorName: "Dr. Test",
        date: "2026-09-11",
        timeSlot: "10:00 AM",
        tokenNumber: 4,
      },
      db: null,
      fetchImpl,
    });
    assert.equal(confirm.ok, true);
    assert.equal(confirm.channel, "graph");

    const receipt = await sendPaymentReceipt({
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      amount: 700,
      currency: "₹",
      invoiceId: "INV-TEST-1",
      db: null,
      fetchImpl,
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.channel, "graph");

    assert.equal(captured.length, 4);
    for (const call of captured) {
      assert.match(call.url, /graph\.facebook\.com\/v21\.0\/123456789012345\/messages/);
      assert.equal(call.body.type, "text");
      assert.equal(call.body.messaging_product, "whatsapp");
    }
    const otpBody = captured[0].body.text as { body?: string };
    assert.match(String(otpBody.body), /123456/);
    const reminderBody = captured[1].body.text as { body?: string };
    assert.match(String(reminderBody.body), /Appointment reminder/);
    const confirmBody = captured[2].body.text as { body?: string };
    assert.match(String(confirmBody.body), /Appointment confirmed/);
    const receiptBody = captured[3].body.text as { body?: string };
    assert.match(String(receiptBody.body), /Payment receipt/);
    assert.equal(/certified tech provider/i.test(JSON.stringify(captured)), false);
  });

  it("Graph path uses a utility template when META_REMINDER_TEMPLATE_NAME is set", async () => {
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE_ID;
    process.env.META_REMINDER_TEMPLATE_NAME = "appointment_reminder_v1";
    process.env.NODE_ENV = "test";
    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const reminder = await sendAppointmentReminder({
      to: "+919823455667",
      patientName: "Meera",
      appointment: { doctorName: "Dr. A", date: "2026-09-12", timeSlot: "11:00 AM", tokenNumber: 2 },
      templateParameters: ["Meera", "Dr. A", "Tomorrow", "11:00 AM", "02"],
      db: null,
      fetchImpl: mockGraphFetch(captured, "wamid.TPL"),
    });
    assert.equal(reminder.ok, true);
    assert.equal(captured[0].body.type, "template");
    const template = captured[0].body.template as { name?: string };
    assert.equal(template.name, "appointment_reminder_v1");
    delete process.env.META_REMINDER_TEMPLATE_NAME;
  });

  it("sandbox path in non-prod without creds records SANDBOX and does not call Graph", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "test";

    let fetchCalled = false;
    const sent = await dispatchWhatsAppCloudMessage({
      to: "+919800011122",
      kind: "appointment_reminder",
      patientName: "Sandbox Patient",
      textBody: "Reminder body",
      db: null,
      recordEvent: false,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}", { status: 500 });
      },
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.channel, "sandbox");
    assert.equal(fetchCalled, false);
  });

  it("production hard-fails without creds (no fake Graph success)", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "production";
    try {
      const sent = await dispatchWhatsAppCloudMessage({
        to: "+919800011122",
        kind: "book_confirmation",
        patientName: "Prod Patient",
        textBody: "Confirmation body",
        db: null,
        recordEvent: false,
      });
      assert.equal(sent.ok, false);
      assert.equal(sent.channel, "none");
      assert.match(sent.error, /not configured/i);
      assert.equal("messageId" in sent, false);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("source files keep SANDBOX labels and do not claim certified Tech Provider", () => {
    const graph = fs.readFileSync(path.join(__dirname, "graph-whatsapp.ts"), "utf8");
    assert.match(graph, /SANDBOX \/ DEV-ONLY/);
    assert.equal(/certified Tech Provider/i.test(graph), false);
    assert.equal(/Official Meta/i.test(graph), false);
    const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    assert.match(envExample, /META_REMINDER_TEMPLATE_NAME/);
    assert.match(envExample, /META_BOOK_CONFIRMATION_TEMPLATE_NAME/);
    assert.match(envExample, /META_RECEIPT_TEMPLATE_NAME/);
    assert.match(envExample, /META_ACCESS_TOKEN/);
  });
});

describe("Wave 2 WhatsApp outbound / cloud-send HTTP hooks", () => {
  let port = 0;
  let server: Server | undefined;
  const prevToken = process.env.META_ACCESS_TOKEN;
  const prevPhone = process.env.META_PHONE_NUMBER_ID;
  const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevWaPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const prevNode = process.env.NODE_ENV;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-wave2-meta-send";
    }
    process.env.NODE_ENV = "test";
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
    if (prevPhone === undefined) delete process.env.META_PHONE_NUMBER_ID;
    else process.env.META_PHONE_NUMBER_ID = prevPhone;
    if (prevWaToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = prevWaToken;
    if (prevWaPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = prevWaPhone;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function login(): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email: "doctor@lumera.me",
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    return String(loginRes.json.token || "");
  }

  it("outbound-trigger reminder uses sandbox dual-path without Graph creds", async () => {
    const res = await jsonRequest(port, "POST", "/api/whatsapp/outbound-trigger", {
      eventType: "appointment_reminder_24h",
      patientPhone: "+91 98234 55667",
      patientName: "Rajiv Saxena",
    });
    assert.equal(res.status, 201, String(res.json.error || "outbound-trigger failed"));
    assert.equal(res.json.ok, true);
    assert.equal(res.json.channel, "sandbox");
    assert.equal(res.json.sandbox, true);
    assert.match(String(res.json.notice || ""), /SANDBOX \/ DEV-ONLY/);
    assert.match(String(res.json.messageDispatched || ""), /SANDBOX \/ DEV-ONLY/);
    assert.equal(/certified/i.test(JSON.stringify(res.json)), false);

    const lookedUp = lookupAppointmentForWhatsAppSend(getDb(), { patientPhone: "+91 98234 55667" });
    assert.ok(lookedUp);
    assert.equal(lookedUp?.patientName, "Rajiv Saxena");
  });

  it("book_appointment confirmation is SANDBOX when Graph creds are absent", async () => {
    const res = await jsonRequest(port, "POST", "/api/whatsapp/emr-action", {
      action: "book_appointment",
      patientPhone: "+91 98234 55667",
      payload: { doctorId: "doc-6", date: "2026-09-12", timeSlot: "02:00 PM" },
    });
    assert.equal(res.status, 200, String(res.json.error || "book_appointment failed"));
    assert.equal(res.json.success, true);
    const confirmation = res.json.confirmation as {
      ok?: boolean;
      channel?: string;
      sandbox?: boolean;
      notice?: string;
    };
    assert.equal(confirmation.ok, true);
    assert.equal(confirmation.channel, "sandbox");
    assert.equal(confirmation.sandbox, true);
    assert.match(String(confirmation.notice || ""), /SANDBOX \/ DEV-ONLY/);
    const appointment = res.json.appointment as { id?: string };
    assert.ok(appointment.id);
    const row = lookupAppointmentForWhatsAppSend(getDb(), { appointmentId: appointment.id });
    assert.ok(row);
    assert.equal(row?.id, appointment.id);
  });

  it("POST /api/whatsapp/cloud-send receipt assist requires auth and sandboxes without creds", async () => {
    const unauth = await jsonRequest(port, "POST", "/api/whatsapp/cloud-send", {
      kind: "payment_receipt",
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      receipt: { amount: 700, invoiceId: "INV-W2" },
    });
    assert.equal(unauth.status, 401);

    const token = await login();
    const res = await jsonRequest(
      port,
      "POST",
      "/api/whatsapp/cloud-send",
      {
        kind: "payment_receipt",
        to: "+919823455667",
        patientName: "Rajiv Saxena",
        receipt: { amount: 700, currency: "₹", invoiceId: "INV-W2" },
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(res.status, 201, String(res.json.error || "cloud-send failed"));
    assert.equal(res.json.channel, "sandbox");
    assert.equal(res.json.sandbox, true);
    assert.match(String(res.json.notice || ""), /SANDBOX \/ DEV-ONLY/);

    const meta = await jsonRequest(
      port,
      "POST",
      "/api/meta/cloud-send",
      {
        kind: "appointment_reminder",
        to: "+919823455667",
        patientName: "Rajiv Saxena",
        appointmentId: "apt-1",
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(meta.status, 201, String(meta.json.error || "meta cloud-send failed"));
    assert.equal(meta.json.sandbox, true);
  });

  it("production outbound-trigger hard-fails without Graph creds", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await jsonRequest(port, "POST", "/api/whatsapp/outbound-trigger", {
        eventType: "book_confirmation",
        patientPhone: "+91 98234 55667",
        patientName: "Rajiv Saxena",
      });
      assert.equal(res.status, 503);
      assert.equal(res.json.ok, false);
      assert.equal(res.json.sandbox, false);
      assert.equal(res.json.delivered, false);
      assert.match(String(res.json.error || ""), /not configured/i);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
