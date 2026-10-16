import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { applyWalletTransaction } from "./usage-wallet.ts";
import {
  decideRazorpayWebhookSignature,
  extractRazorpayPaidRefs,
  razorpayKeysConfigured,
  verifyRazorpayWebhookSignature,
} from "./razorpay.ts";
import { isUnsetOrPlaceholder } from "./runtime.ts";

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@billing-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  applyWalletTransaction(tenantId, "adjustment", 1000, {
    note: "Test seed credit for WhatsApp metering",
    createdBy: "system",
  });
  return { tenantId, userId, email };
}

describe("Razorpay webhook signatures", () => {
  const secret = "rzp_test_webhook_secret";
  const body = '{"event":"payment.captured"}';

  it("accepts a valid X-Razorpay-Signature", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyRazorpayWebhookSignature(body, sig, secret), true);
  });

  it("rejects a tampered payload", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyRazorpayWebhookSignature(body + "x", sig, secret), false);
  });

  it("fail-closes unsigned webhooks in production when the secret is missing", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      webhookSecret: "",
      production: true,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 500);
  });

  it("fail-closes unsigned webhooks in non-prod (sandbox mock is the only bypass)", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      webhookSecret: "",
      production: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  });

  it("fail-closes a bad signature even when the secret is present", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      webhookSecret: secret,
      production: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  });

  it("treats replace-with-* Razorpay env placeholders as unset", () => {
    assert.equal(isUnsetOrPlaceholder("replace-with-razorpay-key-id"), true);
    assert.equal(isUnsetOrPlaceholder("replace-with-razorpay-key-secret"), true);
    assert.equal(isUnsetOrPlaceholder("undefined"), true);
    const prevId = process.env.RAZORPAY_KEY_ID;
    const prevSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = "replace-with-razorpay-key-id";
    process.env.RAZORPAY_KEY_SECRET = "replace-with-razorpay-key-secret";
    assert.equal(razorpayKeysConfigured(), false);
    if (prevId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
  });

  it("extracts invoice notes from payment.captured payloads", () => {
    const refs = extractRazorpayPaidRefs({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            order_id: "order_1",
            notes: { invoice_id: "inv-1", tenant_id: "tenant-1" },
          },
        },
      },
    });
    assert.ok(refs);
    assert.equal(refs?.invoiceId, "inv-1");
    assert.equal(refs?.tenantId, "tenant-1");
    assert.equal(refs?.paymentId, "pay_1");
  });
});

