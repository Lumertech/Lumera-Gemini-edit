import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RX_FLASH_MATCHERS } from "./flashPopulatedRxFields.ts";

describe("scribe Rx flash matchers", () => {
  it("matches the clinician-facing physio and Rx labels", () => {
    const labels = [
      "Chief Complaints & Symptom Duration:",
      "Clinical Diagnosis:",
      "ICD-10 Code:",
      "Medication Schedule",
      "Joint Range of Motion (ROM) & Mobility Restrictions",
      "Manual Muscle Testing (MMT 0-5)",
      "Prescribed Home Exercise Program (HEP)",
    ];
    for (const label of labels) {
      assert.ok(
        RX_FLASH_MATCHERS.some((re) => re.test(label)),
        `expected a matcher for ${label}`
      );
    }
  });
});
