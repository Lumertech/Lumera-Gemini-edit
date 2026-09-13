import type { Express, Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import type { GoogleGenAI } from "@google/genai";
import { initDatabase, getDb } from "./db.ts";
import { startAppointmentReminderScheduler } from "./whatsapp-calendar.ts";
import { ensureUsageWalletSchema, seedDemoUsageWallet } from "./usage-billing.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv } from "./runtime.ts";
import { attachProductionSpaFallback } from "./spa-fallback.ts";
import { isPublicPolicyHtmlPath } from "./policy-html.ts";
import { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-clinical-helpers.ts";

export { generateRuleBasedSoap, getPulseFallbackAnswer } from "./gemini-clinical-helpers.ts";

export function attachGeminiClinicalRest(app: Express, getGenAI: () => GoogleGenAI | null) {
  const handleGeminiCopilot = async (req: Request, res: Response) => {
    try {
      const { query, patientContext = {}, history = [] } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      const ai = getGenAI();
      if (ai) {
        try {
          const systemInstruction = `You are Pulse AI, an advanced enterprise clinical decision support copilot powered by Google Gemini. Provide evidence-based, concise, physician-to-physician clinical decision support.`;
          const contents: any[] = [];
          if (patientContext && Object.keys(patientContext).length > 0) {
            contents.push({ role: "user", parts: [{ text: `Current Patient Profile: ${JSON.stringify(patientContext)}` }] });
            contents.push({ role: "model", parts: [{ text: "Understood. Tailoring clinical recommendations to this patient's profile." }] });
          }
          for (const h of history.slice(-6)) {
            contents.push({ role: h.sender === "user" ? "user" : "model", parts: [{ text: h.text }] });
          }
          contents.push({ role: "user", parts: [{ text: query }] });
          const response = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: contents,
            config: { systemInstruction: systemInstruction, temperature: 0.2 },
          });
          return res.json({ response: response.text, source: "Pulse AI (Google Gemini 3.8 Flash)" });
        } catch (err: any) {
          console.error("Pulse AI / Gemini Copilot API error:", err?.message);
        }
      }
      const fallbackAnswer = getPulseFallbackAnswer(query, patientContext);
      return res.json({ response: fallbackAnswer, source: "Pulse AI Knowledge Base (Offline Fallback)" });
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
          const prompt = `Analyze clinical safety and drug interactions for this prescription: PATIENT Age ${patientAge || 40}, Allergies: ${patientAllergies.join(", ") || "None"}, Medicines: ${JSON.stringify(medicines)}. Return JSON { hasHighRiskAlert: boolean, alerts: [] }.`;
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
          alerts.push({ type: "ALLERGY", severity: "Severe", drugsInvolved: ["Amoxicillin/Clavulanate"], description: "Patient is allergic to Penicillin.", clinicalRecommendation: "Switch to Macrolide." });
        }
      }
      return res.json({ hasHighRiskAlert: alerts.some((a) => a.severity === "Severe" || a.severity === "Critical"), alerts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gemini/voice-bot", async (req: Request, res: Response) => {
    try {
      const { message, callerName = "Patient", language = "English" } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `You are Maya, the voice assistant for Lumera Polyclinic speaking with ${callerName} in ${language}. Reply in JSON { speechText, intent, suggestedAction }. Patient says: ${message}`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: [{ parts: [{ text: `Patient says: "${message}"` }] }],
            config: { systemInstruction: prompt, responseMimeType: "application/json", temperature: 0.3 },
          });
          return res.json(JSON.parse(response.text?.trim() || "{}"));
        } catch (err) {
          console.error("Voice bot Gemini error:", err);
        }
      }
      return res.json({
        speechText: `Hello ${callerName}, I can help book you an appointment with Dr. Vikram Malhotra tomorrow at 10:30 AM.`,
        intent: "BOOKING",
        suggestedAction: "Book appointment with Dr. Malhotra at 10:30 AM",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gemini/translate-rx", async (req: Request, res: Response) => {
    try {
      const { advice = [], medicines = [], targetLanguage = "Hindi" } = req.body;
      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `Translate prescription advice into ${targetLanguage}. Medicines: ${JSON.stringify(medicines)}. Advice: ${advice.join("; ")}. Return JSON { language, translatedAdvice, formattedWhatsAppMessage }.`;
          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.2 },
          });
          return res.json(JSON.parse(response.text?.trim() || "{}"));
        } catch (err) {
          console.error("Translate Rx error:", err);
        }
      }
      return res.json({ language: targetLanguage, translatedAdvice: advice, formattedWhatsAppMessage: advice.join("\n") });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

export async function startLumeraServer(app: Express, PORT: number) {
  applyBundledServerNodeEnv();
  failFastRequiredProductionEnv();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: true, allowedHosts: true as const },
      appType: "spa",
    });
    app.use((req, _res, next) => {
      const p = req.path;
      const isAsset =
        p === "/healthz" ||
        p.startsWith("/api") ||
        p.startsWith("/uploads") ||
        p.startsWith("/meta") ||
        p.startsWith("/v3") ||
        p.startsWith("/@") ||
        p.startsWith("/src") ||
        p.startsWith("/node_modules") ||
        p.includes(".");
      if ((req.method === "GET" || req.method === "HEAD") && !isAsset && !isPublicPolicyHtmlPath(p)) {
        req.url = "/index.html";
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    attachProductionSpaFallback(app);
  }
  const envPort = String(process.env.PORT || "").trim();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Lumera] listening on 0.0.0.0:${PORT} (env PORT=${envPort || "(unset → default 3000)"})`);
      resolve();
    });
    server.once("error", reject);
  });
  initDatabase();
  ensureUsageWalletSchema(getDb());
  seedDemoUsageWallet(getDb());
  startAppointmentReminderScheduler();
}
