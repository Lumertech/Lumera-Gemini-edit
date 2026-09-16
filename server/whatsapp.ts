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

function respondWhatsAppMessages(res: Response, convId?: string, phone?: string) {
  const db = getDb();
  let rows: Record<string, unknown>[] = [];
  if (convId) {
    rows = db
      .prepare(
        `SELECT * FROM whatsapp_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(convId) as Record<string, unknown>[];
    db.prepare("UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = ?").run(convId);
  } else if (phone) {
    rows = db
      .prepare(
        `SELECT * FROM whatsapp_messages
         WHERE patient_phone = ?
         ORDER BY created_at ASC`
      )
      .all(phone) as Record<string, unknown>[];
  } else {
    res.status(400).json({ error: "Either conversationId or phone is required" });
    return;
  }
  res.json({ messages: rows.map(serializeWhatsAppMessage) });
}
