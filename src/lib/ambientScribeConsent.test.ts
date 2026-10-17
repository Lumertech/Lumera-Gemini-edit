import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AMBIENT_RECORDING_DISCLOSURE,
  AMBIENT_SCRIBE_CONSENT_TEXT,
  ambientMicStartDecision,
  ambientVisitKey,
  consentWriteNextStep,
} from "./ambientScribeConsent.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("per-visit ambient scribe consent", () => {
  it("does not start the microphone until the clinician confirms", () => {
    assert.equal(
      ambientMicStartDecision({ listening: false, requesting: false, busy: false, consentGranted: false }),
      "ask-consent"
    );
    assert.equal(
      ambientMicStartDecision({
        force: "start",
        listening: false,
        requesting: false,
        busy: false,
        consentGranted: false,
      }),
      "ask-consent"
    );
    assert.equal(
      ambientMicStartDecision({
        force: "start",
        listening: false,
        requesting: false,
        busy: false,
        consentGranted: true,
      }),
      "start"
    );
    assert.equal(
      ambientMicStartDecision({ listening: true, requesting: false, busy: false, consentGranted: true }),
      "stop"
    );
  });

  it("uses a queue appointment id and does not invent a walk-in id", () => {
    assert.equal(ambientVisitKey("apt-1", "pat-1", "2026-10-17"), "apt-1");
    assert.equal(ambientVisitKey("", "pat-1", "2026-10-17"), "");
    assert.equal(ambientVisitKey(undefined, "", "2026-10-17"), "");
  });

  it("awaits the audit write and leaves the microphone for a second tap", () => {
    assert.equal(consentWriteNextStep(true), "second-tap");
    assert.equal(consentWriteNextStep(false), "blocked");
    const hook = fs.readFileSync(path.join(root, "src/lib/useAmbientScribeConsent.ts"), "utf8");
    assert.match(hook, /await saveAmbientScribeConsent/);
    assert.match(hook, /consentWriteNextStep\(true\)/);
    assert.match(hook, /consentWriteNextStep\(false\)/);
    assert.doesNotMatch(hook, /getUserMedia|beginAmbientMicGesture/);
    for (const rel of ["src/components/CompactAmbientScribe.tsx", "src/components/AmbientAIStudio.tsx"]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      assert.match(source, /void consent\.confirm\(\)/);
      assert.match(source, /beginAmbientMicGesture\(\)/);
      assert.doesNotMatch(source, /confirm\(\(\) =>[\s\S]{0,120}beginAmbientMicGesture/);
    }
  });

  it("uses the exact consent sentence and the disclosure under the mic", () => {
    assert.equal(
      AMBIENT_SCRIBE_CONSENT_TEXT,
      "I have told the patient that this consult will be recorded and transcribed by an AI service to draft notes, and the patient agreed. Audio is not stored."
    );
    assert.equal(
      AMBIENT_RECORDING_DISCLOSURE,
      "Recording is sent to an AI transcription service. Audio is not saved. Text stays a suggestion until you apply it."
    );
    const dialog = fs.readFileSync(path.join(root, "src/components/AmbientScribeConsentDialog.tsx"), "utf8");
    const compact = fs.readFileSync(path.join(root, "src/components/CompactAmbientScribe.tsx"), "utf8");
    const studio = fs.readFileSync(path.join(root, "src/components/AmbientAIStudio.tsx"), "utf8");
    assert.match(dialog, /AMBIENT_SCRIBE_CONSENT_TEXT/);
    assert.match(dialog, /AMBIENT_RECORDING_DISCLOSURE/);
    for (const source of [compact, studio]) {
      assert.match(source, /AmbientRecordingDisclosure/);
      assert.match(source, /ambientMicStartDecision\(/);
      const decision = source.indexOf("ambientMicStartDecision(");
      const gesture = source.indexOf("beginAmbientMicGesture()");
      assert.ok(decision > 0 && gesture > decision);
    }
  });
});
