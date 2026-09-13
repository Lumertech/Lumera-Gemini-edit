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
import { ensureUsageWalletSchema, seedDemoUsageWallet } from "./server/usage-billing.ts";
import { aiScribeTenantIdFromRequest, blockedAiScribeResponse, meterSuccessfulGeminiScribe } from "./server/gemini-scribe-meter.ts";
import { createAbdmRouter } from "./server/abdm.ts";
import { applyBundledServerNodeEnv, failFastRequiredProductionEnv, resolveListenPort } from "./server/runtime.ts";
import { attachProductionSpaFallback } from "./server/spa-fallback.ts";
import { attachPublicPolicyHtml, isPublicPolicyHtmlPath } from "./server/policy-html.ts";

dotenv.config();
applyBundledServerNodeEnv();
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

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
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

    const ai = getGenAI();
    if (ai) {
      try {
        const prompt = `You are Lumera AI, an expert Clinical AI Medical Scribe. Generate a SOAP note JSON from this transcript.\nPATIENT: ${patientName} ${patientAge}/${patientGender}. Doctor: ${doctorName} (${doctorSpecialty}). Transcript: ${transcript}`;
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
