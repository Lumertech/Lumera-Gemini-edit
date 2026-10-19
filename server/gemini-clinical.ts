import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth.ts";
import { hasAmbientScribeConsent, mountAmbientScribeConsentRoutes, transcribeAppointmentId } from "./ambient-scribe-consent.ts";
import { maxTranscribeBase64Chars, transcribeJsonParser } from "./json-body.ts";
import { denyUnlessPrescriber } from "./patient-access.ts";
import { rejectUntrustedTenantClaim } from "./tenant-guard.ts";
import { transcribeRateLimit } from "./transcribe-rate-limit.ts";
import { base64DecodedBytes, canonicalTranscribeMime, resolveTranscribeDurationMs, transcribeDurationTooLong } from "./transcribe-policy.ts";
import { mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { aiScribeTenantIdFromRequest, blockedAiScribeResponse, meterSuccessfulGeminiScribe, meterSuccessfulTranscription } from "./gemini-scribe-meter.ts";
import {
  AI_TRANSCRIPTION_NOT_CONFIGURED,
  AI_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
  getVertexClient,
  VERTEX_GEMINI_MODEL,
} from "./vertex-gemini.ts";
import type { NextFunction } from "express";

let testSoapGenerator: ((body: Record<string, unknown>) => Promise<unknown>) | undefined;
let testTranscribeGenerator: (() => Promise<string>) | undefined;

/** Test-only Gemini mock so HTTP tests do not need live API keys. */
export function setGeminiSoapGeneratorForTests(
  fn?: ((body: Record<string, unknown>) => Promise<unknown>) | undefined
) {
  testSoapGenerator = fn;
}

/** Test-only transcription stand-in. It does not receive audio or a transcript. */
export function setGeminiTranscribeGeneratorForTests(fn?: (() => Promise<string>) | undefined) {
  testTranscribeGenerator = fn;
}

function prescriberOnly(req: Request, res: Response, next: NextFunction): void {
  if (!denyUnlessPrescriber(req, res)) return;
  next();
}

function errorName(err: unknown): string {
  return err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "Error";
}

/** Clinical Gemini HTTP routes. PHI calls use Vertex AI in asia-south1. There is no API-key fallback. */
export function mountGeminiClinicalRoutes(app: Express) {
  // DATA USE: patient audio, transcripts, and clinical text go through Vertex AI (asia-south1). No API key.

  app.post("/api/gemini/generate-soap", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        patientName = "Patient",
        patientAge = 40,
        patientGender = "Unknown",
        transcript = "",
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
          metadata: { source: VERTEX_GEMINI_MODEL, endpoint: "generate-soap" },
        });
        return res.json({ success: true, soap, source: "Pulse AI" });
      }

      const ai = getVertexClient();
      if (!ai) {
        return res.status(503).json({ code: "AI_SOAP_NOT_CONFIGURED", message: "AI note generation not configured" });
      }
      try {
        const prompt = `You are Lumera AI, an expert Clinical AI Medical Scribe. Generate a structured SOAP note.\nPATIENT: ${patientName} ${patientAge} / ${patientGender}, Doctor ${doctorName} (${doctorSpecialty}).\nTRANSCRIPT:\n${transcript}\nReturn JSON SOAP with subjective, objective, assessment, plan.\n${AI_RUPEE_OUTPUT_RULE}`;
        const response = await ai.models.generateContent({
          model: VERTEX_GEMINI_MODEL,
          contents: prompt,
          config: { responseMimeType: "application/json", temperature: 0.2 },
        });
        const text = response.text?.trim() || "";
        const parsed = JSON.parse(text);
        meterSuccessfulGeminiScribe({
          tenantId,
          durationMinutes: req.body?.durationMinutes,
          transcript,
          metadata: { source: VERTEX_GEMINI_MODEL, endpoint: "generate-soap" },
        });
        return res.json({ success: true, soap: parsed, source: "Pulse AI" });
      } catch (geminiError: unknown) {
        console.error("SOAP generation error", errorName(geminiError));
        return res.status(500).json({ error: "Could not generate the note", code: "soap_failed" });
      }
    } catch {
      console.error("SOAP endpoint error");
      res.status(500).json({ error: "Could not generate the note", code: "soap_failed" });
    }
  });

  const handleGeminiCopilot = async (req: Request, res: Response) => {
    try {
      const { query, patientContext = {}, history = [] } = req.body;
      if (!query) return res.status(400).json({ error: "Query is required" });
      const ai = getVertexClient();
      if (!ai) {
        return res.status(503).json({ code: "AI_COPILOT_NOT_CONFIGURED", message: "AI assistant not configured" });
      }
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
          model: VERTEX_GEMINI_MODEL,
          contents,
          config: { systemInstruction, temperature: 0.2 },
        });
        return res.json({ response: response.text, source: "Pulse AI" });
      } catch (err: unknown) {
        console.error("Copilot generation error", errorName(err));
        return res.status(503).json({ code: "AI_COPILOT_NOT_CONFIGURED", message: "AI assistant not configured" });
      }
    } catch {
      res.status(500).json({ error: "Could not answer", code: "AI_COPILOT_NOT_CONFIGURED" });
    }
  };

  app.post("/api/gemini/copilot", handleGeminiCopilot);
  app.post("/api/gemini/pulse-assistant", handleGeminiCopilot);
  app.post("/api/gemini/hexa-assistant", handleGeminiCopilot);

  app.post("/api/gemini/safety-check", async (req: Request, res: Response) => {
    try {
      const { patientAllergies = [], chronicConditions = [], medicines = [], patientAge, patientGender } = req.body;
      if (!Array.isArray(medicines) || medicines.length === 0) {
        return res.json({ hasHighRiskAlert: false, alerts: [] });
      }
      const ai = getVertexClient();
      if (!ai) {
        return res.status(503).json({ code: "AI_SAFETY_NOT_CONFIGURED", message: "AI safety check not configured" });
      }
      try {
        const prompt = `Analyze clinical safety for Age ${patientAge || 40}, ${patientGender || "Adult"}, Allergies: ${(patientAllergies || []).join(", ") || "None"}, Conditions: ${(chronicConditions || []).join(", ") || "None"}, Medicines: ${JSON.stringify(medicines)}. Return JSON { hasHighRiskAlert, alerts }.`;
        const response = await ai.models.generateContent({
          model: VERTEX_GEMINI_MODEL,
          contents: prompt,
          config: { responseMimeType: "application/json", temperature: 0.1 },
        });
        return res.json(JSON.parse(response.text?.trim() || "{}"));
      } catch (err: unknown) {
        console.error("Safety check error", errorName(err));
        return res.status(503).json({ code: "AI_SAFETY_NOT_CONFIGURED", message: "AI safety check not configured" });
      }
    } catch {
      res.status(500).json({ error: "Could not check safety", code: "AI_SAFETY_NOT_CONFIGURED" });
    }
  });
  app.post(
    "/api/gemini/transcribe",
    requireAuth,
    prescriberOnly,
    transcribeRateLimit,
    transcribeJsonParser(),
    rejectUntrustedTenantClaim,
    async (req: Request, res: Response) => {
      const tenantId = String(req.user?.tenantId || "").trim();
      const blocked = blockedAiScribeResponse(tenantId);
      if (blocked) return res.status(blocked.status).json(blocked.body);
      try {
        const { audioBase64, mimeType, durationMs } = req.body ?? {};
        if (!audioBase64) {
          return res.status(400).json({ error: "audioBase64 is required" });
        }
        const canonicalMime = canonicalTranscribeMime(mimeType);
        if (!canonicalMime) {
          return res.status(415).json({ error: "Unsupported audio type." });
        }
        const cleanBase64 = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, "");
        // Size and duration before any model client, so an over-long clip is 413 even when Vertex is missing.
        // The clip is not stored.
        if (cleanBase64.length > maxTranscribeBase64Chars()) {
          return res.status(413).json({ error: "Recording is too long to transcribe." });
        }
        const audioBytes = base64DecodedBytes(cleanBase64);
        if (transcribeDurationTooLong(audioBytes, durationMs)) {
          return res.status(413).json({ error: "Recording is too long to transcribe." });
        }
        const appointmentId = transcribeAppointmentId((req.body ?? {}).appointmentId);
        if (!appointmentId) {
          return res.status(400).json({ error: "appointmentId is required", code: "appointment_required" });
        }
        if (!hasAmbientScribeConsent(tenantId, appointmentId)) {
          return res.status(409).json({ error: "Patient consent required", code: "consent_required" });
        }
        const duration = resolveTranscribeDurationMs(audioBytes, durationMs);
        let transcription = "";
        if (testTranscribeGenerator) {
          transcription = (await testTranscribeGenerator()).trim();
        } else {
          const ai = getVertexClient();
          if (!ai) {
            return res.status(503).json({
              code: AI_TRANSCRIPTION_NOT_CONFIGURED,
              message: AI_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
            });
          }
          const response = await ai.models.generateContent({
            model: VERTEX_GEMINI_MODEL,
            contents: [
              {
                inlineData: {
                  mimeType: canonicalMime,
                  data: cleanBase64,
                },
              },
              {
                text: "Transcribe this medical consultation audio accurately. Return the verbatim words in the spoken language (English, Hindi, Hinglish, Marathi, Tamil, Telugu, etc.).",
              },
            ],
          });
          transcription = response.text?.trim() || "";
        }
        if (!transcription) return res.status(500).json({ code: "transcribe_failed" });
        meterSuccessfulTranscription({ tenantId, durationMs: duration, audioBytes });
        return res.json({ success: true, transcription });
      } catch (err: unknown) {
        console.error("Ambient transcribe failed:", errorName(err));
        return res.status(500).json({ code: "transcribe_failed" });
      }
    }
  );

  mountAmbientScribeConsentRoutes(app);
  mountGeminiVoiceRoutes(app, getVertexClient);
}
