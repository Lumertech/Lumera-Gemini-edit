import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mapInvoice } from "./db-seed-maps.ts";
import { receiptBody } from "./billing.ts";
import { buildReceiptText } from "./graph-whatsapp.ts";
import {
  SAMPLE_TAX_INVOICE_BANNER,
  isDemoTenant,
  isSampleTaxInvoice,
  sampleTaxInvoiceReceiptText,
} from "../src/lib/sampleTaxInvoice.ts";

const BANNER = "DEMO / SAMPLE — not a valid tax invoice";
const REAL_GSTIN = "27AAACL9999A1Z5";
const SEED_GSTIN = "19AABCL8899K1Z5";
const SEED_UPI = "lumerahealth@icici";

function invoiceRow(overrides: Record<string, unknown>) {
  return {
    id: "inv-sample",
    tenant_id: "tenant-real-clinic",
    invoice_number: "INV-2026-0108",
    patient_name: "Asha Rao",
    status: "Paid",
    total_amount: 500,
    items: "[]",
    gstin: REAL_GSTIN,
    upi_id: "clinic@upi",
    ...overrides,
  };
}

describe("sample tax invoice banner", () => {
  it("uses the required banner and does not name a wallet or the product", () => {
    assert.equal(SAMPLE_TAX_INVOICE_BANNER, BANNER);
    const text = sampleTaxInvoiceReceiptText("*Payment receipt*\nAmount paid: ₹500", true);
    assert.match(text, new RegExp(`^${BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(text, /Lumera/);
    assert.doesNotMatch(text, /wallet/i);
    assert.doesNotMatch(sampleTaxInvoiceReceiptText("*Payment receipt*", false), /DEMO \/ SAMPLE/);
  });

  it("demo tenant -> banner", () => {
    assert.equal(isDemoTenant("tenant-lumera-main"), true);
    assert.equal(isDemoTenant("tenant-543feff7"), true);
    assert.equal(isDemoTenant("tenant-demo-individual"), true);
    const quickDemo = mapInvoice(invoiceRow({ tenant_id: "tenant-demo-individual", gstin: "", upi_id: "" }));
    assert.equal(quickDemo.sampleTaxInvoice, true);
    assert.match(receiptBody(quickDemo, false), new RegExp(`^${BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(isSampleTaxInvoice({ tenantId: "tenant-lumera-main", gstin: "", upiId: "" }), true);
    assert.equal(
      isSampleTaxInvoice({ tenantId: "tenant-543feff7", gstin: REAL_GSTIN, upiId: "sunrise@upi" }),
      true
    );

    const sunrise = mapInvoice(invoiceRow({ tenant_id: "tenant-543feff7", gstin: "", upi_id: "" }));
    assert.equal(sunrise.sampleTaxInvoice, true);
    const receipt = receiptBody(sunrise, false);
    assert.match(receipt, new RegExp(`^${BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(receipt, /Lumera/);

    const whatsapp = buildReceiptText({
      patientName: "Asha Rao",
      amount: 500,
      invoiceId: "INV-2026-0108",
      tenantId: "tenant-lumera-main",
      clinicName: "Sunrise Family Clinic",
    });
    assert.match(whatsapp, new RegExp(BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(whatsapp, /Sunrise Family Clinic/);
    assert.doesNotMatch(whatsapp, /Lumera/);
    assert.doesNotMatch(whatsapp, /wallet/i);
  });

  it("seed GSTIN on a non-demo tenant -> banner", () => {
    assert.equal(isDemoTenant("tenant-real-clinic"), false);
    assert.equal(
      isSampleTaxInvoice({ tenantId: "tenant-real-clinic", gstin: SEED_GSTIN, upiId: "clinic@upi" }),
      true
    );
    assert.equal(
      isSampleTaxInvoice({ tenantId: "tenant-real-clinic", gstin: "19aabcl8899k1z5", upiId: "" }),
      true
    );

    const mapped = mapInvoice(invoiceRow({ gstin: SEED_GSTIN, upi_id: "clinic@upi" }));
    assert.equal(mapped.gstin, "");
    assert.equal(mapped.sampleTaxInvoice, true);
    const receipt = receiptBody(mapped, true);
    assert.match(receipt, new RegExp(BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(receipt, /SANDBOX \/ DEV-ONLY/);
    assert.doesNotMatch(receipt, /Lumera/);

    const whatsapp = buildReceiptText({
      patientName: "Asha Rao",
      amount: 500,
      tenantId: "tenant-real-clinic",
      gstin: SEED_GSTIN,
      clinicName: "City Clinic",
    });
    assert.match(whatsapp, new RegExp(BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(whatsapp, /Lumera/);
  });

  it("seed UPI on a non-demo tenant -> banner", () => {
    assert.equal(
      isSampleTaxInvoice({ tenantId: "tenant-real-clinic", gstin: REAL_GSTIN, upiId: "LumeraHealth@ICICI" }),
      true
    );
    const mapped = mapInvoice(invoiceRow({ gstin: REAL_GSTIN, upi_id: SEED_UPI }));
    assert.equal(mapped.upiId, "");
    assert.equal(mapped.sampleTaxInvoice, true);
    assert.match(receiptBody(mapped, false), new RegExp(BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("real tenant -> no banner", () => {
    assert.equal(
      isSampleTaxInvoice({ tenantId: "tenant-real-clinic", gstin: REAL_GSTIN, upiId: "clinic@upi" }),
      false
    );
    const mapped = mapInvoice(invoiceRow({}));
    assert.equal(mapped.sampleTaxInvoice, false);
    assert.equal(mapped.gstin, REAL_GSTIN);
    const receipt = receiptBody(mapped, false);
    assert.doesNotMatch(receipt, /DEMO \/ SAMPLE/);
    assert.match(receipt, /Payment receipt/);
    assert.doesNotMatch(receipt, /Lumera/);

    const whatsapp = buildReceiptText({
      patientName: "Asha Rao",
      amount: 500,
      tenantId: "tenant-real-clinic",
      gstin: REAL_GSTIN,
      upiId: "clinic@upi",
      clinicName: "City Clinic",
    });
    assert.doesNotMatch(whatsapp, /DEMO \/ SAMPLE/);
    assert.match(whatsapp, /Payment receipt/);
    assert.doesNotMatch(whatsapp, /Lumera/);
  });

  it("keeps the banner on the on-screen invoice, the print view, and e-receipt text", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const ui = fs.readFileSync(path.join(root, "src/components/BillingManager.tsx"), "utf8");
    const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
    const billing = fs.readFileSync(path.join(root, "server/billing.ts"), "utf8");
    const graph = fs.readFileSync(path.join(root, "server/graph-whatsapp.ts"), "utf8");
    assert.match(ui, /SAMPLE_TAX_INVOICE_BANNER/);
    assert.match(ui, /sample-tax-banner/);
    assert.equal((ui.match(/<SampleTaxBanner/g) || []).length, 2);
    assert.match(css, /\.sample-tax-banner/);
    assert.match(css, /@media print/);
    assert.match(billing, /sampleTaxInvoiceReceiptText/);
    assert.match(graph, /sampleTaxInvoiceReceiptText/);
    assert.doesNotMatch(billing, /Lumera/);
    const receiptFn = graph.slice(graph.indexOf("export function buildReceiptText"), graph.indexOf("const CLOUD_NOT_CONFIGURED"));
    assert.doesNotMatch(receiptFn, /Lumera/);
  });
});
