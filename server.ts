import express, { Request, Response } from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { attachUser, requireAuth } from "./server/auth.ts";
import { createApiRouter } from "./server/api.ts";
import { createUsageBillingRouter } from "./server/usage-billing-api.ts";
import { createMetaRouter } from "./server/meta.ts";
import { aiScribeTenantIdFromRequest, blockedAiScribeResponse, meterSuccessfulGeminiScribe } from "./server/gemini-scribe-meter.ts";
import { attachGeminiClinicalRest, generateRuleBasedSoap, startLumeraServer } from "./server/gemini-clinical-rest.ts";
import { createAbdmRouter } from "./server/abdm.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import { attachPublicPolicyHtml } from "./server/policy-html.ts";

dotenv.config();
applyBundledServerNodeEnv();
// Fail-closed on JWT_SECRET before any listen. Missing secret exits here — not a PORT bug.
failFastRequiredProductionEnv();

const app = express();
const PORT = resolveListenPort();
app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(attachUser);
app.use("/api/gemini", requireAuth);
app.use("/api/v3", createAbdmRouter());
app.use("/v3", createAbdmRouter());
app.use("/api", createUsageBillingRouter());
app.use("/api", createApiRouter());
app.use("/meta", createMetaRouter());
app.post("/data-deletion-callback", (req, res, next) => {
  req.url = "/data-deletion";
  createMetaRouter()(req, res, next);
});
attachPublicPolicyHtml(app);

// Lazy Google GenAI initialization
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAIClient;
}

// ----------------------------------------------------
// Clinical Gemini AI Routes
// ----------------------------------------------------

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

    const tenantId = aiScribeTenantIdFromRequest(req);
    const blocked = blockedAiScribeResponse(tenantId);
    if (blocked) {
      return res.status(blocked.status).json(blocked.body);
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
        meterSuccessfulGeminiScribe({
          tenantId,
          durationMinutes: req.body?.durationMinutes,
          transcript,
          metadata: { source: "gemini-3.7-flash", endpoint: "generate-soap" },
        });
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

attachGeminiClinicalRest(app, getGenAI);
startLumeraServer(app, PORT).catch((err) => {
  console.error("[Lumera] Server failed to start:", err);
  process.exit(1);
});
