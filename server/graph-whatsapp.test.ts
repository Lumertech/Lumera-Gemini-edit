import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dispatchWhatsAppCloudMessage,
  postGraphWhatsAppMessage,
  resolveGraphCredentials,
  resolveReminderGraphCredentials,
  sendAppointmentReminder,
  sendBookConfirmation,
  sendPaymentReceipt,
  sendWhatsAppGraphMessage,
  sendWhatsAppGraphText,
  tenantCustomNumberReadyForSend,
} from "./graph-whatsapp.ts";
import { platformMetaGraphTokenSource } from "./runtime.ts";

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
  const prevGraphToken = process.env.META_GRAPH_TOKEN;
  const prevPhone = process.env.META_PHONE_NUMBER_ID;
  const prevWaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevWaPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const prevNode = process.env.NODE_ENV;
  const prevTpl = process.env.META_REMINDER_TEMPLATE_NAME;
  const prevOtpTpl = process.env.META_OTP_TEMPLATE_NAME;
  const prevFallbackToken = process.env.META_FALLBACK_ACCESS_TOKEN;
  const prevFallbackPhone = process.env.META_FALLBACK_PHONE_NUMBER_ID;

  after(() => {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
    if (prevGraphToken === undefined) delete process.env.META_GRAPH_TOKEN;
    else process.env.META_GRAPH_TOKEN = prevGraphToken;
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
    if (prevFallbackToken === undefined) delete process.env.META_FALLBACK_ACCESS_TOKEN;
    else process.env.META_FALLBACK_ACCESS_TOKEN = prevFallbackToken;
    if (prevFallbackPhone === undefined) delete process.env.META_FALLBACK_PHONE_NUMBER_ID;
    else process.env.META_FALLBACK_ACCESS_TOKEN = prevFallbackPhone;
  });
