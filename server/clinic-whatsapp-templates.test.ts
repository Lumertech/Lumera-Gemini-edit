import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLINIC_TEMPLATE_CATALOG,
  LUMERA_RECEIPT_TEMPLATE_V1,
  LUMERA_RECEIPT_TEMPLATE_V2,
  graphComponentsForClinicTemplate,
  receiptTemplateParameters,
} from "./clinic-whatsapp-templates.ts";

function placeholderNumbers(text: string): number[] {
  const found = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return found;
}

describe("clinic WhatsApp template catalog", () => {
  it("uses fixed clinic_ names, positional params, and no Lumera or certification claims", () => {
    const names = new Set<string>();
    for (const spec of CLINIC_TEMPLATE_CATALOG) {
      assert.equal(names.has(spec.name), false);
      names.add(spec.name);
      assert.match(spec.name, /^clinic_[a-z0-9_]+$/);
      assert.equal(spec.name.startsWith("lumera_"), false);
      assert.equal(spec.language, "en");
      assert.equal(spec.category, "UTILITY");
      const indexes = placeholderNumbers(spec.body);
      assert.deepEqual(indexes, indexes.map((_, index) => index + 1));
      assert.equal(new Set(indexes).size, indexes.length);
      assert.equal(spec.example.length, indexes.length);
      assert.equal(/\{\{/.test(spec.footer), false);
      const blob = `${spec.body}\n${spec.footer}\n${spec.example.join(" ")}\n${spec.urlButton?.text || ""}`;
      assert.equal(/lumera/i.test(blob), false);
      assert.equal(/\bNHA\b|\bABDM\b|certif/i.test(blob), false);
      const components = graphComponentsForClinicTemplate(spec);
      assert.equal(components.some((part) => part.type === "BODY"), true);
      assert.equal(components.some((part) => part.type === "FOOTER" && /\{\{/.test(String(part.text))), false);
      if (spec.urlButton) {
        assert.match(spec.urlButton.url, /\/\{\{1\}\}$/);
        assert.equal(spec.urlButton.url.includes("{{2}}"), false);
        assert.equal(spec.urlButton.example.startsWith(spec.urlButton.url.replace("{{1}}", "")), true);
      }
    }
    const rx = CLINIC_TEMPLATE_CATALOG.find((spec) => spec.name === "clinic_prescription_ready");
    assert.ok(rx);
    assert.match(rx.body, /reviewed and signed/);
    assert.match(rx.body, /\{\{3\}\}/);
  });

  it("fills lumera_payment_receipt_v2 with exactly 6 positional params and keeps the old name at 3", () => {
    const fields = {
      patientName: "Asha Rao",
      clinicName: "Sunrise Clinic",
      doctorName: "Dr Mehta",
      amount: 700,
      invoiceId: "INV-1042",
      date: "20 Oct 2026",
    };
    assert.deepEqual(receiptTemplateParameters(fields, LUMERA_RECEIPT_TEMPLATE_V2), [
      "Asha Rao",
      "Sunrise Clinic",
      "Dr Mehta",
      "700",
      "INV-1042",
      "20 Oct 2026",
    ]);
    assert.deepEqual(receiptTemplateParameters(fields, "clinic_payment_receipt"), [
      "Asha Rao",
      "Sunrise Clinic",
      "Dr Mehta",
      "₹700.00",
      "INV-1042",
      "20 Oct 2026",
    ]);
    assert.deepEqual(receiptTemplateParameters(fields, LUMERA_RECEIPT_TEMPLATE_V1), [
      "Asha Rao",
      "700",
      "INV-1042",
    ]);
    const fallback = receiptTemplateParameters({}, LUMERA_RECEIPT_TEMPLATE_V2);
    assert.equal(fallback.length, 6);
    assert.equal(fallback[1], "your clinic");
    assert.equal(fallback[2], "your clinician");
    assert.equal(fallback.some((part) => /lumera/i.test(part)), false);
  });
});
