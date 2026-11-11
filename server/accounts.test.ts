import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { ensureAccountsSchema } from "./accounts-schema.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { readStoredPatientDocument } from "./patient-documents.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { applyWalletTransaction } from "./usage-wallet.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";

function suffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function seedClinic(label: string) {
  const tag = suffix();
  const tenantId = `tenant-${label}-${tag}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  const user = (role: string, key: string) => {
    const userId = `user-${key}-${tag}`;
    const email = `${key}.${tag}@accounts-test.example`.toLowerCase();
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
    ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `${key} ${label}`, role, `+91 90000 ${tag.slice(0, 5)}`, `Clinic ${label}`, now, now);
    return { userId, email, role };
  };
  applyWalletTransaction(tenantId, "adjustment", 1000, { note: "accounts test", createdBy: "system" });
  return {
    tenantId,
    admin: user("CLINIC_ADMIN", "admin"),
    desk: user("receptionist", "desk"),
    doctor: user("doctor", "doc"),
  };
}

describe("clinic accounts, inventory, and day close", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-accounts";
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      getDb();
    } catch {
      initDatabase();
    }
    ensureAccountsSchema(getDb());
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<Record<string, string>> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || res.status));
    return { Authorization: `Bearer ${String(res.json.token)}` };
  }

  async function createPatient(auth: Record<string, string>, name: string) {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name, phone: `+91 98${Math.floor(10000000 + Math.random() * 89999999)}`, age: 4, gender: "Female" },
      auth
    );
    assert.equal(res.status, 201, String(res.json.error || ""));
    return res.json.patient as { id: string; name: string };
  }

  async function bill(
    auth: Record<string, string>,
    amount: number,
    extra: Record<string, unknown> = {}
  ) {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientName: "Day book",
        items: [{ id: "b1", description: "OPD", category: "Consultation", quantity: 1, unitPrice: amount, total: amount, gstPercent: 0 }],
        subtotal: amount,
        discountAmount: 0,
        taxAmount: 0,
        ...extra,
      },
      auth
    );
    assert.equal(res.status, 201, String(res.json.error || ""));
    return (res.json.invoice as { id: string; invoiceNumber: string; totalAmount: number; taxAmount: number });
  }

  it("rejects anonymous access and still refuses a desk UPI mark-paid", async () => {
    const anon = await jsonRequest(port, "GET", "/api/accounts/day-close");
    assert.equal(anon.status, 401);
    const clinic = seedClinic("guard");
    const desk = await login(clinic.desk.email);
    const invoice = await bill(desk, 100);
    const upi = await jsonRequest(port, "POST", `/api/invoices/${invoice.id}/desk-collect`, { paymentMode: "UPI" }, desk);
    assert.equal(upi.status, 400);

    const linked = await bill(desk, 150);
    const order = await jsonRequest(port, "POST", `/api/invoices/${linked.id}/pay-order`, {}, desk);
    assert.equal(order.status, 200, String(order.json.error || ""));
    const clinicUpi = await jsonRequest(port, "POST", "/api/accounts/collections/upi", { invoiceId: linked.id }, desk);
    assert.equal(clinicUpi.status, 400);
    const still = await jsonRequest(port, "GET", `/api/invoices/${linked.id}`, undefined, desk);
    assert.equal((still.json.invoice as { paymentStatus: string }).paymentStatus, "Unpaid");
  });

  it("keeps tenants, roles, stock math, and day-close totals apart", async () => {
    const clinic = seedClinic("main");
    const other = seedClinic("other");
    const admin = await login(clinic.admin.email);
    const desk = await login(clinic.desk.email);
    const doctor = await login(clinic.doctor.email);
    const outsider = await login(other.admin.email);

    const vendor = await jsonRequest(port, "POST", "/api/accounts/vendors", { name: "Serum Institute" }, admin);
    assert.equal(vendor.status, 201, String(vendor.json.error || ""));
    const vendorId = (vendor.json.vendor as { id: string }).id;

    const itemRes = await jsonRequest(
      port,
      "POST",
      "/api/accounts/items",
      { name: "BCG", kind: "vaccine", gstPercent: 5, reorderLevel: 4, sellPrice: 250, unit: "vial" },
      admin
    );
    assert.equal(itemRes.status, 201, String(itemRes.json.error || ""));
    const itemId = (itemRes.json.item as { id: string }).id;

    const deskLock = await jsonRequest(
      port,
      "POST",
      "/api/accounts/price-locks",
      { vendorId, itemId, agreedRate: 100 },
      desk
    );
    assert.equal(deskLock.status, 403);
    assert.equal(deskLock.json.code, "ROLE_DENIED");
    const doctorLock = await jsonRequest(
      port,
      "POST",
      "/api/accounts/price-locks",
      { vendorId, itemId, agreedRate: 100 },
      doctor
    );
    assert.equal(doctorLock.status, 403);
    assert.equal(doctorLock.json.code, "ROLE_DENIED");

    const lock = await jsonRequest(
      port,
      "POST",
      "/api/accounts/price-locks",
      { vendorId, itemId, agreedRate: 100 },
      admin
    );
    assert.equal(lock.status, 201, String(lock.json.error || ""));

    const deskDelete = await jsonRequest(port, "DELETE", `/api/accounts/items/${itemId}`, undefined, desk);
    assert.equal(deskDelete.status, 403);
    assert.equal(deskDelete.json.code, "ROLE_DENIED");

    const today = clinicCalendarDate(new Date(), "IST (UTC+5:30)");
    const soonExpiry = shiftIsoDate(today, 20);
    const laterExpiry = shiftIsoDate(today, 200);
    const expiredExpiry = shiftIsoDate(today, -30);
    const soon = await jsonRequest(
      port,
      "POST",
      "/api/accounts/stock-in",
      { itemId, vendorId, batchNo: "SOON", expiryDate: soonExpiry, qty: 2, unitCost: 90 },
      desk
    );
    assert.equal(soon.status, 201, String(soon.json.error || ""));
    assert.equal(soon.json.priceFlag, "deviation");
    const soonId = (soon.json.batch as { id: string }).id;

    const later = await jsonRequest(
      port,
      "POST",
      "/api/accounts/stock-in",
      { itemId, vendorId, batchNo: "LATER", expiryDate: laterExpiry, qty: 5, unitCost: 100 },
      desk
    );
    assert.equal(later.status, 201, String(later.json.error || ""));
    assert.equal(later.json.priceFlag, "match");
    const expiredIn = await jsonRequest(
      port,
      "POST",
      "/api/accounts/stock-in",
      { itemId, vendorId, batchNo: "OLD", expiryDate: expiredExpiry, qty: 9, unitCost: 100 },
      desk
    );
    assert.equal(expiredIn.status, 201, String(expiredIn.json.error || ""));

    const stolen = await jsonRequest(
      port,
      "POST",
      "/api/accounts/stock-in",
      { itemId, vendorId, batchNo: "NOPE", expiryDate: "2027-01-01", qty: 1, unitCost: 100 },
      outsider
    );
    assert.equal(stolen.status, 404);

    const otherStock = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, outsider);
    assert.equal(otherStock.status, 200);
    const otherItems = (otherStock.json.items as { id: string }[]) || [];
    assert.equal(otherItems.some((row) => row.id === itemId), false);

    const patient = await createPatient(admin, "Asha");
    const hiddenVax = await jsonRequest(
      port,
      "GET",
      `/api/accounts/vaccines?patientId=${encodeURIComponent(patient.id)}`,
      undefined,
      outsider
    );
    assert.equal(hiddenVax.status, 404);

    const deskGive = await jsonRequest(
      port,
      "POST",
      "/api/accounts/vaccines",
      { patientId: patient.id, itemId, batchId: soonId, dose: "0.05 ml", qty: 1 },
      desk
    );
    assert.equal(deskGive.status, 403);
    assert.equal(deskGive.json.code, "ROLE_DENIED");

    const given = await jsonRequest(
      port,
      "POST",
      "/api/accounts/vaccines",
      { patientId: patient.id, itemId, batchId: soonId, dose: "0.05 ml", qty: 1 },
      doctor
    );
    assert.equal(given.status, 201, String(given.json.error || ""));
    const administration = given.json.administration as { batchNo: string; expiryDate: string; id: string };
    assert.equal(administration.batchNo, "SOON");
    assert.equal(administration.expiryDate, soonExpiry);

    const chart = await jsonRequest(
      port,
      "GET",
      `/api/accounts/vaccines?patientId=${encodeURIComponent(patient.id)}`,
      undefined,
      doctor
    );
    assert.equal(chart.status, 200);
    const rows = chart.json.administrations as { batchNo: string; expiryDate: string }[];
    assert.equal(rows[0].batchNo, "SOON");
    assert.equal(rows[0].expiryDate, soonExpiry);

    const stock = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, desk);
    const batches = stock.json.batches as { id: string; qty: number; batchNo: string }[];
    assert.equal(batches.find((row) => row.batchNo === "SOON")?.qty, 1);
    assert.equal(batches.find((row) => row.batchNo === "LATER")?.qty, 5);
    const alerts = stock.json.alerts as { priceDeviations: { batchNo: string }[]; nearExpiry: { batchNo: string }[]; expired: { batchNo: string }[] };
    assert.equal(alerts.priceDeviations.some((row) => row.batchNo === "SOON"), true);
    assert.equal(alerts.nearExpiry.some((row) => row.batchNo === "SOON"), true);
    assert.equal(alerts.expired.some((row) => row.batchNo === "OLD"), true);

    const fefo = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientName: "Stock bill",
        items: [
          {
            id: "med",
            description: "BCG",
            category: "Pharmacy",
            quantity: 3,
            unitPrice: 250,
            total: 750,
            gstPercent: 5,
            inventoryItemId: itemId,
          },
        ],
        subtotal: 750,
        discountAmount: 0,
        taxAmount: 0,
      },
      desk
    );
    assert.equal(fefo.status, 201, String(fefo.json.error || ""));
    const fefoInvoice = fefo.json.invoice as { taxAmount: number; totalAmount: number; invoiceNumber: string };
    assert.equal(fefoInvoice.taxAmount, 38);
    assert.equal(fefoInvoice.totalAmount, 788);
    const after = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, desk);
    const left = after.json.batches as { batchNo: string; qty: number }[];
    assert.equal(left.find((row) => row.batchNo === "SOON")?.qty, 0);
    assert.equal(left.find((row) => row.batchNo === "LATER")?.qty, 3);
    assert.equal(left.find((row) => row.batchNo === "OLD")?.qty, 9);
    const low = after.json.alerts as { lowStock: { name: string; onHand: number }[] };
    assert.equal(low.lowStock.some((row) => row.name === "BCG" && row.onHand === 3), true);

    const short = await jsonRequest(
      port,
      "POST",
      "/api/invoices",
      {
        patientName: "Too many",
        items: [
          {
            id: "med2",
            description: "BCG",
            category: "Pharmacy",
            quantity: 9,
            unitPrice: 10,
            total: 90,
            gstPercent: 0,
            inventoryItemId: itemId,
          },
        ],
        subtotal: 90,
        discountAmount: 0,
      },
      desk
    );
    assert.equal(short.status, 409);
    const still = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, desk);
    const unchanged = still.json.batches as { batchNo: string; qty: number }[];
    assert.equal(unchanged.find((row) => row.batchNo === "LATER")?.qty, 3);

    const cash = await bill(desk, 500);
    const upi = await bill(desk, 200);
    const card = await bill(desk, 100);
    const razor = await bill(desk, 300);
    const cover = await bill(desk, 80);
    assert.equal((await jsonRequest(port, "POST", `/api/invoices/${cash.id}/desk-collect`, { paymentMode: "Cash" }, desk)).status, 200);
    assert.equal((await jsonRequest(port, "POST", `/api/invoices/${card.id}/desk-collect`, { paymentMode: "Card" }, desk)).status, 200);
    assert.equal((await jsonRequest(port, "POST", `/api/invoices/${cover.id}/desk-collect`, { paymentMode: "Insurance" }, desk)).status, 200);
    const sandbox = await jsonRequest(port, "POST", `/api/invoices/${razor.id}/sandbox-pay`, undefined, desk);
    assert.equal(sandbox.status, 200, String(sandbox.json.error || ""));
    const clinicUpi = await jsonRequest(port, "POST", "/api/accounts/collections/upi", { invoiceId: upi.id }, desk);
    assert.equal(clinicUpi.status, 201, String(clinicUpi.json.error || ""));
    const refund = await jsonRequest(port, "POST", "/api/accounts/refunds", { invoiceId: cash.id, amount: 50, reason: "Returned" }, desk);
    assert.equal(refund.status, 201, String(refund.json.error || ""));

    const open = await jsonRequest(port, "GET", "/api/accounts/day-close", undefined, desk);
    assert.equal(open.status, 200);
    const expected = open.json.expected as { cash: number; upi: number; card: number; razorpay: number; other: number };
    assert.equal(expected.cash, 450);
    assert.equal(expected.upi, 200);
    assert.equal(expected.card, 100);
    assert.equal(expected.razorpay, 300);
    assert.equal(expected.other, 80);
    assert.equal(open.json.refundTotal, 50);
    assert.equal(open.json.fourExpected, 1050);

    const doctorDelete = await jsonRequest(
      port,
      "DELETE",
      `/api/accounts/day-close?date=${encodeURIComponent(String(open.json.date))}`,
      undefined,
      doctor
    );
    assert.equal(doctorDelete.status, 403);

    const closed = await jsonRequest(
      port,
      "POST",
      "/api/accounts/day-close",
      { date: open.json.date, counted: { cash: 440, upi: 200, card: 100, razorpay: 300 }, note: "Drawer short 10" },
      desk
    );
    assert.equal(closed.status, 201, String(closed.json.error || ""));
    assert.equal(closed.json.closed, true);
    const discrepancy = closed.json.discrepancy as { cash: number };
    assert.equal(discrepancy.cash, -10);
    assert.equal(closed.json.discrepancyTotal, -10);
    assert.equal(closed.json.countedTotal, 1040);
    assert.equal(closed.json.netExpected, 1130);

    const again = await jsonRequest(
      port,
      "POST",
      "/api/accounts/day-close",
      { date: open.json.date, counted: { cash: 0, upi: 0, card: 0, razorpay: 0 } },
      desk
    );
    assert.equal(again.status, 409);

    const foreignClose = await jsonRequest(port, "GET", "/api/accounts/day-close", undefined, outsider);
    const foreignBills = (foreignClose.json.bills as { invoiceNumber: string }[]) || [];
    assert.equal(foreignBills.some((row) => row.invoiceNumber === cash.invoiceNumber), false);

    const month = String(open.json.date).slice(0, 7);
    const csvRes = await fetch(`http://127.0.0.1:${port}/api/accounts/export?month=${month}&format=csv`, { headers: desk });
    assert.equal(csvRes.status, 200);
    const csv = await csvRes.text();
    assert.match(csv, new RegExp(cash.invoiceNumber));
    assert.match(csv, /CGST|cgst|gst/i);
    const foreignCsv = await fetch(`http://127.0.0.1:${port}/api/accounts/export?month=${month}&format=csv`, { headers: outsider });
    const foreignText = await foreignCsv.text();
    assert.equal(foreignText.includes(cash.invoiceNumber), false);

    const xlsxRes = await fetch(`http://127.0.0.1:${port}/api/accounts/export?month=${month}&format=xlsx`, { headers: desk });
    const bytes = Buffer.from(await xlsxRes.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.match(bytes.toString("utf8"), /GST/);
    assert.match(bytes.toString("utf8"), new RegExp(fefoInvoice.invoiceNumber));

    const expense = await jsonRequest(
      port,
      "POST",
      "/api/accounts/expenses",
      { vendorName: "Grid power", billNumber: "EB-1", billDate: String(open.json.date), taxableAmount: 1000, gstPercent: 18, category: "utilities" },
      desk
    );
    assert.equal(expense.status, 201, String(expense.json.error || ""));
    const saved = expense.json.expense as { id: string; cgst: number; sgst: number; taxAmount: number };
    assert.equal(saved.taxAmount, 180);
    assert.equal(saved.cgst, 90);
    assert.equal(saved.sgst, 90);
    const drop = await jsonRequest(port, "DELETE", `/api/accounts/expenses/${saved.id}`, undefined, desk);
    assert.equal(drop.status, 403);
    const dropped = await jsonRequest(port, "DELETE", `/api/accounts/expenses/${saved.id}`, undefined, admin);
    assert.equal(dropped.status, 200);
  });

  it("creates the accounts tables again without dropping them", () => {
    ensureAccountsSchema(getDb());
    ensureAccountsSchema(getDb());
    const names = [
      "clinic_vendors",
      "inventory_items",
      "vendor_price_locks",
      "stock_batches",
      "stock_movements",
      "vaccine_administrations",
      "clinic_expenses",
      "invoice_refunds",
      "day_closes",
      "accounts_settings",
    ];
    for (const name of names) {
      const row = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
        | { name?: string }
        | undefined;
      assert.equal(row?.name, name);
    }
    const columns = getDb().prepare("PRAGMA table_info(clinic_expenses)").all() as { name: string }[];
    assert.equal(columns.some((column) => column.name === "storage_key"), true);
    assert.equal(columns.some((column) => column.name === "storage_backend"), true);
  });

  it("stores a receipt in the patient-document store and reads it back after the upload buffer is gone", async () => {
    const clinic = seedClinic("receipt");
    const desk = await login(clinic.desk.email);
    const previousDir = process.env.PATIENT_DOCS_DIR;
    const previousEnv = process.env.NODE_ENV;
    const previousBucket = process.env.PATIENT_DOCS_GCS_BUCKET;
    const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-expense-receipts-"));
    process.env.PATIENT_DOCS_DIR = docsDir;
    delete process.env.PATIENT_DOCS_GCS_BUCKET;
    const pdf = Buffer.from("%PDF-1.4\nnot a real pdf\n%%EOF");
    try {
      process.env.NODE_ENV = "production";
      const refused = new FormData();
      refused.set("vendorName", "Grid");
      refused.set("billNumber", "EB-NO");
      refused.set("billDate", "2026-11-11");
      refused.set("taxableAmount", "10");
      refused.set("gstPercent", "0");
      refused.set("receipt", new Blob([pdf], { type: "application/pdf" }), "bill.pdf");
      const blocked = await fetch(`http://127.0.0.1:${port}/api/accounts/expenses`, {
        method: "POST",
        headers: desk,
        body: refused,
      });
      assert.equal(blocked.status, 503);
      const blockedBody = (await blocked.json()) as { error?: string };
      assert.match(String(blockedBody.error || ""), /PATIENT_DOCS_GCS_BUCKET/);

      process.env.NODE_ENV = previousEnv;
      const form = new FormData();
      form.set("vendorName", "Grid power");
      form.set("billNumber", "EB-PDF");
      form.set("billDate", "2026-11-11");
      form.set("taxableAmount", "100");
      form.set("gstPercent", "0");
      form.set("category", "utilities");
      form.set("receipt", new Blob([pdf], { type: "application/pdf" }), "power.pdf");
      const created = await fetch(`http://127.0.0.1:${port}/api/accounts/expenses`, {
        method: "POST",
        headers: desk,
        body: form,
      });
      const createdJson = (await created.json()) as { error?: string; expense?: { id: string; hasReceipt: boolean } };
      assert.equal(created.status, 201, String(createdJson.error || ""));
      const expenseId = String(createdJson.expense?.id || "");
      assert.equal(createdJson.expense?.hasReceipt, true);

      const downloaded = await fetch(`http://127.0.0.1:${port}/api/accounts/expenses/${expenseId}/receipt`, {
        headers: desk,
      });
      assert.equal(downloaded.status, 200);
      assert.equal(Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), pdf), 0);

      const row = getDb()
        .prepare("SELECT storage_key, storage_backend, receipt_path FROM clinic_expenses WHERE id = ? AND tenant_id = ?")
        .get(expenseId, clinic.tenantId) as { storage_key: string; storage_backend: string; receipt_path: string };
      assert.equal(row.storage_backend, "local");
      assert.equal(row.receipt_path, "");
      assert.match(row.storage_key, new RegExp(`^${clinic.tenantId}/clinic-expenses/`));
      assert.equal(fs.existsSync(path.join(process.cwd(), "uploads", "clinic-expenses", clinic.tenantId)), false);

      ensureAccountsSchema(getDb());
      const reread = await readStoredPatientDocument(clinic.tenantId, row.storage_key, row.storage_backend);
      assert.equal(Buffer.compare(reread, pdf), 0);
      const onDisk = fs.readFileSync(path.join(docsDir, row.storage_key));
      assert.equal(Buffer.compare(onDisk, pdf), 0);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      if (previousDir === undefined) delete process.env.PATIENT_DOCS_DIR;
      else process.env.PATIENT_DOCS_DIR = previousDir;
      if (previousBucket === undefined) delete process.env.PATIENT_DOCS_GCS_BUCKET;
      else process.env.PATIENT_DOCS_GCS_BUCKET = previousBucket;
      fs.rmSync(docsDir, { recursive: true, force: true });
    }
  });
});
