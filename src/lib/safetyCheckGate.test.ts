import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_SAFETY_GATE,
  SAFETY_CHECK_FAILED_COPY,
  SAFETY_CHECK_RATE_LIMIT_COPY,
  buildSafetyListSignature,
  formatSafetyCheckTime,
  hasSafetyPayload,
  interpretSafetyCheckResponse,
  lastSuccessfulCheckCopy,
  pulseSafetyFromModel,
  reduceSafetyCheck,
  safetyGateBlocksActions,
  safetyGateFromState,
} from "./safetyCheckGate.ts";

const meds = [{ id: "med-1", drugName: "Amoxicillin", dosage: "500 mg", frequency: "1-0-1", durationDays: 5 }];
const signature = buildSafetyListSignature({
  medicines: meds,
  allergies: ["Penicillin"],
  chronicConditions: ["Asthma"],
});

function view(state: typeof EMPTY_SAFETY_GATE, listSignature = signature) {
  return {
    medicineCount: meds.length,
    checkedSignature: state.checkedSignature,
    medicinesSignature: listSignature,
    safetyStatus: state.result?.safetyStatus,
    hasHighRiskAlert: state.result?.hasHighRiskAlert,
    source: state.result?.source,
    alerts: state.result?.alerts,
    overrideSignature: state.overrideSignature,
  };
}

