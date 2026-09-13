export function generateRuleBasedSoap(name: string, age: number, gender: string, transcript: string, vitals: any) {
  const t = transcript.toLowerCase();
  let primaryDiagnosis = "Acute Upper Respiratory Infection";
  let icd10 = "J06.9";
  let complaints = ["Fever with body aches for 2 days", "Mild dry cough & sore throat"];
  let meds: any[] = [];
  let tests: any[] = [];
  let advice = [
    "Warm saline gargles 3 times daily",
    "Adequate oral fluid intake (2.5L / day)",
    "Rest for 2-3 days"
  ];

  if (t.includes("sugar") || t.includes("diabetes") || t.includes("glucose") || t.includes("thirsty")) {
    primaryDiagnosis = "Type 2 Diabetes Mellitus - Follow Up";
    icd10 = "E11.9";
    complaints = ["Routine diabetes check-up", "Mild fatigue in afternoons"];
    meds = [
      { id: "m1", drugName: "Metformin 500 mg SR (Glycomet 500 SR)", composition: "Metformin 500mg", form: "Tablet", dosage: "500 mg", frequency: "1-0-1", timing: "After Food", durationDays: 30, instructions: "With breakfast and dinner" },
      { id: "m2", drugName: "Methylcobalamin + Alpha Lipoic Acid (Neurobion Forte)", composition: "Mecobalamin 1500mcg", form: "Tablet", dosage: "1 Tablet", frequency: "0-0-1", timing: "After Food", durationDays: 30, instructions: "At bedtime" }
    ];
    tests = [{ id: "l1", testName: "HbA1c & Fasting / PP Blood Sugar", category: "Biochemistry", urgent: false }];
    advice = ["Low carbohydrate, high fiber diet", "30 mins walking daily", "Record fasting blood sugar log"];
  } else if (t.includes("stomach") || t.includes("diarrhea") || t.includes("loose motion") || t.includes("vomit")) {
    primaryDiagnosis = "Acute Gastroenteritis with Mild Dehydration";
    icd10 = "A09";
    complaints = ["Loose stools 4-5 episodes since yesterday", "Abdominal cramping and nausea"];
    meds = [
      { id: "m1", drugName: "Ofloxacin + Ornidazole (O2 Tablet)", composition: "Ofloxacin 200mg + Ornidazole 500mg", form: "Tablet", dosage: "1 Tablet", frequency: "1-0-1", timing: "After Food", durationDays: 5, instructions: "Complete 5 day course" },
      { id: "m2", drugName: "ORS Sachet (Electral)", composition: "Oral Rehydration Salts", form: "Syrup", dosage: "1 Sachet in 1L water", frequency: "1-1-1", timing: "With Food", durationDays: 3, instructions: "Sip throughout the day" },
      { id: "m3", drugName: "Ondansetron 4 mg (Emeset 4)", composition: "Ondansetron 4mg", form: "Tablet", dosage: "4 mg", frequency: "SOS", timing: "Before Food", durationDays: 3, instructions: "If nausea persists" }
    ];
    advice = ["Bland khichdi and curd diet", "Avoid spicy, oily and street food", "Continue ORS hydration"];
  } else {
    meds = [
      { id: "m1", drugName: "Paracetamol 650 mg (Dolo 650)", composition: "Paracetamol 650mg", form: "Tablet", dosage: "650 mg", frequency: "1-0-1", timing: "After Food", durationDays: 3, instructions: "For fever >99°F" },
      { id: "m2", drugName: "Montelukast + Levocetirizine (Montair-LC)", composition: "Montelukast 10mg + Levocetirizine 5mg", form: "Tablet", dosage: "1 Tablet", frequency: "0-0-1", timing: "At Bedtime", durationDays: 5, instructions: "Night dose" },
      { id: "m3", drugName: "Pantoprazole 40 mg (Pan 40)", composition: "Pantoprazole 40mg", form: "Tablet", dosage: "40 mg", frequency: "1-0-0", timing: "Before Food", durationDays: 5, instructions: "Before breakfast" }
    ];
    tests = [{ id: "l1", testName: "Complete Blood Count (CBC with ESR)", category: "Hematology", urgent: false }];
  }

  return {
    subjective: {
      chiefComplaints: complaints,
      historyOfPresentIllness: `Patient ${name}, ${age}yo ${gender}, presented with ${complaints.join(' and ')}. Symptoms began 2-3 days ago. No history of chest pain or dyspnea reported.`,
      pastMedicalHistory: "Non-contributory; no known drug allergies reported unless noted in chart.",
      reviewOfSystems: "Denies shortness of breath, palpitations, urinary symptoms."
    },
    objective: {
      vitals: {
        bloodPressureSystolic: vitals.bloodPressureSystolic || 124,
        bloodPressureDiastolic: vitals.bloodPressureDiastolic || 82,
        heartRate: vitals.heartRate || 78,
        temperature: vitals.temperature || 99.1,
        spO2: vitals.spO2 || 98,
        weightKg: vitals.weightKg || 68,
        heightCm: vitals.heightCm || 165,
        bmi: 25.0,
        bloodSugarRandom: vitals.bloodSugarRandom || 110
      },
      physicalExamination: "Conscious, oriented. Pharynx mildly congested. Chest bilateral vesicular breath sounds, no wheezing. S1/S2 heard normal, no murmurs. Abdomen soft, non-tender.",
      clinicalFindings: ["Mild pharyngeal erythema", "Normal systemic examination"]
    },
    assessment: {
      primaryDiagnosis: primaryDiagnosis,
      icd10Code: icd10,
      differentialDiagnoses: ["Viral Prodrome", "Allergic Rhinitis / Pharyngitis"],
      riskLevel: "Low"
    },
    plan: {
      medicines: meds,
      labTests: tests,
      lifestyleAdvice: advice,
      redFlags: ["High fever >102°F persisting >48 hrs", "Difficulty breathing or chest tightness", "Inability to keep liquids down"],
      followUpDays: 5,
      followUpDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
    },
    transcriptSummary: `Patient presented with ${complaints[0]}. Evaluated and prescribed symptomatic medical management with follow-up advised in 5 days.`
  };
}

