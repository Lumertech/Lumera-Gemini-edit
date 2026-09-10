import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canMarkPaidLocally,
  deskCollectAllowed,
  displayBillingIds,
  isInvoicePaid,
  paymentModeFromInvoice,
  paymentStatusLabel,
  pickInvoiceForContext,
  receiptHonestyFromResponse,
  shouldShowSandboxPay,
} from "./billingCollect";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const billingUi = fs.readFileSync(path.join(__dirname, "../components/BillingManager.tsx"), "utf8");

describe("billing collect UX helpers", () => {
  it("treats only paymentStatus Paid as paid — never a local UPI flip", () => {
    assert.equal(isInvoicePaid({ paymentStatus: "Paid" }), true);
    assert.equal(isInvoicePaid({ paymentStatus: "Unpaid" }), false);
    assert.equal(isInvoicePaid({ paymentStatus: "Pending" }), false);
    assert.equal(isInvoicePaid(null), false);
    assert.equal(canMarkPaidLocally("UPI"), false);
    assert.equal(canMarkPaidLocally("Cash"), true);
    assert.equal(deskCollectAllowed("UPI"), false);
    assert.equal(deskCollectAllowed("Insurance"), true);
  });

  it("Paid survives refresh from invoice or appointment isPaid", () => {
    assert.equal(paymentStatusLabel({ invoicePaid: true }), "Paid");
    assert.equal(paymentStatusLabel({ appointmentIsPaid: true }), "Paid");
    assert.equal(paymentStatusLabel({ invoicePaid: false, appointmentIsPaid: false }), "Unpaid");
    assert.equal(
      paymentStatusLabel({ invoicePaid: false, appointmentIsPaid: true }),
      "Paid"
    );
  });

  it("picks the latest appointment invoice so Paid/Unpaid hydrates after reload", () => {
    const invoices = [
      { id: "inv-new", invoiceNumber: "INV-2", appointmentId: "a1", patientId: "p1", paymentStatus: "Paid" },
      { id: "inv-old", invoiceNumber: "INV-1", appointmentId: "a1", patientId: "p1", paymentStatus: "Unpaid" },
    ];
    const picked = pickInvoiceForContext(invoices, { appointmentId: "a1", patientId: "p1" });
    assert.equal(picked?.id, "inv-new");
    assert.equal(isInvoicePaid(picked), true);
  });

  it("shows sandbox-pay only when simulators are enabled, invoice exists, and unpaid", () => {
    assert.equal(
      shouldShowSandboxPay({ isPaid: false, sandboxSimulatorsEnabled: true, hasInvoiceId: true }),
      true
    );
    assert.equal(
      shouldShowSandboxPay({ isPaid: true, sandboxSimulatorsEnabled: true, hasInvoiceId: true }),
      false
    );
    assert.equal(
      shouldShowSandboxPay({ isPaid: false, sandboxSimulatorsEnabled: false, hasInvoiceId: true }),
      false
    );
    assert.equal(
      shouldShowSandboxPay({ isPaid: false, sandboxSimulatorsEnabled: true, hasInvoiceId: false }),
      false
    );
  });

  it("receipt honesty never claims Graph delivery for sandbox or missing graphDelivered", () => {
    const sandbox = receiptHonestyFromResponse({
      channel: "sandbox",
      sandbox: true,
      graphDelivered: false,
      wamid: null,
    });
    assert.equal(sandbox.graphDelivered, false);
    assert.equal(sandbox.wamid, null);
    assert.match(sandbox.headline, /SANDBOX \/ DEV-ONLY/);
    assert.match(sandbox.detail, /not treat this as patient WhatsApp delivery/i);

    const graph = receiptHonestyFromResponse({
      channel: "graph",
      sandbox: false,
      graphDelivered: true,
      wamid: "wamid.HBgNMTIz",
    });
    assert.equal(graph.graphDelivered, true);
    assert.equal(graph.wamid, "wamid.HBgNMTIz");
    assert.match(graph.headline, /Graph/);

    const fakeWamidOnSandbox = receiptHonestyFromResponse({
      channel: "sandbox",
      sandbox: true,
      graphDelivered: false,
      wamid: "wamid.should-ignore",
    });
    assert.equal(fakeWamidOnSandbox.wamid, null);
    assert.equal(fakeWamidOnSandbox.graphDelivered, false);
  });

  it("prints GSTIN/UPI from billing settings even when empty (no seed fallback)", () => {
    const ids = displayBillingIds(
      { psp: "razorpay", razorpayConfigured: false, sandboxSimulatorsEnabled: true, gstin: "", upiId: "", clinicName: "My Clinic" },
      { gstin: "19AABCL8899K1Z5", upiId: "lumerahealth@icici", name: "Seed" }
    );
    assert.equal(ids.gstin, "");
    assert.equal(ids.upiId, "");
    assert.equal(ids.gstinLabel, "Not set");
    assert.equal(ids.upiLabel, "Not set");
    assert.equal(ids.clinicName, "My Clinic");
  });

  it("maps Razorpay invoice modes back to UPI in the desk UI", () => {
    assert.equal(paymentModeFromInvoice("Razorpay"), "UPI");
    assert.equal(paymentModeFromInvoice("UPI / QR"), "UPI");
    assert.equal(paymentModeFromInvoice("Cash"), "Cash");
  });
});

describe("BillingManager Wave 2 source gates", () => {
  it("does not locally mark UPI paid and only sandbox-pays when simulators are on", () => {
    assert.match(billingUi, /\/api\/billing\/settings/);
    assert.match(billingUi, /\/api\/billing\/day-end/);
    assert.match(billingUi, /\/api\/invoices\/\$\{invoice\.id\}\/pay-order/);
    assert.match(billingUi, /\/api\/invoices\/\$\{invoice\.id\}\/desk-collect/);
    assert.match(billingUi, /sandboxSimulatorsEnabled/);
    assert.match(billingUi, /shouldShowSandboxPay/);
    assert.match(billingUi, /SANDBOX \/ DEV-ONLY/);
    assert.equal(/setIsPaid\(\s*true\s*\)/.test(billingUi), false);
    assert.match(billingUi, /receiptHonestyFromResponse/);
    assert.match(billingUi, /graphDelivered/);
    assert.doesNotMatch(billingUi, /mark-paid-local|markPaidLocal|locallyPaid/);
  });
});
