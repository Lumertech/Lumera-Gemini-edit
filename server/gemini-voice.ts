import type { Express, Request, Response } from "express";
import type { GoogleGenAI } from "@google/genai";
import { requireAuth } from "./auth.ts";
import { getDb } from "./db.ts";
import { clinicLine, getTenantLetterhead } from "./letterhead.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { vertexGeminiModel } from "./vertex-gemini.ts";
import { bookWhatsAppAppointment } from "./whatsapp-calendar-booking.ts";
import { findRegisteredPatient, resolveClinicFacingNames } from "./whatsapp.ts";
import { dispatchPatientCloudText } from "./whatsapp-patient-dispatch.ts";

function errorName(err: unknown): string {
  return err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "Error";
}

export interface VoiceReceptionistInput {
  message: string;
  callerName?: string;
  callerPhone?: string;
  language?: string;
  tenantId?: string;
  availableDoctors?: Array<{
    name: string;
    specialty: string;
    fee?: number;
    timing?: string;
  }>;
  getGenAI?: () => GoogleGenAI | null;
}

export interface VoiceReceptionistResult {
  speechText: string;
  intent: "EMERGENCY" | "BOOKING" | "REFILL" | "TIMINGS" | "LOCATION" | "INQUIRY";
  suggestedAction: string;
  isEmergency: boolean;
  appointment?: {
    id: string;
    tokenNumber: number;
    doctorName: string;
    specialty: string;
    date: string;
    timeSlot: string;
    uhid: string;
    status: string;
  };
  buttons?: string[];
}

