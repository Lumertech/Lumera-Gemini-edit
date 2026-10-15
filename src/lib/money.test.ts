import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatInr } from "./money.ts";

describe("formatInr", () => {
  it("prints rupees with en-IN grouping", () => {
    assert.equal(formatInr(0), "₹0");
    assert.equal(formatInr(600), "₹600");
    assert.equal(formatInr(1250.5), "₹1,250.50");
    assert.equal(formatInr(1234567), "₹12,34,567");
    assert.equal(formatInr(Number.NaN), "₹0");
  });
});