describe("safety check gate", () => {
  it("keeps Print, Sign, and WhatsApp blocked for a high-risk flag until the override is acknowledged", () => {
    const decision = interpretSafetyCheckResponse(200, {
      hasHighRiskAlert: true,
      alerts: [{ severity: "Moderate", description: "Dose check" }],
    });
    assert.equal(decision.accepted, true);
    assert.equal(decision.result.safetyStatus, "HIGH_RISK");
    assert.equal(decision.result.hasHighRiskAlert, true);

    const checked = reduceSafetyCheck(EMPTY_SAFETY_GATE, 200, decision.result, signature, "09:15");
    assert.equal(safetyGateFromState(checked, meds.length, signature), true);
    assert.equal(safetyGateBlocksActions(view(checked)), true);

    const acknowledged = { ...checked, overrideSignature: signature };
    assert.equal(safetyGateFromState(acknowledged, meds.length, signature), false);
    assert.equal(safetyGateBlocksActions({ ...view(acknowledged), overrideSignature: signature }), false);
  });

  it("treats a Severe alert with hasHighRiskAlert false as HIGH_RISK", () => {
    const decision = interpretSafetyCheckResponse(200, {
      hasHighRiskAlert: false,
      safetyStatus: "REVIEW",
      alerts: [{ severity: "severe" }],
    });
    assert.equal(decision.accepted, true);
    assert.equal(decision.result.safetyStatus, "HIGH_RISK");
    assert.equal(decision.result.hasHighRiskAlert, true);

    const checked = reduceSafetyCheck(EMPTY_SAFETY_GATE, 200, {
      hasHighRiskAlert: false,
      safetyStatus: "REVIEW",
      alerts: [{ severity: "Critical" }],
    }, signature, "09:16");
    assert.equal(checked.result?.safetyStatus, "HIGH_RISK");
    assert.equal(safetyGateBlocksActions(view(checked)), true);
    assert.equal(safetyGateBlocksActions({ ...view(checked), overrideSignature: signature }), false);
  });

  it("keeps Print, Sign, and WhatsApp disabled after 429 and safety_check_failed", () => {
    const opened = reduceSafetyCheck(EMPTY_SAFETY_GATE, 200, {
      safetyStatus: "REVIEW",
      source: "Pulse AI",
      hasHighRiskAlert: false,
      alerts: [],
    }, signature, "09:10");
    assert.equal(safetyGateFromState(opened, meds.length, signature), false);

    const rateLimited = interpretSafetyCheckResponse(429, { error: "slow" });
    assert.equal(rateLimited.accepted, false);
    if (rateLimited.accepted === false) assert.equal(rateLimited.message, SAFETY_CHECK_RATE_LIMIT_COPY);
    const afterRateLimit = reduceSafetyCheck(opened, 429, { error: "slow" }, signature, "09:20");
    assert.equal(afterRateLimit.checkedSignature, null);
    assert.equal(afterRateLimit.lastSuccessfulCheckAt, "09:10");
    assert.equal(lastSuccessfulCheckCopy(afterRateLimit.lastSuccessfulCheckAt), "Last successful check at 09:10 IST");
    assert.equal(safetyGateFromState(afterRateLimit, meds.length, signature), true);

    const failed = interpretSafetyCheckResponse(500, { code: "safety_check_failed" });
    assert.equal(failed.accepted, false);
    if (failed.accepted === false) assert.equal(failed.message, SAFETY_CHECK_FAILED_COPY);
    const afterFailure = reduceSafetyCheck(opened, 500, { code: "safety_check_failed" }, signature, "09:21");
    assert.equal(afterFailure.checkedSignature, null);
    assert.equal(safetyGateFromState(afterFailure, meds.length, signature), true);
  });

  it("requires an acknowledgement when REVIEW still has alerts, and includes allergies in the signature", () => {
    const review = interpretSafetyCheckResponse(200, {
      safetyStatus: "SAFE",
      hasHighRiskAlert: false,
      alerts: [{ severity: "Moderate", description: "Dose check" }],
    });
    assert.equal(review.accepted, true);
    if (review.accepted) {
      assert.equal(review.result.safetyStatus, "REVIEW");
      assert.equal(hasSafetyPayload(review.result), true);
    }
    const checked = reduceSafetyCheck(EMPTY_SAFETY_GATE, 200, {
      safetyStatus: "SAFE",
      hasHighRiskAlert: false,
      alerts: [{ severity: "Moderate", description: "Dose check" }],
    }, signature, "11:00");
    assert.equal(checked.result?.safetyStatus, "REVIEW");
    assert.equal(safetyGateBlocksActions(view(checked)), true);
    assert.equal(safetyGateBlocksActions({ ...view(checked), overrideSignature: signature }), false);
    const clear = reduceSafetyCheck(EMPTY_SAFETY_GATE, 200, {
      hasHighRiskAlert: false,
      alerts: [],
    }, signature, "11:05");
    assert.equal(clear.result?.safetyStatus, "SAFE");
    assert.equal(hasSafetyPayload(clear.result), false);
    assert.equal(safetyGateBlocksActions(view(clear)), false);

    const withNewAllergy = buildSafetyListSignature({
      medicines: meds,
      allergies: ["Penicillin", "Sulfa"],
      chronicConditions: ["Asthma"],
    });
    assert.notEqual(withNewAllergy, signature);
    assert.equal(safetyGateFromState(checked, meds.length, withNewAllergy), true);
  });

  it("formats the check time in en-IN and rejects a model status that is not HIGH_RISK or REVIEW", () => {
    const formatted = formatSafetyCheckTime(new Date("2026-10-17T03:45:00.000Z"));
    assert.match(formatted, /09/);
    assert.match(formatted, /15/);
    assert.equal(hasSafetyPayload({ safetyStatus: "HIGH_RISK" }), true);
    assert.equal(hasSafetyPayload({ safetyStatus: "REVIEW" }), true);
    assert.equal(hasSafetyPayload({ safetyStatus: "SAFE" }), false);
    assert.equal(hasSafetyPayload({ safetyStatus: "banana" }), false);
    assert.equal(hasSafetyPayload({}), false);
    const derived = pulseSafetyFromModel({
      safetyStatus: "SAFE",
      hasHighRiskAlert: false,
      alerts: [{ severity: "high" }],
    });
    assert.equal(derived.safetyStatus, "HIGH_RISK");
    assert.throws(() => pulseSafetyFromModel({}));
  });
});
