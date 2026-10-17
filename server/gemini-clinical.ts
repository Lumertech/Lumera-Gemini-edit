import type { Express, NextFunction, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "./auth.ts";
import { clinicalGeminiRateLimit, safetyCheckRateLimit } from "./gemini-clinical-rate-limit.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-fallbacks.ts";
import { aiScribeTenantIdFromRequest, blockedAiScribeResponse, meterSuccessfulGeminiScribe } from "./gemini-scribe-meter.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { denyUnlessPrescriber } from "./patient-access.ts";
import { rejectUntrustedTenantClaim } from "./tenant-guard.ts";

let testSoapGenerator: ((body: Record<string, unknown>) => Promise<unknown>) | undefined;
let testCopilotGenerator: (() => Promise<unknown>) | undefined;
let testSafetyCheckGenerator: (() => Promise<unknown>) | undefined;

/** Test-only Gemini mock so HTTP tests do not need live API keys. */
export function setGeminiSoapGeneratorForTests(
  fn?: ((body: Record<string, unknown>) => Promise<unknown>) | undefined
) {
  testSoapGenerator = fn;
}

/** Test-only copilot stand-in. It does not receive the prompt or patientContext. */
export function setGeminiCopilotGeneratorForTests(fn?: (() => Promise<unknown>) | undefined) {
  testCopilotGenerator = fn;
}

/** Test-only safety-check stand-in. It does not receive medicines or allergies. */
export function setGeminiSafetyCheckGeneratorForTests(fn?: (() => Promise<unknown>) | undefined) {
  testSafetyCheckGenerator = fn;
}

type GeminiSafetyBody = {
  safetyStatus: "HIGH_RISK" | "REVIEW";
  source: "gemini";
  hasHighRiskAlert: boolean;
  alerts: Record<string, unknown>[];
};

/** Gemini's raw { hasHighRiskAlert, alerts } shape. A bad payload is a failed check, not a pass. */
export function normalizeGeminiSafetyOutput(raw: unknown): { ok: true; body: GeminiSafetyBody } | { ok: false } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const record = raw as { hasHighRiskAlert?: unknown; alerts?: unknown };
  if ("hasHighRiskAlert" in record && typeof record.hasHighRiskAlert !== "boolean") return { ok: false };
  if (!Array.isArray(record.alerts)) return { ok: false };
  const alerts: Record<string, unknown>[] = [];
  for (const item of record.alerts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false };
    alerts.push(item as Record<string, unknown>);
  }
  const hasHighRiskAlert = record.hasHighRiskAlert === true;
  return {
    ok: true,
    body: {
      safetyStatus: hasHighRiskAlert ? "HIGH_RISK" : "REVIEW",
      source: "gemini",
      hasHighRiskAlert,
      alerts,
    },
  };
}

/** Prescriber or clinic clinical staff. Patient, reception, and super_admin are denied. */
function prescriberOnly(req: Request, res: Response, next: NextFunction): void {
  if (!denyUnlessPrescriber(req, res)) return;
  next();
}

