import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SoapNote } from "../types.ts";
import {
  SOAP_RX_FIELD_NAMES,
  alignSessionToPatient,
  applySoapDraft,
  buildInitialFormSeed,
  canAutosaveDraft,
  chronicPrefillSeed,
  completeDraftFetch,
  demoDraftStorageKey,
  sessionDemoDraftTenant,
  mapSoapToRxDraft,
  openPatientDraft,
  readDemoDraft,
  replaceAiFields,
  restoreRxDraft,
  aiReviewAllowsDispatch,
  shouldConfirmAiReplace,
  transcriptHash,
  writeDemoDraft,
  writerKey,
  type RxClinicalFields,
} from "./rxDraft.ts";

const META = { source: "pulse-local-parser", generatedAt: "2026-10-15T02:00:00.000Z", transcriptHash: "abc" };

function fullSoap(overrides: Partial<SoapNote> = {}): SoapNote {
  return {
    id: "soap-1",
    patientId: "patient-a",
    uhid: "LUM-A",
    doctorId: "doctor-1",
    date: "2026-10-15",
    specialty: "Cardiology",
    subjective: {
      chiefComplaints: ["crushing chest pain"],
      historyOfPresentIllness: "HPI-UNIQUE",
      pastMedicalHistory: "PMH-UNIQUE",
      reviewOfSystems: "ROS-UNIQUE",
    },
    objective: {
      vitals: {
        recordedAt: "2026-10-15T02:00:00.000Z",
        bloodPressureSystolic: 150,
        bloodPressureDiastolic: 92,
        heartRate: 88,
        temperature: 98.6,
        spO2: 97,
        recordedBy: "Scribe",
      },
      physicalExamination: "EXAM-UNIQUE",
      clinicalFindings: ["finding-a", "finding-b"],
    },
    assessment: {
      primaryDiagnosis: "DX-UNIQUE",
      icd10Code: "I20.9",
      differentialDiagnoses: ["DDX-1", "DDX-2"],
      riskLevel: "High",
    },
    plan: {
      medicines: [
        {
          id: "med-a",
          drugName: "DRUG-A",
          composition: "comp-a",
          dosage: "1 tab",
          form: "Tablet",
          frequency: "1-0-0",
          timing: "After Food",
          durationDays: 5,
        },
      ],
      labTests: [{ id: "lab-a", testName: "LAB-A", category: "Biochemistry" }],
      lifestyleAdvice: ["ADVICE-A"],
      redFlags: ["syncope", "chest pain"],
      followUpDays: 11,
      followUpDate: "2026-10-26",
    },
    physiotherapyAssessment: {
      vasPainScore: 4,
      painType: "Aching",
      jointRomFindings: [],
      muscleStrengthMmt: [],
      gaitAndPosture: "GAIT-A",
      specialOrthopedicTests: [],
      functionalGoals: ["GOAL-A"],
    },
    performedTherapies: [
      {
        id: "proc-a",
        name: "IFT-UNIQUE",
        type: "Electrotherapy & Modality",
        targetArea: "chest wall",
        durationMinutes: 15,
        patientTolerance: "Well Tolerated",
      },
    ],
    prescribedExercises: [
      {
        id: "ex-a",
        exerciseName: "HEP-A",
        targetArea: "Full Body & Balance",
        sets: 2,
        reps: 8,
        holdSeconds: 5,
        frequency: "1x Daily",
        instructions: "slow",
      },
    ],
    cardiologyAssessment: {
      nyhaFunctionalClass: "Class III",
      targetBloodPressure: "CARDIO-A",
      targetRestingHeartRate: "60",
      dailySodiumLimitGrams: 2,
    },
    dermatologyAssessment: {
      fitzpatrickSkinType: "Type IV",
      lesionType: ["DERM-A"],
      distribution: "face",
      sunProtectionAdvice: "spf",
    },
    pediatricAssessment: {
      developmentalMilestones: "Age Appropriate",
      feedingAdvice: "PEDS-A",
    },
    orthopedicAssessment: {
      affectedJointLimb: "ORTHO-A",
      weightBearingStatus: "Full Weight Bearing (FWB)",
    },
    ophthalmologyAssessment: {
      visualAcuityOD: "EYE-OD",
      visualAcuityOS: "EYE-OS",
      refractionOD: { sphere: "0", cyl: "0", axis: "0", add: "0" },
      refractionOS: { sphere: "0", cyl: "0", axis: "0", add: "0" },
      pupillaryDistanceMm: 62,
      iopOD: 14,
      iopOS: 15,
      anteriorSegment: "clear",
      fundusExam: { cupToDiscRatioOD: "0.3", cupToDiscRatioOS: "0.3", retinaFindings: "EYE-FUNDUS" },
    },
    dentalAssessment: {
      teethStatus: { 11: { condition: "Healthy" } },
      periodontalStatus: "Healthy",
      plaqueCalculusIndex: "Low",
      plannedProcedures: [],
    },
    gynecologyAssessment: {
      lmpDate: "2026-01-01",
      calculatedEdd: "GYN-EDD",
      gestationalAgeWeeks: 12,
      gestationalAgeDays: 1,
      trimester: "1st Trimester",
      gravidaPara: { g: 1, p: 0, l: 0, a: 0 },
    },
    transcriptSummary: "SUMMARY-A",
    ambientRecordingDurationSec: 95,
    ...overrides,
  };
}

