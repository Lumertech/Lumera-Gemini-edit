import type {
  MedicineItem,
  Patient,
  Doctor,
  PhysiotherapyAssessment,
  PrescribedExercise,
  SoapNote,
} from "../types";
import { clonePresetExercises } from "./rxPresetHep.ts";

export type PulseExtractSource = "gemini-3.7-flash" | "clinical-synthesis-engine" | "pulse-local-parser";

const KNEE_HEP: PrescribedExercise[] = [
  {
    id: "hep-quad",
    exerciseName: "Isometric Quadriceps Setting",
    targetArea: "Hip & Knee",
    sets: 3,
    reps: 12,
    holdSeconds: 8,
    frequency: "3x Daily",
    resistanceBand: "None",
    instructions: "Sit or lie with knee extended. Tighten the front of the thigh and press the knee down into the couch. Hold, then relax.",
    precautions: "Stay within tolerable pain (VAS ≤ 4). Do not bounce.",
  },
  {
    id: "hep-slr",
    exerciseName: "Straight Leg Raise",
    targetArea: "Hip & Knee",
    sets: 3,
    reps: 10,
    holdSeconds: 3,
    frequency: "2x Daily",
    resistanceBand: "None",
    instructions: "Lie on your back, lock the knee, lift the leg to 30–45°, pause, then lower slowly.",
    precautions: "Stop if sharp catching or locking occurs.",
  },
  {
    id: "hep-mini-squat",
    exerciseName: "Wall Mini-Squats (0–30°)",
    targetArea: "Hip & Knee",
    sets: 2,
    reps: 10,
    holdSeconds: 2,
    frequency: "2x Daily",
    resistanceBand: "None",
    instructions: "Stand with back against a wall. Slide down only to a shallow squat, then return.",
    precautions: "Avoid deep knee bend past comfortable range.",
  },
];

const SHOULDER_HEP: PrescribedExercise[] = [
  {
    id: "hep-pendulum",
    exerciseName: "Codman's Pendulum Decompression Swings",
    targetArea: "Shoulder & Arm",
    sets: 3,
    reps: 20,
    holdSeconds: 0,
    frequency: "3x Daily",
    resistanceBand: "None",
    instructions: "Bend forward supported by a table. Let the affected arm dangle and swing gently in small circles.",
    precautions: "Use body momentum, not active shoulder muscle.",
  },
  {
    id: "hep-er",
    exerciseName: "Shoulder External Rotation with Resistance Band",
    targetArea: "Shoulder & Arm",
    sets: 3,
    reps: 12,
    holdSeconds: 3,
    frequency: "2x Daily",
    resistanceBand: "Yellow (Light)",
    instructions: "Elbow at 90° by the side. Rotate the forearm outward against light band resistance.",
    precautions: "Do not shrug. Stop if sharp night pain increases.",
  },
  {
    id: "hep-wand",
    exerciseName: "Wand-Assisted Forward Flexion",
    targetArea: "Shoulder & Arm",
    sets: 2,
    reps: 10,
    holdSeconds: 5,
    frequency: "2x Daily",
    resistanceBand: "None",
    instructions: "Hold a stick with both hands and lift with the unaffected arm to assist the stiff shoulder.",
    precautions: "Stay below the painful arc.",
  },
];

