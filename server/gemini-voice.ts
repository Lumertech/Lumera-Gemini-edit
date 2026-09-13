import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";

export function mountGeminiVoiceRoutes(app: Express, getGenAI: () => GoogleGenAI | null) {
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
        formattedWhatsAppMessage: `\u092a\u094d\u0930\u093f\u092f \u092e\u0930\u0940\u091c, \u0906\u092a\u0915\u0947 \u0921\u0949\u0915\u094d\u091f\u0930 \u0926\u094d\u0935\u093e\u0930\u093e \u0926\u0940 \u0917\u0908 \u0938\u0932\u093e\u0939:\n${advice.join('\n\u2022 ')}\n\u0915\u0943\u092a\u092f\u093e \u0926\u0935\u093e\u0907\u092f\u093e\u0902 \u0938\u092e\u092f \u092a\u0930 \u0932\u0947\u0902\u0964`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
