import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABDM_REGISTRY_PENDING_NOTE,
  CONFIRMED_ABDM_REGISTRY_CLAIM,
  formatAbdmArtefactLabel,
  formatAbdmRegistryLabel,
  onboardingCompleteMessage,
  practiceRegisteredAuditMessage,
  practiceRegisteredWelcomeMessage,
} from "./abdmRegistryLabel.ts";

describe("ABDM registry placeholder labels", () => {
  it("marks stub IDs as pending NHA verification", () => {
    const hfr = formatAbdmRegistryLabel("HFR", "IN-HFR-12345678", true);
    assert.equal(hfr, `HFR: IN-HFR-12345678 (${ABDM_REGISTRY_PENDING_NOTE})`);
    assert.equal(CONFIRMED_ABDM_REGISTRY_CLAIM.test(hfr), false);
    assert.match(hfr, /pending/);
  });

  it("keeps activated-style labels when placeholderMode is false", () => {
    assert.equal(formatAbdmRegistryLabel("HPR", "IN-HPR-87654321", false), "HPR: IN-HPR-87654321");
    assert.equal(
      practiceRegisteredWelcomeMessage("Mehta Clinic", false),
      "Welcome to Lumera! Mehta Clinic has been activated with 500 AI Scribe minutes and 100 monthly DHIS transactions."
    );
    assert.equal(
      practiceRegisteredAuditMessage("Mehta Clinic", "IN-HFR-111", false),
      "Registered and activated tenant: Mehta Clinic (HFR: IN-HFR-111)"
    );
    assert.equal(
      onboardingCompleteMessage(false),
      "Clinical profile verified & practice suite activated successfully."
    );
  });

  it("stub welcome/audit/onboarding copy never claims a confirmed registry ID", () => {
    const welcome = practiceRegisteredWelcomeMessage("Mehta Clinic", true);
    const audit = practiceRegisteredAuditMessage("Mehta Clinic", "IN-HFR-111", true);
    const done = onboardingCompleteMessage(true);
    for (const text of [welcome, audit, done]) {
      assert.match(text, /pending — not yet verified with the National Health Authority/);
      assert.equal(CONFIRMED_ABDM_REGISTRY_CLAIM.test(text), false);
      assert.equal(/has been activated/.test(text), false);
    }
  });

  it("labels locally generated consent artefact IDs the same way", () => {
    const labeled = formatAbdmArtefactLabel("hip-notify-abc123", true);
    assert.equal(labeled, `hip-notify-abc123 (${ABDM_REGISTRY_PENDING_NOTE})`);
    assert.equal(formatAbdmArtefactLabel("grant-1", false), "grant-1");
  });
});
