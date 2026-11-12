import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { publicPlansResponse } from "../../server/pricing-catalog.ts";
import {
  bindOpenTabMicrophoneGrant,
  openTabGrantNotice,
  resetAmbientMicrophoneSession,
  shouldReleaseStreamForPermission,
  startAmbientMic,
  type AmbientGestureDeps,
  type MicrophonePermissionStatus,
} from "./ambientMic.ts";
import { AMBIENT_SCRIBE_MISSION, AI_SCRIBE_LIVE_LABEL } from "./pricingCopy.ts";
import { buildPricingPageModel } from "./pricingModel.ts";
import {
  applyScribeDraftEdit,
  publicScribeDraftError,
  scribeAcceptanceAllowsPersist,
  scribeDraftEditFromSoap,
  unacceptedAiMustNotPersist,
} from "./scribeAcceptance.ts";
import type { SoapNote } from "../types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const BASE: SoapNote = {
  id: "soap-keep",
  patientId: "pat-1",
  uhid: "UHID-1",
  doctorId: "doc-1",
  date: "2026-11-11",
  subjective: {
    chiefComplaints: ["Fever for two days"],
    historyOfPresentIllness: "Original HPI",
    pastMedicalHistory: "Asthma",
  },
  objective: {
    vitals: { recordedAt: "2026-11-11T00:00:00.000Z", heartRate: 88 },
    physicalExamination: "Throat congested",
    clinicalFindings: ["erythema"],
  },
  assessment: {
    primaryDiagnosis: "Viral pharyngitis",
    icd10Code: "J06.9",
    differentialDiagnoses: ["Influenza"],
    riskLevel: "Low",
  },
  plan: {
    medicines: [
      {
        id: "med-1",
        drugName: "Paracetamol",
        composition: "Paracetamol 650 mg",
        dosage: "650 mg",
        form: "Tablet",
        frequency: "1-1-1",
        timing: "After Food",
        durationDays: 3,
      },
      {
        id: "med-2",
        drugName: "Cetirizine",
        composition: "Cetirizine 10 mg",
        dosage: "10 mg",
        form: "Tablet",
        frequency: "0-0-1",
        timing: "At Bedtime",
        durationDays: 5,
      },
    ],
    labTests: [{ id: "lab-1", testName: "CBC", category: "Hematology" }],
    lifestyleAdvice: ["Warm fluids"],
    redFlags: ["Breathlessness"],
    followUpDays: 4,
    followUpDate: "2026-11-15",
  },
};