/** Clinical Gemini HTTP routes. Split from server.ts so MCP can upload both files intact. */
export function mountGeminiClinicalRoutes(app: Express) {
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

  app.post(
    "/api/gemini/generate-soap",
    requireAuth,
    prescriberOnly,
    clinicalGeminiRateLimit,
    rejectUntrustedTenantClaim,
    async (req: Request, res: Response) => {
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

      if (testSoapGenerator) {
        const soap = await testSoapGenerator(req.body);
        meterSuccessfulGeminiScribe({
          tenantId,
          durationMinutes: req.body?.durationMinutes,
          transcript,
          metadata: { source: "gemini-3.7-flash", endpoint: "generate-soap" },
        });
        return res.json({ success: true, soap, source: "Pulse AI" });
      }

      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `You are Lumera AI, an expert Clinical AI Medical Scribe. Generate a structured SOAP note.\nPATIENT: ${patientName} ${patientAge} / ${patientGender}, Doctor ${doctorName} (${doctorSpecialty}).\nTRANSCRIPT:\n${transcript}\nReturn JSON SOAP with subjective, objective, assessment, plan.\n${AI_RUPEE_OUTPUT_RULE}`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.2 },
          });
          const text = response.text?.trim() || "";
          const parsed = JSON.parse(text);
          meterSuccessfulGeminiScribe({
            tenantId,
            durationMinutes: req.body?.durationMinutes,
            transcript,
            metadata: { source: "gemini-3.7-flash", endpoint: "generate-soap" },
          });
          return res.json({ success: true, soap: parsed, source: "Pulse AI" });
        } catch {
          console.error("SOAP model call failed");
        }
      }
      const fallbackSoap = generateRuleBasedSoap(patientName, patientAge, patientGender, transcript, vitals);
      return res.json({ success: true, soap: fallbackSoap, source: "clinical-synthesis-engine" });
    } catch {
      console.error("SOAP generation failed");
      res.status(500).json({ code: "soap_failed" });
    }
  });

  const handleGeminiCopilot = async (req: Request, res: Response) => {
    try {
      if (testCopilotGenerator) {
        return res.json(await testCopilotGenerator());
      }
      const { query, patientContext = {}, history = [] } = req.body;
      if (!query) return res.status(400).json({ error: "Query is required" });
      const ai = getGenAI();
      if (ai) {
        try {
          const systemInstruction = `You are Pulse AI, an advanced enterprise clinical decision support copilot.\n${AI_RUPEE_OUTPUT_RULE}`;
          const contents: any[] = [];
          if (patientContext && Object.keys(patientContext).length > 0) {
            contents.push({ role: "user", parts: [{ text: `Current Patient Profile: ${JSON.stringify(patientContext)}` }] });
            contents.push({ role: "model", parts: [{ text: "Understood." }] });
          }
          for (const h of history.slice(-6)) {
            contents.push({ role: h.sender === "user" ? "user" : "model", parts: [{ text: h.text }] });
          }
          contents.push({ role: "user", parts: [{ text: query }] });
          const response = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents,
            config: { systemInstruction, temperature: 0.2 },
          });
          return res.json({ response: response.text, source: "Pulse AI" });
        } catch {
          console.error("Pulse copilot model call failed");
        }
      }
      return res.json({ response: getPulseFallbackAnswer(query, patientContext), source: "Pulse AI Knowledge Base (Offline Fallback)" });
    } catch {
      console.error("Pulse copilot failed");
      res.status(500).json({ code: "copilot_failed" });
    }
  };

  app.post(
    "/api/gemini/copilot",
    requireAuth,
    prescriberOnly,
    clinicalGeminiRateLimit,
    rejectUntrustedTenantClaim,
    handleGeminiCopilot
  );
  app.post(
    "/api/gemini/pulse-assistant",
    requireAuth,
    prescriberOnly,
    clinicalGeminiRateLimit,
    rejectUntrustedTenantClaim,
    handleGeminiCopilot
  );
  app.post(
    "/api/gemini/hexa-assistant",
    requireAuth,
    prescriberOnly,
    clinicalGeminiRateLimit,
    rejectUntrustedTenantClaim,
    handleGeminiCopilot
  );

  app.post("/api/gemini/safety-check", requireAuth, prescriberOnly, safetyCheckRateLimit, rejectUntrustedTenantClaim, async (req: Request, res: Response) => {
    try {
      if (testSafetyCheckGenerator) {
        const normalized = normalizeGeminiSafetyOutput(await testSafetyCheckGenerator());
        if (!normalized.ok) {
          console.error("Safety check model output was malformed");
          return res.status(500).json({ code: "safety_check_failed" });
        }
        return res.json(normalized.body);
      }
      const { patientAllergies = [], chronicConditions = [], medicines = [], patientAge, patientGender } = req.body;
      const ai = getGenAI();
      if (ai && medicines.length > 0) {
        try {
          const prompt = `Analyze clinical safety for Age ${patientAge || 40}, ${patientGender || "Adult"}, Allergies: ${(patientAllergies || []).join(", ") || "None"}, Conditions: ${(chronicConditions || []).join(", ") || "None"}, Medicines: ${JSON.stringify(medicines)}. Return JSON { hasHighRiskAlert, alerts }.`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.1 },
          });
          let parsed: unknown;
          try {
            parsed = JSON.parse(response.text?.trim() || "");
          } catch {
            console.error("Safety check model output was not JSON");
            return res.status(500).json({ code: "safety_check_failed" });
          }
          const normalized = normalizeGeminiSafetyOutput(parsed);
          if (!normalized.ok) {
            console.error("Safety check model output was malformed");
            return res.status(500).json({ code: "safety_check_failed" });
          }
          return res.json(normalized.body);
        } catch {
          console.error("Safety check model call failed");
        }
      }
      const alerts: any[] = [];
      const drugNames = medicines.map((m: any) => (m.drugName + " " + (m.composition || "")).toLowerCase());
      for (const allergy of patientAllergies) {
        const allgLower = String(allergy).toLowerCase();
        if (allgLower.includes("penicillin") && drugNames.some((d: string) => d.includes("amoxicillin") || d.includes("augmentin") || d.includes("ampicillin"))) {
          alerts.push({ type: "ALLERGY", severity: "Severe", drugsInvolved: ["Amoxicillin/Clavulanate"], description: "Patient is allergic to Penicillin.", clinicalRecommendation: "Switch to a Macrolide." });
        }
      }
      const highRisk = alerts.some((a) => a.severity === "Severe" || a.severity === "Critical");
      return res.json({
        safetyStatus: highRisk ? "HIGH_RISK" : "REVIEW",
        source: "rule-based fallback",
        hasHighRiskAlert: highRisk,
        alerts,
      });
    } catch {
      console.error("Safety check failed");
      res.status(500).json({ code: "safety_check_failed" });
    }
  });
  app.post("/api/gemini/transcribe", requireAuth, async (req: Request, res: Response) => {
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) {
      return res.status(400).json({ error: "No tenant associated with this account." });
    }
    try {
      const { audioBase64, mimeType = "audio/webm" } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }
      const ai = getGenAI();
      if (!ai) {
        return res.status(503).json({ error: "Gemini AI API key not configured" });
      }
      const cleanBase64 = audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, "");
      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: [
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
          {
            text: "Transcribe this medical consultation audio accurately. Return the verbatim transcript in the spoken language (English, Hindi, Hinglish, Marathi, Tamil, Telugu, etc.).",
          },
        ],
      });
      const transcription = response.text?.trim() || "";
      return res.json({ success: true, transcription });
    } catch (err: any) {
      console.error("Gemini 3.5 transcribe error:", err?.message);
      return res.status(500).json({ error: err.message || "Transcription failed" });
    }
  });

  mountGeminiVoiceRoutes(app, getGenAI);
}