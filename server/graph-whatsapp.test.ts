import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bookConfirmationTemplateParameters,
  buildQueueNextText,
  dispatchWhatsAppCloudMessage,
  postGraphWhatsAppMessage,
  prescriptionReadyTemplateParameters,
  queueNextTemplateParameters,
  receiptTemplateParameters,
  sendAppointmentReminder,
  sendBookConfirmation,
  sendPaymentReceipt,
  sendPrescriptionReady,
  sendQueueNext,
  sendWhatsAppGraphMessage,
  sendWhatsAppGraphText,
  templateConfigForKind,
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

  it("OTP named template always includes the button OTP parameter (#131008)", async () => {
    const prevName = process.env.META_OTP_TEMPLATE_NAME;
    const prevLang = process.env.META_OTP_TEMPLATE_LANGUAGE;
    const prevButton = process.env.META_OTP_TEMPLATE_BUTTON;
    process.env.META_OTP_TEMPLATE_NAME = "lumera_login_otp";
    process.env.META_OTP_TEMPLATE_LANGUAGE = "en";
    const credentials = { token: LIVE_TOKEN, phoneNumberId: LIVE_PHONE_ID, source: "env" as const };

    async function send(otp: string, messageId: string) {
      const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
      const result = await sendWhatsAppGraphMessage({
        credentials,
        to: "+919823455667",
        otp,
        purpose: "login",
        fetchImpl: mockGraphFetch(captured, messageId),
      });
      return { result, captured };
    }

    try {
      const cases = [
        { buttonEnv: undefined, language: undefined, otp: "654321" },
        { buttonEnv: "false" as const, language: "en", otp: "111222" },
      ];
      for (const testCase of cases) {
        if (testCase.buttonEnv === undefined) delete process.env.META_OTP_TEMPLATE_BUTTON;
        else process.env.META_OTP_TEMPLATE_BUTTON = testCase.buttonEnv;
        if (testCase.language === undefined) delete process.env.META_OTP_TEMPLATE_LANGUAGE;
        else process.env.META_OTP_TEMPLATE_LANGUAGE = testCase.language;

        const { result, captured } = await send(testCase.otp, "wamid.OTP_TPL");
        assert.equal(result.ok, true);
        assert.equal(captured.length, 1);
        assert.equal(captured[0].body.type, "template");
        const template = captured[0].body.template as {
          name?: string;
          language?: { code?: string };
          components?: Array<{
            type?: string;
            sub_type?: string;
            index?: string;
            parameters?: Array<{ type?: string; text?: string; coupon_code?: string }>;
          }>;
        };
        assert.equal(template.name, "lumera_login_otp");
        assert.equal(template.language?.code, "en");
        const body = template.components?.find((component) => component.type === "body");
        const button = template.components?.find((component) => component.type === "button");
        assert.equal(body?.parameters?.[0]?.type, "text");
        assert.equal(body?.parameters?.[0]?.text, testCase.otp);
        assert.equal(button?.sub_type, "copy_code");
        assert.equal(button?.index, "0");
        assert.equal(button?.parameters?.[0]?.type, "coupon_code");
        assert.equal(button?.parameters?.[0]?.coupon_code, testCase.otp);
      }
    } finally {
      if (prevName === undefined) delete process.env.META_OTP_TEMPLATE_NAME;
      else process.env.META_OTP_TEMPLATE_NAME = prevName;
      if (prevLang === undefined) delete process.env.META_OTP_TEMPLATE_LANGUAGE;
      else process.env.META_OTP_TEMPLATE_LANGUAGE = prevLang;
      if (prevButton === undefined) delete process.env.META_OTP_TEMPLATE_BUTTON;
      else process.env.META_OTP_TEMPLATE_BUTTON = prevButton;
    }
  });

  it("Graph path uses lumera_appointment_reminder with Manager body order when META_REMINDER_TEMPLATE_NAME is set", async () => {
    const prevLang = process.env.META_UTILITY_TEMPLATE_LANGUAGE;
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE_ID;
    process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
    process.env.NODE_ENV = "test";
    try {
      const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
      const managerParameters = ["Meera", "Lumera Apex PolyClinic", "Dr. A", "2026-09-12", "11:00 AM"];
      const reminder = await sendAppointmentReminder({
        to: "+919823455667",
        patientName: "Meera",
        doctorName: "Dr. A",
        date: "2026-09-12",
        timeSlot: "11:00 AM",
        tokenNumber: 2,
        templateParameters: managerParameters,
        db: null,
        fetchImpl: mockGraphFetch(captured, "wamid.TPL"),
      });
      assert.equal(reminder.ok, true);
      assert.equal(captured[0].body.type, "template");
      const template = captured[0].body.template as {
        name?: string;
        language?: { code?: string };
        components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
      };
      assert.equal(template.name, "lumera_appointment_reminder");
      assert.equal(template.language?.code, "en_US");
      assert.deepEqual(
        template.components?.find((component) => component.type === "body")?.parameters?.map((parameter) => parameter.text),
        managerParameters
      );
    } finally {
      delete process.env.META_REMINDER_TEMPLATE_NAME;
      if (prevLang === undefined) delete process.env.META_UTILITY_TEMPLATE_LANGUAGE;
      else process.env.META_UTILITY_TEMPLATE_LANGUAGE = prevLang;
    }
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
    assert.match(envExample, /META_QUEUE_NEXT_TEMPLATE_NAME/);
    assert.match(envExample, /META_PRESCRIPTION_READY_TEMPLATE_NAME/);
    assert.match(envExample, /META_REMINDER_TEMPLATE_LANGUAGE=en_US/);
    assert.match(envExample, /META_BOOK_CONFIRMATION_TEMPLATE_NAME=lumera_appointment_booked/);
    assert.match(envExample, /META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE=en/);
    assert.match(envExample, /META_RECEIPT_TEMPLATE_NAME=lumera_payment_receipt/);
    assert.match(envExample, /META_RECEIPT_TEMPLATE_LANGUAGE=en/);
    assert.match(envExample, /META_QUEUE_NEXT_TEMPLATE_LANGUAGE=en/);
    assert.match(envExample, /META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE=en/);
    assert.match(envExample, /META_ACCESS_TOKEN/);
  });

  it("templateConfigForKind maps queue_next and prescription_ready onto utility language", () => {
    const prevQueue = process.env.META_QUEUE_NEXT_TEMPLATE_NAME;
    const prevRx = process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME;
    const prevReceipt = process.env.META_RECEIPT_TEMPLATE_NAME;
    const prevLang = process.env.META_UTILITY_TEMPLATE_LANGUAGE;
    const prevOtpLang = process.env.META_OTP_TEMPLATE_LANGUAGE;
    const prevReminder = process.env.META_REMINDER_TEMPLATE_NAME;
    const prevReminderLang = process.env.META_REMINDER_TEMPLATE_LANGUAGE;
    const prevBook = process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME;
    const prevBookLang = process.env.META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE;
    const prevReceiptLang = process.env.META_RECEIPT_TEMPLATE_LANGUAGE;
    const prevQueueLang = process.env.META_QUEUE_NEXT_TEMPLATE_LANGUAGE;
    const prevRxLang = process.env.META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE;
    delete process.env.META_QUEUE_NEXT_TEMPLATE_NAME;
    delete process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME;
    process.env.META_RECEIPT_TEMPLATE_NAME = "lumera_payment_receipt";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
    process.env.META_OTP_TEMPLATE_LANGUAGE = "en";
    try {
      assert.equal(templateConfigForKind("queue_next"), null);
      assert.equal(templateConfigForKind("prescription_ready"), null);
      assert.equal(templateConfigForKind("text"), null);
      assert.equal(templateConfigForKind("payment_receipt")?.name, "lumera_payment_receipt");

      process.env.META_QUEUE_NEXT_TEMPLATE_NAME = "lumera_queue_next";
      process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME = "lumera_prescription_ready";
      process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
      process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME = "lumera_appointment_booked";
      process.env.META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE = "en";
      process.env.META_RECEIPT_TEMPLATE_LANGUAGE = "en";
      process.env.META_QUEUE_NEXT_TEMPLATE_LANGUAGE = "en";
      process.env.META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE = "en";
      process.env.META_REMINDER_TEMPLATE_LANGUAGE = "en_US";
      assert.deepEqual(templateConfigForKind("queue_next"), {
        name: "lumera_queue_next",
        language: "en",
      });
      assert.deepEqual(templateConfigForKind("prescription_ready"), {
        name: "lumera_prescription_ready",
        language: "en",
      });
      assert.equal(templateConfigForKind("appointment_reminder")?.language, "en_US");
      assert.equal(templateConfigForKind("book_confirmation")?.language, "en");
      assert.equal(templateConfigForKind("payment_receipt")?.language, "en");
      if (process.env.META_OTP_TEMPLATE_NAME) {
        assert.equal(templateConfigForKind("otp")?.language, "en");
      }
      delete process.env.META_REMINDER_TEMPLATE_LANGUAGE;
      delete process.env.META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE;
      assert.equal(templateConfigForKind("appointment_reminder")?.language, "en_US");
      assert.equal(templateConfigForKind("book_confirmation")?.language, "en_US");
      delete process.env.META_UTILITY_TEMPLATE_LANGUAGE;
      delete process.env.META_QUEUE_NEXT_TEMPLATE_LANGUAGE;
      delete process.env.META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE;
      assert.equal(templateConfigForKind("appointment_reminder")?.language, "en_US");
      assert.equal(templateConfigForKind("book_confirmation")?.language, "en");
      assert.equal(templateConfigForKind("queue_next")?.language, "en");
      assert.equal(templateConfigForKind("prescription_ready")?.language, "en");
      if (process.env.META_OTP_TEMPLATE_NAME) {
        assert.equal(templateConfigForKind("otp")?.language, "en");
      } else {
        assert.equal(templateConfigForKind("otp"), null);
      }
    } finally {
      if (prevQueue === undefined) delete process.env.META_QUEUE_NEXT_TEMPLATE_NAME;
      else process.env.META_QUEUE_NEXT_TEMPLATE_NAME = prevQueue;
      if (prevRx === undefined) delete process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME;
      else process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME = prevRx;
      if (prevReceipt === undefined) delete process.env.META_RECEIPT_TEMPLATE_NAME;
      else process.env.META_RECEIPT_TEMPLATE_NAME = prevReceipt;
      if (prevLang === undefined) delete process.env.META_UTILITY_TEMPLATE_LANGUAGE;
      else process.env.META_UTILITY_TEMPLATE_LANGUAGE = prevLang;
      if (prevOtpLang === undefined) delete process.env.META_OTP_TEMPLATE_LANGUAGE;
      else process.env.META_OTP_TEMPLATE_LANGUAGE = prevOtpLang;
      if (prevReminder === undefined) delete process.env.META_REMINDER_TEMPLATE_NAME;
      else process.env.META_REMINDER_TEMPLATE_NAME = prevReminder;
      if (prevReminderLang === undefined) delete process.env.META_REMINDER_TEMPLATE_LANGUAGE;
      else process.env.META_REMINDER_TEMPLATE_LANGUAGE = prevReminderLang;
      if (prevBook === undefined) delete process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME;
      else process.env.META_BOOK_CONFIRMATION_TEMPLATE_NAME = prevBook;
      if (prevBookLang === undefined) delete process.env.META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE;
      else process.env.META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE = prevBookLang;
      if (prevReceiptLang === undefined) delete process.env.META_RECEIPT_TEMPLATE_LANGUAGE;
      else process.env.META_RECEIPT_TEMPLATE_LANGUAGE = prevReceiptLang;
      if (prevQueueLang === undefined) delete process.env.META_QUEUE_NEXT_TEMPLATE_LANGUAGE;
      else process.env.META_QUEUE_NEXT_TEMPLATE_LANGUAGE = prevQueueLang;
      if (prevRxLang === undefined) delete process.env.META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE;
      else process.env.META_PRESCRIPTION_READY_TEMPLATE_LANGUAGE = prevRxLang;
    }
  });

  it("queue_next and prescription_ready use their own templates and keep session text when unset", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of [
      "META_ACCESS_TOKEN",
      "META_PHONE_NUMBER_ID",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "META_QUEUE_NEXT_TEMPLATE_NAME",
      "META_PRESCRIPTION_READY_TEMPLATE_NAME",
      "META_RECEIPT_TEMPLATE_NAME",
      "META_UTILITY_TEMPLATE_LANGUAGE",
      "NODE_ENV",
    ]) {
      saved[key] = process.env[key];
    }
    process.env.META_ACCESS_TOKEN = LIVE_TOKEN;
    process.env.META_PHONE_NUMBER_ID = LIVE_PHONE_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "test";
    try {
    const sessionText = buildQueueNextText({ patientName: "Rajiv Saxena" });
    assert.equal(
      sessionText,
      "📢 *OPD Queue Alert - You're Almost Up!*\n\nNamaste Rajiv Saxena,\nToken *#01* is currently completing consultation. You are *NEXT IN LINE* (Token #02).\n\n📍 Please proceed to *Rehab Suite 105* near Waiting Lounge B."
    );
    assert.deepEqual(
      queueNextTemplateParameters({
        patientName: "Rajiv Saxena",
        clinicName: "City Care Clinic",
        doctorName: "Dr. A",
        tokenNumber: 2,
        location: "Rehab Suite 105",
      }),
      ["Rajiv Saxena", "City Care Clinic", "Dr. A", "02", "Rehab Suite 105"]
    );
    const queueFallback = queueNextTemplateParameters({});
    assert.equal(queueFallback[1], "your clinic");
    assert.equal(queueFallback[2], "your clinician");
    assert.equal(queueFallback.some((part) => /lumera/i.test(part)), false);
    assert.deepEqual(
      bookConfirmationTemplateParameters({
        patientName: "Rajiv Saxena",
        clinicName: "City Care Clinic",
        doctorName: "Dr. A",
        date: "2026-09-12",
        timeSlot: "11:00 AM",
        tokenNumber: 4,
      }),
      ["Rajiv Saxena", "City Care Clinic", "Dr. A", "2026-09-12", "11:00 AM", "4"]
    );
    assert.equal(bookConfirmationTemplateParameters({})[1], "your clinic");
    assert.deepEqual(
      receiptTemplateParameters({
        patientName: "Rajiv Saxena",
        clinicName: "City Care Clinic",
        doctorName: "Dr. A",
        amount: 700,
        invoiceId: "INV-1",
      }),
      ["Rajiv Saxena", "City Care Clinic", "Dr. A", "700", "INV-1"]
    );
    assert.equal(receiptTemplateParameters({}).some((part) => /lumera/i.test(part)), false);
    assert.deepEqual(
      prescriptionReadyTemplateParameters({
        patientName: "Rajiv Saxena",
        clinicName: "Lumera Rehab",
        doctorName: "Dr. Siddharth Varma",
        rxNumber: "RX-2026-0106",
      }),
      ["Rajiv Saxena", "Lumera Rehab", "Dr. Siddharth Varma", "RX-2026-0106"]
    );
      delete process.env.META_QUEUE_NEXT_TEMPLATE_NAME;
      delete process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME;
      process.env.META_RECEIPT_TEMPLATE_NAME = "lumera_payment_receipt";
      const textCaptured: Array<{ url: string; body: Record<string, unknown> }> = [];
      const textSend = await sendQueueNext({
        to: "+919823455667",
        patientName: "Rajiv Saxena",
        textBody: sessionText,
        db: null,
        fetchImpl: mockGraphFetch(textCaptured, "wamid.QUEUE_TEXT"),
      });
      assert.equal(textSend.ok, true);
      assert.equal(textCaptured[0].body.type, "text");
      assert.equal((textCaptured[0].body.text as { body?: string }).body, sessionText);

      const rxText: Array<{ url: string; body: Record<string, unknown> }> = [];
      const rxUnset = await sendPrescriptionReady({
        to: "+919823455667",
        patientName: "Rajiv Saxena",
        clinicName: "Lumera Rehab",
        doctorName: "Dr. Siddharth Varma",
        rxNumber: "RX-2026-0106",
        textBody: "session rx",
        db: null,
        fetchImpl: mockGraphFetch(rxText, "wamid.RX_TEXT"),
      });
      assert.equal(rxUnset.ok, true);
      assert.equal(rxText[0].body.type, "text");
      assert.equal(rxText[0].body.template, undefined);

      process.env.META_QUEUE_NEXT_TEMPLATE_NAME = "lumera_queue_next";
      process.env.META_PRESCRIPTION_READY_TEMPLATE_NAME = "lumera_prescription_ready";
      process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en_US";
      const queueParams = ["Meera", "City Care Clinic", "Dr. A", "02", "Rehab Suite 105"];
      const queueCaptured: Array<{ url: string; body: Record<string, unknown> }> = [];
      const queueSend = await sendQueueNext({
        to: "+919823455667",
        patientName: "Meera",
        clinicName: "City Care Clinic",
        doctorName: "Dr. A",
        tokenNumber: "02",
        location: "Rehab Suite 105",
        templateParameters: queueParams,
        db: null,
        fetchImpl: mockGraphFetch(queueCaptured, "wamid.QUEUE_TPL"),
      });
      assert.equal(queueSend.ok, true);
      if (queueSend.ok) assert.equal(queueSend.messageId, "wamid.QUEUE_TPL");
      assert.equal(queueCaptured[0].body.type, "template");
      const queueTemplate = queueCaptured[0].body.template as {
        name?: string;
        language?: { code?: string };
        components?: Array<{ type?: string; sub_type?: string; parameters?: Array<{ text?: string }> }>;
      };
      assert.equal(queueTemplate.name, "lumera_queue_next");
      assert.equal(queueTemplate.language?.code, "en_US");
      assert.equal(queueTemplate.components?.some((component) => component.type === "button"), false);
      assert.deepEqual(
        queueTemplate.components?.find((component) => component.type === "body")?.parameters?.map((parameter) => parameter.text),
        queueParams
      );

      const rxParams = ["Meera", "Lumera Rehab", "Dr. A", "RX-1"];
      const rxCaptured: Array<{ url: string; body: Record<string, unknown> }> = [];
      const rxSend = await sendPrescriptionReady({
        to: "+919823455667",
        patientName: "Meera",
        clinicName: "Lumera Rehab",
        doctorName: "Dr. A",
        rxNumber: "RX-1",
        textBody: "session rx",
        templateParameters: rxParams,
        db: null,
        fetchImpl: mockGraphFetch(rxCaptured, "wamid.RX_TPL"),
      });
      assert.equal(rxSend.ok, true);
      const rxTemplate = rxCaptured[0].body.template as {
        name?: string;
        language?: { code?: string };
        components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
      };
      assert.equal(rxTemplate.name, "lumera_prescription_ready");
      assert.notEqual(rxTemplate.name, "lumera_payment_receipt");
      assert.equal(rxTemplate.language?.code, "en_US");
      assert.deepEqual(
        rxTemplate.components?.find((component) => component.type === "body")?.parameters?.map((parameter) => parameter.text),
        rxParams
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("production queue_next without creds hard-fails and does not invent a wamid", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "NODE_ENV"]) {
      saved[key] = process.env[key];
    }
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = "production";
    try {
      const sent = await sendQueueNext({
        to: "+919800011122",
        patientName: "Rajiv Saxena",
        db: null,
      });
      assert.equal(sent.ok, false);
      if (!sent.ok) {
        assert.equal(sent.channel, "none");
        assert.match(sent.error, /not configured/i);
        assert.equal("messageId" in sent, false);
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("outbound triggers call queue_next and prescription_ready instead of the receipt template", () => {
    const whatsapp = fs.readFileSync(path.join(__dirname, "whatsapp.ts"), "utf8");
    const usage = fs.readFileSync(path.join(__dirname, "usage-billing-api.ts"), "utf8");
    const queueBranch = whatsapp.indexOf('const queueEvent = eventType === "queue_token_update" || eventType === "queue_next"');
    const rxBranch = whatsapp.indexOf('const prescriptionEvent = eventType === "post_consultation_dispatch" || eventType === "prescription_ready"');
    const sendQueue = whatsapp.indexOf("await sendQueueNext(", queueBranch);
    const sendRx = whatsapp.indexOf("await sendPrescriptionReady(", rxBranch);
    assert.ok(queueBranch > 0, "queue_token_update branch missing");
    assert.ok(rxBranch > queueBranch, "prescription_ready branch missing");
    assert.ok(sendQueue > rxBranch, "sendQueueNext is not in the outbound trigger");
    assert.ok(sendRx > sendQueue, "sendPrescriptionReady is not in the outbound trigger");
    assert.match(usage, /templateOwnedOutbound/);
    assert.match(usage, /if \(reminderEvent \|\| templateOwnedOutbound\) return next\(\)/);
    const sendRxRoute = usage.slice(usage.indexOf('api.post("/whatsapp/send-rx"'));
    const sendRxBlock = sendRxRoute.slice(0, sendRxRoute.indexOf("meterCustomOutbound"));
    assert.match(sendRxBlock, /sendPrescriptionReady\(/);
    assert.equal(sendRxBlock.includes("dispatchPatientCloudText"), false);
    assert.equal(sendRxBlock.includes("META_RECEIPT_TEMPLATE_NAME"), false);
    assert.match(whatsapp, /kind: "appointment_reminder"|dispatchAppointmentReminder/);
    const graph = fs.readFileSync(path.join(__dirname, "graph-whatsapp.ts"), "utf8");
    assert.match(graph, /sub_type: "copy_code"/);
    assert.match(graph, /queue_next: "META_QUEUE_NEXT_TEMPLATE_NAME"/);
    assert.match(graph, /prescription_ready: "META_PRESCRIPTION_READY_TEMPLATE_NAME"/);
    assert.match(graph, /META_REMINDER_TEMPLATE_LANGUAGE/);
    assert.match(graph, /META_BOOK_CONFIRMATION_TEMPLATE_LANGUAGE/);
    assert.match(graph, /META_QUEUE_NEXT_TEMPLATE_LANGUAGE/);
    const reminders = fs.readFileSync(path.join(__dirname, "whatsapp-calendar-reminders.ts"), "utf8");
    const billing = fs.readFileSync(path.join(__dirname, "billing.ts"), "utf8");
    assert.match(reminders, /bookConfirmationTemplateParameters/);
    assert.match(reminders, /clinicDisplayNameForTenant/);
    assert.equal(/Lumera Clinic/.test(reminders), false);
    assert.match(billing, /receiptTemplateParameters/);
    assert.equal(whatsapp.includes('fallback: "Lumera'), false);
    assert.equal(/"Lumera Clinic"/.test(whatsapp), false);
    assert.equal(/"Lumera Rehab"/.test(whatsapp), false);
  });
});