describe("scribe acceptance stays in place", () => {
  it("edits one field and keeps the rest of the SOAP note and draft Rx", () => {
    const edit = scribeDraftEditFromSoap(BASE);
    edit.historyOfPresentIllness = "Edited HPI in place";
    const next = applyScribeDraftEdit(BASE, edit);
    assert.equal(next.subjective.historyOfPresentIllness, "Edited HPI in place");
    assert.deepEqual(next.subjective.chiefComplaints, ["Fever for two days"]);
    assert.equal(next.subjective.pastMedicalHistory, "Asthma");
    assert.equal(next.objective.physicalExamination, "Throat congested");
    assert.equal(next.objective.vitals.heartRate, 88);
    assert.deepEqual(next.objective.clinicalFindings, ["erythema"]);
    assert.equal(next.assessment.primaryDiagnosis, "Viral pharyngitis");
    assert.equal(next.assessment.icd10Code, "J06.9");
    assert.deepEqual(next.assessment.differentialDiagnoses, ["Influenza"]);
    assert.equal(next.plan.medicines[1].drugName, "Cetirizine");
    assert.equal(next.plan.medicines[1].composition, "Cetirizine 10 mg");
    assert.equal(next.plan.labTests[0].testName, "CBC");
    assert.deepEqual(next.plan.redFlags, ["Breathlessness"]);
    assert.deepEqual(next.plan.lifestyleAdvice, ["Warm fluids"]);
    assert.equal(next.plan.followUpDays, 4);
  });

  it("does not persist an AI draft until the doctor accepts it", () => {
    assert.equal(unacceptedAiMustNotPersist({}), false);
    assert.equal(unacceptedAiMustNotPersist({ diagnosis: "typed" } as { aiSource?: string }), false);
    assert.equal(unacceptedAiMustNotPersist({ aiSource: "Pulse AI", aiGeneratedAt: "2026-11-11T00:00:00.000Z" }), true);
    assert.equal(
      unacceptedAiMustNotPersist({ aiSource: "Pulse AI", aiAcknowledged: true }),
      false
    );
    assert.equal(scribeAcceptanceAllowsPersist({ accepted: false }), false);
    assert.equal(scribeAcceptanceAllowsPersist({}), false);
    assert.equal(scribeAcceptanceAllowsPersist({ accepted: true }), true);
    assert.equal(scribeAcceptanceAllowsPersist({ aiAcknowledged: true }), true);
    assert.equal(publicScribeDraftError("Gemini AI API key not configured"), "Could not draft a SOAP note. Nothing was written to the chart.");
    assert.doesNotMatch(publicScribeDraftError("Gemini AI API key not configured"), /gemini|api key/i);
  });

  it("wires consent, accept, and the open-tab microphone grant into the consult", () => {
    const dialog = read("src/components/AmbientScribeConsentDialog.tsx");
    assert.match(dialog, /type="checkbox"/);
    assert.match(dialog, /data-testid="ambient-scribe-consent-check"/);
    assert.match(dialog, /disabled=\{!checked \|\| saving\}/);
    const compact = read("src/components/CompactAmbientScribe.tsx");
    const studio = read("src/components/AmbientAIStudio.tsx");
    const writer = read("src/components/PrescriptionWriter.tsx");
    const app = read("src/ClinicianApp.tsx");
    for (const source of [compact, studio]) {
      assert.match(source, /AmbientScribeDraftEditor/);
      assert.match(source, /data-testid="ambient-scribe-accept"|onAccept=/);
      assert.match(source, /bindOpenTabMicrophoneGrant/);
      assert.match(source, /openTabGrantNotice/);
    }
    const draftFn = compact.slice(compact.indexOf("const handleDraftSoap"), compact.indexOf("const handleAcceptDraft"));
    assert.doesNotMatch(draftFn, /onApplyToRx/);
    assert.match(compact, /accepted: true/);
    assert.match(writer, /scribeAcceptanceAllowsPersist\(\{ accepted: meta\.accepted \}\)/);
    assert.match(writer, /unacceptedAiMustNotPersist\(draft\)/);
    assert.match(writer, /setAiAcknowledged\(true\)/);
    assert.match(app, /unacceptedAiMustNotPersist\(rx\)/);
    assert.match(app, /aiAcknowledged: true/);
    assert.match(app, /overflow-y-auto overflow-x-hidden/);
    assert.match(read("src/components/AmbientScribeDraftEditor.tsx"), /data-testid="ambient-scribe-accept"/);
    assert.match(read("src/components/AmbientScribeDraftEditor.tsx"), /Nothing is saved to the chart or the prescription until you accept/);
  });
});

