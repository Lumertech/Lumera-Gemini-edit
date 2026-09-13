import { Router, type Request, type Response } from "express";
import { DEMO_TENANT_ID, getDb, mapAppointment } from "./db.ts";
import {
  clinicLine,
  doctorSignatureByDoctorId,
  escapeHtml,
  getTenantLetterhead,
} from "./letterhead.ts";
import { GoogleGenAI } from "@google/genai";
import {
  bookWhatsAppAppointment,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
  findActiveAppointment,
  getWhatsAppQueue,
  httpErrorStatus,
  patchWhatsAppAppointment,
  resolveWhatsAppTenantId,
  runAppointmentReminders,
} from "./whatsapp-calendar.ts";
import { isProduction } from "./runtime.ts";
import { reportCaughtError } from "./error-tracker.ts";

let defaultGenAIClient: GoogleGenAI | null = null;
function getDefaultGenAI(): GoogleGenAI | null {
  if (!defaultGenAIClient && process.env.GEMINI_API_KEY) {
    defaultGenAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return defaultGenAIClient;
}

function serializeWhatsAppMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    patientPhone: m.patient_phone,
    sender: m.sender,
    staffName: m.staff_name,
    content: m.content,
    translatedContent: m.translated_content,
    detectedLanguage: m.detected_language,
    time: m.time_display,
    buttons: m.buttons ? JSON.parse(m.buttons as string) : null,
    media: m.media ? JSON.parse(m.media as string) : null,
    audioUrl: m.audio_url,
    voiceTranscript: m.voice_transcript,
    status: m.status,
    createdAt: m.created_at,
  };
}
