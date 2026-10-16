import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeAbdmCallbackWrite } from "./abdm-internal.ts";
import type { AbdmCallbackAuth } from "./abdm-hmac.ts";

const unsigned: AbdmCallbackAuth = { ok: true, matched: false, sandboxTolerant: true };
const signed: AbdmCallbackAuth = { ok: true, matched: true };
const rejected: AbdmCallbackAuth = { ok: false, status: 401, error: "Missing X-ABDM-Signature" };

describe("ABDM callback write authorization", () => {
  it("accepts a matched signature or a staff role, and never a patient session", () => {
    assert.equal(authorizeAbdmCallbackWrite({ role: undefined, hmac: signed }).accept, true);
    assert.equal(authorizeAbdmCallbackWrite({ role: "doctor", hmac: unsigned }).accept, true);
    assert.equal(authorizeAbdmCallbackWrite({ role: "receptionist", hmac: rejected }).accept, true);

    const patientUnsigned = authorizeAbdmCallbackWrite({ role: "patient", hmac: unsigned });
    assert.equal(patientUnsigned.accept, false);
    if (!patientUnsigned.accept) {
      assert.equal(patientUnsigned.status, 403);
      assert.equal(patientUnsigned.code, "ROLE_DENIED");
    }
    const patientSigned = authorizeAbdmCallbackWrite({ role: "patient", hmac: signed });
    assert.equal(patientSigned.accept, false);
    if (!patientSigned.accept) assert.equal(patientSigned.status, 403);

    const anonymous = authorizeAbdmCallbackWrite({ role: undefined, hmac: unsigned });
    assert.equal(anonymous.accept, false);
    if (!anonymous.accept) assert.equal(anonymous.status, 401);

    const anonymousRejected = authorizeAbdmCallbackWrite({ role: null, hmac: rejected });
    assert.equal(anonymousRejected.accept, false);
    if (!anonymousRejected.accept) assert.equal(anonymousRejected.status, 401);
  });
});