function secondSoap(): SoapNote {
  const soap = fullSoap();
  soap.subjective = {
    chiefComplaints: ["second complaint"],
    historyOfPresentIllness: "HPI-SECOND",
    pastMedicalHistory: "",
    reviewOfSystems: "ROS-SECOND",
  };
  soap.objective = {
    vitals: { recordedAt: "2026-10-15T03:00:00.000Z", heartRate: 70 },
    physicalExamination: "EXAM-SECOND",
    clinicalFindings: [],
  };
  soap.assessment = {
    primaryDiagnosis: "DX-SECOND",
    icd10Code: "J06.9",
    differentialDiagnoses: ["DDX-SECOND"],
    riskLevel: "Low",
  };
  soap.plan = {
    medicines: [
      {
        id: "med-b",
        drugName: "DRUG-B",
        composition: "comp-b",
        dosage: "1 tab",
        form: "Tablet",
        frequency: "1-0-1",
        timing: "After Food",
        durationDays: 3,
      },
    ],
    labTests: [],
    lifestyleAdvice: ["ADVICE-B"],
    redFlags: [],
    followUpDays: 2,
    followUpDate: "2026-10-17",
  };
  soap.performedTherapies = [];
  soap.prescribedExercises = [];
  soap.cardiologyAssessment = undefined;
  soap.physiotherapyAssessment = undefined;
  soap.transcriptSummary = "SUMMARY-B";
  return soap;
}

