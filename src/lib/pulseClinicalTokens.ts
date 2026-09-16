import type {
  MedicineItem,
  Patient,
  Doctor,
  PhysiotherapyAssessment,
  PrescribedExercise,
  SoapNote,
  CardiologyAssessment,
  DermatologyAssessment,
  PediatricAssessment,
  OrthopedicAssessment,
  PolyclinicSpecialty,
} from "../types";
import { clonePresetExercises } from "./rxPresetHep.ts";
import { resolveRxModule } from "./specialtyWorkflow.ts";

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

export function isPhysioPractice(specialty: string): boolean {
  return /physio|rehab/i.test(specialty);
}

export function isViralPlaceholderSoap(soap: Pick<SoapNote, "assessment" | "subjective">): boolean {
  const icd = soap.assessment?.icd10Code || "";
  const dx = soap.assessment?.primaryDiagnosis || "";
  const complaints = (soap.subjective?.chiefComplaints || []).join(" ");
  return (
    ["J06.9", "J00"].includes(icd) ||
    /viral|pharyngitis|nasopharyngitis|upper respiratory/i.test(dx) ||
    /high grade fever|acute viral/i.test(complaints)
  );
}

function paracetamol(id: string, extra?: Partial<MedicineItem>): MedicineItem {
  return {
    id,
    drugName: "Paracetamol 650 mg (Dolo 650)",
    composition: "Paracetamol 650mg",
    dosage: "1 Tablet",
    form: "Tablet",
    frequency: "1-0-1",
    timing: "After Food",
    durationDays: 3,
    instructions: "For fever or pain SOS; max 4 g/day",
    ...extra,
  };
}

