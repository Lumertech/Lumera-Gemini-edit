import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { consentDialogStep } from "./consentGate.ts";

describe("consent dialog gate", () => {
  it("opens the dialog on 409 when the notice is already loaded", () => {
    assert.equal(consentDialogStep(409, "CONSENT_REQUIRED", true), "open");
    assert.equal(consentDialogStep(409, "GUARDIAN_REQUIRED", true), "open");
    assert.equal(consentDialogStep(409, "", true), "open");
  });

  it("fetches the notice and then opens the dialog when a 409 arrives before status loaded", () => {
    assert.equal(consentDialogStep(409, "CONSENT_REQUIRED", false), "fetch");
    assert.equal(consentDialogStep(409, "", false), "fetch");
    assert.equal(consentDialogStep(403, "CONSENT_REQUIRED", false), "fetch");
    assert.equal(consentDialogStep(403, "ROLE_DENIED", false), "stay");
    assert.equal(consentDialogStep(403, "", true), "stay");
    assert.equal(consentDialogStep(400, "CLINIC_NAME_REQUIRED", false), "stay");
  });

  it("wires a failed notice load to an error with Retry, then opens the dialog", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/PatientDocuments.tsx"), "utf8");
    assert.match(source, /consentDialogStep\(/);
    assert.match(source, /data-testid="consent-notice-retry"/);
    assert.match(source, /setConsentOpen\(true\)/);
    assert.match(source, /document-consent/);
  });
});
