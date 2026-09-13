import assert from "node:assert/strict";
import crypto from "node:crypto";
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
import { extractRazorpayPaidRefs } from "./razorpay.ts";
import {
  bookWhatsAppAppointment,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
} from "./whatsapp-calendar.ts";
import {
  DEFAULT_MARKUP_PERCENT,
  applyWalletTransaction,
  assertWalletAllowsAiScribe,
  billedAmountFromRaw,
  estimateWhatsAppRawCostInr,
  getMarkupPercent,
  insertUsageEvent,
  isMetaServiceWindowBilled,
  listWalletTransactions,
  publicWalletStatus,
  recordAiScribeUsage,
  recordWhatsAppUsageAndDebit,
  upsertMarkupConfig,
} from "./usage-billing.ts";
import { GEMINI_SCRIBE_RAW_COST_INR, META_SERVICE_WINDOW_CUTOVER_ISO } from "./usage-rates.ts";

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
