import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectPhysioRegion,
  extractPhysioTokensFromTranscript,
  extractSpecialtyTokensFromTranscript,
  mergePhysioIntoSoap,
  mergeSpecialtyIntoSoap,
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

describe("Pulse tokens for every practice line", () => {
  it("does not force knee HEP onto a GP fever consult", () => {
    const text =
      "Patient: 2 din se tez fever and throat pain. Mild dry cough.\nDoctor: Viral URI. Dolo 650 after food.";
    const merged = mergePhysioIntoSoap(VIRAL_SOAP, text, "General Medicine");
    assert.equal(merged.assessment.icd10Code, "J06.9");
    assert.equal(merged.prescribedExercises, undefined);
    const gp = extractSpecialtyTokensFromTranscript(text, "gp");
    assert.equal(gp.icd10, "J06.9");
    assert.equal(gp.prescribedExercises, undefined);
  });

  it("maps a cardiology consult to NYHA + I10/I20, not frozen shoulder", () => {
    const text =
      "Patient: Chest heaviness during brisk walking for 2 weeks, relieves with rest.\nDoctor: BP 142/88. Telmisartan 40 mg. Echo.";
    const tokens = extractSpecialtyTokensFromTranscript(text, "Cardiology");
    assert.match(tokens.icd10, /^I/);
    assert.ok(tokens.cardiologyAssessment);
    assert.equal(tokens.cardiologyAssessment?.nyhaFunctionalClass, "Class II");
    assert.ok(tokens.medicines.some((m) => /telmisartan/i.test(m.drugName)));
    const merged = mergeSpecialtyIntoSoap(VIRAL_SOAP, text, "Cardiology");
    assert.notEqual(merged.assessment.icd10Code, "J06.9");
    assert.ok(merged.cardiologyAssessment);
  });

  it("maps dermatology and pediatrics without physio ROM", () => {
    const derm = extractSpecialtyTokensFromTranscript(
      "Patient: Pimples on the cheeks for 6 weeks, itchy after sun.\nDoctor: Acne vulgaris. Clindamycin gel.",
      "Dermatology"
    );
    assert.equal(derm.icd10, "L70.0");
    assert.ok(derm.dermatologyAssessment);
    assert.equal(derm.physiotherapyAssessment, undefined);

    const peds = extractSpecialtyTokensFromTranscript(
      "Patient: High fever since last night, dry cough. Papa is 3 years.\nDoctor: Viral pyrexia. Paracetamol syrup.",
      "Pediatrics"
    );
    assert.equal(peds.icd10, "R50.9");
    assert.ok(peds.pediatricAssessment);
  });

  it("starts a new GP clinic from the captured text instead of a canned URI", () => {
    const tokens = extractSpecialtyTokensFromTranscript(
      "Patient: Headache every afternoon for 5 days, worse with screens.\nDoctor: Tension-type headache. Rest, hydration, review.",
      "General Medicine"
    );
    assert.notEqual(tokens.icd10, "M17.9");
    assert.ok(tokens.chiefComplaints.some((c) => /headache/i.test(c)));
  });
});
