import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_WHATSAPP_TEMPLATES } from "../data/clinicalData.ts";
import { WHATSAPP_TEMPLATE_BODY_INDEX } from "./whatsappMetaTemplates.ts";
import {
  WHATSAPP_SEND_FAILED,
  WHATSAPP_SEND_UNREACHABLE,
  buildRxWhatsAppText,
  interpretWhatsAppNetworkError,
  interpretWhatsAppSendResponse,
  recordWhatsAppDispatch,
  whatsAppDispatchErrorCopy,
} from "./whatsappRxDispatch.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const rxText = buildRxWhatsAppText({
  clinicName: "Sunrise Family Clinic",
  doctorName: "Dr Meera Shah",
  doctorSpecialty: "General Medicine",
  patientName: "Asha Rao",
  uhid: "UH-19",
  diagnosis: "Viral fever",
  medicines: [{ drugName: "Paracetamol 650 mg", dosage: "650 mg", frequency: "1-0-1" }],
  pdfUrl: "/api/whatsapp/prescription/RX-19/pdf",
});

describe("WhatsApp Rx dispatch honesty", () => {
  it("marks the prescription delivered only after the send API confirms success", () => {
    const decision = interpretWhatsAppSendResponse(200, { success: true, status: "delivered" });
    const recorded = recordWhatsAppDispatch("unsent", decision);
    assert.equal(decision.outcome, "delivered");
    assert.equal(recorded.showSuccess, true);
    assert.equal(recorded.whatsappSentStatus, "delivered");
    assert.equal(recorded.failureCode, null);
  });

  it("keeps the delivery status and records a fixed code when the send API fails", () => {
    const leaked = "Failed to dispatch WhatsApp Rx: ECONNRESET patient chart";
    const decision = interpretWhatsAppSendResponse(500, { error: leaked });
    const recorded = recordWhatsAppDispatch("unsent", decision);
    assert.equal(decision.outcome, "failed");
    assert.equal(recorded.showSuccess, false);
    assert.equal(recorded.whatsappSentStatus, "unsent");
    assert.equal(recorded.failureCode, WHATSAPP_SEND_FAILED);
    const copy = whatsAppDispatchErrorCopy(recorded.failureCode || "");
    assert.match(copy, /Reason: WHATSAPP_SEND_FAILED/);
    assert.equal(copy.includes(leaked), false);
    assert.equal(copy.includes("ECONNRESET"), false);

    const coded = interpretWhatsAppSendResponse(402, { error: "Top up now", code: "WALLET_INSUFFICIENT" });
    const wallet = recordWhatsAppDispatch("queued", coded);
    assert.equal(wallet.whatsappSentStatus, "queued");
    assert.equal(wallet.failureCode, "WALLET_INSUFFICIENT");
    assert.equal(wallet.showSuccess, false);
  });

  it("records a network error without marking the prescription delivered", () => {
    const decision = interpretWhatsAppNetworkError();
    const recorded = recordWhatsAppDispatch("unsent", decision);
    assert.equal(decision.outcome, "failed");
    assert.equal(recorded.failureCode, WHATSAPP_SEND_UNREACHABLE);
    assert.equal(recorded.whatsappSentStatus, "unsent");
    assert.equal(recorded.showSuccess, false);
    assert.equal(whatsAppDispatchErrorCopy(WHATSAPP_SEND_UNREACHABLE).includes("Failed to fetch"), false);
  });

  it("does not treat a 200 without success, or a success flag on an error status, as delivered", () => {
    assert.equal(interpretWhatsAppSendResponse(200, { status: "delivered" }).outcome, "failed");
    assert.equal(interpretWhatsAppSendResponse(200, { ok: true }).outcome, "failed");
    assert.equal(interpretWhatsAppSendResponse(503, { success: true }).outcome, "failed");
  });

  it("fills the clinic and doctor names and does not hardcode a brand", () => {
    assert.match(rxText, /Sunrise Family Clinic/);
    assert.match(rxText, /Dr Meera Shah/);
    assert.doesNotMatch(rxText, /lumera/i);
    const source = fs.readFileSync(path.join(root, "src/lib/whatsappRxDispatch.ts"), "utf8");
    assert.doesNotMatch(source, /lumera/i);

    const rxTemplate = DEFAULT_WHATSAPP_TEMPLATES.find((tpl) => tpl.name === "digital_prescription_ready");
    const appointment = DEFAULT_WHATSAPP_TEMPLATES.find((tpl) => tpl.name === "appointment_confirmation_v2");
    assert.ok(rxTemplate);
    assert.ok(appointment);
    assert.equal(WHATSAPP_TEMPLATE_BODY_INDEX.digital_prescription_ready.doctor_name, 1);
    assert.equal(WHATSAPP_TEMPLATE_BODY_INDEX.digital_prescription_ready.clinic_name, 2);
    assert.equal(WHATSAPP_TEMPLATE_BODY_INDEX.appointment_confirmation_v2.doctor_name, 2);
    assert.equal(WHATSAPP_TEMPLATE_BODY_INDEX.appointment_confirmation_v2.clinic_name, 4);
    for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
      const text = JSON.stringify(tpl).replaceAll("mylumera.in", "");
      assert.doesNotMatch(text, /lumera/i, tpl.name);
    }

    const seed = fs.readFileSync(path.join(root, "server/db-seed-meta.ts"), "utf8");
    assert.match(seed, /templateByName\(row\.name\)/);
    assert.doesNotMatch(seed, /\{\{clinic_name\}\}/);
    assert.doesNotMatch(seed, /\{\{doctor_name\}\}/);

    const whatsappRoute = fs.readFileSync(path.join(root, "server/whatsapp.ts"), "utf8");
    const sendRx = whatsappRoute.slice(whatsappRoute.indexOf('router.post("/send-rx"'), whatsappRoute.indexOf("router.get(\"/prescription/:id/pdf\""));
    assert.match(sendRx, /buildRxWhatsAppText/);
    assert.match(sendRx, /WHATSAPP_SEND_FAILED/);
    assert.doesNotMatch(sendRx, /err\.message/);
    const billing = fs.readFileSync(path.join(root, "server/usage-billing-api.ts"), "utf8");
    assert.match(billing, /buildRxWhatsAppText/);
  });

  it("sends only after an explicit click on a signed prescription and does not mark failure as delivered", () => {
    const writer = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    const handler = writer.slice(
      writer.indexOf("const handleDirectWhatsAppDispatch"),
      writer.indexOf("const handleSaveAndDispatch")
    );
    assert.match(handler, /isFinalized/);
    assert.match(handler, /interpretWhatsAppSendResponse/);
    assert.match(handler, /interpretWhatsAppNetworkError/);
    assert.match(handler, /recordWhatsAppDispatch/);
    const fetchAt = handler.indexOf("apiFetchResponse");
    const signedAt = handler.indexOf("isFinalized");
    assert.ok(signedAt >= 0 && signedAt < fetchAt);
    const catchBlock = handler.slice(handler.indexOf("} catch"));
    assert.doesNotMatch(catchBlock, /setWhatsAppDirectSuccess\(true\)/);
    assert.doesNotMatch(catchBlock, /buildCurrentRx\('delivered'\)/);
    assert.doesNotMatch(catchBlock, /onSavePrescription/);
    assert.match(writer, /data-testid="whatsapp-dispatch-retry"/);
    assert.match(writer, /whatsAppDispatchErrorCopy/);
  });
});
