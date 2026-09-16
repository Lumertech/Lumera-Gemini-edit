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

  // 3. Clinical Safety & Drug Interaction Checker
  app.post("/api/gemini/safety-check", async (req: Request, res: Response) => {
    try {
      const { patientAllergies = [], chronicConditions = [], medicines = [], patientAge, patientGender } = req.body;

      const ai = getGenAI();
      if (ai && medicines.length > 0) {
        try {
          const prompt = `Analyze clinical safety and drug interactions for this prescription:
  PATIENT: Age ${patientAge || 40}, Gender ${patientGender || 'Adult'}, Allergies: ${patientAllergies.join(', ') || 'None reported'}, Chronic Conditions: ${chronicConditions.join(', ') || 'None'}
  MEDICINES:
  ${medicines.map((m: any, i: number) => `${i + 1}. ${m.drugName} (${m.composition || ''}) - Dose: ${m.dosage || ''}, Frequency: ${m.frequency || ''}`).join('\n')}

  Check for:
  1. Severe & moderate Drug-Drug Interactions
  2. Drug-Allergy cross-reactivity
  3. Drug-Disease contraindications (e.g. NSAIDs in CKD/Ulcers, Beta-blockers in Asthma)
  4. Dosage warnings or duplication

  Return JSON with format:
  {
    "hasHighRiskAlert": boolean,
    "alerts": [
      {
        "type": "INTERACTION" | "ALLERGY" | "CONTRAINDICATION" | "DOSAGE_WARNING" | "PREGNANCY_LACTATION",
        "severity": "Mild" | "Moderate" | "Severe" | "Critical",
        "drugsInvolved": ["Drug 1", "Drug 2"],
        "description": "Clear medical summary of the risk",
        "clinicalRecommendation": "Alternative drug or dosing advice"
      }
    ]
  }`;

          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.1,
            },
          });

          const parsed = JSON.parse(response.text?.trim() || "{}");
          return res.json(parsed);
        } catch (err: any) {
          console.error("Safety check Gemini error:", err?.message);
        }
      }

      // Rule-based safety validator
      const alerts: any[] = [];
      const drugNames = medicines.map((m: any) => (m.drugName + ' ' + (m.composition || '')).toLowerCase());
    
      // Check allergy
      for (const allergy of patientAllergies) {
        const allgLower = allergy.toLowerCase();
        if (allgLower.includes('penicillin') && drugNames.some((d: string) => d.includes('amoxicillin') || d.includes('augmentin') || d.includes('ampicillin'))) {
          alerts.push({
            type: 'ALLERGY',
            severity: 'Severe',
            drugsInvolved: ['Amoxicillin/Clavulanate'],
            description: `Patient is allergic to Penicillin. Beta-lactam antibiotic prescribed poses risk of anaphylaxis/angioedema.`,
            clinicalRecommendation: 'Switch to Macrolide (Azithromycin) or Fluoroquinolone / Cefpodoxime with caution.'
          });
        }
        if (allgLower.includes('aspirin') || allgLower.includes('nsaid')) {
          if (drugNames.some((d: string) => d.includes('ibuprofen') || d.includes('combiflam') || d.includes('aceclofenac') || d.includes('diclofenac'))) {
            alerts.push({
              type: 'ALLERGY',
              severity: 'Severe',
              drugsInvolved: ['NSAID Analgesic'],
              description: `Patient has documented NSAID hypersensitivity. Risk of bronchospasm / urticaria.`,
              clinicalRecommendation: 'Use plain Paracetamol or Tramadol instead.'
            });
          }
        }
      }

      // Check drug-drug interactions
      const hasNsaid = drugNames.some((d: string) => d.includes('aceclofenac') || d.includes('ibuprofen') || d.includes('combiflam'));
      const hasTelmisartan = drugNames.some((d: string) => d.includes('telmisartan') || d.includes('losartan'));
      if (hasNsaid && hasTelmisartan) {
        alerts.push({
          type: 'INTERACTION',
          severity: 'Moderate',
          drugsInvolved: ['NSAID', 'Telmisartan'],
          description: 'Concurrent NSAID use may blunt the antihypertensive effect of ARB and elevate renal compromise risk.',
          clinicalRecommendation: 'Limit NSAID duration to <3-5 days and monitor renal function / BP.'
        });
      }

      const hasClopidogrel = drugNames.some((d: string) => d.includes('clopidogrel'));
      const hasOmeprazole = drugNames.some((d: string) => d.includes('omeprazole'));
      if (hasClopidogrel && hasOmeprazole) {
        alerts.push({
          type: 'INTERACTION',
          severity: 'Moderate',
          drugsInvolved: ['Clopidogrel', 'Omeprazole'],
          description: 'Omeprazole inhibits CYP2C19, reducing the antiplatelet activation of Clopidogrel.',
          clinicalRecommendation: 'Switch PPI to Pantoprazole or Rabeprazole.'
        });
      }

      return res.json({
        hasHighRiskAlert: alerts.some((a) => a.severity === 'Severe' || a.severity === 'Critical'),
        alerts: alerts
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4. Voice Bot & Triage Simulator
  app.post("/api/gemini/voice-bot", async (req: Request, res: Response) => {
    try {
      const { message, callerName = "Patient", language = "English" } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });

      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `You are Maya, the voice assistant for Lumera Polyclinic.
  You are speaking over the phone with a patient named ${callerName} in ${language}.
  Provide a brief, comforting, conversational response (1-2 sentences max, spoken tone).
  Identify if they want:
  1. Appointment booking (suggest available slot e.g., Tomorrow at 10:30 AM with Dr. Malhotra)
  2. Prescription refill
  3. Emergency escalation (direct to Emergency Room / Call 108)
  4. General inquiry

  Output JSON:
  {
    "speechText": "Natural conversational voice response",
    "intent": "BOOKING" | "REFILL" | "EMERGENCY" | "INQUIRY",
    "suggestedAction": "e.g. Scheduled token #4 for Tomorrow 10:30 AM"
  }`;

          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: [{ parts: [{ text: `Patient says: "${message}"` }] }],
            config: {
              systemInstruction: prompt,
              responseMimeType: "application/json",
              temperature: 0.3,
            },
          });

          const parsed = JSON.parse(response.text?.trim() || "{}");
          return res.json(parsed);
        } catch (err) {
          console.error("Voice bot Gemini error:", err);
        }
      }

      // Fallback response
      return res.json({
        speechText: `Hello ${callerName}, I understand. I can help book you an appointment with Dr. Vikram Malhotra in General Medicine for tomorrow at 10:30 AM. Would you like me to confirm this token?`,
        intent: "BOOKING",
        suggestedAction: "Book appointment with Dr. Malhotra at 10:30 AM"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 5. Multi-Language Rx Advice Translation
  app.post("/api/gemini/translate-rx", async (req: Request, res: Response) => {
    try {
      const { advice = [], medicines = [], targetLanguage = "Hindi" } = req.body;

      const ai = getGenAI();
      if (ai) {
        try {
          const prompt = `Translate the following medical prescription advice and medicine timing instructions into natural, easily understandable ${targetLanguage} for a patient to read on WhatsApp.

  Medicines:
  ${medicines.map((m: any) => `${m.drugName}: ${m.frequency} (${m.timing}) for ${m.durationDays} days. Note: ${m.instructions || ''}`).join('\n')}

  Advice:
  ${advice.join('\n')}

  Return JSON:
  {
    "language": "${targetLanguage}",
    "translatedMeds": [
      { "drugName": "string", "instructions": "translated instructions in ${targetLanguage}" }
    ],
    "translatedAdvice": ["advice item in ${targetLanguage}"],
    "formattedWhatsAppMessage": "Complete friendly WhatsApp message formatted in ${targetLanguage}"
  }`;

          const response = await ai.models.generateContent({
            model: "gemini-3.7-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          return res.json(JSON.parse(response.text?.trim() || "{}"));
        } catch (err) {
          console.error("Translate Rx error:", err);
        }
      }

      return res.json({
        language: targetLanguage,
        translatedAdvice: advice,
        formattedWhatsAppMessage: `प्रिय मरीज, आपके डॉक्टर द्वारा दी गई सलाह:\n${advice.join('\n• ')}\nकृपया दवाइयां समय पर लें।`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}

// ----------------------------------------------------
// Start Server with Vite Middleware
// ----------------------------------------------------
export async function startLumeraServer(app: Express, PORT: number) {
  applyBundledServerNodeEnv();
  failFastRequiredProductionEnv();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: true,
        allowedHosts: true as const,
      },
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
      console.log(
        `[Lumera] listening on 0.0.0.0:${PORT} (env PORT=${envPort || "(unset → default 3000)"})`
      );
      resolve();
    });
    server.once("error", reject);
  });

  // Heavy work after the Cloud Run socket is open. /healthz is already registered.
  initDatabase();
  ensureUsageWalletSchema(getDb());
  seedDemoUsageWallet(getDb());
  startAppointmentReminderScheduler();
}
