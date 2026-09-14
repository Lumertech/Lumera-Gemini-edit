import type { Express, Request, Response } from "express";
import type { GoogleGenAI } from "@google/genai";
import { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-clinical-helpers.ts";

export function attachGeminiSoapAndCopilot(
  app: Express,
  getGenAI: () => GoogleGenAI | null
): void {
// 1. Ambient AI Clinical SOAP Note Generation
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
        return res.json({ success: true, soap: parsed, source: "gemini-3.7-flash" });
      } catch (geminiError: any) {
        console.error("Gemini SOAP generation error, using fallback clinical synthesis:", geminiError?.message);
      }
    }

    // High-quality Rule-Based Clinical Fallback Synthesis
    const fallbackSoap = generateRuleBasedSoap(patientName, patientAge, patientGender, transcript, vitals);
    return res.json({ success: true, soap: fallbackSoap, source: "clinical-synthesis-engine" });
  } catch (error: any) {
    console.error("SOAP endpoint error:", error);
    res.status(500).json({ error: "Failed to generate SOAP note", details: error.message });
  }
});

// 2. Gemini Clinical Assistant / Copilot (Clinical Decision Support Chat - Pulse AI)
const handleGeminiCopilot = async (req: Request, res: Response) => {
  try {
    const { query, patientContext = {}, history = [] } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const ai = getGenAI();
    if (ai) {
      try {
        const systemInstruction = `You are Pulse AI, an advanced enterprise clinical decision support copilot powered by Google Gemini.
Provide evidence-based, concise, physician-to-physician clinical decision support for doctors, clinicians, and healthcare providers.
Include:
1. Direct answer with sound physiological and clinical rationale
2. Standard clinical guidelines (ICMR, WHO, NICE, ADA, ESC, AHA)
3. Drug dosage recommendations, contraindications, and pediatric/geriatric adjustments when applicable
4. Differential diagnoses & red flag alerts
5. Active patient risk analysis if patient profile is provided
Always maintain an objective, rigorous, professional medical tone.`;

        const contents: any[] = [];
        if (patientContext && Object.keys(patientContext).length > 0) {
          contents.push({
            role: "user",
            parts: [{ text: `Current Patient Profile: ${JSON.stringify(patientContext)}` }],
          });
          contents.push({
            role: "model",
            parts: [{ text: "Understood. Tailoring clinical recommendations, drug interactions, and dosage checks to this patient's profile." }],
          });
        }

        // Add conversation history
        for (const h of history.slice(-6)) {
          contents.push({
            role: h.sender === "user" ? "user" : "model",
            parts: [{ text: h.text }],
          });
        }

        contents.push({
          role: "user",
          parts: [{ text: query }],
        });

        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.2,
          },
        });

        return res.json({ response: response.text, source: "Pulse AI (Google Gemini 3.8 Flash)" });
      } catch (err: any) {
        console.error("Pulse AI / Gemini Copilot API error:", err?.message);
      }
    }

    // Fallback response for offline / simulated queries
    const fallbackAnswer = getPulseFallbackAnswer(query, patientContext);
    return res.json({ response: fallbackAnswer, source: "Pulse AI Knowledge Base (Offline Fallback)" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

app.post("/api/gemini/copilot", handleGeminiCopilot);
app.post("/api/gemini/pulse-assistant", handleGeminiCopilot);
app.post("/api/gemini/hexa-assistant", handleGeminiCopilot);

}