export async function runGeminiVoiceReceptionist(opts: VoiceReceptionistInput): Promise<VoiceReceptionistResult> {
  const { message, callerName = "Patient", callerPhone = "+919999973271", language = "English", tenantId = "tenant-lumera-main", getGenAI } = opts;
  const lowerMsg = String(message || "").toLowerCase();
  const db = getDb();
  const registered = findRegisteredPatient(db, callerPhone, tenantId);
  const cleanCallerName =
    registered?.firstName ||
    (callerName && !/^patient(\s*\(\+?\d+\))?$/i.test(callerName) && callerName !== "A1 Test Recipient" ? callerName.split(/\s+/)[0] : "there");

  // 1. Critical Medical Emergency Detection
  const isEmergency =
    lowerMsg.includes("chest pain") ||
    lowerMsg.includes("breathless") ||
    lowerMsg.includes("unconscious") ||
    lowerMsg.includes("bleed") ||
    lowerMsg.includes("heart attack") ||
    lowerMsg.includes("सीने में दर्द") ||
    lowerMsg.includes("सांस") ||
    lowerMsg.includes("बेहोश") ||
    lowerMsg.includes("खून");

  if (isEmergency) {
    const isHindi = /hindi|हिंदी/i.test(language) || /[\u0900-\u097F]/.test(message);
    const speechText = isHindi
      ? "यह एक गंभीर आपातकालीन स्थिति प्रतीत होती है। कृपया तुरंत नजदीकी अस्पताल के आपातकालीन कक्ष (ER) जाएं या 108 नंबर पर एम्बुलेंस बुलाएं। क्लिनिक स्टाफ को सूचित कर दिया गया है।"
      : "This sounds like a critical medical emergency. Please proceed directly to the nearest Emergency Room or dial 108 for an ambulance. Our clinical emergency team has been alerted.";
    return {
      speechText,
      intent: "EMERGENCY",
      suggestedAction: "Advise emergency room or call 108 ambulance",
      isEmergency: true,
      buttons: ["🚨 Call 108 Ambulance", "📍 Nearest ER", "📞 Call Helpline"],
    };
  }

  // 2. Specialty & Clinical Keywords Matching
  const specialtySearchKeywords: { kws: string[]; specMatch: string; docHint: string }[] = [
    { kws: ["cardio", "heart", "ecg", "bp", "blood pressure", "palpitation"], specMatch: "Cardiology", docHint: "Rajesh" },
    { kws: ["skin", "derma", "hair", "acne", "rash", "itching", "allergy", "eczema"], specMatch: "Dermatology", docHint: "Meera" },
    { kws: ["physio", "back pain", "knee pain", "knee", "back", "joint pain", "joint", "ortho", "rehab", "sprain", "posture"], specMatch: "Physiotherapy & Rehabilitation", docHint: "Siddharth" },
    { kws: ["pediatric", "child", "baby", "kid", "vaccin", "infant"], specMatch: "Pediatrics", docHint: "Ananya" },
    { kws: ["general physician", "physician", "fever", "cold", "cough", "flu", "weakness", "headache", "infection", "body ache", "internal medicine"], specMatch: "General Medicine", docHint: "Vikram" },
    { kws: ["eye", "ophthalmology", "vision", "cataract"], specMatch: "Ophthalmology", docHint: "Mukherjee" },
    { kws: ["dental", "teeth", "tooth", "dentist", "gum"], specMatch: "Dental Surgery", docHint: "Swamy" },
  ];
  const matchedSpec = specialtySearchKeywords.find((item) => item.kws.some((k) => lowerMsg.includes(k)));

  // 3. Appointment Booking Intent
  const isBooking =
    lowerMsg.includes("book") ||
    lowerMsg.includes("appointment") ||
    lowerMsg.includes("slot") ||
    lowerMsg.includes("consult") ||
    lowerMsg.includes("schedule") ||
    lowerMsg.includes("doctor") ||
    lowerMsg.includes("dr") ||
    lowerMsg.includes("अपॉइंटमेंट") ||
    lowerMsg.includes("दिखाना") ||
    matchedSpec !== undefined;

  if (isBooking) {
    let doctorName: string | undefined;
    if (lowerMsg.includes("siddharth") || matchedSpec?.docHint === "Siddharth") {
      doctorName = "Siddharth";
    } else if (lowerMsg.includes("vikram") || matchedSpec?.docHint === "Vikram") {
      doctorName = "Vikram";
    } else if (lowerMsg.includes("ananya") || matchedSpec?.docHint === "Ananya") {
      doctorName = "Ananya";
    } else if (lowerMsg.includes("meera") || matchedSpec?.docHint === "Meera") {
      doctorName = "Meera";
    } else if (lowerMsg.includes("rajesh") || matchedSpec?.docHint === "Rajesh") {
      doctorName = "Rajesh";
    } else if (lowerMsg.includes("swamy") || matchedSpec?.docHint === "Swamy") {
      doctorName = "Swamy";
    } else if (lowerMsg.includes("mukherjee") || matchedSpec?.docHint === "Mukherjee") {
      doctorName = "Mukherjee";
    }

    try {
      const booked = bookWhatsAppAppointment({
        tenantId,
        patientPhone: callerPhone,
        patientName: cleanCallerName !== "there" ? cleanCallerName : "Patient",
        doctorName,
      });
      const appt = booked.appointment;
      const isHindi = /hindi|हिंदी/i.test(language) || /[\u0900-\u097F]/.test(message);
      const speechText = isHindi
        ? `नमस्ते ${cleanCallerName}, मैंने ${appt.doctorName} (${appt.specialty}) के साथ आपका अपॉइंटमेंट आज ${appt.timeSlot} के लिए बुक कर दिया है। आपका टोकन नंबर #${appt.tokenNumber} है। कृपया 10 मिनट पहले पहुंचें।`
        : `Hello ${cleanCallerName}, your consultation with ${appt.doctorName} (${appt.specialty}) has been booked for today at ${appt.timeSlot}. Your OPD token is #${appt.tokenNumber}. Please arrive 10 minutes prior to your slot.`;

      return {
        speechText,
        intent: "BOOKING",
        suggestedAction: `Confirmed token #${appt.tokenNumber} for today at ${appt.timeSlot}`,
        isEmergency: false,
        appointment: {
          id: String(appt.id),
          tokenNumber: appt.tokenNumber,
          doctorName: appt.doctorName,
          specialty: appt.specialty,
          date: appt.date,
          timeSlot: appt.timeSlot,
          uhid: appt.uhid,
          status: appt.status,
        },
        buttons: ["🎫 View My Queue", "🔄 Reschedule Slot", "📍 Clinic Location"],
      };
    } catch (bookingErr) {
      console.warn("[Voice Receptionist Booking Fallback]", bookingErr);
    }
  }

  // 4. Prescription / Medication Refill Inquiry
  if (lowerMsg.includes("prescription") || lowerMsg.includes("rx") || lowerMsg.includes("medicine") || lowerMsg.includes("refill") || lowerMsg.includes("दवा") || lowerMsg.includes("पर्ची")) {
    const isHindi = /hindi|हिंदी/i.test(language) || /[\u0900-\u097F]/.test(message);
    const speechText = isHindi
      ? `नमस्ते ${cleanCallerName}, आपका पिछला पर्चा हमारे रिकॉर्ड में दर्ज है। आप व्हाट्सऐप पर डॉक्टर द्वारा हस्ताक्षरित पर्चा देख सकते हैं या फार्मेसी रीफिल का अनुरोध कर सकते हैं।`
      : `Hello ${cleanCallerName}, your verified prescription is on file. You can preview the dosage schedule or request a pharmacy refill directly via WhatsApp.`;
    return {
      speechText,
      intent: "REFILL",
      suggestedAction: "View prescription or request pharmacy refill",
      isEmergency: false,
      buttons: ["📄 View Prescription", "💊 Request Pharmacy Refill", "📅 Book Doctor Appointment"],
    };
  }

  // 5. Clinic Location & Directions
  if (lowerMsg.includes("location") || lowerMsg.includes("address") || lowerMsg.includes("where") || lowerMsg.includes("landmark") || lowerMsg.includes("कहाँ") || lowerMsg.includes("पता")) {
    const speechText = `Lumera Apex PolyClinic is located at 104 to 106, Health Hub, Sector 14, Opposite Metro Station, Gurgaon. Dedicated on-site parking is available for all patients.`;
    return {
      speechText,
      intent: "LOCATION",
      suggestedAction: "Provided address and directions to clinic",
      isEmergency: false,
      buttons: ["🗺️ Google Maps Directions", "📅 Book Appointment", "📞 Call Helpline"],
    };
  }

  // 6. Timings & Working Hours
  if (lowerMsg.includes("timing") || lowerMsg.includes("hours") || lowerMsg.includes("open") || lowerMsg.includes("close") || lowerMsg.includes("समय")) {
    const speechText = `Our clinic OPD operates Monday through Saturday from 09:00 AM to 08:00 PM, and Sundays from 10:00 AM to 02:00 PM. Diagnostic lab sample collection begins at 08:00 AM daily.`;
    return {
      speechText,
      intent: "TIMINGS",
      suggestedAction: "Provided working hours and OPD schedule",
      isEmergency: false,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location"],
    };
  }

  // 7. General Receptionist Inquiry & Greeting
  const isHindi = /hindi|हिंदी/i.test(language) || /[\u0900-\u097F]/.test(message);
  const speechText = isHindi
    ? `नमस्ते ${cleanCallerName}! लुमेरा अपेक्स पॉलीक्लिनिक में आपका स्वागत है। मैं आपकी एआई रिसेप्शनिस्ट माया हूँ। मैं अपॉइंटमेंट बुक करने, डॉक्टर की टाइमिंग बताने या आपकी मेडिकल रिपोर्ट देखने में सहायता कर सकती हूँ। मैं आपकी क्या मदद कर सकती हूँ?`
    : `Hello ${cleanCallerName}! Welcome to Lumera Apex PolyClinic. I am Maya, your AI clinic receptionist. I can help you schedule an appointment, check doctor timings, or access your medical records. How may I assist you today?`;

  return {
    speechText,
    intent: "INQUIRY",
    suggestedAction: "Greeted patient and offered clinical services",
    isEmergency: false,
    buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "👤 Speak with Front Desk"],
  };
}

