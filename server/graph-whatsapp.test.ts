import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dispatchWhatsAppCloudMessage,
  postGraphWhatsAppMessage,
  sendAppointmentReminder,
  sendBookConfirmation,
  sendPaymentReceipt,
  sendWhatsAppGraphMessage,
  sendWhatsAppGraphText,
} from "./graph-whatsapp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_TOKEN = "EAAGisAlongEnoughTokenWithoutEllipsis0123456789abcdef";
const LIVE_PHONE_ID = "123456789012345";

function mockGraphFetch(captured: Array<{ url: string; body: Record<string, unknown> }>, messageId = "wamid.TEST_GRAPH_OK") {
  return async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: messageId }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("Wave 2 reusable Meta Graph send helper (#24 / #25 assist)", () => {
  const prevToken = process.env.META_ACCESS_TOKEN;
  const prevPhone = process.env.META_PHONE_NUMBER_ID;
  const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevWaPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const prevNode = process.env.NODE_ENV;
  const prevTpl = process.env.META_REMINDER_TEMPLATE_NAME;
  const prevOtpTpl = process.env.META_OTP_TEMPLATE_NAME;

  after(() => {
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
  });

  it("Graph path sends reminder / confirmation / receipt / OTP when creds are set (mock fetch OK)", async () => {
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE_ID;
    process.env.NODE_ENV = "test";
    delete process.env.META_REMINDER_TEMPLATE_NAME;
    delete process.env.META_OTP_TEMPLATE_NAME;

    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = mockGraphFetch(captured);
    const credentials = { token: LIVE_TOKEN, phoneNumberId: LIVE_PHONE_ID, source: "env" as const };

    const otp = await sendWhatsAppGraphMessage({
      credentials,
      to: "+91 98234 55667",
      otp: "123456",
      purpose: "login",
      fetchImpl,
    });
    assert.equal(otp.ok, true);
    if (otp.ok) assert.equal(otp.messageId, "wamid.TEST_GRAPH_OK");

    const text = await sendWhatsAppGraphText({
      credentials,
      to: "+919823455667",
      body: "hello",
      fetchImpl,
    });
    assert.equal(text.ok, true);

    const reminder = await sendAppointmentReminder({
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      doctorName: "Dr. Test",
      specialty: "GP",
      date: "2026-09-11",
      timeSlot: "10:00 AM",
      tokenNumber: 4,
      db: null,
      fetchImpl,
    });
    assert.equal(reminder.ok, true);
    assert.equal(reminder.channel, "graph");

    const confirm = await sendBookConfirmation({
      to: "+919823455667",
      patientName: "Rajiv Saxena",
      doctorName: "Dr. Test",
      date: "2026-09-11",
      timeSlot: "10:00 AM",
      tokenNumber: 4,
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

    assert.equal(captured.length, 5);
    for (const call of captured) {
      assert.match(call.url, /graph\.facebook\.com\/v21\.0\/123456789012345\/messages/);
      assert.equal(call.body.messaging_product, "whatsapp");
      assert.equal(call.body.to, "919823455667");
    }
    assert.match(String((captured[0].body.text as { body?: string }).body), /123456/);
    assert.match(String((captured[2].body.text as { body?: string }).body), /Appointment reminder/);
    assert.match(String((captured[3].body.text as { body?: string }).body), /Appointment confirmed/);
    assert.match(String((captured[4].body.text as { body?: string }).body), /Payment receipt/);
  });

  it("postGraphWhatsAppMessage stays the Platform #25 primitive (payload + to)", async () => {
    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const graph = await postGraphWhatsAppMessage({
      credentials: { token: LIVE_TOKEN, phoneNumberId: LIVE_PHONE_ID, source: "env" },
      to: "+91 90000 11111",
      payload: { messaging_product: "whatsapp", type: "text", text: { body: "platform" } },
      fetchImpl: mockGraphFetch(captured, "wamid.PLATFORM"),
    });
    assert.equal(graph.ok, true);
    if (graph.ok) assert.equal(graph.messageId, "wamid.PLATFORM");
    assert.equal(captured[0].body.to, "919000011111");
    assert.equal((captured[0].body.text as { body?: string }).body, "platform");
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
      doctorName: "Dr. A",
      date: "2026-09-12",
      timeSlot: "11:00 AM",
      tokenNumber: 2,
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

  it("sandbox path in non-prod without creds does not call Graph", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "test";

    let fetchCalled = false;
    const sent = await dispatchWhatsAppCloudMessage({
      to: "+919800011122",
      kind: "appointment_reminder",
      textBody: "Reminder body",
      db: null,
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
        textBody: "Confirmation body",
        db: null,
      });
      assert.equal(sent.ok, false);
      assert.equal(sent.channel, "none");
      assert.match(sent.error, /not configured/i);
      assert.equal("messageId" in sent, false);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("module keeps SANDBOX labels, exports Platform primitives, and does not claim certified Tech Provider", () => {
    const graph = fs.readFileSync(path.join(__dirname, "graph-whatsapp.ts"), "utf8");
    assert.match(graph, /SANDBOX/);
    assert.match(graph, /export async function postGraphWhatsAppMessage/);
    assert.match(graph, /export async function sendWhatsAppGraphText/);
    assert.match(graph, /export async function sendAppointmentReminder/);
    assert.match(graph, /export async function sendBookConfirmation/);
    assert.match(graph, /export async function sendPaymentReceipt/);
    assert.equal(/certified Tech Provider/i.test(graph), false);
    assert.equal(/Official Meta/i.test(graph), false);
    const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    assert.match(envExample, /META_REMINDER_TEMPLATE_NAME/);
    assert.match(envExample, /META_BOOK_CONFIRMATION_TEMPLATE_NAME/);
    assert.match(envExample, /META_RECEIPT_TEMPLATE_NAME/);
    assert.match(envExample, /META_ACCESS_TOKEN/);
  });
});
