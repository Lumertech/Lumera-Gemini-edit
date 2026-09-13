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
import { dispatchWhatsAppCloudMessage } from "./graph-whatsapp.ts";
import { hashPassword } from "./password.ts";
import { extractRazorpayPaidRefs } from "./razorpay.ts";
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
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    `user-sa-${suffix}`,
    tenantId,
    adminEmail,
    hashPassword("Lumera@2026"),
    `SA ${label}`,
    "+91 90000 22222",
    "Lumera",
    now,
    now
  );
  applyWalletTransaction(tenantId, "adjustment", 1000, {
    note: "Test seed credit",
    createdBy: "system",
  });
  return { tenantId, clinicEmail, adminEmail, otherTenantId: "" };
}

describe("Usage wallet billing", () => {
  let port = 0;
  let server: Server | undefined;
  let clinicAuth: Record<string, string> = {};
  let adminAuth: Record<string, string> = {};
  let tenantId = "";
  let otherTenantId = "";
  let clinicEmail = "";
  let adminEmail = "";

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

    const a = createUsers("wa");
    tenantId = a.tenantId;
    clinicEmail = a.clinicEmail;
    adminEmail = a.adminEmail;
    const b = createUsers("wb");
    otherTenantId = b.tenantId;

    const clinicLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: clinicEmail,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(clinicLogin.status, 200, String(clinicLogin.json.error || "clinic login"));
    clinicAuth = { Authorization: `Bearer ${String(clinicLogin.json.token)}` };

    const adminLogin = await jsonRequest(port, "POST", "/api/auth/login", {
      email: adminEmail,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(adminLogin.status, 200, String(adminLogin.json.error || "admin login"));
    adminAuth = { Authorization: `Bearer ${String(adminLogin.json.token)}` };
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  });

  it("WhatsApp send inserts usage_events with raw_cost and metadata, then debits billed_amount", async () => {
    const before = publicWalletStatus(tenantId).balance;
    const sent = await dispatchWhatsAppCloudMessage({
      to: "+919823455667",
      kind: "appointment_reminder",
      textBody: "Reminder",
      db: getDb(),
      tenantId,
      inCustomerServiceWindow: false,
    });
    assert.equal(sent.ok, true);
    const event = getDb()
      .prepare(
        `SELECT * FROM usage_events WHERE tenant_id = ? AND resource = 'whatsapp_message' ORDER BY created_at DESC LIMIT 1`
      )
      .get(tenantId) as {
      raw_cost: number;
      metadata: string;
      quantity: number;
    };
    assert.equal(event.quantity, 1);
    const meta = JSON.parse(event.metadata) as { kind: string; category: string; country: string };
    assert.equal(meta.kind, "appointment_reminder");
    assert.equal(meta.category, "utility");
    assert.equal(meta.country, "IN");
    const estimate = estimateWhatsAppRawCostInr({
      kind: "appointment_reminder",
      to: "+919823455667",
      inCustomerServiceWindow: false,
    });
    assert.equal(event.raw_cost, estimate.rawCost);
    const markup = getMarkupPercent(tenantId, "whatsapp_message");
    const billed = billedAmountFromRaw(estimate.rawCost, markup);
    const after = publicWalletStatus(tenantId).balance;
    assert.equal(round4(after), round4(before - billed));
    const debit = listWalletTransactions(tenantId, 5).find((t) => t.type === "usage_debit");
    assert.ok(debit);
    assert.equal(round4(debit!.amount), round4(-billed));
  });

  it("tenant override markup wins over global; missing config falls back to 20% placeholder", () => {
    const fresh = `tenant-markup-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
         VALUES (?, 'M', 'GP', 'India', 'IST', '', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(fresh, now, now, now);
    assert.equal(getMarkupPercent(fresh, "whatsapp_message"), DEFAULT_MARKUP_PERCENT);
    assert.equal(DEFAULT_MARKUP_PERCENT, 20);
    upsertMarkupConfig({ scope: "global", resource: "whatsapp_message", markupPercent: 30, updatedBy: "test" });
    assert.equal(getMarkupPercent(fresh, "whatsapp_message"), 30);
    upsertMarkupConfig({
      scope: "tenant",
      tenantId: fresh,
      resource: "whatsapp_message",
      markupPercent: 50,
      updatedBy: "test",
    });
    assert.equal(getMarkupPercent(fresh, "whatsapp_message"), 50);
    upsertMarkupConfig({ scope: "global", resource: "whatsapp_message", markupPercent: 20, updatedBy: "test" });
  });

  it("Gemini/AI Scribe with null raw_cost records usage_events but does not debit the wallet", () => {
    assert.equal(GEMINI_SCRIBE_RAW_COST_INR, null);
    const before = publicWalletStatus(tenantId).balance;
    const recorded = recordAiScribeUsage({ tenantId, quantityMinutes: 3.5, metadata: { test: true } });
    assert.ok(recorded);
    const event = getDb().prepare("SELECT * FROM usage_events WHERE id = ?").get(recorded!.usageEventId) as {
      raw_cost: number | null;
      quantity: number;
      resource: string;
    };
    assert.equal(event.resource, "ai_scribe_minutes");
    assert.equal(event.quantity, 3.5);
    assert.equal(event.raw_cost, null);
    assert.equal(publicWalletStatus(tenantId).balance, before);
    const rollup = getDb()
      .prepare("SELECT ai_scribe_minutes_used FROM tenants WHERE id = ?")
      .get(tenantId) as { ai_scribe_minutes_used: number };
    assert.ok(Number(rollup.ai_scribe_minutes_used) >= 3.5);
  });

  it("clinic admin cannot GET/PUT usage-markup; Super Admin can", async () => {
    const clinicGet = await jsonRequest(port, "GET", "/api/admin/usage-markup", undefined, clinicAuth);
    assert.equal(clinicGet.status, 403);
    const clinicPut = await jsonRequest(
      port,
      "PUT",
      "/api/admin/usage-markup",
      { scope: "global", resource: "whatsapp_message", markupPercent: 99 },
      clinicAuth
    );
    assert.equal(clinicPut.status, 403);
    const adminGet = await jsonRequest(port, "GET", "/api/admin/usage-markup", undefined, adminAuth);
    assert.equal(adminGet.status, 200);
    assert.equal((adminGet.json as { defaultMarkupPercent: number }).defaultMarkupPercent, 20);
    const adminPut = await jsonRequest(
      port,
      "PUT",
      "/api/admin/usage-markup",
      { scope: "global", resource: "whatsapp_message", markupPercent: 25 },
      adminAuth
    );
    assert.equal(adminPut.status, 200);
    const body = adminPut.json as { markup?: { markupPercent: number } };
    assert.equal(body.markup?.markupPercent, 25);
    await jsonRequest(
      port,
      "PUT",
      "/api/admin/usage-markup",
      { scope: "global", resource: "whatsapp_message", markupPercent: 20 },
      adminAuth
    );
  });

  it("clinic admin can view own wallet + transactions and request a top-up; cannot see markup or another tenant", async () => {
    const mine = await jsonRequest(port, "GET", "/api/wallet", undefined, clinicAuth);
    assert.equal(mine.status, 200);
    const wallet = mine.json.wallet as { balance: number; state: string };
    assert.ok(typeof wallet.balance === "number");
    assert.ok(Array.isArray(mine.json.transactions));
    assert.equal("markupPercent" in (mine.json as object), false);
    assert.equal(JSON.stringify(mine.json).includes("markup_percent"), false);
    assert.equal(JSON.stringify(mine.json).includes("markupPercent"), false);

    const other = await jsonRequest(port, "GET", `/api/wallet?tenantId=${otherTenantId}`, undefined, clinicAuth);
    assert.equal(other.status, 403);

    const topup = await jsonRequest(port, "POST", "/api/wallet/topup", { amountRupees: 250 }, clinicAuth);
    assert.equal(topup.status, 200, String(topup.json.error || ""));
    assert.equal(topup.json.purpose, "wallet_topup");
    assert.equal(topup.json.sandbox, true);
    assert.equal("markupPercent" in topup.json, false);
  });

  it("Razorpay webhook with purpose=wallet_topup credits after signature; unsigned does not; invoice webhooks still pay invoices", async () => {
    const before = publicWalletStatus(tenantId).balance;
    const unsigned = await jsonRequest(port, "POST", "/api/billing/razorpay/webhook", {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_wallet_unsigned",
            amount: 40000,
            notes: { purpose: "wallet_topup", tenant_id: tenantId, amount_rupees: "400" },
          },
        },
      },
    });
    assert.equal(unsigned.status, 403);
    assert.equal(publicWalletStatus(tenantId).balance, before);

    const prevSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "usage-wallet-hook";
    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_wallet_${crypto.randomUUID().slice(0, 8)}`,
            amount: 40000,
            notes: { purpose: "wallet_topup", tenant_id: tenantId, amount_rupees: "400" },
          },
        },
      },
    };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", "usage-wallet-hook").update(raw).digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/razorpay/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Razorpay-Signature": signature },
      body: raw,
    });
    if (prevSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prevSecret;
    assert.equal(res.status, 200, await res.clone().text());
    const json = (await res.json()) as { purpose?: string; wallet?: { balance: number } };
    assert.equal(json.purpose, "wallet_topup");
    assert.equal(round4(publicWalletStatus(tenantId).balance), round4(before + 400));

    const refs = extractRazorpayPaidRefs(payload);
    assert.equal(refs?.purpose, "wallet_topup");
    assert.equal(refs?.tenantId, tenantId);
    const invoiceRefs = extractRazorpayPaidRefs({
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_inv", notes: { invoice_id: "inv-1", tenant_id: tenantId } } },
      },
    });
    assert.equal(invoiceRefs?.invoiceId, "inv-1");
    assert.equal(invoiceRefs?.purpose, "");
  });

  it("critical WhatsApp (OTP, booking confirmation) still sends at 0/negative and records usage_debit", async () => {
    const emptyTenant = `tenant-empty-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
         VALUES (?, 'E', 'GP', 'India', 'IST', '', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(emptyTenant, now, now, now);
    publicWalletStatus(emptyTenant);
    assert.equal(publicWalletStatus(emptyTenant).balance, 0);

    const otp = await dispatchWhatsAppCloudMessage({
      to: "+919800011122",
      kind: "otp",
      otp: "123456",
      purpose: "login",
      textBody: "otp",
      db: getDb(),
      tenantId: emptyTenant,
      inCustomerServiceWindow: false,
    });
    assert.equal(otp.ok, true);
    assert.ok(publicWalletStatus(emptyTenant).balance < 0);

    const confirm = await dispatchWhatsAppCloudMessage({
      to: "+919800011122",
      kind: "book_confirmation",
      textBody: "confirmed",
      db: getDb(),
      tenantId: emptyTenant,
      inCustomerServiceWindow: false,
    });
    assert.equal(confirm.ok, true);
    const debits = listWalletTransactions(emptyTenant, 10).filter((t) => t.type === "usage_debit");
    assert.ok(debits.length >= 2);
  });

  it("non-critical WhatsApp and AI Scribe are blocked when debit would take balance below 0", async () => {
    const emptyTenant = `tenant-block-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
         VALUES (?, 'B', 'GP', 'India', 'IST', '', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(emptyTenant, now, now, now);
    publicWalletStatus(emptyTenant);

    const reminder = await dispatchWhatsAppCloudMessage({
      to: "+919800011122",
      kind: "appointment_reminder",
      textBody: "reminder",
      db: getDb(),
      tenantId: emptyTenant,
      inCustomerServiceWindow: false,
    });
    assert.equal(reminder.ok, false);
    assert.match(String("error" in reminder ? reminder.error : ""), /Top up now/i);

    const gate = assertWalletAllowsAiScribe(emptyTenant);
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.status, 402);
      assert.match(gate.error, /Top up now/i);
    }
  });

  it("applyWalletTransaction is atomic (ledger + balance); adjustments require a note", () => {
    const before = publicWalletStatus(tenantId).balance;
    const countBefore = listWalletTransactions(tenantId, 200).length;
    assert.throws(() => applyWalletTransaction(tenantId, "adjustment", 50, { note: "", createdBy: "test" }), /note/i);
    assert.equal(publicWalletStatus(tenantId).balance, before);

    assert.throws(
      () =>
        applyWalletTransaction(tenantId, "adjustment", 12, {
          note: "__test_fail_after_insert__",
          createdBy: "test",
        }),
      /forced failure/
    );
    assert.equal(publicWalletStatus(tenantId).balance, before);
    assert.equal(listWalletTransactions(tenantId, 200).length, countBefore);

    const ok = applyWalletTransaction(tenantId, "adjustment", 15, {
      note: "goodwill credit",
      createdBy: "test",
    });
    assert.equal(round4(ok.balanceAfter), round4(before + 15));
  });

  it("October 1 2026 (or env cutover flag) flips 24h service/utility window raw_cost from 0 to catalog rate", () => {
    const prevBill = process.env.META_BILL_SERVICE_WINDOW;
    const prevFree = process.env.META_FREE_SERVICE_WINDOW;
    const prevCut = process.env.META_SERVICE_WINDOW_CUTOVER;
    delete process.env.META_BILL_SERVICE_WINDOW;
    delete process.env.META_FREE_SERVICE_WINDOW;
    delete process.env.META_SERVICE_WINDOW_CUTOVER;

    const before = estimateWhatsAppRawCostInr({
      kind: "text",
      to: "+919823455667",
      inCustomerServiceWindow: true,
      now: new Date("2026-09-30T12:00:00.000Z"),
    });
    assert.equal(before.windowFree, true);
    assert.equal(before.rawCost, 0);

    const after = estimateWhatsAppRawCostInr({
      kind: "text",
      to: "+919823455667",
      inCustomerServiceWindow: true,
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    assert.equal(after.windowFree, false);
    assert.ok(after.rawCost > 0);
    assert.equal(after.rawCost, after.rateInr);

    process.env.META_BILL_SERVICE_WINDOW = "true";
    assert.equal(isMetaServiceWindowBilled(new Date("2025-01-01")), true);
    delete process.env.META_BILL_SERVICE_WINDOW;
    process.env.META_FREE_SERVICE_WINDOW = "true";
    assert.equal(isMetaServiceWindowBilled(new Date("2027-01-01")), false);

    if (prevBill === undefined) delete process.env.META_BILL_SERVICE_WINDOW;
    else process.env.META_BILL_SERVICE_WINDOW = prevBill;
    if (prevFree === undefined) delete process.env.META_FREE_SERVICE_WINDOW;
    else process.env.META_FREE_SERVICE_WINDOW = prevFree;
    if (prevCut === undefined) delete process.env.META_SERVICE_WINDOW_CUTOVER;
    else process.env.META_SERVICE_WINDOW_CUTOVER = prevCut;
    assert.equal(META_SERVICE_WINDOW_CUTOVER_ISO, "2026-10-01T00:00:00.000Z");
  });

  it("invoices and tenant_subscriptions schema files stay the clinic/SaaS surfaces", () => {
    const billing = fs.readFileSync(path.join(__dirname, "billing.ts"), "utf8");
    const usageApi = fs.readFileSync(path.join(__dirname, "usage-billing-api.ts"), "utf8");
    assert.match(billing, /createRazorpayCollectOrder/);
    assert.match(billing, /decideRazorpayWebhookSignature/);
    assert.match(usageApi, /purpose !== \"wallet_topup\"/);
    assert.match(usageApi, /decideRazorpayWebhookSignature/);
    const usage = fs.readFileSync(path.join(__dirname, "usage-billing.ts"), "utf8");
    assert.match(usage, /ensureUsageWalletSchema/);
    assert.equal(/CREATE TABLE IF NOT EXISTS invoices/.test(usage), false);
    insertUsageEvent({
      tenantId,
      resource: "whatsapp_message",
      quantity: 1,
      rawCost: 0.115,
      metadata: { probe: true },
    });
  });
});

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