function complaintsFromTranscript(transcript: string, duration: string): string[] {
  const spoken = transcript
    .split(/\n+/)
    .filter((line) => /^(patient|caregiver)\s*:/i.test(line))
    .map((line) => line.replace(/^(patient|caregiver)\s*:\s*/i, "").trim())
    .filter(Boolean);
  const fallback = transcript
    .split(/[.?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 18 && !/^(doctor|dr)\s*:/i.test(s));
  const source = (spoken.length ? spoken : fallback).slice(0, 3);
  if (!source.length) {
    return duration ? [`Clinical symptoms for ${duration}`] : ["Clinical findings from today's captured consult"];
  }
  return source.map((c) => (duration && !/\d+\s*(day|week|month|din)/i.test(c) ? `${c} (${duration})` : c));
}

export interface SpecialtyTokenBundle {
  chiefComplaints: string[];
  diagnosis: string;
  icd10: string;
  medicines: MedicineItem[];
  advice: string[];
  labs?: { id: string; testName: string; category: "Hematology" | "Biochemistry" | "Radiology" | "Pathology"; urgent?: boolean }[];
  physiotherapyAssessment?: PhysiotherapyAssessment;
  prescribedExercises?: PrescribedExercise[];
  cardiologyAssessment?: CardiologyAssessment;
  dermatologyAssessment?: DermatologyAssessment;
  pediatricAssessment?: PediatricAssessment;
  orthopedicAssessment?: OrthopedicAssessment;
}

export function extractGpTokensFromTranscript(transcript: string): SpecialtyTokenBundle {
  const t = transcript.toLowerCase();
  const duration = extractDurationPhrase(transcript);
  if (includesAny(t, ["sugar", "diabetes", "glucose", "hba1c", "metformin", "neuropathy", "झनझना"])) {
    return {
      chiefComplaints: [
        duration ? `Diabetes review (${duration})` : "Type 2 diabetes follow-up",
        includesAny(t, ["tingling", "burning", "neuropathy", "झनझना"]) ? "Peripheral tingling / burning of the feet" : "Afternoon fatigue",
      ],
      diagnosis: "Type 2 Diabetes Mellitus — follow-up",
      icd10: "E11.9",
      medicines: [
        {
          id: "med-met",
          drugName: "Metformin 500 mg SR",
          composition: "Metformin 500mg",
          dosage: "500 mg",
          form: "Tablet",
          frequency: "1-0-1",
          timing: "After Food",
          durationDays: 30,
          instructions: "With breakfast and dinner",
        },
      ],
      labs: [{ id: "lab-hba1c", testName: "HbA1c & Fasting / PP Blood Sugar", category: "Biochemistry" }],
      advice: ["Low carbohydrate, high fibre diet", "30 minutes walking daily", "Keep a fasting sugar log"],
    };
  }
  if (
    includesAny(t, ["stomach", "diarrhea", "loose motion", "vomit", "gastro"]) ||
    /\bors\b/i.test(transcript)
  ) {
    return {
      chiefComplaints: [
        duration ? `Watery stools and abdominal cramps for ${duration}` : "Acute watery stools with cramping",
        "Nausea / vomiting sensation",
      ],
      diagnosis: "Acute gastroenteritis with mild dehydration",
      icd10: "A09",
      medicines: [
        {
          id: "med-o2",
          drugName: "Ofloxacin + Ornidazole (O2)",
          composition: "Ofloxacin 200mg + Ornidazole 500mg",
          dosage: "1 Tablet",
          form: "Tablet",
          frequency: "1-0-1",
          timing: "After Food",
          durationDays: 5,
          instructions: "Complete the 5-day course",
        },
        {
          id: "med-ors",
          drugName: "ORS (Electral)",
          composition: "Oral Rehydration Salts",
          dosage: "1 sachet in 1 L water",
          form: "Syrup",
          frequency: "1-1-1",
          timing: "With Food",
          durationDays: 3,
          instructions: "Sip through the day",
        },
      ],
      advice: ["Bland khichdi and curd", "Avoid spicy / street food", "Continue ORS"],
    };
  }
  if (includesAny(t, ["fever", "cough", "throat", "pharyng", "uri", "ताप", "खांसी", "बुखार"])) {
    return {
      chiefComplaints: [
        duration ? `Fever and body ache for ${duration}` : "Fever with body ache",
        includesAny(t, ["throat", "pharyng"]) ? "Sore throat / odynophagia" : "Mild dry cough",
      ],
      diagnosis: "Acute viral upper respiratory infection",
      icd10: "J06.9",
      medicines: [paracetamol("med-dolo")],
      advice: ["Warm saline gargles 3 times daily", "Rest and oral fluids", "Review if fever persists beyond 3 days"],
    };
  }
  return {
    chiefComplaints: complaintsFromTranscript(transcript, duration),
    diagnosis: "Clinical evaluation from captured consult",
    icd10: "Z71.1",
    medicines: [],
    advice: ["Review highlighted fields before signing", "Return sooner for red-flag symptoms"],
  };
}

export function extractCardioTokensFromTranscript(transcript: string): SpecialtyTokenBundle {
  const t = transcript.toLowerCase();
  const duration = extractDurationPhrase(transcript);
  const exertional = includesAny(t, ["walk", "exert", "stair", "angina", "heaviness", "chest"]);
  const nyha: CardiologyAssessment["nyhaFunctionalClass"] = includesAny(t, ["at rest", "class iv", "class 4"])
    ? "Class IV"
    : includesAny(t, ["marked", "class iii", "class 3"])
      ? "Class III"
      : exertional
        ? "Class II"
        : "Class I";
  return {
    chiefComplaints: [
      duration ? `Chest heaviness / dyspnoea for ${duration}` : "Chest heaviness on exertion",
      "Blood pressure review",
    ],
    diagnosis: exertional ? "Stable angina / hypertensive heart review" : "Essential (primary) hypertension",
    icd10: exertional ? "I20.9" : "I10",
    medicines: [
      {
        id: "med-telmi",
        drugName: "Telmisartan 40 mg",
        composition: "Telmisartan 40mg",
        dosage: "40 mg",
        form: "Tablet",
        frequency: "1-0-0",
        timing: "After Food",
        durationDays: 30,
        instructions: "Once daily; hold if systolic BP <100 mmHg",
      },
    ],
    labs: [{ id: "lab-echo", testName: "12-lead ECG & 2D Echo", category: "Radiology" }],
    advice: ["Sodium <2 g/day", "Walk 30 minutes most days", "Home BP log twice daily"],
    cardiologyAssessment: {
      nyhaFunctionalClass: nyha,
      targetBloodPressure: "< 130/80 mmHg",
      targetRestingHeartRate: "60 - 70 bpm",
      dailySodiumLimitGrams: 2,
      dailyFluidLimitMl: 1500,
      ecgSummary: includesAny(t, ["ecg", "sinus"]) ? "Normal sinus rhythm as documented in consult" : "ECG pending / correlate with consult",
      echoFindings: includesAny(t, ["echo", "lvef"]) ? "Correlate echo findings documented in consult" : "",
      cardiacRehabGuidance: ["Graded walking programme", "Avoid isometric heavy lifting until review"],
    },
  };
}

export function extractDermTokensFromTranscript(transcript: string): SpecialtyTokenBundle {
  const t = transcript.toLowerCase();
  const duration = extractDurationPhrase(transcript);
  const acne = includesAny(t, ["acne", "pimple", "comedone"]);
  return {
    chiefComplaints: [
      duration ? `Facial lesions for ${duration}` : acne ? "Inflammatory facial acne" : "Itchy rash / dermatitis",
      includesAny(t, ["itch", "prurit"]) ? "Pruritus" : "Cosmetic concern and flare on sun exposure",
    ],
    diagnosis: acne ? "Acne vulgaris" : "Dermatitis / eczematous rash",
    icd10: acne ? "L70.0" : "L30.9",
    medicines: [
      {
        id: "med-clinda",
        drugName: acne ? "Clindamycin 1% gel" : "Mometasone 0.1% cream (short course)",
        composition: acne ? "Clindamycin phosphate 1%" : "Mometasone furoate 0.1%",
        dosage: "Thin film",
        form: "Ointment",
        frequency: "1-0-1",
        timing: "With Food",
        durationDays: acne ? 28 : 7,
        instructions: "Apply to affected skin; wash hands after",
      },
    ],
    advice: ["Broad-spectrum SPF 50+ each morning", "Do not pick lesions", "Patch-test new products"],
    dermatologyAssessment: {
      fitzpatrickSkinType: "Type IV",
      lesionType: acne ? ["Inflammatory papules", "Comedones"] : ["Erythematous patches"],
      distribution: includesAny(t, ["malar", "face", "forehead"]) ? "Facial malar region and forehead" : "As documented in consult",
      sunProtectionAdvice: "Broad spectrum SPF 50+ gel 20 min before sun, reapply every 3 hours",
    },
  };
}

export function extractPediatricTokensFromTranscript(transcript: string): SpecialtyTokenBundle {
  const duration = extractDurationPhrase(transcript);
  return {
    chiefComplaints: [
      duration ? `Fever for ${duration}` : "Acute fever",
      includesAny(transcript.toLowerCase(), ["cough", "vomit"]) ? "Cough / vomiting sensation" : "Irritability and reduced oral intake",
    ],
    diagnosis: "Acute viral pyrexia — pediatric",
    icd10: "R50.9",
    medicines: [
      {
        id: "med-pcm-syrup",
        drugName: "Paracetamol syrup 250 mg/5 ml",
        composition: "Paracetamol 250mg/5ml",
        dosage: "15 mg/kg/dose",
        form: "Syrup",
        frequency: "SOS",
        timing: "After Food",
        durationDays: 3,
        instructions: "Every 6 hours if fever >100°F; do not exceed 5 doses/day",
      },
    ],
    advice: ["Tepid sponging if fever ≥101°F", "ORS sips", "Review in 48 hours if fever persists"],
    pediatricAssessment: {
      developmentalMilestones: "Age Appropriate",
      calculatedDosageBasis: "Paracetamol 15 mg/kg per dose",
      immunizationsDue: [],
      feedingAdvice: "Continue usual diet; extra fluids",
    },
  };
}

export function extractOrthoTokensFromTranscript(transcript: string): SpecialtyTokenBundle {
  const physio = extractPhysioTokensFromTranscript(transcript);
  const region = detectPhysioRegion(transcript);
  const joint = region === "shoulder" ? "Shoulder" : region === "lumbar" ? "Lumbar spine" : "Knee";
  return {
    chiefComplaints: physio.chiefComplaints,
    diagnosis: physio.diagnosis,
    icd10: physio.icd10,
    medicines: physio.medicines,
    advice: physio.advice,
    orthopedicAssessment: {
      affectedJointLimb: joint,
      weightBearingStatus: region === "lumbar" ? "Full Weight Bearing (FWB)" : "Partial Weight Bearing (PWB)",
      splintOrBraceApplied: region === "knee" ? "Hinged knee brace as needed" : "",
      xrayFindingsSummary: "Correlate with consult / pending radiograph",
    },
  };
}

export function extractSpecialtyTokensFromTranscript(transcript: string, specialty: string): SpecialtyTokenBundle {
  const module = resolveRxModule(specialty);
  if (module === "Physiotherapy & Rehabilitation" || (isPhysioPractice(specialty) && detectPhysioRegion(transcript) !== "generic")) {
    const physio = extractPhysioTokensFromTranscript(transcript);
    return {
      chiefComplaints: physio.chiefComplaints,
      diagnosis: physio.diagnosis,
      icd10: physio.icd10,
      medicines: physio.medicines,
      advice: physio.advice,
      physiotherapyAssessment: physio.assessment,
      prescribedExercises: physio.exercises,
    };
  }
  if (module === "Cardiology") return extractCardioTokensFromTranscript(transcript);
  if (module === "Dermatology") return extractDermTokensFromTranscript(transcript);
  if (module === "Pediatrics") return extractPediatricTokensFromTranscript(transcript);
  if (module === "Orthopedics") return extractOrthoTokensFromTranscript(transcript);
  if (module === "Dental Surgery") {
    const duration = extractDurationPhrase(transcript);
    return {
      chiefComplaints: [
        duration ? `Tooth pain for ${duration}` : "Tooth pain on biting",
        "Sensitivity to cold / sweet",
      ],
      diagnosis: "Dental caries with pulp involvement to correlate",
      icd10: "K02.9",
      medicines: [paracetamol("med-dent-pcm", { instructions: "After food until dental procedure" })],
      advice: ["Avoid chewing on the affected side", "Warm saline rinses", "Complete planned dental visit"],
    };
  }
  return extractGpTokensFromTranscript(transcript);
}

export function mergePhysioIntoSoap(soap: SoapNote, transcript: string, specialty: string): SoapNote {
  const module = resolveRxModule(specialty);
  const looksPhysio = isPhysioPractice(specialty) || module === "Physiotherapy & Rehabilitation";
  if (!looksPhysio) return soap;
  const extracted = extractPhysioTokensFromTranscript(transcript);
  const complaints =
    soap.subjective?.chiefComplaints?.length && !/fever|pharyngitis|viral/i.test(soap.subjective.chiefComplaints.join(" "))
      ? soap.subjective.chiefComplaints
      : extracted.chiefComplaints;
  return {
    ...soap,
    specialty: "Physiotherapy & Rehabilitation",
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

function localSoapFromBundle(
  bundle: SpecialtyTokenBundle,
  patient: Patient,
  doctor: Doctor,
  specialty: PolyclinicSpecialty,
  transcript: string,
  recordingSeconds: number
): SoapNote {
  const now = new Date().toISOString().split("T")[0];
  return {
    id: "soap-" + Date.now(),
    patientId: patient.id,
    uhid: patient.uhid,
    doctorId: doctor.id,
    date: now,
    specialty,
    subjective: {
      chiefComplaints: bundle.chiefComplaints,
      historyOfPresentIllness: transcript.slice(0, 800) || bundle.chiefComplaints.join(". "),
    },
    objective: {
      vitals: { recordedAt: new Date().toISOString() },
      physicalExamination: bundle.physiotherapyAssessment?.gaitAndPosture || "As documented in captured consult",
      clinicalFindings: bundle.physiotherapyAssessment?.specialOrthopedicTests?.map((t) => `${t.testName}: ${t.result}`) || [],
    },
    assessment: {
      primaryDiagnosis: bundle.diagnosis,
      icd10Code: bundle.icd10,
      differentialDiagnoses: [],
      riskLevel: "Low",
    },
    plan: {
      medicines: bundle.medicines,
      labTests: (bundle.labs || []).map((l) => ({ ...l, urgent: Boolean(l.urgent) })),
      lifestyleAdvice: bundle.advice,
      redFlags: [],
      followUpDays: 7,
      followUpDate: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    },
    physiotherapyAssessment: bundle.physiotherapyAssessment,
    prescribedExercises: bundle.prescribedExercises,
    cardiologyAssessment: bundle.cardiologyAssessment,
    dermatologyAssessment: bundle.dermatologyAssessment,
    pediatricAssessment: bundle.pediatricAssessment,
    orthopedicAssessment: bundle.orthopedicAssessment,
    transcriptSummary: bundle.chiefComplaints[0],
    ambientRecordingDurationSec: recordingSeconds,
  };
}

export function mergeSpecialtyIntoSoap(soap: SoapNote, transcript: string, specialty: string): SoapNote {
  const module = resolveRxModule(specialty);
  if (isPhysioPractice(specialty) || module === "Physiotherapy & Rehabilitation") {
    return mergePhysioIntoSoap(soap, transcript, specialty);
  }
  const bundle = extractSpecialtyTokensFromTranscript(transcript, specialty);
  const viral = isViralPlaceholderSoap(soap);
  const keepDx = !viral && Boolean(soap.assessment?.primaryDiagnosis);
  return {
    ...soap,
    specialty: module,
    subjective: {
      ...soap.subjective,
      chiefComplaints:
        !viral && soap.subjective?.chiefComplaints?.length ? soap.subjective.chiefComplaints : bundle.chiefComplaints,
    },
    assessment: {
      ...soap.assessment,
      primaryDiagnosis: keepDx ? soap.assessment.primaryDiagnosis : bundle.diagnosis,
      icd10Code: !viral && soap.assessment?.icd10Code ? soap.assessment.icd10Code : bundle.icd10,
    },
    plan: {
      ...soap.plan,
      medicines: soap.plan?.medicines?.length && !viral ? soap.plan.medicines : bundle.medicines,
      labTests: soap.plan?.labTests?.length ? soap.plan.labTests : bundle.labs || [],
      lifestyleAdvice: soap.plan?.lifestyleAdvice?.length && !viral ? soap.plan.lifestyleAdvice : bundle.advice,
    },
    cardiologyAssessment: soap.cardiologyAssessment || bundle.cardiologyAssessment,
    dermatologyAssessment: soap.dermatologyAssessment || bundle.dermatologyAssessment,
    pediatricAssessment: soap.pediatricAssessment || bundle.pediatricAssessment,
    orthopedicAssessment: soap.orthopedicAssessment || bundle.orthopedicAssessment,
    physiotherapyAssessment: soap.physiotherapyAssessment,
    prescribedExercises: soap.prescribedExercises,
  };
}

export async function extractClinicalTokens(params: {
  transcript: string;
  patient: Patient;
  doctor: Doctor;
  recordingSeconds: number;
  practiceSpecialty?: string;
}): Promise<{ soap: SoapNote; source: PulseExtractSource }> {
  const { transcript, patient, doctor, recordingSeconds } = params;
  const specialtyLabel = params.practiceSpecialty || doctor.specialty || "General Medicine";
  const module = resolveRxModule(specialtyLabel);
  const bundle = extractSpecialtyTokensFromTranscript(transcript, specialtyLabel);
  const localSoap = localSoapFromBundle(bundle, patient, doctor, module, transcript, recordingSeconds);

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
        doctorSpecialty: module,
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
        date: localSoap.date,
        specialty: module,
        ambientRecordingDurationSec: recordingSeconds,
      };
      return {
        soap: mergeSpecialtyIntoSoap(full, transcript, specialtyLabel),
        source: (data.source as PulseExtractSource) || "clinical-synthesis-engine",
      };
    }
  } catch {
    /* fall through to local Pulse parser */
  }

  return { soap: localSoap, source: "pulse-local-parser" };
}
