import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canMarkPaidLocally,
  deskCollectAllowed,
  displayBillingIds,
  displayInvoiceNumber,
  DRAFT_INVOICE_LABEL,
  invoiceNumberToPersist,
  isInvoicePaid,
  paymentModeFromInvoice,
  paymentStatusLabel,
  pickInvoiceForContext,
  receiptHonestyFromResponse,
  savedInvoiceView,
  shouldRecomputeDraftLines,
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
      { id: "inv-new", invoiceNumber: "INV-2", appointmentId: "a1", patientId: "p1", paymentStatus: "Paid", createdAt: "2026-10-15T10:00:00.000Z" },
      { id: "inv-old", invoiceNumber: "INV-1", appointmentId: "a1", patientId: "p1", paymentStatus: "Unpaid", createdAt: "2026-10-01T10:00:00.000Z" },
    ];
    const picked = pickInvoiceForContext(invoices, { appointmentId: "a1", patientId: "p1" });
    assert.equal(picked?.id, "inv-new");
    assert.equal(isInvoicePaid(picked), true);
    const reversed = [...invoices].reverse();
    assert.equal(pickInvoiceForContext(reversed, { appointmentId: "a1" })?.id, "inv-new");
  });

  it("matches an invoice by appointment id only, so an older bill does not open on today's visit", () => {
    const invoices = [
      {
        id: "older-paid",
        invoiceNumber: "INV-2026-0007",
        appointmentId: "apt-last-month",
        patientId: "p1",
        paymentStatus: "Paid",
        totalAmount: 2000,
        createdAt: "2026-09-01T08:00:00.000Z",
      },
      {
        id: "today-paid",
        invoiceNumber: "INV-2026-0108",
        appointmentId: "apt-today",
        patientId: "p1",
        paymentStatus: "Paid",
        totalAmount: 750,
        createdAt: "2026-10-15T08:00:00.000Z",
      },
    ];
    const today = pickInvoiceForContext(invoices, { appointmentId: "apt-today", patientId: "p1" });
    assert.equal(today?.id, "today-paid");
    assert.equal(today?.totalAmount, 750);
    assert.equal(pickInvoiceForContext(invoices, { patientId: "p1" }), null);
    assert.equal(pickInvoiceForContext(invoices, { appointmentId: "apt-missing", patientId: "p1" }), null);
  });

  it("renders a saved invoice from its stored lines and total, not a consult fee plus Rx estimates", () => {
    const view = savedInvoiceView({
      items: [
        {
          id: "line-consult",
          description: "OPD consult",
          category: "Consultation",
          quantity: 1,
          unitPrice: 750,
          total: 750,
        },
      ],
      subtotal: 750,
      discountAmount: 0,
      totalAmount: 750,
    });
    assert.equal(view.totalAmount, 750);
    assert.equal(view.items.length, 1);
    assert.equal(view.items[0].description, "OPD consult");
    assert.equal(view.items[0].unitPrice, 750);
    const mismatched = savedInvoiceView({
      items: [
        { id: "fee", description: "Estimated consult", category: "Consultation", quantity: 1, unitPrice: 600, total: 600 },
        { id: "rx", description: "Estimated medicine", category: "Pharmacy", quantity: 1, unitPrice: 140, total: 140 },
      ],
      subtotal: 740,
      discountAmount: 0,
      totalAmount: 750,
    });
    assert.equal(mismatched.totalAmount, 750);
    assert.equal(mismatched.items[0].total, 600);
    assert.equal(shouldRecomputeDraftLines({ id: "inv-1" }), false);
    assert.equal(shouldRecomputeDraftLines(null), true);
    assert.equal(shouldRecomputeDraftLines({ id: "" }), true);
  });

  it("shows Draft (not saved) until the server allocates a GST invoice number", () => {
    assert.equal(DRAFT_INVOICE_LABEL, "Draft (not saved)");
    assert.equal(displayInvoiceNumber(""), "Draft (not saved)");
    assert.equal(displayInvoiceNumber("Draft (not saved)"), "Draft (not saved)");
    assert.equal(displayInvoiceNumber("INV-2026-0108"), "INV-2026-0108");
    assert.equal(invoiceNumberToPersist("Draft (not saved)"), "");
    assert.equal(invoiceNumberToPersist("INV-2026-####"), "");
    assert.equal(invoiceNumberToPersist("INV-2026-0108"), "INV-2026-0108");
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
    assert.match(billingUi, /savedInvoiceView/);
    assert.match(billingUi, /shouldRecomputeDraftLines/);
    assert.match(billingUi, /Draft \(not saved\)|DRAFT_INVOICE_LABEL/);
    assert.match(billingUi, /linesLocked/);
    assert.match(billingUi, /appointmentId=\$\{encodeURIComponent\(appointmentId\)\}/);
    assert.doesNotMatch(billingUi, /INV-2026-\$\{Math\.floor/);
    assert.doesNotMatch(billingUi, /pickInvoiceForContext\([\s\S]{0,180}patientId/);
    assert.doesNotMatch(billingUi, /Lumera/);
  });
});
