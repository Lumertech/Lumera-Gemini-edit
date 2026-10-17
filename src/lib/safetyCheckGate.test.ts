import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SAFETY_CHECK_FAILED_COPY,
  SAFETY_CHECK_RATE_LIMIT_COPY,
  interpretSafetyCheckResponse,
  safetyGateBlocksActions,
} from "./safetyCheckGate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const signature = "med-1:Amoxicillin:500 mg:1-0-1:5";

function stillBlocked(): boolean {
  return safetyGateBlocksActions({
    medicineCount: 1,
    checkedSignature: null,
    medicinesSignature: signature,
    safetyStatus: null,
    overrideSignature: null,
  });
}

describe("safety check gate", () => {
  it("keeps Print, Sign, and WhatsApp disabled after 429 and safety_check_failed", () => {
    const rateLimited = interpretSafetyCheckResponse(429, {
      error: "Too many clinical assistant requests. Try again later.",
    });
    assert.equal(rateLimited.accepted, false);
    if (!rateLimited.accepted) assert.equal(rateLimited.message, SAFETY_CHECK_RATE_LIMIT_COPY);
    assert.equal(stillBlocked(), true);

    const failed = interpretSafetyCheckResponse(500, { code: "safety_check_failed" });
    assert.equal(failed.accepted, false);
    if (!failed.accepted) assert.equal(failed.message, SAFETY_CHECK_FAILED_COPY);
    assert.equal(stillBlocked(), true);

    const forbidden = interpretSafetyCheckResponse(403, { error: "Insufficient permissions" });
    assert.equal(forbidden.accepted, false);
    assert.equal(stillBlocked(), true);

    const empty = interpretSafetyCheckResponse(200, { code: "safety_check_failed" });
    assert.equal(empty.accepted, false);
    assert.equal(stillBlocked(), true);

    const writer = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    const handler = writer.slice(writer.indexOf("const handleCheckSafety"), writer.indexOf("const handleAddMedicine"));
    const guardAt = handler.indexOf("if (decision.accepted === false)");
    const recordAt = handler.indexOf("setSafetyCheckedSignature");
    assert.ok(guardAt >= 0 && recordAt > guardAt);
    assert.match(handler, /return;/);
    assert.match(handler, /interpretSafetyCheckResponse/);
    assert.doesNotMatch(handler, /setSafetyResult\(data\)/);
    assert.doesNotMatch(handler, /setSafetyCheckedSignature\(medicinesSignature\)[\s\S]*if \(!decision\.accepted\)/);

    for (const label of [
      "<span>Print Prescription</span>",
      "<span>Finalize &amp; Sign Rx</span>",
      "<span>Send WhatsApp Rx</span>",
      "<span>WhatsApp Dispatch</span>",
    ]) {
      const at = writer.indexOf(label);
      assert.ok(at > 0, label);
      const window = writer.slice(Math.max(0, at - 700), at);
      assert.match(window, /disabled=\{[^}]*isSafetyGateBlocking/);
    }
    const signLabel = writer.indexOf("Finalize & Sign Rx");
    const signWindow = writer.slice(Math.max(0, signLabel - 700), signLabel);
    assert.match(signWindow, /disabled=\{[^}]*isSafetyGateBlocking/);
  });

  it("accepts a fallback result that names REVIEW or HIGH_RISK and shows the source", () => {
    const review = interpretSafetyCheckResponse(200, {
      safetyStatus: "REVIEW",
      source: "rule-based fallback",
      alerts: [],
    });
    assert.equal(review.accepted, true);
    const high = interpretSafetyCheckResponse(200, {
      safetyStatus: "HIGH_RISK",
      source: "rule-based fallback",
      alerts: [{ severity: "Severe" }],
    });
    assert.equal(high.accepted, true);
    if (high.accepted) {
      assert.equal(
        safetyGateBlocksActions({
          medicineCount: 1,
          checkedSignature: signature,
          medicinesSignature: signature,
          safetyStatus: high.result.safetyStatus,
          overrideSignature: null,
        }),
        true
      );
    }
    const writer = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    assert.match(writer, /safetyResult\.source/);
  });

  it("blocks Print, Sign, and WhatsApp on a Gemini high-risk flag until the override is acknowledged", () => {
    const alert = {
      type: "ALLERGY",
      severity: "Severe",
      drugsInvolved: ["Amoxicillin"],
      description: "Penicillin allergy",
      clinicalRecommendation: "Stop the drug",
    };
    const high = interpretSafetyCheckResponse(200, { hasHighRiskAlert: true, alerts: [alert] });
    assert.equal(high.accepted, true);
    if (!high.accepted) return;
    assert.equal(high.result.safetyStatus, "HIGH_RISK");
    assert.equal(high.result.hasHighRiskAlert, true);
    const open = {
      medicineCount: 1,
      checkedSignature: signature,
      medicinesSignature: signature,
      safetyStatus: high.result.safetyStatus,
      hasHighRiskAlert: high.result.hasHighRiskAlert,
    };
    assert.equal(safetyGateBlocksActions({ ...open, overrideSignature: null }), true);
    assert.equal(safetyGateBlocksActions({ ...open, overrideSignature: signature }), false);

    const failed = interpretSafetyCheckResponse(500, { code: "safety_check_failed" });
    assert.equal(failed.accepted, false);
    assert.equal(stillBlocked(), true);

    const review = interpretSafetyCheckResponse(200, {
      safetyStatus: "REVIEW",
      source: "gemini",
      hasHighRiskAlert: false,
      alerts: [],
    });
    assert.equal(review.accepted, true);
    if (review.accepted) {
      assert.equal(review.result.safetyStatus, "REVIEW");
      assert.equal(
        safetyGateBlocksActions({
          medicineCount: 1,
          checkedSignature: signature,
          medicinesSignature: signature,
          safetyStatus: review.result.safetyStatus,
          hasHighRiskAlert: false,
          overrideSignature: null,
        }),
        false
      );
    }

    const writer = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    assert.match(writer, /hasHighRiskAlert === true/);
    assert.match(writer, /safetyResult\.source/);
  });
});
