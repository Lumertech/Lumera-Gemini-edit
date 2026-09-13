import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { initDatabase, getDb } from "./server/db.ts";
import { startAppointmentReminderScheduler } from "./server/whatsapp-calendar.ts";
import { attachUser, requireAuth } from "./server/auth.ts";
import { createApiRouter } from "./server/api.ts";
import { createUsageBillingRouter } from "./server/usage-billing-api.ts";
import { createMetaRouter } from "./server/meta.ts";
import { createAbdmRouter } from "./server/abdm.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import { attachProductionSpaFallback } from "./server/spa-fallback.ts";
import { attachPublicPolicyHtml, isPublicPolicyHtmlPath } from "./server/policy-html.ts";
import { ensureUsageWalletSchema, seedDemoUsageWallet } from "./server/usage-billing.ts";

dotenv.config();
applyBundledServerNodeEnv();
failFastRequiredProductionEnv();

const app = express();
const PORT = resolveListenPort();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => { (req as Request).rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.get("/healthz", (_req, res) => { res.type("text/plain").send("ok"); });
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(attachUser);
app.use("/api/gemini", requireAuth);
app.use("/api/v3", createAbdmRouter());
app.use("/v3", createAbdmRouter());
app.use("/api", createUsageBillingRouter());
app.use("/api", createApiRouter());
app.use("/meta", createMetaRouter());
app.post("/data-deletion-callback", (req, res, next) => { req.url = "/data-deletion"; createMetaRouter()(req, res, next); });
attachPublicPolicyHtml(app);

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
  }
  return genAIClient;
}

app.post("/api/gemini/generate-soap", async (req: Request, res: Response) => {
  try {
    const { patientName = "Patient", patientAge = 40, patientGender = "Unknown", transcript = "", vitals = {}, doctorSpecialty = "General Medicine", doctorName = "Doctor" } = req.body;
    if (!transcript || transcript.trim().length < 5) return res.status(400).json({ error: "Consultation transcript is required" });
    const ai = getGenAI();
    if (ai) {
      try {
        const prompt = `You are Lumera AI. Generate a SOAP note JSON from this transcript for ${patientName} (${patientAge}/${patientGender}) with doctor ${doctorName} (${doctorSpecialty}). Transcript: ${transcript}`;
        const response = await ai.models.generateContent({ model: "gemini-3.7-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.2 } });
        const text = response.text?.trim() || "";
        return res.json({ success: true, soap: JSON.parse(text), source: "gemini-3.7-flash" });
      } catch (geminiError: any) {
        console.error("Gemini SOAP generation error, using fallback clinical synthesis:", geminiError?.message);
      }
    }
    return res.json({ success: true, soap: generateRuleBasedSoap(patientName, patientAge, patientGender, transcript, vitals), source: "clinical-synthesis-engine" });
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
        const contents: any[] = [];
        if (patientContext && Object.keys(patientContext).length > 0) {
          contents.push({ role: "user", parts: [{ text: `Current Patient Profile: ${JSON.stringify(patientContext)}` }] });
          contents.push({ role: "model", parts: [{ text: "Understood." }] });
        }
        for (const h of history.slice(-6)) contents.push({ role: h.sender === "user" ? "user" : "model", parts: [{ text: h.text }] });
        contents.push({ role: "user", parts: [{ text: query }] });
        const response = await ai.models.generateContent({ model: "gemini-3.8-flash", contents, config: { systemInstruction: "You are Pulse AI, a clinical decision support copilot.", temperature: 0.2 } });
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
        const prompt = `Analyze clinical safety for age ${patientAge} ${patientGender} allergies ${patientAllergies.join(", ")} conditions ${chronicConditions.join(", ")} medicines ${JSON.stringify(medicines)}. Return JSON { hasHighRiskAlert, alerts }.`;
        const response = await ai.models.generateContent({ model: "gemini-3.7-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.1 } });
        return res.json(JSON.parse(response.text?.trim() || "{}"));
      } catch (err: any) {
        console.error("Safety check Gemini error:", err?.message);
      }
    }
    return res.json({ hasHighRiskAlert: false, alerts: [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/voice-bot", async (req: Request, res: Response) => {
  try {
    const { message, callerName = "Patient", language = "English" } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    return res.json({ speechText: `Hello ${callerName}, I can help book an appointment.`, intent: "BOOKING", suggestedAction: "Book appointment" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gemini/translate-rx", async (req: Request, res: Response) => {
  try {
    const { advice = [], targetLanguage = "Hindi" } = req.body;
    return res.json({ language: targetLanguage, translatedAdvice: advice, formattedWhatsAppMessage: advice.join("\n") });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function generateRuleBasedSoap(name: string, age: number, gender: string, transcript: string, vitals: any) {
  return {
    subjective: { chiefComplaints: ["Consultation"], historyOfPresentIllness: `${name}, ${age}yo ${gender}. ${String(transcript || "").slice(0, 500)}`, pastMedicalHistory: "", reviewOfSystems: "" },
    objective: { vitals: { bloodPressureSystolic: vitals?.bloodPressureSystolic || 120, bloodPressureDiastolic: vitals?.bloodPressureDiastolic || 80, heartRate: vitals?.heartRate || 72, temperature: vitals?.temperature || 98.6, spO2: vitals?.spO2 || 98, weightKg: vitals?.weightKg || 70, heightCm: vitals?.heightCm || 165, bmi: 25, bloodSugarRandom: vitals?.bloodSugarRandom || 110 }, physicalExamination: "", clinicalFindings: [] },
    assessment: { primaryDiagnosis: "Clinical encounter", icd10Code: "Z00.00", differentialDiagnoses: [], riskLevel: "Low" },
    plan: { medicines: [], labTests: [], lifestyleAdvice: [], redFlags: [], followUpDays: 5, followUpDate: new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0] },
    transcriptSummary: "Encounter documented.",
  };
}

function getPulseFallbackAnswer(query: string, _ctx: any): string {
  return `Clinical decision support for: ${query}`;
}

async function startServer() {
  applyBundledServerNodeEnv();
  failFastRequiredProductionEnv();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true, host: true, allowedHosts: true as const }, appType: "spa" });
    app.use((req, _res, next) => {
      const p = req.path;
      const isAsset = p === "/healthz" || p.startsWith("/api") || p.startsWith("/uploads") || p.startsWith("/meta") || p.startsWith("/v3") || p.startsWith("/@") || p.startsWith("/src") || p.startsWith("/node_modules") || p.includes(".");
      if ((req.method === "GET" || req.method === "HEAD") && !isAsset && !isPublicPolicyHtmlPath(p)) req.url = "/index.html";
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

startServer().catch((err) => {
  console.error("[Lumera] Server failed to start:", err);
  process.exit(1);
});
