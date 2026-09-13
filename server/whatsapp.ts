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