describe("Wave 2 Razorpay UPI collect", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-billing-upi";
    }
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    assert.ok(token);
    return token;
  }

  async function seedVisit(auth: Record<string, string>, phoneTail: string) {
    const patientRes = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Billing Patient",
        phone: `+91 98120 ${phoneTail}`,
        age: 36,
        gender: "Female",
      },
      auth
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patient = patientRes.json.patient as { id: string; name: string; phone: string; uhid: string };

    const aptRes = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        patientId: patient.id,
        specialty: "General Medicine",
        isPaid: false,
        consultationFee: 600,
      },
      auth
    );
    assert.equal(aptRes.status, 201, String(aptRes.json.error || ""));
    const appointment = aptRes.json.appointment as { id: string; isPaid: boolean };
    assert.equal(appointment.isPaid, false);
    return { patient, appointment };
  }

  it("unauthenticated clients cannot read invoices or day-end", async () => {
    const list = await jsonRequest(port, "GET", "/api/invoices");
    assert.equal(list.status, 401);
    const create = await jsonRequest(port, "POST", "/api/invoices", { totalAmount: 100 });
    assert.equal(create.status, 401);
    const report = await jsonRequest(port, "GET", "/api/billing/day-end");
    assert.equal(report.status, 401);
    const letterhead = await jsonRequest(port, "GET", "/api/tenant/letterhead");
    assert.equal(letterhead.status, 401);
  });

  it("happy path: create bill, sandbox pay link, webhook fail-closed, sandbox mock marks Paid", async () => {
    const clinic = createClinicUser("payA");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient, appointment } = await seedVisit(auth, clinic.tenantId.slice(-4));

    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        patientUhid: patient.uhid,
        items: [
          {
            id: "b-consult",
            description: "OPD consult",
            category: "Consultation",
            quantity: 1,
            unitPrice: 700,
            total: 700,
          },
        ],
        discountAmount: 0,
        taxAmount: 0,
      },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const invoice = created.json.invoice as {
      id: string;
      invoiceNumber: string;
      paymentStatus: string;
      totalAmount: number;
      gstin: string;
      upiId: string;
      tenantId: string;
    };
    assert.ok(invoice.id);
    assert.match(invoice.invoiceNumber, /^INV-/);
    assert.equal(invoice.paymentStatus, "Unpaid");
    assert.equal(invoice.totalAmount, 700);
    assert.equal(invoice.tenantId, clinic.tenantId);
    assert.equal(invoice.gstin, "");
    assert.equal(invoice.upiId, "");

    const order = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/pay-order`, {}, auth);
    assert.equal(order.status, 200, String(order.json.error || ""));
    assert.equal(order.json.sandbox, true);
    assert.ok(String(order.json.payLink || "").includes(invoice.id));
    const stillUnpaid = await jsonRequest(port, "GET", `/api/invoices/${invoice.id}`, undefined, auth);
    assert.equal((stillUnpaid.json.invoice as { paymentStatus: string }).paymentStatus, "Unpaid");

    const aptUnpaid = await jsonRequest(port, "GET", `/api/appointments/${appointment.id}`, undefined, auth);
    assert.equal((aptUnpaid.json.appointment as { isPaid: boolean }).isPaid, false);

    const unsigned = await jsonRequest(port, "POST", "/api/billing/razorpay/webhook", {
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: "pay_x", notes: { invoice_id: invoice.id, tenant_id: clinic.tenantId } },
        },
      },
    });
    assert.equal(unsigned.status, 403);

    const prevSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "unit-billing-webhook";
    const tamperedBody = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: "pay_bad", notes: { invoice_id: invoice.id, tenant_id: clinic.tenantId } },
        },
      },
    });
    const bad = await fetch(`http://127.0.0.1:${port}/api/billing/razorpay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      body: tamperedBody,
    });
    assert.equal(bad.status, 403);
    if (prevSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prevSecret;

    const afterFail = await jsonRequest(port, "GET", `/api/invoices/${invoice.id}`, undefined, auth);
    assert.equal((afterFail.json.invoice as { paymentStatus: string }).paymentStatus, "Unpaid");

    const mock = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/sandbox-pay`, {}, auth);
    assert.equal(mock.status, 200, String(mock.json.error || ""));
    assert.equal(mock.json.sandbox, true);
    const paid = mock.json.invoice as { paymentStatus: string; paidAmount: number };
    assert.equal(paid.paymentStatus, "Paid");
    assert.equal(paid.paidAmount, 700);

    const refreshed = await jsonRequest(port, "GET", `/api/invoices/${invoice.id}`, undefined, auth);
    assert.equal((refreshed.json.invoice as { paymentStatus: string }).paymentStatus, "Paid");

    const aptPaid = await jsonRequest(port, "GET", `/api/appointments/${appointment.id}`, undefined, auth);
    assert.equal((aptPaid.json.appointment as { isPaid: boolean }).isPaid, true);

    const receipt = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/receipt`, {}, auth);
    assert.equal(receipt.status, 200, String(receipt.json.error || ""));
    assert.equal(receipt.json.channel, "sandbox");
    assert.equal(receipt.json.graphDelivered, false);
    assert.equal(receipt.json.sandbox, true);
    assert.equal(receipt.json.wamid, null);
    assert.equal(receipt.json.messageId, null);
    assert.match(String(receipt.json.notice || ""), /no live wamid/i);
    const receiptInvoice = receipt.json.invoice as { receiptWhatsAppMessageId?: string; receiptWhatsAppChannel?: string };
    assert.equal(receiptInvoice.receiptWhatsAppChannel, "sandbox");
    assert.equal(receiptInvoice.receiptWhatsAppMessageId || "", "");

    const report = await jsonRequest(port, "GET", "/api/billing/day-end", undefined, auth);
    assert.equal(report.status, 200);
    assert.equal(report.json.paidCount, 1);
    assert.equal(report.json.paidAmount, 700);
    assert.equal(report.json.dueCount, 0);
  });

  it("verified Razorpay webhook marks the invoice Paid", async () => {
    const clinic = createClinicUser("hook");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient, appointment } = await seedVisit(auth, clinic.tenantId.slice(-5).slice(-4));

    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Consult", quantity: 1, unitPrice: 500, total: 500 }],
      },
      auth
    );
    const invoice = created.json.invoice as { id: string };
    await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/pay-order`, {}, auth);

    const prevSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "live-webhook-secret";
    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_live_1",
            order_id: `order_sandbox_${invoice.id}`,
            notes: { invoice_id: invoice.id, tenant_id: clinic.tenantId },
          },
        },
      },
    };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", "live-webhook-secret").update(raw).digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/razorpay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: raw,
    });
    if (prevSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prevSecret;
    assert.equal(res.status, 200, await res.clone().text());
    const json = (await res.json()) as { invoice?: { paymentStatus: string } };
    assert.equal(json.invoice?.paymentStatus, "Paid");

    const again = await jsonRequest(port, "GET", `/api/invoices/${invoice.id}`, undefined, auth);
    assert.equal((again.json.invoice as { paymentStatus: string }).paymentStatus, "Paid");
  });

  it("sandbox mock is disabled in production", async () => {
    const clinic = createClinicUser("prod");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient } = await seedVisit(auth, clinic.tenantId.slice(-4));
    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Consult", quantity: 1, unitPrice: 400, total: 400 }],
      },
      auth
    );
    const invoice = created.json.invoice as { id: string };
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const mock = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/sandbox-pay`, {}, auth);
      assert.equal(mock.status, 403);
      const still = await jsonRequest(port, "GET", `/api/invoices/${invoice.id}`, undefined, auth);
      assert.equal((still.json.invoice as { paymentStatus: string }).paymentStatus, "Unpaid");
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("clinic A never sees clinic B invoices", async () => {
    const clinicA = createClinicUser("isoInvA");
    const clinicB = createClinicUser("isoInvB");
    const tokenA = await login(clinicA.email);
    const tokenB = await login(clinicB.email);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const visitA = await seedVisit(authA, clinicA.tenantId.slice(-4));
    const visitB = await seedVisit(authB, clinicB.tenantId.slice(-4));

    const invA = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: visitA.patient.id,
        patientName: visitA.patient.name,
        patientPhone: visitA.patient.phone,
        items: [{ description: "A-only", quantity: 1, unitPrice: 250, total: 250 }],
      },
      authA
    );
    assert.equal(invA.status, 201);
    const idA = (invA.json.invoice as { id: string }).id;

    const stolen = await jsonRequest(port, "GET", `/api/invoices/${idA}`, undefined, authB);
    assert.equal(stolen.status, 404);

    const listB = await jsonRequest(port, "GET", "/api/invoices", undefined, authB);
    const idsB = ((listB.json.invoices as Array<{ id: string }>) || []).map((i) => i.id);
    assert.equal(idsB.includes(idA), false);

    const invB = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: visitB.patient.id,
        patientName: visitB.patient.name,
        patientPhone: visitB.patient.phone,
        items: [{ description: "B-only", quantity: 1, unitPrice: 300, total: 300 }],
      },
      authB
    );
    assert.equal(invB.status, 201);
    const listA = await jsonRequest(port, "GET", "/api/invoices", undefined, authA);
    const numsA = ((listA.json.invoices as Array<{ id: string }>) || []).map((i) => i.id);
    assert.ok(numsA.includes(idA));
    assert.equal(numsA.includes((invB.json.invoice as { id: string }).id), false);

    const demoToken = await login("doctor@lumera.me");
    const demoList = await jsonRequest(port, "GET", "/api/invoices", undefined, {
      Authorization: `Bearer ${demoToken}`,
    });
    const demoIds = ((demoList.json.invoices as Array<{ id: string }>) || []).map((i) => i.id);
    assert.equal(demoIds.includes(idA), false);
    const demoTenant = getDb()
      .prepare("SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ?")
      .get(DEMO_TENANT_ID) as { c: number };
    assert.ok(demoTenant.c >= 0);
  });

  it("desk collect cannot mark UPI invoices paid", async () => {
    const clinic = createClinicUser("desk");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient } = await seedVisit(auth, clinic.tenantId.slice(-4));
    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Consult", quantity: 1, unitPrice: 450, total: 450 }],
      },
      auth
    );
    const id = (created.json.invoice as { id: string }).id;
    const blocked = await jsonRequest(
      port,
      "POST",
      `/api/invoices/${id}/desk-collect`,
      { paymentMode: "UPI" },
      auth
    );
    assert.equal(blocked.status, 400);
    const still = await jsonRequest(port, "GET", `/api/invoices/${id}`, undefined, auth);
    assert.equal((still.json.invoice as { paymentStatus: string }).paymentStatus, "Unpaid");
  });

  it("real tenants never persist seed Lumera GSTIN/UPI even if the client sends them", async () => {
    const clinic = createClinicUser("noseed");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient } = await seedVisit(auth, clinic.tenantId.slice(-4));

    const letterhead = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, auth);
    assert.equal(letterhead.status, 200, String(letterhead.json.error || ""));
    const lh = letterhead.json.letterhead as { gstin: string; upiId: string };
    assert.equal(lh.gstin, "");
    assert.equal(lh.upiId, "");

    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Consult", quantity: 1, unitPrice: 500, total: 500 }],
        gstin: "19AABCL8899K1Z5",
        upiId: "lumerahealth@icici",
      },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const invoice = created.json.invoice as { gstin: string; upiId: string };
    assert.equal(invoice.gstin, "");
    assert.equal(invoice.upiId, "");

    getDb()
      .prepare("UPDATE tenants SET gstin = ?, upi_id = ? WHERE id = ?")
      .run("19AABCL8899K1Z5", "lumerahealth@icici", clinic.tenantId);

    const createdAfterSeedRow = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Follow-up", quantity: 1, unitPrice: 400, total: 400 }],
      },
      auth
    );
    assert.equal(createdAfterSeedRow.status, 201, String(createdAfterSeedRow.json.error || ""));
    const scrubbed = createdAfterSeedRow.json.invoice as { gstin: string; upiId: string };
    assert.equal(scrubbed.gstin, "");
    assert.equal(scrubbed.upiId, "");
  });

  it("prefers tenant letterhead GSTIN/UPI when present", async () => {
    const clinic = createClinicUser("lhset");
    const token = await login(clinic.email);
    const auth = { Authorization: `Bearer ${token}` };
    const { patient } = await seedVisit(auth, clinic.tenantId.slice(-4));
    getDb()
      .prepare("UPDATE tenants SET gstin = ?, upi_id = ? WHERE id = ?")
      .run("27AAACL9999A1Z5", "realclinic@upi", clinic.tenantId);

    const letterhead = await jsonRequest(port, "GET", "/api/tenant/letterhead", undefined, auth);
    const lh = letterhead.json.letterhead as { gstin: string; upiId: string; clinicName: string };
    assert.equal(lh.gstin, "27AAACL9999A1Z5");
    assert.equal(lh.upiId, "realclinic@upi");
    assert.ok(lh.clinicName);

    const created = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ description: "Consult", quantity: 1, unitPrice: 550, total: 550 }],
        gstin: "19AABCL8899K1Z5",
        upiId: "lumerahealth@icici",
      },
      auth
    );
    const invoice = created.json.invoice as { gstin: string; upiId: string };
    assert.equal(invoice.gstin, "27AAACL9999A1Z5");
    assert.equal(invoice.upiId, "realclinic@upi");
  });

  it("invoice receipts use Meta sendPaymentReceipt and do not ship a competing letterhead CRUD", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const billing = fs.readFileSync(path.join(dir, "billing.ts"), "utf8");
    const api = fs.readFileSync(path.join(dir, "api.ts"), "utf8");
    const letterhead = fs.readFileSync(path.join(dir, "letterhead.ts"), "utf8");
    assert.match(billing, /sendPaymentReceipt/);
    assert.match(billing, /getTenantLetterhead/);
    assert.match(billing, /tenantId: invoice.tenantId/);
    assert.equal(/sendWhatsAppGraphText/.test(billing), false);
    assert.equal(/resolveGraphCredentials/.test(billing), false);
    assert.equal(/createLetterheadReadRouter/.test(api), false);
    assert.equal(/createLetterheadReadRouter/.test(letterhead), false);
    assert.match(letterhead, /export function updateTenantLetterhead/);
    assert.doesNotMatch(billing, /DELETE FROM invoices/i);
    assert.match(billing, /invoiceNumberToPersist/);
  });

  it("keeps numbered invoices and returns the saved total for that appointment only", async () => {
    const clinic = createClinicUser("savedbill");
    const other = createClinicUser("savedbillB");
    const token = await login(clinic.email);
    const otherToken = await login(other.email);
    const auth = { Authorization: `Bearer ${token}` };
    const authB = { Authorization: `Bearer ${otherToken}` };
    const { patient, appointment } = await seedVisit(auth, clinic.tenantId.slice(-4));

    const secondApt = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: patient.id, date: "2026-01-15", timeSlot: "09:00 AM", specialty: "General Medicine" },
      auth
    );
    assert.equal(secondApt.status, 201, String(secondApt.json.error || ""));
    const olderAppointmentId = (secondApt.json.appointment as { id: string }).id;

    const numbered = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        invoiceNumber: "INV-2026-KEEPME",
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [
          { id: "consult", description: "OPD consult", category: "Consultation", quantity: 1, unitPrice: 750, total: 750 },
        ],
        subtotal: 750,
        discountAmount: 0,
        taxAmount: 0,
      },
      auth
    );
    assert.equal(numbered.status, 201, String(numbered.json.error || ""));
    const saved = numbered.json.invoice as {
      id: string;
      invoiceNumber: string;
      appointmentId: string;
      totalAmount: number;
      items: Array<{ description: string; total: number; unitPrice: number }>;
    };
    assert.equal(saved.invoiceNumber, "INV-2026-KEEPME");
    assert.equal(saved.appointmentId, appointment.id);
    assert.equal(saved.totalAmount, 750);
    assert.equal(saved.items[0].unitPrice, 750);
    assert.equal(saved.items[0].total, 750);

    const draftPlaceholder = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        invoiceNumber: "Draft (not saved)",
        appointmentId: olderAppointmentId,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ id: "old", description: "Earlier consult", quantity: 1, unitPrice: 2000, total: 2000 }],
      },
      auth
    );
    assert.equal(draftPlaceholder.status, 201, String(draftPlaceholder.json.error || ""));
    const allocated = draftPlaceholder.json.invoice as { id: string; invoiceNumber: string; totalAmount: number };
    assert.match(allocated.invoiceNumber, /^INV-\d{4}-[A-Z0-9]+$/);
    assert.notEqual(allocated.invoiceNumber, "Draft (not saved)");
    assert.equal(allocated.totalAmount, 2000);

    const forToday = await jsonRequest(
      port,
      "GET",
      `/api/invoices?appointmentId=${encodeURIComponent(appointment.id)}`,
      undefined,
      auth
    );
    assert.equal(forToday.status, 200);
    const todayRows = forToday.json.invoices as Array<{ id: string; invoiceNumber: string; totalAmount: number }>;
    assert.deepEqual(todayRows.map((row) => row.id), [saved.id]);
    assert.equal(todayRows[0].totalAmount, 750);
    assert.equal(todayRows[0].invoiceNumber, "INV-2026-KEEPME");

    const all = await jsonRequest(port, "GET", "/api/invoices", undefined, auth);
    const numbers = ((all.json.invoices as Array<{ invoiceNumber: string; id: string }>) || []).map((row) => row.invoiceNumber);
    assert.ok(numbers.includes("INV-2026-KEEPME"));
    assert.ok(numbers.includes(allocated.invoiceNumber));
    assert.equal(numbers.includes("Draft (not saved)"), false);

    const stolen = await jsonRequest(
      port,
      "GET",
      `/api/invoices?appointmentId=${encodeURIComponent(appointment.id)}`,
      undefined,
      authB
    );
    assert.equal(stolen.status, 200);
    assert.deepEqual(stolen.json.invoices, []);
  });

  it("bills the visit doctor and keeps the signed-in user as issuer", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const db = getDb();
    const tenantId = `tenant-consult-${suffix}`;
    const otherTenantId = `tenant-consult-other-${suffix}`;
    const ananyaUserId = `user-ananya-${suffix}`;
    const receptionUserId = `user-reception-${suffix}`;
    const otherDoctorUserId = `user-other-doc-${suffix}`;
    const ananyaEmail = `ananya.${suffix}@billing-test.example`;
    const receptionEmail = `reception.${suffix}@billing-test.example`;
    const ananyaDoctorId = `doc-ananya-${suffix}`;
    const otherDoctorId = `doc-other-${suffix}`;

    const insertTenant = db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
    );
    insertTenant.run(tenantId, "Sunrise Family Clinic", now, now, now);
    insertTenant.run(otherTenantId, "Other Clinic", now, now, now);
    const insertUser = db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'Sunrise Family Clinic', 1, 'individual', 'General Medicine', ?, ?)`
    );
    insertUser.run(ananyaUserId, tenantId, ananyaEmail, hashPassword("Lumera@2026"), "Dr. Ananya Sen", "doctor", "+91 90000 11111", now, now);
    insertUser.run(
      receptionUserId,
      tenantId,
      receptionEmail,
      hashPassword("Lumera@2026"),
      "Priya Deshmukh",
      "receptionist",
      "+91 90000 22222",
      now,
      now
    );
    insertUser.run(
      otherDoctorUserId,
      otherTenantId,
      `other.${suffix}@billing-test.example`,
      hashPassword("Lumera@2026"),
      "Dr. Other Clinic",
      "doctor",
      "+91 90000 33333",
      now,
      now
    );
    const insertDoctor = db.prepare(
      `INSERT INTO doctors (
         id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
         opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
       ) VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 6, 800, '1', '[]', '09:00-13:00', '', '', '', '', '', 1)`
    );
    insertDoctor.run(ananyaDoctorId, ananyaUserId, "Dr. Ananya Sen", `REG-${suffix}`);
    insertDoctor.run(otherDoctorId, otherDoctorUserId, "Dr. Other Clinic", `REG-O-${suffix}`);

    const receptionToken = await login(receptionEmail);
    const receptionAuth = { Authorization: `Bearer ${receptionToken}` };
    const patientRes = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Billing Patient", phone: `+91 98121 ${suffix.slice(-4)}`, age: 34, gender: "Female" },
      receptionAuth
    );
    assert.equal(patientRes.status, 201, String(patientRes.json.error || ""));
    const patient = patientRes.json.patient as { id: string; name: string; phone: string; uhid: string };
    const aptRes = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: patient.id, doctorId: ananyaDoctorId, date: "2026-10-16", timeSlot: "10:30", consultationFee: 800 },
      receptionAuth
    );
    assert.equal(aptRes.status, 201, String(aptRes.json.error || ""));
    const appointment = aptRes.json.appointment as { id: string; doctorId: string; doctorName: string };
    assert.equal(appointment.doctorId, ananyaDoctorId);
    assert.match(appointment.doctorName, /Ananya/);

    const billed = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        patientUhid: patient.uhid,
        items: [
          {
            id: "b-consult",
            description: "OPD Specialist Consultation - General Medicine (Dr. Ananya Sen)",
            category: "Consultation",
            quantity: 1,
            unitPrice: 800,
            total: 800,
          },
        ],
        consultingDoctorId: ananyaDoctorId,
        consultingDoctorName: "Priya Deshmukh",
        issuedBy: "Dr. Ananya Sen",
      },
      receptionAuth
    );
    assert.equal(billed.status, 201, String(billed.json.error || ""));
    const receptionInvoice = billed.json.invoice as {
      id: string;
      consultingDoctorId: string;
      consultingDoctorName: string;
      issuedBy: string;
    };
    assert.equal(receptionInvoice.consultingDoctorId, ananyaDoctorId);
    assert.match(receptionInvoice.consultingDoctorName, /Ananya/);
    assert.equal(receptionInvoice.issuedBy, "Priya Deshmukh");
    const stored = db
      .prepare("SELECT consulting_doctor_id, consulting_doctor_name, issued_by, tenant_id FROM invoices WHERE id = ?")
      .get(receptionInvoice.id) as {
      consulting_doctor_id: string;
      consulting_doctor_name: string;
      issued_by: string;
      tenant_id: string;
    };
    assert.equal(stored.tenant_id, tenantId);
    assert.equal(stored.consulting_doctor_id, ananyaDoctorId);
    assert.match(stored.consulting_doctor_name, /Ananya/);
    assert.equal(stored.issued_by, "Priya Deshmukh");

    const doctorToken = await login(ananyaEmail);
    const doctorAuth = { Authorization: `Bearer ${doctorToken}` };
    const ownVisit = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: patient.id, doctorId: ananyaDoctorId, date: "2026-10-16", timeSlot: "11:00" },
      doctorAuth
    );
    assert.equal(ownVisit.status, 201, String(ownVisit.json.error || ""));
    const ownAppointment = ownVisit.json.appointment as { id: string };
    const ownBill = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        appointmentId: ownAppointment.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        items: [{ id: "b-consult", description: "OPD", quantity: 1, unitPrice: 800, total: 800 }],
        consultingDoctorId: ananyaDoctorId,
        consultingDoctorName: "Dr. Ananya Sen",
      },
      doctorAuth
    );
    assert.equal(ownBill.status, 201, String(ownBill.json.error || ""));
    const doctorInvoice = ownBill.json.invoice as { consultingDoctorName: string; issuedBy: string; consultingDoctorId: string };
    assert.equal(doctorInvoice.consultingDoctorId, ananyaDoctorId);
    assert.equal(doctorInvoice.consultingDoctorName, "Dr. Ananya Sen");
    assert.equal(doctorInvoice.issuedBy, "Dr. Ananya Sen");

    const crossed = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        items: [{ id: "b-consult", description: "OPD", quantity: 1, unitPrice: 500, total: 500 }],
        consultingDoctorId: otherDoctorId,
        consultingDoctorName: "Dr. Other Clinic",
      },
      receptionAuth
    );
    assert.equal(crossed.status, 400);
    assert.match(String(crossed.json.error), /Consulting doctor/);

    const overridden = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
        items: [{ id: "b-consult", description: "OPD", quantity: 1, unitPrice: 800, total: 800 }],
        consultingDoctorId: otherDoctorId,
        consultingDoctorName: "Dr. Other Clinic",
      },
      receptionAuth
    );
    assert.equal(overridden.status, 201, String(overridden.json.error || ""));
    const overriddenInvoice = overridden.json.invoice as { consultingDoctorId: string; consultingDoctorName: string };
    assert.equal(overriddenInvoice.consultingDoctorId, ananyaDoctorId);
    assert.match(overriddenInvoice.consultingDoctorName, /Ananya/);
    assert.equal(overriddenInvoice.consultingDoctorName.includes("Other"), false);

    const namedOnly = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientId: patient.id,
        patientName: patient.name,
        items: [{ id: "b-consult", description: "OPD", quantity: 1, unitPrice: 500, total: 500 }],
        consultingDoctorName: "Not On The Roster",
      },
      receptionAuth
    );
    assert.equal(namedOnly.status, 400);
    assert.match(String(namedOnly.json.error), /Consulting doctor/);
    const leaked = db.prepare("SELECT id FROM invoices WHERE consulting_doctor_name = ?").get("Not On The Roster");
    assert.equal(leaked, undefined);
  });
});