export function getPulseFallbackAnswer(query: string, ctx: any): string {
  const q = query.toLowerCase();
  if (q.includes("dose") || q.includes("paracetamol")) {
    return `### Paracetamol Dosage Guidelines (Adult & Pediatric):\n• **Adults**: 500 mg - 650 mg PO every 4 to 6 hours as needed. Maximum daily dose is **4,000 mg (4g)** in healthy adults. In hepatic impairment/chronic alcohol use, limit to **2,000 mg/day**.\n• **Pediatrics**: 10 - 15 mg/kg per dose PO every 4 to 6 hours (Max: 5 doses or 75 mg/kg/24 hrs).\n• **Caution**: Monitor for co-prescriptions containing acetaminophen (e.g. Ultracet, Combiflam) to prevent accidental overdose.`;
  }
  if (q.includes("interaction") || q.includes("aceclofenac") || q.includes("telmisartan")) {
    return `### Clinical Interaction Analysis:\n• **Telmisartan (ARB) + Aceclofenac (NSAID)**:\n  - **Mechanism**: NSAIDs inhibit renal prostaglandin synthesis, which can reduce the GFR and blunt the antihypertensive efficacy of ARBs.\n  - **Risk**: Increased risk of acute kidney injury (AKI) and hyperkalemia, especially in elderly or dehydrated patients.\n  - **Recommendation**: If NSAID is required, limit to lowest effective dose for <3-5 days. Ensure adequate hydration and monitor serum creatinine & potassium if prolonged.`;
  }
  if (q.includes("hypertension") || q.includes("guidelines")) {
    return `### ICMR & ESC Hypertension Management Summary:\n1. **Initial Therapy (Stage 1 HTN >140/90)**:\n   - Monotherapy with ARB (Telmisartan 40mg) OR CCB (Amlodipine 5mg).\n2. **Stage 2 HTN (>160/100) or High Risk**:\n   - Single-pill combination: ARB + CCB (e.g. Telmisartan 40mg + Amlodipine 5mg) OR ARB + Thiazide diuretic.\n3. **Lifestyle**: Sodium restriction (<2g sodium/day), DASH diet, weight control, 150 mins aerobic exercise/week.`;
  }
  return `### Clinical Decision Support:\nFor query "${query}":\n• Please evaluate comprehensive patient history, current vitals, renal/hepatic parameters, and medication profile.\n• Standard medical practice recommends conservative symptom-targeted therapy with non-pharmacological support where appropriate.\n• Always verify patient allergy records prior to initiating antimicrobial or NSAID regimens.`;
}
