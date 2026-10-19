import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PATIENT_PHONE_MISSING,
  SAFETY_REVIEW_REQUIRED,
  RX_NOT_FOUND,
  RX_NOT_SIGNED,
  RX_SEND_FAILED,
  SANDBOX_NOT_SENT_COPY,
  SIGNED_RX_WHATSAPP_COPY,
  WALLET_INSUFFICIENT,
  WHATSAPP_NOT_CONNECTED,
  WHATSAPP_POLICY_BLOCKED,
  interpretSignedRxWhatsAppResponse,
  patientPhoneBlocksWhatsAppSend,
  shouldPersistWhatsAppSent,
  signedRxWhatsAppRequestBody,
  whatsAppDispatchNotice,
} from "./signedRxWhatsAppSend.ts";

const RAW = "Meta rejected the recipient because it is not on the allow-list";

function notice(status: number, body: unknown, phone = "+91 98111 00000") {
  const decision = interpretSignedRxWhatsAppResponse(status, body);
  return {
    decision,
    text: whatsAppDispatchNotice(decision, phone),
    persist: shouldPersistWhatsAppSent(decision),
  };
}

describe("signed Rx WhatsApp client", () => {
  it("sends only the rx number", () => {
    assert.deepEqual(signedRxWhatsAppRequestBody("RX-1"), { rxNumber: "RX-1" });
  });

  it("shows sent only when the response is ok, success, and status sent", () => {
    const sent = notice(200, { success: true, status: "sent", messageId: "wamid.OK", channel: "graph" });
    assert.equal(sent.decision.kind, "sent");
    assert.equal(sent.persist, true);
    assert.equal(sent.text, "Sent on WhatsApp to +91 98111 00000");

    const delivered = notice(200, { success: true, status: "delivered", messageId: "msg-rx-local" });
    assert.equal(delivered.decision.kind, "failed");
    assert.equal(delivered.persist, false);
    assert.equal(delivered.text.includes("delivered"), false);
    assert.equal(delivered.text.includes("Sent on WhatsApp"), false);

    const missingStatus = notice(200, { success: true, channel: "graph" });
    assert.equal(missingStatus.persist, false);
    assert.equal(missingStatus.decision.kind, "failed");
  });

  it("sandbox, 409, and 500 never render or save sent or delivered", () => {
    const cases = [
      notice(200, { success: false, channel: "sandbox", status: "sandbox", error: RAW }),
      notice(409, { code: RX_NOT_SIGNED, error: RAW, message: RAW }),
      notice(500, { code: RX_SEND_FAILED, error: RAW }),
      notice(500, { error: RAW, message: RAW }),
      notice(422, { code: PATIENT_PHONE_MISSING, error: RAW }),
    ];
    for (const item of cases) {
      assert.equal(item.persist, false);
      assert.notEqual(item.decision.kind, "sent");
      assert.equal(item.text.includes("delivered"), false);
      assert.equal(item.text.includes("Sent on WhatsApp"), false);
      assert.equal(item.text.includes(RAW), false);
    }
    assert.equal(cases[0].text, SANDBOX_NOT_SENT_COPY);
    assert.equal(cases[1].text, SIGNED_RX_WHATSAPP_COPY[RX_NOT_SIGNED]);
    assert.equal(cases[2].text, SIGNED_RX_WHATSAPP_COPY[RX_SEND_FAILED]);
    assert.equal(cases[3].text, SIGNED_RX_WHATSAPP_COPY[RX_SEND_FAILED]);
    assert.equal(cases[4].text, SIGNED_RX_WHATSAPP_COPY[PATIENT_PHONE_MISSING]);
  });

  it("uses fixed copy for every send code", () => {
    for (const code of [
      RX_NOT_SIGNED,
      RX_NOT_FOUND,
      WALLET_INSUFFICIENT,
      WHATSAPP_NOT_CONNECTED,
      WHATSAPP_POLICY_BLOCKED,
      RX_SEND_FAILED,
      PATIENT_PHONE_MISSING,
      SAFETY_REVIEW_REQUIRED,
    ]) {
      const item = notice(400, { code, error: RAW });
      assert.equal(item.text, SIGNED_RX_WHATSAPP_COPY[code]);
      assert.equal(item.text.includes(RAW), false);
      assert.equal(item.persist, false);
    }
  });

  it("blocks send when the patient phone is missing", () => {
    assert.equal(patientPhoneBlocksWhatsAppSend(""), SIGNED_RX_WHATSAPP_COPY[PATIENT_PHONE_MISSING]);
    assert.equal(patientPhoneBlocksWhatsAppSend("123"), SIGNED_RX_WHATSAPP_COPY[PATIENT_PHONE_MISSING]);
    assert.equal(patientPhoneBlocksWhatsAppSend("+91 98111 00000"), null);
  });
});
