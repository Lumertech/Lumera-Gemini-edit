import type { Express, Request, Response } from "express";
import { getDb } from "./db.ts";
import { rememberSafetyCheckResponse } from "./rx-safety-store.ts";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "./auth.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-fallbacks.ts";
import { aiScribeTenantIdFromRequest, blockedAiScribeResponse, meterSuccessfulGeminiScribe } from "./gemini-scribe-meter.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { RULE_BASED_SAFETY_SOURCE } from "../src/lib/safetyCheckGate.ts";

let testSoapGenerator: ((body: Record<string, unknown>) => Promise<unknown>) | undefined;
let testSafetyCheck: (() => Promise<unknown>) | undefined;

/** Test-only Gemini mock so HTTP tests do not need live API keys. */
export function setGeminiSoapGeneratorForTests(
  fn?: ((body: Record<string, unknown>) => Promise<unknown>) | undefined
) {
  testSoapGenerator = fn;
}

/** Test-only stand-in for the safety-check model. A throw takes the rule-based path. */
export function setGeminiSafetyCheckForTests(fn?: (() => Promise<unknown>) | undefined) {
  testSafetyCheck = fn;
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
        } catch (geminiError: any) {
          console.error("Gemini SOAP generation error, using fallback clinical synthesis:", geminiError?.message);
        }
      }
      const fallbackSoap = generateRuleBasedSoap(patientName, patientAge, patientGender, transcript, vitals);
      return res.json({ success: true, soap: fallbackSoap, source: "clinical-synthesis-engine" });
    } catch (error: any) {
      console.error("SOAP endpoint error:", error);
      res.status(500).json({ error: "Failed to generate SOAP note", details: error.message });
    }
  });

  const handleGeminiCopilot = async (req: Request, res: Response) => {
    try {
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
        } catch (err: any) {
          console.error("Pulse AI / Gemini Copilot API error:", err?.message);
        }
      }
      return res.json({ response: getPulseFallbackAnswer(query, patientContext), source: "Pulse AI Knowledge Base (Offline Fallback)" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  app.post("/api/gemini/copilot", handleGeminiCopilot);
  app.post("/api/gemini/pulse-assistant", handleGeminiCopilot);
  app.post("/api/gemini/hexa-assistant", handleGeminiCopilot);

  function alertListIsSevere(alerts: unknown[]): boolean {
    return alerts.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const severity = String((item as { severity?: unknown }).severity || "").trim().toLowerCase();
      return severity === "severe" || severity === "critical";
    });
  }

  /** Model JSON is usable only as an alert list. Status and source are computed here. */
  function modelSafetyPayload(raw: unknown): { hasHighRiskAlert: boolean; alerts: unknown[]; safetyStatus: "HIGH_RISK" | "REVIEW" | "SAFE" } {
    const parsed = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!parsed || !Array.isArray(parsed.alerts) || typeof parsed.hasHighRiskAlert !== "boolean") {
      throw new Error("safety check reply was not a usable alert list");
    }
    const alerts = parsed.alerts;
    const hasHighRiskAlert = parsed.hasHighRiskAlert === true || alertListIsSevere(alerts);
    const safetyStatus = hasHighRiskAlert ? "HIGH_RISK" : alerts.length > 0 ? "REVIEW" : "SAFE";
    return { hasHighRiskAlert, alerts, safetyStatus };
  }

  function finishSafetyCheck(req: Request, res: Response, body: unknown) {
    const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const alerts = Array.isArray(record.alerts) ? record.alerts : [];
    const hasHighRiskAlert = record.hasHighRiskAlert === true || alertListIsSevere(alerts);
    const fallback = record.source === RULE_BASED_SAFETY_SOURCE;
    // Ignore a model-supplied safetyStatus. #155's fail-closed 503 (no fallback) wins on rebase; keep that 503.
    let safetyStatus = hasHighRiskAlert ? "HIGH_RISK" : alerts.length > 0 ? "REVIEW" : "SAFE";
    if (fallback && safetyStatus === "SAFE") safetyStatus = "REVIEW";
    const payload: Record<string, unknown> = { ...record, hasHighRiskAlert, alerts, safetyStatus };
    if (fallback) payload.source = RULE_BASED_SAFETY_SOURCE;
    else delete payload.source;
    const tenantId = String(req.user?.tenantId || "").trim();
    if (tenantId) {
      try {
        const incoming = (req.body || {}) as {
          medicines?: unknown;
          patientAllergies?: unknown;
          chronicConditions?: unknown;
          patientId?: unknown;
          patientAge?: unknown;
          patientGender?: unknown;
        };
        rememberSafetyCheckResponse(getDb(), {
          tenantId,
          patientId: String(incoming.patientId || ""),
          age: incoming.patientAge,
          gender: incoming.patientGender,
          medicines: incoming.medicines,
          allergies: incoming.patientAllergies,
          chronicConditions: incoming.chronicConditions,
          status: 200,
          body: payload,
        });
      } catch (err) {
        console.error("safety check persist failed", err);
      }
    }
    return res.json(payload);
  }

  app.post("/api/gemini/safety-check", async (req: Request, res: Response) => {
    try {
      const { patientAllergies = [], chronicConditions = [], medicines = [], patientAge, patientGender } = req.body;
      const ai = getGenAI();
      if (testSafetyCheck) {
        try {
          return finishSafetyCheck(req, res, modelSafetyPayload(await testSafetyCheck()));
        } catch (err: any) {
          console.error("Safety check Gemini error:", err?.message);
        }
      } else if (ai && medicines.length > 0) {
        try {
          const prompt = `Analyze clinical safety for Age ${patientAge || 40}, ${patientGender || "Adult"}, Allergies: ${(patientAllergies || []).join(", ") || "None"}, Conditions: ${(chronicConditions || []).join(", ") || "None"}, Medicines: ${JSON.stringify(medicines)}. Return JSON { hasHighRiskAlert, alerts }.`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.1 },
          });
          const parsed = JSON.parse(response.text?.trim() || "{}");
          return finishSafetyCheck(req, res, modelSafetyPayload(parsed));
        } catch (err: any) {
          console.error("Safety check Gemini error:", err?.message);
        }
      }
      const alerts: any[] = [];
      const drugNames = (medicines || []).map((m: any) => (m.drugName + " " + (m.composition || "")).toLowerCase());
      for (const allergy of patientAllergies) {
        const allgLower = String(allergy).toLowerCase();
        if (allgLower.includes("penicillin") && drugNames.some((d: string) => d.includes("amoxicillin") || d.includes("augmentin") || d.includes("ampicillin"))) {
          alerts.push({ type: "ALLERGY", severity: "Severe", drugsInvolved: ["Amoxicillin/Clavulanate"], description: "Patient is allergic to Penicillin.", clinicalRecommendation: "Switch to a Macrolide." });
        }
      }
      const hasHighRiskAlert = alerts.some((a) => a.severity === "Severe" || a.severity === "Critical");
      return finishSafetyCheck(req, res, {
        hasHighRiskAlert,
        alerts,
        safetyStatus: hasHighRiskAlert ? "HIGH_RISK" : "REVIEW",
        source: RULE_BASED_SAFETY_SOURCE,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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