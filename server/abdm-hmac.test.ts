import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAbdmCallbackSignature, signAbdmCallback, verifyAbdmCallbackHmac } from "./abdm-hmac.ts";

describe("ABDM callback HMAC hook (NHA sandbox)", () => {
  const secret = "callback-secret-for-tests";
  const body = JSON.stringify({ patientId: "pat-1", consentId: "c-1" });

  it("signs and verifies sha256 hex", () => {
    const header = signAbdmCallback(secret, body);
    assert.match(header, /^sha256=[a-f0-9]{64}$/);
    assert.equal(verifyAbdmCallbackHmac(body, header, secret), true);
    assert.equal(verifyAbdmCallbackHmac(body + "x", header, secret), false);
  });

  it("is sandbox-tolerant when secret is unset", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      mode: "stub",
      secret: "",
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.matched, false);
      assert.equal(decision.sandboxTolerant, true);
    }
  });

  it("stub path accepts missing signature even when a secret exists", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      mode: "stub",
      secret,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.sandboxTolerant, true);
    }
  });

  it("sandbox mode with a secret rejects a bad signature", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      signatureHeader: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mode: "sandbox",
      secret,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 401);
    }
  });

  it("sandbox mode with a secret accepts a matching signature", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      signatureHeader: signAbdmCallback(secret, body),
      mode: "sandbox",
      secret,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.matched, true);
    }
  });
});
