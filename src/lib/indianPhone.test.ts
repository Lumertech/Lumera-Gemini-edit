import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIndianPhoneDisplay, isIndianPhoneNumber } from "./indianPhone.ts";

describe("Indian phone numbers", () => {
  it("accepts mobiles and landlines with +91, trunk 0, or spaces", () => {
    for (const value of ["+91 98765 43210", "9876543210", "+919876543210", "09876543210", "022 2847 9000", "+91 22 2847 9000"]) {
      assert.equal(isIndianPhoneNumber(value), true, value);
    }
  });

  it("rejects empty, foreign, and partial numbers", () => {
    for (const value of ["", "12345", "+1 202 555 0100", "987654321", "Lumera", "+91 98765"]) {
      assert.equal(isIndianPhoneNumber(value), false, value);
    }
  });

  it("groups a mobile as +91 98765 43210", () => {
    assert.equal(formatIndianPhoneDisplay("919876543210"), "+91 98765 43210");
    assert.equal(formatIndianPhoneDisplay("+91 9876543210"), "+91 98765 43210");
  });
});
