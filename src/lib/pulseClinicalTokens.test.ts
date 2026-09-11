import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectPhysioRegion,
  extractPhysioTokensFromTranscript,
  mergePhysioIntoSoap,
} from "./pulseClinicalTokens.ts";
import type { SoapNote } from "../types.ts";

const KNEE_TRANSCRIPT = `Doctor: नमस्कार, गुडघ्याचा त्रास कसा आहे?
Patient: डॉक्टर, गेल्या आठवड्यापासून डाव्या गुडघ्यात खूप तीव्र वेदना (pain) होत आहेत. जिने चढताना stiffness.
Doctor: Left knee examination: Medial joint line tenderness present, Crepitus on passive flexion, Active ROM limited to 105 degrees with pain on terminal extension. VAS 7/10.
Doctor: Grade II Osteoarthritis. Quadriceps strengthening + hot pack. Aceclofenac after food.`;

const VIRAL_SOAP: SoapNote = {
  id: "soap-1",
  patientId: "p1",
  uhid: "LUM-1",
  doctorId: "d1",
  date: "2026-09-11",
  subjective: {
    chiefComplaints: ["High grade fever & chills for 2 days"],
    historyOfPresentIllness: "Viral prodrome",
  },
  objective: {
    vitals: { recordedAt: "2026-09-11T00:00:00.000Z" },
    physicalExamination: "Throat congested",
    clinicalFindings: [],
  },
  assessment: {
    primaryDiagnosis: "Acute Viral Upper Respiratory Infection (Pharyngitis)",
    icd10Code: "J06.9",
    differentialDiagnoses: [],
    riskLevel: "Low",
  },
  plan: {
    medicines: [],
    labTests: [],
    lifestyleAdvice: [],
    redFlags: [],
    followUpDays: 4,
    followUpDate: "2026-09-15",
  },
};

describe("Pulse physio token extraction", () => {
  it("detects knee OA consults from Marathi + English code-switch", () => {
    assert.equal(detectPhysioRegion(KNEE_TRANSCRIPT), "knee");
    const tokens = extractPhysioTokensFromTranscript(KNEE_TRANSCRIPT);
    assert.match(tokens.diagnosis, /osteoarthritis/i);
    assert.equal(tokens.icd10, "M17.9");
    assert.ok(tokens.chiefComplaints.some((c) => /knee/i.test(c)));
    assert.ok(tokens.chiefComplaints.some((c) => /आठवद|week/i.test(c) || /pain/i.test(c)));
    assert.equal(tokens.assessment.vasPainScore, 7);
    assert.ok(tokens.assessment.jointRomFindings.some((r) => r.degrees.includes("105")));
    assert.ok(tokens.assessment.muscleStrengthMmt.length >= 1);
    assert.ok(tokens.assessment.specialOrthopedicTests.length >= 1);
    assert.ok(tokens.exercises.length >= 2);
    assert.ok(tokens.exercises.some((e) => /quadriceps/i.test(e.exerciseName)));
  });

  it("replaces hardcoded viral SOAP tokens when the transcript is a physio consult", () => {
    const merged = mergePhysioIntoSoap(VIRAL_SOAP, KNEE_TRANSCRIPT, "Physiotherapy & Rehabilitation");
    assert.notEqual(merged.assessment.icd10Code, "J06.9");
    assert.equal(merged.assessment.icd10Code, "M17.9");
    assert.ok(merged.physiotherapyAssessment);
    assert.ok((merged.prescribedExercises || []).length >= 2);
    assert.ok(merged.subjective.chiefComplaints.every((c) => !/fever/i.test(c)));
  });

  it("extracts frozen-shoulder ROM, special tests, and HEP", () => {
    const text =
      "Severe shoulder pain and stiffness for 3 weeks. Night pain. Abduction 75 degrees. Neer and Hawkins positive. Adhesive capsulitis.";
    assert.equal(detectPhysioRegion(text), "shoulder");
    const tokens = extractPhysioTokensFromTranscript(text);
    assert.equal(tokens.icd10, "M75.0");
    assert.ok(tokens.assessment.jointRomFindings.some((r) => /75/.test(r.degrees)));
    assert.ok(tokens.assessment.specialOrthopedicTests.some((t) => /Neer/i.test(t.testName)));
    assert.ok(tokens.exercises.some((e) => /pendulum/i.test(e.exerciseName)));
  });

  it("extracts lumbar radiculopathy SLR and McKenzie HEP", () => {
    const text = "Low back pain with sciatica. Straight leg raise positive. McKenzie extension.";
    assert.equal(detectPhysioRegion(text), "lumbar");
    const tokens = extractPhysioTokensFromTranscript(text);
    assert.equal(tokens.icd10, "M54.16");
    assert.ok(tokens.assessment.specialOrthopedicTests.some((t) => /straight leg/i.test(t.testName)));
    assert.ok(tokens.exercises.some((e) => /mckenzie/i.test(e.exerciseName)));
  });
});