describe("apply maps every SOAP field into the Rx draft", () => {
  it("copies each SOAP section and stores a transcript hash, not the raw transcript", async () => {
    const soap = fullSoap();
    const raw = "UNIQUE-RAW-TRANSCRIPT-NOT-IN-SOAP";
    const mapped = await applySoapDraft(soap, { transcript: raw, source: "pulse-local-parser", generatedAt: META.generatedAt });
    const expected = mapSoapToRxDraft(soap, {
      ...META,
      transcriptHash: await transcriptHash(raw),
      transcriptSummary: soap.transcriptSummary,
      ambientRecordingDurationSec: soap.ambientRecordingDurationSec,
    });

    for (const field of SOAP_RX_FIELD_NAMES) {
      assert.deepEqual(mapped[field], expected[field], field);
    }
    assert.equal(mapped.historyOfPresentIllness, "HPI-UNIQUE");
    assert.equal(mapped.pastMedicalHistory, "PMH-UNIQUE");
    assert.equal(mapped.reviewOfSystems, "ROS-UNIQUE");
    assert.equal(mapped.vitals.heartRate, 88);
    assert.equal(mapped.physicalExamination, "EXAM-UNIQUE");
    assert.deepEqual(mapped.clinicalFindings, ["finding-a", "finding-b"]);
    assert.deepEqual(mapped.differentialDiagnoses, ["DDX-1", "DDX-2"]);
    assert.equal(mapped.riskLevel, "High");
    assert.deepEqual(mapped.redFlags, ["syncope", "chest pain"]);
    assert.equal(mapped.performedTherapies[0]?.name, "IFT-UNIQUE");
    assert.equal(mapped.followUpDays, 11);
    assert.equal(mapped.aiSource, "pulse-local-parser");
    assert.equal(mapped.aiGeneratedAt, META.generatedAt);
    assert.equal(mapped.transcriptHash, await transcriptHash(raw));
    assert.equal(mapped.reviewedBy, undefined);
    assert.equal(mapped.aiAcknowledged, false);
    assert.equal(JSON.stringify(mapped).includes(raw), false);
    assert.equal("transcript" in mapped, false);
    assert.equal(await transcriptHash("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("a second apply replaces earlier AI fields instead of merging them", () => {
    const first = mapSoapToRxDraft(fullSoap(), META);
    assert.equal(shouldConfirmAiReplace(first), true);
    const second = replaceAiFields(first, secondSoap(), { source: "pulse-local-parser", generatedAt: "2026-10-15T03:00:00.000Z" });
    assert.deepEqual(second.chiefComplaints, ["second complaint"]);
    assert.equal(second.historyOfPresentIllness, "HPI-SECOND");
    assert.equal(second.pastMedicalHistory, "");
    assert.equal(second.diagnosis, "DX-SECOND");
    assert.deepEqual(second.medicines.map((med) => med.drugName), ["DRUG-B"]);
    assert.deepEqual(second.redFlags, []);
    assert.deepEqual(second.clinicalFindings, []);
    assert.deepEqual(second.labTests, []);
    assert.equal(second.followUpDays, 2);
    assert.equal(second.performedTherapies.length, 0);
    assert.equal(second.cardiologyAssessment, undefined);
    assert.equal(JSON.stringify(second).includes("DRUG-A"), false);
    assert.equal(JSON.stringify(second).includes("HPI-UNIQUE"), false);
    assert.equal(JSON.stringify(second).includes("IFT-UNIQUE"), false);
  });
});

describe("draft hydration, refresh, and patient switch", () => {
  it("a late draft fetch hydrates the form and blocks autosave until it resolves", () => {
    const stored = mapSoapToRxDraft(fullSoap(), META);
    let session = openPatientDraft("patient-a");
    assert.equal(session.phase, "loading");
    assert.equal(canAutosaveDraft(session), false);
    assert.equal(writerKey(session), null);

    session = completeDraftFetch(session, "patient-a", stored);
    assert.equal(canAutosaveDraft(session), true);
    assert.equal(writerKey(session), "patient-a:1");
    const seed = buildInitialFormSeed({
      draft: session.draft,
      soap: null,
      patient: { chronicConditions: ["Diabetes"] },
    });
    assert.equal(seed.historyOfPresentIllness, "HPI-UNIQUE");
    assert.equal(seed.followUpDays, 11);
    assert.deepEqual(seed.redFlags, ["syncope", "chest pain"]);
    assert.equal(seed.riskLevel, "High");
    assert.equal(seed.chiefComplaints.includes("Evaluation & review of Diabetes"), false);
    assert.equal(seed.diagnosis, "DX-UNIQUE");
  });

  it("a refresh restores every stored field with no hard-coded defaults", () => {
    const stored = mapSoapToRxDraft(fullSoap(), META);
    const restored = restoreRxDraft(JSON.parse(JSON.stringify(stored)));
    assert.ok(restored);
    for (const field of SOAP_RX_FIELD_NAMES) {
      assert.deepEqual(restored[field], stored[field], field);
    }
    assert.equal(restored.followUpDays, 11);
    assert.notEqual(restored.followUpDays, 7);
    assert.deepEqual(restored.redFlags, ["syncope", "chest pain"]);
    assert.equal(restored.riskLevel, "High");
    assert.equal(restored.vitals.heartRate, 88);
    assert.equal(restored.physicalExamination, "EXAM-UNIQUE");
    assert.deepEqual(restored.clinicalFindings, ["finding-a", "finding-b"]);
    assert.deepEqual(restored.differentialDiagnoses, ["DDX-1", "DDX-2"]);
    assert.equal(restored.pastMedicalHistory, "PMH-UNIQUE");
    assert.equal(restored.reviewOfSystems, "ROS-UNIQUE");
    assert.equal(restored.performedTherapies[0]?.name, "IFT-UNIQUE");
  });

  it("switching patients does not leak fields and does not wipe the saved chart", () => {
    const draftA = mapSoapToRxDraft(fullSoap(), META);
    const readyA = completeDraftFetch(openPatientDraft("patient-a"), "patient-a", draftA);
    const switched = alignSessionToPatient(readyA, "patient-b");
    assert.equal(switched.phase, "loading");
    assert.equal(switched.draft, null);
    assert.equal(canAutosaveDraft(switched), false);

    const stale = completeDraftFetch(switched, "patient-a", draftA);
    assert.equal(stale.patientId, "patient-b");
    assert.equal(stale.draft, null);

    const readyB = completeDraftFetch(switched, "patient-b", null);
    const seedB = buildInitialFormSeed({
      draft: readyB.draft,
      soap: null,
      patient: { chronicConditions: ["Asthma"] },
    });
    assert.deepEqual(seedB.chiefComplaints, ["Evaluation & review of Asthma"]);
    assert.equal(seedB.diagnosis, "Clinical Evaluation: Asthma");
    assert.equal(JSON.stringify(seedB).includes("HPI-UNIQUE"), false);
    assert.equal(JSON.stringify(seedB).includes("DRUG-A"), false);
    assert.equal(seedB.aiSource, undefined);

    const back = completeDraftFetch(openPatientDraft("patient-a"), "patient-a", draftA);
    assert.equal(back.draft?.diagnosis, "DX-UNIQUE");
    assert.equal(back.draft?.historyOfPresentIllness, "HPI-UNIQUE");
    assert.equal(back.draft?.followUpDays, 11);
    assert.deepEqual(back.draft?.redFlags, ["syncope", "chest pain"]);
  });

  it("runs chronic-condition prefill only when no draft exists", () => {
    const blank = chronicPrefillSeed({ chronicConditions: [] });
    assert.deepEqual(blank.chiefComplaints, []);
    assert.equal(blank.diagnosis, "");
    assert.equal(blank.followUpDays, null);

    const withDraft = buildInitialFormSeed({
      draft: mapSoapToRxDraft(fullSoap(), META),
      soap: null,
      patient: { chronicConditions: ["Diabetes"] },
    });
    assert.equal(withDraft.diagnosis, "DX-UNIQUE");
  });
});

describe("demo draft sessionStorage", () => {
  it("persists a draft keyed by tenant and patient", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    const draft = mapSoapToRxDraft(fullSoap(), META) as unknown as Record<string, unknown>;
    draft.transcript = "UNIQUE-RAW-TRANSCRIPT-NOT-IN-SOAP";
    assert.equal(demoDraftStorageKey("tenant-1", "patient-a"), "lumera.rxDraft.tenant-1.patient-a");
    writeDemoDraft(storage, "tenant-1", "patient-a", draft);
    assert.equal(readDemoDraft(storage, "tenant-1", "patient-b"), null);
    assert.equal(readDemoDraft(storage, "tenant-2", "patient-a"), null);
    const loaded = readDemoDraft(storage, "tenant-1", "patient-a");
    assert.equal(loaded?.diagnosis, "DX-UNIQUE");
    assert.equal(loaded?.followUpDays, 11);
    assert.equal(JSON.stringify(loaded).includes("UNIQUE-RAW-TRANSCRIPT-NOT-IN-SOAP"), false);
    assert.equal(mem.get("lumera.rxDraft.tenant-1.patient-a")?.includes("UNIQUE-RAW-TRANSCRIPT-NOT-IN-SOAP"), false);
  });

  it("keys demo drafts by the session tenant and skips a blank tenant", () => {
    assert.equal(sessionDemoDraftTenant("tenant-demo-individual"), "tenant-demo-individual");
    assert.equal(sessionDemoDraftTenant("tenant-demo-polyclinic"), "tenant-demo-polyclinic");
    assert.equal(sessionDemoDraftTenant(""), null);
    assert.equal(sessionDemoDraftTenant("   "), null);
    assert.equal(sessionDemoDraftTenant(null), null);
    assert.equal(sessionDemoDraftTenant(undefined), null);
    assert.equal(demoDraftStorageKey("", "patient-a"), null);
    assert.equal(demoDraftStorageKey("tenant-demo-individual", "patient-a"), "lumera.rxDraft.tenant-demo-individual.patient-a");
    assert.notEqual(
      demoDraftStorageKey("tenant-demo-individual", "patient-a"),
      demoDraftStorageKey("tenant-demo-polyclinic", "patient-a")
    );

    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    writeDemoDraft(storage, "", "patient-a", { diagnosis: "LEAK" });
    writeDemoDraft(storage, "   ", "patient-a", { diagnosis: "LEAK" });
    assert.equal(mem.size, 0);
    assert.equal(readDemoDraft(storage, "", "patient-a"), null);
    writeDemoDraft(storage, "tenant-demo-individual", "patient-a", { diagnosis: "IND" });
    writeDemoDraft(storage, "tenant-demo-polyclinic", "patient-a", { diagnosis: "POLY" });
    assert.equal(readDemoDraft(storage, "tenant-demo-individual", "patient-a")?.diagnosis, "IND");
    assert.equal(readDemoDraft(storage, "tenant-demo-polyclinic", "patient-a")?.diagnosis, "POLY");
    assert.equal([...mem.keys()].some((key) => key.includes(".demo.")), false);
  });
});

describe("AI review gate", () => {
  it("blocks dispatch until the draft is acknowledged or every AI field is edited", () => {
    const mapped: RxClinicalFields = mapSoapToRxDraft(fullSoap(), META);
    assert.equal(mapped.reviewedBy, undefined);
    assert.equal(aiReviewAllowsDispatch(mapped), false);
    assert.equal(aiReviewAllowsDispatch({ ...mapped, aiAcknowledged: true }), true);
    assert.equal(aiReviewAllowsDispatch({ ...mapped, pendingAiFields: [] }), true);
    assert.equal(
      aiReviewAllowsDispatch({ ...mapped, aiSource: undefined, aiGeneratedAt: undefined, pendingAiFields: ["diagnosis"] }),
      true
    );
  });
});
