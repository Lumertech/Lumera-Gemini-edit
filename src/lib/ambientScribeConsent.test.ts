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
  closedVisitNeedsFreshConsent,
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
    assert.equal(
      ambientMicStartDecision({ listening: false, requesting: true, busy: false, consentGranted: true }),
      "ignore"
    );
    assert.equal(
      ambientMicStartDecision({
        force: "stop",
        listening: false,
        requesting: true,
        busy: false,
        consentGranted: true,
      }),
      "ignore"
    );
    assert.equal(
      ambientMicStartDecision({
        force: "start",
        listening: false,
        requesting: true,
        busy: false,
        consentGranted: true,
      }),
      "ignore"
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
    assert.equal(closedVisitNeedsFreshConsent({ code: "visit_closed", status: 409 }), true);
    assert.equal(closedVisitNeedsFreshConsent({ code: "visit_closed", status: 400 }), false);
    assert.equal(closedVisitNeedsFreshConsent({ code: "consent_required", status: 409 }), false);
    assert.equal(closedVisitNeedsFreshConsent(null), false);
    const hook = fs.readFileSync(path.join(root, "src/lib/useAmbientScribeConsent.ts"), "utf8");
    assert.match(hook, /await saveAmbientScribeConsent/);
    assert.match(hook, /consentWriteNextStep\(true\)/);
    assert.match(hook, /consentWriteNextStep\(false\)/);
    assert.match(hook, /closedVisitNeedsFreshConsent\(err\)/);
    assert.match(hook, /visitRef\.current = ""/);
    assert.match(hook, /grantedRef\.current = false/);
    assert.doesNotMatch(hook, /getUserMedia|beginAmbientMicGesture/);
    const helper = fs.readFileSync(path.join(root, "src/lib/ambientMic.ts"), "utf8");
    const tap = helper.slice(helper.indexOf("export function commitAmbientTap"));
    const decision = tap.indexOf("ambientMicStartDecision(");
    const gesture = tap.indexOf("beginAmbientMicGesture(");
    assert.ok(decision > 0 && gesture > decision);
    for (const rel of ["src/components/CompactAmbientScribe.tsx", "src/components/AmbientAIStudio.tsx"]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      assert.match(source, /void consent\.confirm\(\)/);
      assert.match(source, /commitAmbientTap\(/);
      assert.doesNotMatch(source, /await[\s\S]{0,40}commitAmbientTap/);
      assert.doesNotMatch(source, /confirm\(\(\) =>[\s\S]{0,120}commitAmbientTap/);
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
      assert.match(source, /commitAmbientTap\(/);
      assert.match(source, /Starting…/);
      assert.match(source, /disabled=\{isRequesting\}/);
    }
    const rx = fs.readFileSync(path.join(root, "src/components/PrescriptionWriter.tsx"), "utf8");
    assert.match(rx, /startListening\(\)/);
    assert.match(rx, /Starting…/);
    assert.match(rx, /disabled=\{scribeStatus === 'requesting'\}/);
    assert.doesNotMatch(rx, /await[\s\S]{0,40}startListening/);
    assert.doesNotMatch(rx, /scribeStatus === 'requesting'\) \{\s*ambientScribeRef\.current\?\.stopListening/);
  });
});