const LUMBAR_HEP: PrescribedExercise[] = [
  {
    id: "hep-mckenzie",
    exerciseName: "McKenzie Prone Press-Up",
    targetArea: "Lower Back & Core",
    sets: 3,
    reps: 8,
    holdSeconds: 3,
    frequency: "3x Daily",
    resistanceBand: "None",
    instructions: "Lie prone, hands under shoulders, press the chest up while hips stay on the couch.",
    precautions: "Stop if pain peripheralizes into the leg.",
  },
  {
    id: "hep-bird-dog",
    exerciseName: "Bird-Dog Core Stability",
    targetArea: "Lower Back & Core",
    sets: 2,
    reps: 8,
    holdSeconds: 5,
    frequency: "2x Daily",
    resistanceBand: "None",
    instructions: "On all fours, extend opposite arm and leg without rotating the pelvis.",
    precautions: "Keep the spine neutral. Avoid lumbar sag.",
  },
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function extractDurationPhrase(text: string): string {
  const lower = text.toLowerCase();
  if (/आठवद/.test(text) || /aathavd/.test(lower)) return "1 week";
  if (/\b3 weeks?\b/i.test(text)) return "3 weeks";
  const patterns = [
    /(\d+\s*(?:din|days?|day|week|weeks?|mahine|months?))/i,
    /(last|past|for)\s+\d+[^\n.]{0,24}/i,
    /(\d+\s*din se)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[0]) return m[0].trim();
  }
  return "";
}

