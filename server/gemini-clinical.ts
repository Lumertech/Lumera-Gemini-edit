import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-fallbacks.ts";

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

      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `You are Lumera AI, an expert Clinical AI Medical Scribe. Generate a structured SOAP note.\nPATIENT: ${patientName} ${patientAge} / ${patientGender}, Doctor ${doctorName} (${doctorSpecialty}).\nTRANSCRIPT:\n${transcript}\nReturn JSON SOAP with subjective, objective, assessment, plan.`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.2 },
          });
          const text = response.text?.trim() || "";
          const parsed = JSON.parse(text);
          return res.json({ success: true, soap: parsed, source: "gemini-3.7-flash" });
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
          const systemInstruction = `You are Pulse AI, an advanced enterprise clinical decision support copilot powered by Google Gemini.`;
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
          return res.json({ response: response.text, source: "Pulse AI (Google Gemini 3.8 Flash)" });
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

  app.post("/api/gemini/safety-check", async (req: Request, res: Response) => {
    try {
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
          return res.json(JSON.parse(response.text?.trim() || "{}"));
        } catch (err: any) {
          console.error("Safety check Gemini error:", err?.message);
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
      return res.json({ hasHighRiskAlert: alerts.some((a) => a.severity === "Severe" || a.severity === "Critical"), alerts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  mountGeminiVoiceRoutes(app, getGenAI);
}
