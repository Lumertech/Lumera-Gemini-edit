import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  honestyCaption,
  isForbiddenBillingSource,
  normalizeHonestyLabel,
  planBadgeLabel,
  typeLabel,
} from "./adminTenants.ts";

describe("Superadmin tenant honesty helpers (#54 SA-5)", () => {
  it("normalizes unknown / paid-looking sources to manual", () => {
    assert.equal(normalizeHonestyLabel("manual"), "manual");
    assert.equal(normalizeHonestyLabel("sandbox"), "sandbox");
    assert.equal(normalizeHonestyLabel("demo"), "demo");
    assert.equal(normalizeHonestyLabel("razorpay"), "manual");
    assert.equal(normalizeHonestyLabel("paid"), "manual");
    assert.equal(normalizeHonestyLabel(""), "manual");
  });

  it("never captions a tenant plan as PSP-paid", () => {
    assert.match(honestyCaption("manual"), /manual/);
    assert.match(honestyCaption("demo"), /demo/);
    assert.match(honestyCaption("razorpay"), /manual/);
    assert.doesNotMatch(honestyCaption("active"), /paid/i);
    assert.doesNotMatch(honestyCaption("manual"), /Razorpay paid|payment captured/i);
    assert.match(honestyCaption("manual"), /not a captured payment/i);
  });

  it("flags forbidden billingSource values the UI must not send", () => {
    assert.equal(isForbiddenBillingSource("razorpay"), true);
    assert.equal(isForbiddenBillingSource("paid"), true);
    assert.equal(isForbiddenBillingSource("psp"), true);
    assert.equal(isForbiddenBillingSource("manual"), false);
    assert.equal(isForbiddenBillingSource("sandbox"), false);
  });

  it("reads plan badge from SoT fields", () => {
    assert.equal(planBadgeLabel({ badge: "Professional", code: "professional" }), "Professional");
    assert.equal(planBadgeLabel({ displayName: "Clinic", code: "clinic" }), "Clinic");
    assert.equal(planBadgeLabel({ code: "trial" }), "trial");
    assert.equal(planBadgeLabel(null), "—");
    assert.equal(typeLabel("polyclinic"), "Polyclinic");
    assert.equal(typeLabel("individual"), "Individual");
  });
});
