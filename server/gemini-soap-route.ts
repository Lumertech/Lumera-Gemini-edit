import type { Express, Request, Response } from "express";
import { generateRuleBasedSoap } from "./gemini-clinical-helpers.ts";
import {
  aiScribeTenantIdFromRequest,
  blockedAiScribeResponse,
  meterSuccessfulGeminiScribe,
} from "./gemini-scribe-meter.ts";

type GeminiClient = {
  models: {
    generateContent: (opts: unknown) => Promise<{ text?: string }>;
  };
};

let testSoapGenerator: ((body: Record<string, unknown>) => Promise<unknown>) | undefined;

/** Test-only Gemini mock so HTTP tests do not need live API keys. */
export function setGeminiSoapGeneratorForTests(
  fn?: ((body: Record<string, unknown>) => Promise<unknown>) | undefined
) {
  testSoapGenerator = fn;
}

export function attachGeminiSoapRoute(
  app: Express,
  opts?: { getGenAI?: () => GeminiClient | null }
) {
  const getGenAI = opts?.getGenAI || (() => null);

  app.post("/api/gemini/generate-soap", async (req: Request, res: Response) => {
    try {
      const {
        patientName = "Patient",
        patientAge = 40,
        patientGender = "Unknown",
        transcript = "",
        vitals = {},
        doctorSpecialty = "General Medicine",
        doctorName = "Doctor",
      } = req.body;

      if (!transcript || transcript.trim().length < 5) {
        return res.status(400).json({ error: "Consultation transcript is required" });
      }

      const tenantId = aiScribeTenantIdFromRequest(req);
      const blocked = blockedAiScribeResponse(tenantId);
      if (blocked) {
        return res.status(blocked.status).json(blocked.body);
      }

      const recordScribe = (source: string) =>
        meterSuccessfulGeminiScribe({
          tenantId,
          durationMinutes: req.body?.durationMinutes,
          transcript,
          metadata: { source, endpoint: "generate-soap" },
        });

      if (testSoapGenerator) {
        const soap = await testSoapGenerator(req.body);
        recordScribe("gemini-3.7-flash");
        return res.json({ success: true, soap, source: "gemini-3.7-flash" });
      }

      const ai = getGenAI();

      if (ai) {
        try {
          const prompt = `You are Lumera AI, an expert Clinical AI Medical Scribe.
  Generate a comprehensive, structured clinical SOAP note from the following doctor-patient consultation transcript.

  PATIENT INFO:
  - Name: ${patientName}
  - Age/Gender: ${patientAge} / ${patientGender}
  - Doctor: ${doctorName} (${doctorSpecialty})
  - Vitals: BP: ${vitals.bloodPressureSystolic || 120}/${vitals.bloodPressureDiastolic || 80} mmHg, HR: ${vitals.heartRate || 72} bpm, Temp: ${vitals.temperature || 98.6}°F, SpO2: ${vitals.spO2 || 99}%, Weight: ${vitals.weightKg || 70} kg

  TRANSCRIPT OF CONSULTATION:
  """${transcript}"""

  Return STRICTLY a JSON object with this exact schema:
  {
    "subjective": {
      "chiefComplaints": ["complaint 1 with duration", "complaint 2"],
      "historyOfPresentIllness": "detailed narrative of symptoms, onset, severity, aggravating/relieving factors",
      "pastMedicalHistory": "past conditions, chronic illnesses if mentioned",
      "reviewOfSystems": "relevant positive/negative systemic review"
    },
    "objective": {
      "vitals": {
        "bloodPressureSystolic": number,
        "bloodPressureDiastolic": number,
        "heartRate": number,
        "temperature": number,
        "spO2": number,
        "weightKg": number,
        "heightCm": number,
        "bmi": number,
        "bloodSugarRandom": number
      },
      "physicalExamination": "general appearance and system exam (e.g. chest clear, no pallor/icterus, throat congested)",
      "clinicalFindings": ["finding 1", "finding 2"]
    },
    "assessment": {
      "primaryDiagnosis": "Most probable clinical diagnosis",
      "icd10Code": "e.g. J06.9, E11.9, I10, K29.7",
      "differentialDiagnoses": ["Diff Dx 1", "Diff Dx 2"],
      "riskLevel": "Low" | "Moderate" | "High" | "Emergency"
    },
    "plan": {
      "medicines": [
        {
          "id": "med-1",
          "drugName": "Standard Indian Brand or Generic name (e.g. Paracetamol 650 mg (Dolo 650))",
          "composition": "Chemical composition",
          "dosage": "e.g. 650 mg",
          "form": "Tablet" | "Capsule" | "Syrup" | "Injection" | "Ointment" | "Inhaler",
          "frequency": "1-0-1" | "1-0-0" | "0-0-1" | "1-1-1" | "SOS" | "Once a week",
          "timing": "After Food" | "Before Food" | "With Food" | "At Bedtime",
          "durationDays": number,
          "instructions": "specific patient instructions"
        }
      ],
      "labTests": [
        {
          "id": "lab-1",
          "testName": "e.g. Complete Blood Count (CBC)",
          "category": "Hematology" | "Biochemistry" | "Radiology" | "Pathology",
          "urgent": boolean,
          "notes": "indication"
        }
      ],
      "lifestyleAdvice": ["advice 1", "advice 2", "diet advice"],
      "redFlags": ["emergency signs that require immediate hospital visit"],
      "followUpDays": number,
      "followUpDate": "YYYY-MM-DD"
    },
    "transcriptSummary": "Concise 2-sentence executive summary of the encounter"
  }`;

          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          const text = response.text?.trim() || "";
          const parsed = JSON.parse(text);
          recordScribe("gemini-3.7-flash");
          return res.json({ success: true, soap: parsed, source: "gemini-3.7-flash" });
        } catch (geminiError: any) {
          console.error("Gemini SOAP generation error, using fallback clinical synthesis:", geminiError?.message);
        }
      }

      // High-quality Rule-Based Clinical Fallback Synthesis
      const fallbackSoap = generateRuleBasedSoap(patientName, patientAge, patientGender, transcript, vitals);
      recordScribe("clinical-synthesis-engine");
      return res.json({ success: true, soap: fallbackSoap, source: "clinical-synthesis-engine" });
    } catch (error: any) {
      console.error("SOAP endpoint error:", error);
      res.status(500).json({ error: "Failed to generate SOAP note", details: error.message });
    }
  });
}
