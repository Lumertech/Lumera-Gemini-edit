import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskedLast4 } from "./mask-last4.ts";

describe("maskedLast4", () => {
  it("keeps the Aadhaar audit shape for an already-extracted last four", () => {
    assert.equal(maskedLast4("5451"), "XXXX-XXXX-5451");
  });

  it("masks a full ABHA number to the last four digits", () => {
    assert.equal(maskedLast4("91-1234-5678-9012"), "XXXX-XXXX-9012");
    assert.equal("91-1234-5678-9012".includes("XXXX-XXXX-9012"), false);
  });
});