function extractVas(text: string): number | undefined {
  const m = text.match(/vas\s*[:=]?\s*(\d{1,2})/i) || text.match(/pain(?:\s*score)?\s*[:=]?\s*(\d{1,2})\s*\/\s*10/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  return undefined;
}

function extractRomDegrees(text: string): string | undefined {
  const m = text.match(/(\d{2,3})\s*(?:°|degrees?)/i);
  return m ? `${m[1]}°` : undefined;
}

export function detectPhysioRegion(
  transcript: string
): "knee" | "shoulder" | "lumbar" | "generic" {
  const t = transcript.toLowerCase();
  if (includesAny(t, ["knee", "गुडघ", "patella", "acl", "osteoarthritis", "m17"])) return "knee";
  if (includesAny(t, ["shoulder", "capsulitis", "frozen", "glenohumeral", "rotator", "neer", "hawkins"])) {
    return "shoulder";
  }
  if (includesAny(t, ["lumbar", "sciatica", "disc", "slr", "straight leg", "radiculopathy", "low back"])) {
    return "lumbar";
  }
  return "generic";
}

export function extractPhysioTokensFromTranscript(transcript: string): {
  chiefComplaints: string[];
  diagnosis: string;
  icd10: string;
  assessment: PhysiotherapyAssessment;
  exercises: PrescribedExercise[];
  medicines: MedicineItem[];
  advice: string[];
} {
  const t = transcript.toLowerCase();
  const region = detectPhysioRegion(transcript);
  const duration = extractDurationPhrase(transcript);
  const vas = extractVas(t) ?? (includesAny(t, ["severe", "तीव्र", "tez"]) ? 7 : 5);
  const rom = extractRomDegrees(transcript);

  if (region === "knee") {
    const complaints = [
      duration ? `Left knee pain for ${duration}` : "Left knee pain with stiffness",
      includesAny(t, ["stair", "जिने", "climbing"]) ? "Pain on stair climbing and sit-to-stand" : "Activity-related knee pain",
      includesAny(t, ["swelling", "सूज", "stiffness", "कडक"]) ? "Evening swelling and morning stiffness" : "Functional limitation of the knee",
    ];
    return {
      chiefComplaints: complaints,
      diagnosis: "Grade II Osteoarthritis of the Knee",
      icd10: "M17.9",
      assessment: {
        vasPainScore: vas,
        painType: includesAny(t, ["shooting", "radiat"]) ? "Sharp / Shooting" : "Aching",
        painAggravatingFactors: "Stair climbing, squatting, prolonged standing",
        painRelievingFactors: "Rest, moist heat, reduced load",
        jointRomFindings: [
          {
            joint: "Left Knee",
            movement: "Active Flexion",
            degrees: rom ? `${rom} (Restricted)` : "105° (Normal 135° — Restricted)",
            endFeel: "Capsular / Firm",
          },
          {
            joint: "Left Knee",
            movement: "Terminal Extension",
            degrees: "Painful lag on end-range extension",
            endFeel: "Empty / Painful",
          },
        ],
        muscleStrengthMmt: [
          { muscleGroup: "Quadriceps (VMO / Vastus lateralis)", grade: "3/5 (Fair - Anti-gravity)" },
          { muscleGroup: "Hamstrings", grade: "4/5 (Good)" },
        ],
        gaitAndPosture: "Antalgic gait with reduced stance time on the affected side",
        specialOrthopedicTests: [
          {
            testName: "Medial joint-line tenderness / Crepitus",
            result: "Positive (+)",
            notes: "Crepitus on passive flexion as documented in consult",
          },
          {
            testName: "McMurray Test",
            result: includesAny(t, ["mcmurray", "lock"]) ? "Positive (+)" : "Equivocal",
            notes: "Correlate with mechanical symptoms",
          },
        ],
        functionalGoals: [
          "Restore pain-free stair ascent within 3 weeks",
          "Improve active flexion toward 120°",
          "Independent HEP adherence 2–3× daily",
        ],
      },
      exercises: clonePresetExercises(KNEE_HEP),
      medicines: [
        {
          id: "med-nsaid",
          drugName: "Aceclofenac + Paracetamol",
          composition: "Aceclofenac 100mg + Paracetamol 325mg",
          dosage: "1 Tablet",
          form: "Tablet",
          frequency: "1-0-1",
          timing: "After Food",
          durationDays: 5,
          instructions: "After meals for inflammatory pain; short course",
        },
      ],
      advice: [
        "Avoid deep squatting and cross-legged sitting for 2 weeks",
        "Moist heat 10 minutes before HEP",
        "Perform Home Exercise Program (HEP) 2–3 times daily within VAS ≤ 4",
      ],
    };
  }

  if (region === "shoulder") {
    return {
      chiefComplaints: [
        duration ? `Shoulder pain and stiffness for ${duration}` : "Shoulder pain with progressive stiffness",
        "Difficulty reaching overhead or behind the back",
        includesAny(t, ["sleep", "night"]) ? "Night pain disturbing sleep" : "Painful arc on elevation",
      ],
      diagnosis: "Adhesive Capsulitis / Rotator Cuff Related Shoulder Pain",
      icd10: "M75.0",
      assessment: {
        vasPainScore: vas,
        painType: "Aching",
        painAggravatingFactors: "Overhead reach, lying on the affected side",
        painRelievingFactors: "Pendulum rest position, moist heat",
        jointRomFindings: [
          {
            joint: "Glenohumeral (Affected)",
            movement: "Abduction",
            degrees: rom ? `${rom} (Restricted)` : "75° (Normal 180° — Restricted)",
            endFeel: "Capsular / Firm",
          },
          {
            joint: "Glenohumeral (Affected)",
            movement: "External Rotation",
            degrees: "25° (Normal 90° — Marked Restriction)",
            endFeel: "Empty / Painful",
          },
        ],
        muscleStrengthMmt: [
          { muscleGroup: "Rotator cuff (supraspinatus / infraspinatus)", grade: "3/5 (Fair - Anti-gravity)" },
          { muscleGroup: "Deltoid & periscapulars", grade: "4/5 (Good)" },
        ],
        gaitAndPosture: "Guarded shoulder elevation with internal rotation posture",
        specialOrthopedicTests: [
          { testName: "Neer's Impingement Test", result: "Positive (+)", notes: "Painful arc" },
          { testName: "Hawkins-Kennedy Test", result: "Positive (+)", notes: "Anterior impingement pain" },
        ],
        functionalGoals: [
          "Restore external rotation toward 60° in 3 weeks",
          "Enable pain-free sleep (VAS < 2 at night)",
        ],
      },
      exercises: clonePresetExercises(SHOULDER_HEP),
      medicines: [
        {
          id: "med-gel",
          drugName: "Diclofenac Diethylamine Gel (Volini)",
          composition: "Diclofenac 1.16%",
          dosage: "Topical Application",
          form: "Ointment",
          frequency: "1-0-1",
          timing: "With Food",
          durationDays: 14,
          instructions: "Gentle massage around the joint capsule after heat",
        },
      ],
      advice: [
        "Sleep on the unaffected side with a pillow supporting the arm",
        "Perform HEP 3 times daily within tolerable pain",
        "Avoid jerky overhead reaching and lifting >2 kg",
      ],
    };
  }

  if (region === "lumbar") {
    return {
      chiefComplaints: [
        duration ? `Low back / radiating pain for ${duration}` : "Low back pain with radiating symptoms",
        "Pain on prolonged sitting and forward bend",
        "Difficulty with sit-to-stand",
      ],
      diagnosis: "Lumbar Radiculopathy (Disc Related)",
      icd10: "M54.16",
      assessment: {
        vasPainScore: vas,
        painType: "Radiating / Neural",
        painAggravatingFactors: "Sitting, forward flexion, coughing",
        painRelievingFactors: "Walking, prone lying, extension",
        jointRomFindings: [
          {
            joint: "Lumbar spine",
            movement: "Forward flexion",
            degrees: rom ? `${rom} (painful)` : "40° (painful, limited)",
            endFeel: "Empty / Painful",
          },
        ],
        muscleStrengthMmt: [{ muscleGroup: "Ankle dorsiflexors / EHL (screen)", grade: "4/5 (Good)" }],
        gaitAndPosture: "Antalgic, flattened lumbar lordosis",
        specialOrthopedicTests: [
          { testName: "Straight Leg Raise", result: "Positive (+)", notes: "Reproduce radiating pain" },
        ],
        functionalGoals: ["Centralize symptoms within 2 weeks", "Independent sitting >30 min with HEP"],
      },
      exercises: clonePresetExercises(LUMBAR_HEP),
      medicines: [],
      advice: [
        "Avoid prolonged sitting; change posture every 20 minutes",
        "McKenzie extension sequence as tolerated",
        "Seek urgent review for saddle anaesthesia or bowel/bladder change",
      ],
    };
  }

  const durationBit = duration ? ` (${duration})` : "";
  return {
    chiefComplaints: [`Musculoskeletal pain${durationBit}`, "Reduced mobility affecting daily activity"],
    diagnosis: "Musculoskeletal strain — physiotherapy evaluation",
    icd10: "M79.1",
    assessment: {
      vasPainScore: vas,
      painType: "Aching",
      painAggravatingFactors: "Activity and end-range movement",
      painRelievingFactors: "Rest and paced exercise",
      jointRomFindings: [
        {
          joint: "Affected region",
          movement: "Primary plane",
          degrees: rom ? `${rom} (Restricted)` : "Restricted vs contralateral side",
          endFeel: "Capsular / Firm",
        },
      ],
      muscleStrengthMmt: [{ muscleGroup: "Prime movers of the affected region", grade: "4/5 (Good)" }],
      gaitAndPosture: "Guarded movement pattern",
      specialOrthopedicTests: [],
      functionalGoals: ["Restore pain-free daily function with a home program"],
    },
    exercises: clonePresetExercises(KNEE_HEP).slice(0, 1),
    medicines: [],
    advice: ["Perform HEP within tolerable pain", "Review if symptoms worsen"],
  };
}

export function mergePhysioIntoSoap(soap: SoapNote, transcript: string, specialty: string): SoapNote {
  const looksPhysio =
    /physio|rehab/i.test(specialty) || detectPhysioRegion(transcript) !== "generic" || Boolean(soap.physiotherapyAssessment);
  if (!looksPhysio) return soap;
  const extracted = extractPhysioTokensFromTranscript(transcript);
  const complaints =
    soap.subjective?.chiefComplaints?.length && !/fever|pharyngitis|viral/i.test(soap.subjective.chiefComplaints.join(" "))
      ? soap.subjective.chiefComplaints
      : extracted.chiefComplaints;
  return {
    ...soap,
    subjective: {
      ...soap.subjective,
      chiefComplaints: complaints,
    },
    assessment: {
      ...soap.assessment,
      primaryDiagnosis:
        /physio|rehab|osteo|capsulitis|radiculopathy|knee|shoulder|lumbar/i.test(soap.assessment?.primaryDiagnosis || "")
          ? soap.assessment.primaryDiagnosis
          : extracted.diagnosis,
      icd10Code:
        soap.assessment?.icd10Code && !["J06.9", "J00"].includes(soap.assessment.icd10Code)
          ? soap.assessment.icd10Code
          : extracted.icd10,
    },
    plan: {
      ...soap.plan,
      medicines: soap.plan?.medicines?.length ? soap.plan.medicines : extracted.medicines,
      lifestyleAdvice: soap.plan?.lifestyleAdvice?.length ? soap.plan.lifestyleAdvice : extracted.advice,
    },
    physiotherapyAssessment: soap.physiotherapyAssessment || extracted.assessment,
    prescribedExercises: soap.prescribedExercises?.length ? soap.prescribedExercises : extracted.exercises,
  };
}

export async function extractClinicalTokens(params: {
  transcript: string;
  patient: Patient;
  doctor: Doctor;
  recordingSeconds: number;
}): Promise<{ soap: SoapNote; source: PulseExtractSource }> {
  const { transcript, patient, doctor, recordingSeconds } = params;
  const local = extractPhysioTokensFromTranscript(transcript);
  const now = new Date().toISOString().split("T")[0];

  const localSoap: SoapNote = {
    id: "soap-" + Date.now(),
    patientId: patient.id,
    uhid: patient.uhid,
    doctorId: doctor.id,
    date: now,
    specialty: /physio|rehab/i.test(doctor.specialty) ? "Physiotherapy & Rehabilitation" : undefined,
    subjective: {
      chiefComplaints: local.chiefComplaints,
      historyOfPresentIllness: transcript.slice(0, 800) || local.chiefComplaints.join(". "),
    },
    objective: {
      vitals: {
        recordedAt: new Date().toISOString(),
      },
      physicalExamination: local.assessment.gaitAndPosture,
      clinicalFindings: local.assessment.specialOrthopedicTests.map((t) => `${t.testName}: ${t.result}`),
    },
    assessment: {
      primaryDiagnosis: local.diagnosis,
      icd10Code: local.icd10,
      differentialDiagnoses: [],
      riskLevel: "Low",
    },
    plan: {
      medicines: local.medicines,
      labTests: [],
      lifestyleAdvice: local.advice,
      redFlags: [],
      followUpDays: 7,
      followUpDate: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    },
    physiotherapyAssessment: local.assessment,
    prescribedExercises: local.exercises,
    transcriptSummary: local.chiefComplaints[0],
    ambientRecordingDurationSec: recordingSeconds,
  };

  try {
    const res = await fetch("/api/gemini/generate-soap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientName: patient.name,
        patientAge: patient.age,
        patientGender: patient.gender,
        transcript,
        vitals: patient.vitals || {},
        doctorSpecialty: doctor.specialty,
        doctorName: doctor.name,
      }),
    });
    const data = await res.json();
    if (data.success && data.soap) {
      const full: SoapNote = {
        ...localSoap,
        ...data.soap,
        id: "soap-" + Date.now(),
        patientId: patient.id,
        uhid: patient.uhid,
        doctorId: doctor.id,
        date: now,
        ambientRecordingDurationSec: recordingSeconds,
      };
      return {
        soap: mergePhysioIntoSoap(full, transcript, doctor.specialty),
        source: (data.source as PulseExtractSource) || "clinical-synthesis-engine",
      };
    }
  } catch {
    /* fall through to local Pulse parser */
  }

  return { soap: localSoap, source: "pulse-local-parser" };
}
