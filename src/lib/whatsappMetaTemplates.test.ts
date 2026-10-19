import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_WHATSAPP_TEMPLATES } from "../data/clinicalData.ts";
import {
  ALL_WHATSAPP_TEMPLATE_SPECS,
  APP_CATEGORY_TO_META,
  AUTH_PRESET_BODY,
  INVOICE_TEMPLATE_URL,
  MARKETING_OPT_OUT_BUTTON_TEXT,
  RX_TEMPLATE_URL,
  SEEDED_TEMPLATE_NAMES,
  TREATMENT_FOLLOWUP_FORM_DEFAULT,
  WHATSAPP_TEMPLATE_BODY_INDEX,
  bodyParametersFor,
  componentContractErrors,
  draftTemplateSpec,
  serverUrlButtonSuffix,
  templateByName,
  templateContractErrors,
  type MetaComponent,
} from "./whatsappMetaTemplates.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function bodyText(name: string): string {
  const spec = templateByName(name);
  assert.ok(spec, name);
  const body = spec.components.find((component) => component.type === "BODY");
  assert.ok(body && body.type === "BODY");
  return body.text;
}

describe("WhatsApp template Meta contract", () => {
  it("checks every catalog template for positional Meta rules", () => {
    assert.equal(ALL_WHATSAPP_TEMPLATE_SPECS.length, 11);
    assert.equal(new Set(ALL_WHATSAPP_TEMPLATE_SPECS.map((spec) => spec.name)).size, 11);
    for (const spec of ALL_WHATSAPP_TEMPLATE_SPECS) {
      assert.deepEqual(templateContractErrors(spec), [], `${spec.name}: ${templateContractErrors(spec).join(",")}`);
    }
  });

  it("fails when a template mixes formats, skips a number, or miscounts examples", () => {
    const mixed: MetaComponent[] = [
      {
        type: "BODY",
        text: "Hello {{1}} from {{clinic_name}}",
        example: { body_text: [["Asha", "Sunrise Family Clinic"]] },
      },
    ];
    assert.ok(componentContractErrors(mixed, "UTILITY").includes("mixed_placeholder"));

    const gap: MetaComponent[] = [
      { type: "BODY", text: "Hello {{1}} on {{3}}", example: { body_text: [["Asha", "Tuesday"]] } },
    ];
    assert.ok(componentContractErrors(gap, "UTILITY").includes("numbering_gap"));

    const footer: MetaComponent[] = [
      { type: "BODY", text: "Hello {{1}}", example: { body_text: [["Asha"]] } },
      { type: "FOOTER", text: "{{clinic_name}}" },
    ];
    assert.ok(componentContractErrors(footer, "UTILITY").includes("footer_variable"));

    const label: MetaComponent[] = [
      { type: "BODY", text: "Invoice {{1}}", example: { body_text: [["INV-1"]] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Pay ₹{{1}}", url: INVOICE_TEMPLATE_URL, example: ["https://www.mylumera.in/pay/INV-1"] }] },
    ];
    assert.ok(componentContractErrors(label, "UTILITY").includes("button_label_variable"));

    const examples: MetaComponent[] = [
      { type: "BODY", text: "Hello {{1}} at {{2}}", example: { body_text: [["Asha"]] } },
    ];
    assert.ok(componentContractErrors(examples, "UTILITY").includes("example_count"));

    const bareUrl: MetaComponent[] = [
      { type: "BODY", text: "Hello {{1}}", example: { body_text: [["Asha"]] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Open", url: "{{portal_url}}", example: ["https://www.mylumera.in/rx/RX-1"] }] },
    ];
    assert.ok(componentContractErrors(bareUrl, "UTILITY").includes("url_button"));
  });

  it("keeps the reviewed wording, categories, and name-to-index maps", () => {
    assert.equal(APP_CATEGORY_TO_META.APPOINTMENT_REMINDER, "UTILITY");
    assert.equal(APP_CATEGORY_TO_META.PRESCRIPTION_DELIVERY, "UTILITY");
    assert.equal(APP_CATEGORY_TO_META.FOLLOWUP_CHECK, "UTILITY");

    const reminder = templateByName("appointment_reminder_v1");
    assert.equal(reminder?.components.find((component) => component.type === "HEADER" && component.format === "TEXT") && reminder.components[0].type === "HEADER" && reminder.components[0].format === "TEXT" ? reminder.components[0].text : "", "Appointment confirmation");
    assert.equal(reminder?.category, "UTILITY");
    assert.equal(reminder?.components.some((component) => component.type === "FOOTER"), false);
    assert.deepEqual(WHATSAPP_TEMPLATE_BODY_INDEX.appointment_reminder_v1, {
      patient_name: 1,
      doctor_name: 2,
      clinic_name: 3,
      date: 4,
      time: 5,
      token: 6,
    });

    assert.equal(bodyText("post_consultation_rx"), "{{1}} at {{2}} has reviewed and signed your prescription (Rx {{3}}). It is attached above.");
    assert.equal(bodyText("digital_prescription_ready"), bodyText("post_consultation_rx"));
    const rx = templateByName("post_consultation_rx");
    assert.equal(rx?.components.find((component) => component.type === "FOOTER" && component.type === "FOOTER") ? (rx.components.find((component) => component.type === "FOOTER") as { text?: string }).text : "", "Digital prescription");
    const rxButton = rx?.components.find((component) => component.type === "BUTTONS");
    assert.ok(rxButton && rxButton.type === "BUTTONS");
    assert.equal(rxButton.buttons[0].type === "URL" ? rxButton.buttons[0].url : "", RX_TEMPLATE_URL);

    const lab = templateByName("lab_report_ready");
    assert.equal(lab?.bodyIndex.clinic_name, 4);
    assert.equal(lab?.components.some((component) => component.type === "FOOTER"), false);
    assert.match(bodyText("lab_report_ready"), /\{\{4\}\}/);

    const opd = templateByName("opd_queue_token_alert");
    assert.equal(opd?.bodyIndex.doctor_name, 3);
    assert.equal(opd?.bodyIndex.clinic_name, 4);
    assert.equal(JSON.stringify(opd?.components).includes("Live OPD Triage System"), false);

    const otp = templateByName("otp_login_verification");
    assert.equal(otp?.category, "AUTHENTICATION");
    assert.equal(bodyText("otp_login_verification"), AUTH_PRESET_BODY);
    assert.equal(otp?.bodyIndex.clinic_name, undefined);
    const otpButtons = otp?.components.find((component) => component.type === "BUTTONS");
    assert.ok(otpButtons && otpButtons.type === "BUTTONS");
    assert.equal(otpButtons.buttons[0].type === "OTP" ? otpButtons.buttons[0].otp_type : "", "COPY_CODE");

    const camp = templateByName("preventive_cardiac_camp");
    assert.equal(camp?.category, "MARKETING");
    const campBody = camp?.components.find((component) => component.type === "BODY");
    assert.equal(campBody && campBody.type === "BODY" ? campBody.example?.body_text?.[0].length : 0, 4);
    assert.equal(Object.keys(camp?.bodyIndex || {}).length, 4);
    assert.match(JSON.stringify(camp?.components), new RegExp(MARKETING_OPT_OUT_BUTTON_TEXT));
    assert.equal(/reply\s+stop/i.test(JSON.stringify(camp?.components)), false);

    const confirm = templateByName("appointment_confirmation_v2");
    assert.equal(confirm?.category, "UTILITY");
    const confirmHeader = confirm?.components.find((component) => component.type === "HEADER");
    assert.equal(confirmHeader && confirmHeader.type === "HEADER" && confirmHeader.format === "TEXT" ? confirmHeader.text.includes("{{") : true, false);

    const uiRx = templateByName("digital_prescription_ready");
    assert.equal(JSON.stringify(uiRx?.components).includes("Telemedicine Practice Guidelines"), false);
    assert.equal(uiRx?.category, "UTILITY");

    const invoice = templateByName("invoice_payment_link");
    const invoiceButtons = invoice?.components.find((component) => component.type === "BUTTONS");
    assert.ok(invoiceButtons && invoiceButtons.type === "BUTTONS");
    assert.equal(invoiceButtons.buttons[0].text.includes("{{"), false);
    assert.equal(invoiceButtons.buttons[0].type === "URL" ? invoiceButtons.buttons[0].url : "", INVOICE_TEMPLATE_URL);
    assert.equal(invoice?.category, "UTILITY");

    const meds = templateByName("medication_adherence_checkin");
    assert.equal(meds?.category, "UTILITY");
    assert.match(bodyText("medication_adherence_checkin"), /A reminder from \{\{2\}\}/);
    assert.match(bodyText("medication_adherence_checkin"), /Rx \{\{4\}\}/);
    assert.equal(meds?.components.some((component) => component.type === "FOOTER"), false);
    assert.equal(bodyText("medication_adherence_checkin").includes("asked whether"), false);

    assert.equal(templateByName("treatment_followup_reminder")?.category, "UTILITY");
    assert.equal(TREATMENT_FOLLOWUP_FORM_DEFAULT.footerText?.includes("Lumera"), false);
    assert.deepEqual(templateContractErrors(draftTemplateSpec(TREATMENT_FOLLOWUP_FORM_DEFAULT, {
      patient_name: 1,
      doctor_name: 2,
      clinic_name: 3,
      review_at: 4,
    })), []);
  });

  it("orders named values by index and rejects a client URL in the button", () => {
    assert.deepEqual(
      bodyParametersFor("post_consultation_rx", {
        rx_number: "RX-2026-0101",
        clinic_name: "Sunrise Family Clinic",
        doctor_name: "Dr Meera Shah",
      }),
      ["Dr Meera Shah", "Sunrise Family Clinic", "RX-2026-0101"]
    );
    assert.equal(serverUrlButtonSuffix("RX-2026-0101"), "RX-2026-0101");
    assert.throws(() => serverUrlButtonSuffix("https://evil.example/rx/1"), /URL_BUTTON_SUFFIX_INVALID/);
    assert.throws(() => serverUrlButtonSuffix("{{portal_url}}"), /URL_BUTTON_SUFFIX_INVALID/);
    assert.throws(() => bodyParametersFor("missing_template", { doctor_name: "Dr Meera Shah" }), /TEMPLATE_UNKNOWN/);
  });

  it("keeps the UI catalog, the seed, and the follow-up form on the same specs", () => {
    assert.deepEqual(
      DEFAULT_WHATSAPP_TEMPLATES.map((tpl) => tpl.name),
      ["appointment_confirmation_v2", "digital_prescription_ready", "invoice_payment_link", "medication_adherence_checkin"]
    );
    for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
      assert.equal(tpl.bodyText, bodyText(tpl.name));
      assert.equal(tpl.category, templateByName(tpl.name)?.category);
      assert.equal(tpl.bodyExample?.length, Object.keys(WHATSAPP_TEMPLATE_BODY_INDEX[tpl.name]).length);
    }

    const seed = fs.readFileSync(path.join(root, "server/db-seed-meta.ts"), "utf8");
    assert.match(seed, /templateByName\(row\.name\)/);
    for (const name of SEEDED_TEMPLATE_NAMES) assert.match(seed, new RegExp(name));
    assert.doesNotMatch(seed, /\{\{(?:clinic_name|doctor_name|portal_url|rx_url|pay_url)\}\}/);
    assert.doesNotMatch(seed, /Reply STOP/);

    const admin = fs.readFileSync(path.join(root, "src/components/admin/AdminMetaTechProvider.tsx"), "utf8");
    assert.match(admin, /TREATMENT_FOLLOWUP_FORM_DEFAULT/);
    assert.doesNotMatch(admin, /Lumera Clinical Care Team/);
    assert.match(admin, /templateContractErrors/);
  });
});