describe("public scribe copy matches the shipped consult", () => {
  it("marks AI Scribe live with the consent and acceptance description", () => {
    const plans = publicPlansResponse();
    for (const plan of plans.plans) {
      const row = plan.includes.find((item) => item.label.startsWith("AI Scribe"));
      assert.ok(row, plan.code);
      assert.equal(row.status, "live");
      assert.equal(row.label, AI_SCRIBE_LIVE_LABEL);
      assert.match(row.label, /recorded patient-consent tick/);
      assert.match(row.label, /accepts before anything is saved/);
      assert.doesNotMatch(row.label, /coming soon/i);
    }
    const model = buildPricingPageModel(plans);
    for (const card of model.cards) {
      assert.equal(card.includes.some((line) => /AI Scribe \(coming soon\)/.test(line)), false);
      assert.ok(card.includes.includes(AI_SCRIBE_LIVE_LABEL));
    }
    assert.match(AMBIENT_SCRIBE_MISSION, /in-consult ambient scribing \(live:/);
    assert.match(AMBIENT_SCRIBE_MISSION, /before they are saved/);
    assert.doesNotMatch(AMBIENT_SCRIBE_MISSION, /coming soon/i);
    const landing = read("src/components/LandingPage.tsx");
    const pricing = read("src/pages/PricingPage.tsx");
    assert.match(landing, /AMBIENT_SCRIBE_MISSION/);
    assert.match(pricing, /AMBIENT_SCRIBE_MISSION/);
    assert.match(landing, /Nothing is saved until the doctor accepts/);
    assert.doesNotMatch(landing, /coming soon/i);
  });
});

describe("microphone grant survives an already-open tab", () => {
  beforeEach(() => {
    resetAmbientMicrophoneSession();
  });

  it("does not release a live stream when the permission query is still denied", () => {
    assert.equal(shouldReleaseStreamForPermission({ queryState: "denied", streamLive: true }), false);
    assert.equal(shouldReleaseStreamForPermission({ queryState: "denied", streamLive: false }), true);
    assert.equal(shouldReleaseStreamForPermission({ queryState: "granted", streamLive: true }), false);
    assert.equal(openTabGrantNotice(null, "granted"), false);
    assert.equal(openTabGrantNotice("denied", "granted"), true);
    assert.equal(openTabGrantNotice("prompt", "granted"), true);
    assert.equal(openTabGrantNotice("granted", "granted"), false);
  });

  it("hears a grant that arrives after the document was already open", async () => {
    const seen: string[] = [];
    let status: MicrophonePermissionStatus = { state: "denied", onchange: null };
    const stop = bindOpenTabMicrophoneGrant(
      {
        query: async () => status,
      },
      (state) => seen.push(state)
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(seen, ["denied"]);
    status.state = "granted";
    status.onchange?.call(status as unknown as PermissionStatus, new Event("change"));
    assert.deepEqual(seen, ["denied", "granted"]);
    assert.equal(openTabGrantNotice("denied", "granted"), true);
    stop();
    status.state = "prompt";
    status.onchange?.call(status as unknown as PermissionStatus, new Event("change"));
    assert.deepEqual(seen, ["denied", "granted"]);
  });

  it("keeps the live track when getUserMedia succeeds and the query still says denied", async () => {
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    let stopped = false;
    const track = new EventTarget() as MediaStreamTrack & { readyState: string; muted?: boolean; stop: () => void };
    track.readyState = "live";
    track.muted = false;
    track.stop = () => {
      stopped = true;
      track.readyState = "ended";
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    const deps: AmbientGestureDeps = {
      isSecureContext: true,
      permissions: { query: async () => ({ state: "denied" }) },
      mediaDevices: { getUserMedia: async () => stream },
      createAudioContext: () => ({
        state: "running",
        resume: () => Promise.resolve(),
        close: () => Promise.resolve(),
        createMediaStreamSource: () => ({ connect: () => undefined }) as unknown as MediaStreamAudioSourceNode,
        createAnalyser: () =>
          ({
            fftSize: 0,
            smoothingTimeConstant: 0,
            getByteTimeDomainData: () => undefined,
          }) as unknown as AnalyserNode,
      }),
    };
    const { beginAmbientMicGesture } = await import("./ambientMic.ts");
    const gesture = beginAmbientMicGesture(deps);
    try {
      const session = await startAmbientMic({
        gesture,
        onLevel: () => undefined,
        streamTimeoutMs: 200,
      });
      assert.equal(stopped, false);
      session.stop();
      assert.equal(stopped, false);
    } finally {
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCancel;
      resetAmbientMicrophoneSession();
    }
  });
});
