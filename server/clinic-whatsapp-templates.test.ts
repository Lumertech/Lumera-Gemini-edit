import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WHATSAPP_TEMPLATES } from "../src/data/clinicalData.ts";
import {
  CLINIC_TEMPLATE_CATALOG,
  LUMERA_RECEIPT_TEMPLATE_V1,
  LUMERA_RECEIPT_TEMPLATE_V2,
  graphComponentsForClinicTemplate,
  patientFirstName,
  prescriptionReadyTemplateParameters,
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
      const blob = `${spec.body}\n${spec.footer}\n${spec.example.join(" ")}\n${spec.urlButton?.text || ""}`.replaceAll(
        "https://www.mylumera.in",
        ""
      );
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
    assert.equal(/Rx No|Medications/i.test(rx.body), false);
    assert.deepEqual(rx.example, ["Asha Rao", "Sunrise Clinic", "Dr Mehta"]);
    assert.deepEqual(
      prescriptionReadyTemplateParameters({
        patientName: rx.example[0],
        clinicName: rx.example[1],
        doctorName: rx.example[2],
      }),
      [patientFirstName(rx.example[0]), rx.example[1], rx.example[2]]
    );
    assert.equal(rx.urlButton?.url, "https://www.mylumera.in/rx/v/{{1}}");
  });

  it("keeps the seed prescription template to clinic, doctor, and the view link", () => {
    const seed = DEFAULT_WHATSAPP_TEMPLATES.find((template) => template.name === "digital_prescription_ready");
    assert.ok(seed);
    assert.equal(seed.bodyText.includes("Rx No"), false);
    assert.equal(seed.bodyText.includes("Medications"), false);
    assert.deepEqual(placeholderNumbers(seed.bodyText), [1, 2]);
    assert.match(seed.bodyText, /from \{\{1\}\}/);
    assert.match(seed.bodyText, /signed by \{\{2\}\}/);
    assert.equal(seed.buttons?.length, 1);
    assert.equal(seed.buttons?.[0]?.type, "URL");
    assert.equal(seed.buttons?.[0]?.payload, "https://www.mylumera.in/rx/v/opaque-token");
  });

  it("fills the Manager receipt bodies: v2 has 6 params and the live name has 4", () => {
    const fields = {
      patientName: "Asha Rao",
      clinicName: "Sunrise Clinic",
      doctorName: "Dr Mehta",
      amount: 700,
      invoiceId: "INV-1042",
      date: "20 Oct 2026",
      receiptUrl: "https://www.mylumera.in/pay/v/opaqueexampletoken",
    };
    const v2 = [
      "Asha",
      "INR 700",
      "Sunrise Clinic",
      "Dr Mehta",
      "INV-1042",
      "https://www.mylumera.in/pay/v/opaqueexampletoken",
    ];
    assert.deepEqual(receiptTemplateParameters(fields, LUMERA_RECEIPT_TEMPLATE_V2), v2);
    assert.deepEqual(receiptTemplateParameters(fields, "clinic_payment_receipt"), v2);
    assert.equal(v2.join(" ").includes("20 Oct 2026"), false);
    assert.deepEqual(receiptTemplateParameters(fields, LUMERA_RECEIPT_TEMPLATE_V1), [
      "Asha",
      "INR 700",
      "Sunrise Clinic",
      "https://www.mylumera.in/pay/v/opaqueexampletoken",
    ]);
    const fallback = receiptTemplateParameters({}, LUMERA_RECEIPT_TEMPLATE_V2);
    assert.equal(fallback.length, 6);
    assert.equal(fallback[0], "Patient");
    assert.equal(fallback[1], "INR 0");
    assert.equal(fallback[2], "your clinic");
    assert.equal(fallback[3], "your clinician");
    assert.equal(fallback.some((part) => /lumera\.health/i.test(part)), false);
  });
});