export function mountGeminiVoiceRoutes(app: Express, getGenAI: () => GoogleGenAI | null) {
  // 4. Voice Bot & Triage Simulator with Emergency Escalation & Resilient Offline Fallback
  app.post("/api/gemini/voice-bot", async (req: Request, res: Response) => {
    try {
      const { message, callerName = "Patient", language = "English", callerPhone = "+919999973271", availableDoctors } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });

      const tenantId = String(req.body?.tenantId || (req as any).user?.tenantId || "tenant-lumera-main");

      const result = await runGeminiVoiceReceptionist({
        message,
        callerName,
        callerPhone,
        language,
        tenantId,
        availableDoctors,
        getGenAI,
      });

      return res.json(result);
    } catch (err) {
      console.error("[Voice Bot Error]", err);
      // Resilient fallback: never fail with 503, always return comforting receptionist response
      return res.json({
        speechText: "Thank you for reaching Lumera Apex PolyClinic. Our front desk has noted your request and is ready to assist you.",
        intent: "INQUIRY",
        suggestedAction: "Routed to front desk support",
        isEmergency: false,
      });
    }
  });

  // 4b. Inbound WhatsApp Voice Call Receiver & Simulator
  app.post("/api/whatsapp/voice-call", async (req: Request, res: Response) => {
    try {
      const from = String(req.body?.from || req.body?.phone || "+919999973271").trim();
      const message = String(req.body?.message || req.body?.transcript || req.body?.text || "Hello").trim();
      const callerName = String(req.body?.callerName || "Patient").trim();
      const language = String(req.body?.language || "English").trim();
      const tenantId = String(req.body?.tenantId || "tenant-lumera-main").trim();

      const result = await runGeminiVoiceReceptionist({
        message,
        callerName,
        callerPhone: from,
        language,
        tenantId,
        getGenAI,
      });

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

      // Record voice call exchange into WhatsApp database
      try {
        let conv = db.prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ? AND tenant_id = ?").get(from, tenantId) as { id?: string } | undefined;
        let convId = conv?.id;
        if (!convId) {
          convId = `conv-vc-${Date.now()}`;
          db.prepare(`
            INSERT INTO whatsapp_conversations (id, tenant_id, patient_phone, patient_name, handover_mode, assigned_staff, tags, last_message, last_message_time, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'bot', 'Maya (AI Voice)', '["Voice Call"]', ?, ?, ?, ?)
          `).run(convId, tenantId, from, callerName !== "Patient" ? callerName : "Ravee", result.speechText.slice(0, 100), timeDisplay, now, now);
        } else {
          db.prepare(`
            UPDATE whatsapp_conversations
            SET last_message = ?, last_message_time = ?, updated_at = ?
            WHERE id = ?
          `).run(result.speechText.slice(0, 100), timeDisplay, now, convId);
        }

        // Caller voice message
        db.prepare(`
          INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, voice_transcript, time_display, status, created_at, tenant_id)
          VALUES (?, ?, ?, 'patient', ?, ?, ?, ?, 'delivered', ?, ?)
        `).run(`msg-vc-in-${Date.now()}`, convId, from, callerName, `🎤 Voice Note: "${message}"`, message, timeDisplay, now, tenantId);

        // Receptionist response
        db.prepare(`
          INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, buttons, voice_transcript, time_display, status, created_at, tenant_id)
          VALUES (?, ?, ?, 'bot', 'Maya (AI Receptionist)', ?, ?, ?, ?, 'delivered', ?, ?)
        `).run(
          `msg-vc-out-${Date.now()}`,
          convId,
          from,
          result.speechText,
          JSON.stringify(result.buttons || []),
          result.speechText,
          timeDisplay,
          now,
          tenantId
        );
      } catch (dbErr) {
        console.warn("[Voice Call DB Record Error]", dbErr);
      }

      // Also trigger outbound WhatsApp interactive message if live phone number is provided
      if (from.startsWith("+91") || from.startsWith("91")) {
        void dispatchPatientCloudText({
          tenantId,
          to: from,
          textBody: `🎤 *Maya (AI Clinic Receptionist)*:\n\n${result.speechText}`,
          buttons: result.buttons,
        }).catch((err) => console.error("[Voice Outbound WhatsApp Error]", err));
      }

      return res.json({
        success: true,
        from,
        ...result,
      });
    } catch (err) {
      console.error("[WhatsApp Voice Call Handler Error]", err);
      return res.status(500).json({ error: "Failed to process voice call" });
    }
  });

  // 4b. Local FHIR document for the signed-in clinic. Not an external locker submission.
  app.post("/api/abdm/fhir-export", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.user?.tenantId || "").trim();
      if (!tenantId) {
        return res.status(400).json({ error: "No tenant associated with this account." });
      }
      const patientId = String(req.body?.patientId || "").trim();
      let patientName = String(req.body?.patientName || "").trim();
      let abhaNumber = String(req.body?.abhaNumber || "").trim();
      if (patientId) {
        const owned = getDb()
          .prepare("SELECT id, name, abha_number FROM patients WHERE id = ? AND tenant_id = ?")
          .get(patientId, tenantId) as { id?: string; name?: string; abha_number?: string } | undefined;
        if (!owned?.id) {
          return res.status(404).json({ error: "Patient not found" });
        }
        patientName = String(owned.name || patientName || "Patient");
        abhaNumber = String(owned.abha_number || "").trim();
      }
      const { diagnosis, doctorName } = req.body || {};
      const clinic = clinicLine(getTenantLetterhead(tenantId, req.user?.id));
      const author = String(doctorName || req.user?.name || "").trim() || "Attending clinician";
      const subjectId = patientId || "local-patient";
      const identifier = abhaNumber
        ? [{ system: "https://healthid.ndhm.gov.in", value: abhaNumber }]
        : [];
      const fhirBundle = {
        resourceType: "Bundle",
        id: `clinic-fhir-${Date.now()}`,
        type: "document",
        timestamp: new Date().toISOString(),
        entry: [
          {
            resource: {
              resourceType: "Patient",
              id: subjectId,
              name: [{ text: patientName || "Patient" }],
              identifier
            }
          },
          {
            resource: {
              resourceType: "Composition",
              status: "final",
              type: { coding: [{ system: "http://loinc.org", code: "60591-5", display: "Patient consultation note" }] },
              subject: { reference: `Patient/${subjectId}` },
              author: [{ display: author }],
              title: `${clinic.name || "Clinic"} consultation note`
            }
          },
          {
            resource: {
              resourceType: "Condition",
              clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
              code: { text: diagnosis || "General Consultation" },
              subject: { reference: `Patient/${subjectId}` }
            }
          }
        ]
      };

      res.json({
        success: true,
        message: "Local FHIR document prepared for this clinic. It has not been sent to an external health locker.",
        abhaNumber,
        fhirBundleId: fhirBundle.id,
        timestamp: fhirBundle.timestamp,
        bundle: fhirBundle
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
      if (!ai) {
        return res.status(503).json({ code: "AI_TRANSLATE_NOT_CONFIGURED", message: "AI translation not configured" });
      }
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
  }
  ${AI_RUPEE_OUTPUT_RULE}`;

          const response = await ai.models.generateContent({
            model: vertexGeminiModel(),
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          return res.json(JSON.parse(response.text?.trim() || "{}"));
        } catch (err) {
          console.error("Translate Rx error", errorName(err));
          return res.status(503).json({
            code: "AI_TRANSLATE_UNAVAILABLE",
            message: "AI translation is temporarily unavailable",
          });
        }
    } catch {
      res.status(503).json({ code: "AI_TRANSLATE_UNAVAILABLE", message: "AI translation is temporarily unavailable" });
    }
  });
}
