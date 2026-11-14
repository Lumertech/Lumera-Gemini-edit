import type { Express, Request, Response } from "express";
import type { GoogleGenAI } from "@google/genai";
import { CLINICIAN_ROLES, isPlatformAdminRole, requireAuth } from "./auth.ts";
import { DEMO_TENANT_ID, getDb } from "./db.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { clinicLine, getTenantLetterhead } from "./letterhead.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { vertexGeminiModel } from "./vertex-gemini.ts";
import { bookWhatsAppAppointment, findNextBookableSlot } from "./whatsapp-calendar-booking.ts";
import { getClinicScheduleSettings } from "./clinic-schedule.ts";
import { mayaDemoMode } from "./voice-demo.ts";
import { cloudTtsBilling, cloudTtsVoice, mayaSpokenLanguage, synthesizeCloudTtsDetailed, type MayaSpokenLanguage } from "./voice-tts.ts";
import { voiceTurnNeedsScheduleLookup } from "./voice-filler.ts";
import { shouldDropVoiceUtterance } from "./voice-listen-gate.ts";
import { mayaLockedLanguageInstruction, resolveMayaCallLanguage, speechConflictsWithLockedLanguage } from "./voice-language-lock.ts";
import { formatTenantVoiceFacts } from "./voice-vocabulary.ts";
import { formatIstDateSpeech, collectVoiceSlots, mayaAskedForPatientName, parseVoiceBookingDraft, planVoiceBooking, speakablePhone, usablePatientName, withHeardSlots, type VoiceBookingDraft, type VoiceHistoryTurn } from "./voice-booking-confirm.ts";
import { findRegisteredPatient, resolveClinicFacingNames } from "./whatsapp.ts";
import { dispatchPatientCloudText } from "./whatsapp-patient-dispatch.ts";
import { getWhatsAppTenantVoiceSettings, saveWhatsAppTenantVoiceSettings } from "./whatsapp-numbers-store.ts";
import { findTenantByPatientPhone } from "./meta.ts";
import { readVoiceGatewaySecret, voiceGatewayAuthorized } from "./voice-gateway-auth.ts";
import { tenantIdFromReceivingPhoneNumberId } from "./whatsapp-tenant-resolve.ts";
import { createVoiceCallbackTask } from "./voice-callback.ts";

function errorName(err: unknown): string {
  return err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "Error";
}

export interface VoiceReceptionistInput {
  message: string;
  callerName?: string;
  callerPhone?: string;
  language?: string;
  /** When set, receptionist speech stays in this call language instead of following the latest utterance. */
  replyLanguage?: MayaSpokenLanguage;
  tenantId?: string;
  conversationHistory?: Array<{ role: "caller" | "maya"; text: string }>;
  bookingDraft?: VoiceBookingDraft | null;
  availableDoctors?: Array<{
    name: string;
    specialty: string;
    fee?: number;
    timing?: string;
  }>;
  getGenAI?: () => GoogleGenAI | null;
  now?: Date;
}

export interface VoiceReceptionistResult {
  speechText: string;
  intent: "EMERGENCY" | "BOOKING" | "REFILL" | "TIMINGS" | "LOCATION" | "INQUIRY" | "RESCHEDULE" | "CANCELLATION" | "DOCTOR_INFO" | "SILENCE";
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

export type IndicLangCode = "en" | "hi" | "bn" | "te" | "mr" | "ta" | "gu" | "kn" | "ml" | "pa" | "or" | "ur";

export function detectIndicLanguage(message: string, languageHint?: string): IndicLangCode {
  const hint = String(languageHint || "").toLowerCase().trim();
  if (hint.includes("hindi") || hint === "hi") return "hi";
  if (hint.includes("bengali") || hint.includes("bangla") || hint === "bn") return "bn";
  if (hint.includes("telugu") || hint === "te") return "te";
  if (hint.includes("tamil") || hint === "ta") return "ta";
  if (hint.includes("kannada") || hint === "kn") return "kn";
  if (hint.includes("marathi") || hint === "mr") return "mr";
  if (hint.includes("gujarati") || hint === "gu") return "gu";
  if (hint.includes("malayalam") || hint === "ml") return "ml";
  if (hint.includes("punjabi") || hint === "pa") return "pa";
  if (hint.includes("odia") || hint.includes("oriya") || hint === "or") return "or";
  if (hint.includes("urdu") || hint === "ur") return "ur";

  // Script detection
  if (/[\u0C00-\u0C7F]/.test(message)) return "te"; // Telugu
  if (/[\u0B80-\u0BFF]/.test(message)) return "ta"; // Tamil
  if (/[\u0C80-\u0CFF]/.test(message)) return "kn"; // Kannada
  if (/[\u0D00-\u0D7F]/.test(message)) return "ml"; // Malayalam
  if (/[\u0980-\u09FF]/.test(message)) return "bn"; // Bengali
  if (/[\u0A80-\u0AFF]/.test(message)) return "gu"; // Gujarati
  if (/[\u0A00-\u0A7F]/.test(message)) return "pa"; // Punjabi
  if (/[\u0B00-\u0B7F]/.test(message)) return "or"; // Odia
  if (/[\u0600-\u06FF]/.test(message)) return "ur"; // Urdu
  if (/[\u0900-\u097F]/.test(message)) {
    if (
      message.includes("आहे") ||
      message.includes("नाही") ||
      message.includes("झाले") ||
      message.includes("मला") ||
      message.includes("कंबरदुखी") ||
      message.includes("नमस्कार") ||
      message.includes("दाखवायचे")
    ) {
      return "mr"; // Marathi
    }
    return "hi"; // Hindi
  }

  // Transliterated Indic detection
  const lower = message.toLowerCase();
  if (/\b(naaku|nenu|nopi|baadhaga|undi|kavali|cheyandi)\b/i.test(lower)) return "te";
  if (/\b(enakku|vali|irukku|vendum|theriyuma)\b/i.test(lower)) return "ta";
  if (/\b(nanage|novu|ide|beku|hege)\b/i.test(lower)) return "kn";
  if (/\b(mala|dukhata|aahe|pahije|dakhvayche)\b/i.test(lower)) return "mr";
  if (/\b(aamar|byatha|korche|chai|dekhte)\b/i.test(lower)) return "bn";
  if (/\b(mane|dukhavo|chhe|joiye|tamari)\b/i.test(lower)) return "gu";
  if (/\b(enikku|vedana|undu|kaanan|aano)\b/i.test(lower)) return "ml";
  if (/\b(mera|meri|mujhe|dard|dikkat|hai|hain|kripya|apka|aapka|namaste|bukhar|dikhana)\b/i.test(lower)) return "hi";

  return "en";
}

export function detectIndicEmergency(message: string): boolean {
  const t = String(message || "").toLowerCase();
  if (
    t.includes("chest pain") || t.includes("breathless") || t.includes("unconscious") || 
    t.includes("bleed") || t.includes("heart attack") || t.includes("stroke") || t.includes("emergency") ||
    t.includes("सीने में दर्द") || t.includes("सांस") || t.includes("बेहोश") || t.includes("खून") || t.includes("छाती में दर्द") || t.includes("दिल का दौरा") ||
    t.includes("ఛాతీ నొప్పి") || t.includes("గుండె నొప్పి") || t.includes("శ్వాస") || t.includes("స్పృహ") || t.includes("రక్తం") ||
    t.includes("நெஞ்சு வலி") || t.includes("மூச்சு") || t.includes("மயக்கம்") || t.includes("இரத்தம்") || t.includes("மாரடைப்பு") ||
    t.includes("ಎದೆ ನೋವು") || t.includes("ಉಸಿರಾಟ") || t.includes("ಪ್ರಜ್ಞೆ") || t.includes("ರಕ್ತ") || t.includes("ಹೃದಯಾಘಾತ") ||
    t.includes("छातीत दुखणे") || t.includes("श्वास") || t.includes("बेशुद्ध") || t.includes("रक्तस्राव") || t.includes("हृदयविकार") ||
    t.includes("বুকে ব্যথা") || t.includes("শ্বাসকষ্ট") || t.includes("অজ্ঞান") || t.includes("রক্তপাত") || t.includes("হার্ট অ্যাটাক") ||
    t.includes("છાતીમાં દુખાવો") || t.includes("શ્વાસ") || t.includes("બેભાન") || t.includes("લોહી") || t.includes("હાર્ટ એટેક") ||
    t.includes("നെഞ്ചുവേദന") || t.includes("ശ്വാസം") || t.includes("ബോധം") || t.includes("രക്തം") || t.includes("ഹൃദയാഘാതം") ||
    t.includes("ਛਾਤੀ ਵਿੱਚ ਦਰਦ") || t.includes("ਸਾਹ") || t.includes("ਬੇਹੋਸ਼") || t.includes("ਖੂਨ") || t.includes("ਦਿਲ ਦਾ ਦੌਰਾ") ||
    t.includes("ଛାତି ଯନ୍ତ୍ରଣା") || t.includes("ନିଶ୍ୱାସ") || t.includes("ଅଚେତ") || t.includes("ରକ୍ତ") || t.includes("ହୃଦଘାତ") ||
    t.includes("سینے میں درد") || t.includes("سانس") || t.includes("بے ہوش") || t.includes("خون")
  ) {
    return true;
  }
  return false;
}

export function detectIndicBooking(message: string): boolean {
  const t = String(message || "").toLowerCase();
  return (
    t.includes("book") || t.includes("appointment") || t.includes("slot") || t.includes("consult") ||
    t.includes("schedule") || t.includes("doctor") || t.includes("dr") ||
    t.includes("अपॉइंटमेंट") || t.includes("दिखाना") || t.includes("बुकिंग") || t.includes("डॉक्टर") ||
    t.includes("అపాయింట్‌మెంట్") || t.includes("బుకింగ్") || t.includes("డాక్టర్") ||
    t.includes("முன்பதிவு") || t.includes("அப்பாயிண்ட்மென்ட்") || t.includes("மருத்துவர்") ||
    t.includes("ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್") || t.includes("ಬುಕಿಂಗ್") || t.includes("ವೈದ್ಯರು") ||
    t.includes("अपॉइंटमेंट") || t.includes("बुकिंग") || t.includes("दाखवायचे") ||
    t.includes("অ্যাপয়েন্টমেন্ট") || t.includes("বুকিং") || t.includes("ডাক্তার") ||
    t.includes("એપોઇન્ટમેન્ટ") || t.includes("બુકિંગ") || t.includes("ડોક્ટર") ||
    t.includes("അപ്പോയിന്റ്മെന്റ്") || t.includes("ബുക്കിംഗ്") || t.includes("ഡോക്ടർ") ||
    t.includes("ਅਪਾਇੰਟਮੈਂਟ") || t.includes("ਬੁਕਿੰਗ") || t.includes("ਡਾਕਟਰ") ||
    t.includes("ଅପଏଣ୍ଟମେଣ୍ଟ") || t.includes("ବୁକିଂ") || t.includes("ଡାକ୍ତର") ||
    t.includes("اپائنٹمنٹ") || t.includes("بکنگ") || t.includes("ڈاکٹر")
  );
}

function isVoiceStaffRole(role: string | undefined): boolean {
  const value = String(role || "");
  if (value === "patient") return false;
  return (CLINICIAN_ROLES as readonly string[]).includes(value) || isPlatformAdminRole(value);
}

let legacyVoiceTenantWarned = false;

/** Test hook. The legacy tenantId warning is once per process. */
export function resetLegacyVoiceTenantWarningForTests(): void {
  legacyVoiceTenantWarned = false;
}

function warnLegacyVoiceTenantOnce(): void {
  if (process.env.NODE_ENV !== "production" || legacyVoiceTenantWarned) return;
  legacyVoiceTenantWarned = true;
  console.warn(
    "[Voice Gateway] VOICE_GATEWAY_SECRET is unset and this call has no phone_number_id. Accepting body.tenantId for the gateway that is still deployed. Send phone_number_id after that gateway is updated."
  );
}

function tenantRowExists(tenantId: string): boolean {
  if (!tenantId) return false;
  const row = getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId) as { id?: string } | undefined;
  return Boolean(row?.id);
}

function inboundVoiceAccess(req: Request): { tenantId: string; authenticated: boolean } | null {
  const sessionTenant = String(req.user?.tenantId || "").trim();
  // These routes skip cookie CSRF. A logged-in patient must not drive booking or
  // clinic WhatsApp sends, even when the gateway secret is still unset.
  // Clinic staff, including the legacy admin alias, may use their session.
  if (req.user) {
    if (!sessionTenant || !isVoiceStaffRole(req.user.role)) return null;
    return { tenantId: sessionTenant, authenticated: true };
  }
  if (!voiceGatewayAuthorized(req.get("x-voice-gateway-secret"))) return null;
  const body = (req.body || {}) as {
    phoneNumberId?: unknown;
    phone_number_id?: unknown;
    metadata?: { phone_number_id?: unknown };
    tenantId?: unknown;
  };
  const phoneNumberId = String(body.phoneNumberId || body.phone_number_id || body.metadata?.phone_number_id || "").trim();
  const fromLine = tenantIdFromReceivingPhoneNumberId(phoneNumberId);
  if (fromLine) return { tenantId: fromLine, authenticated: false };
  // A set secret still requires the receiving phone line. The body tenant is only
  // for the gateway that is live today, and only while the secret is unset.
  if (readVoiceGatewaySecret() || phoneNumberId) return null;
  const legacyTenantId = String(body.tenantId || "").trim();
  if (tenantRowExists(legacyTenantId)) {
    warnLegacyVoiceTenantOnce();
    return { tenantId: legacyTenantId, authenticated: false };
  }
  if (mayaDemoMode()) return { tenantId: DEMO_TENANT_ID, authenticated: false };
  return null;
}

function voiceSettingsTenant(req: Request, res: Response): string | null {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (!isVoiceStaffRole(req.user.role)) {
    res.status(403).json({ error: "Insufficient permissions" });
    return null;
  }
  const tenantId = String(req.user.tenantId || "").trim();
  if (!tenantId) {
    res.status(403).json({ error: "No clinic tenant is linked to this account." });
    return null;
  }
  return tenantId;
}

function lockedReplyFallback(language: MayaSpokenLanguage): string {
  if (language === "hi") return "माफ़ कीजिए, मैं हिंदी में बात कर रही हूँ। बताइए, मैं आपकी क्या मदद करूँ?";
  if (language === "mr") return "माफ करा, मी मराठीत बोलते आहे. सांगा, मी कशी मदत करू?";
  return "I'll continue in English. How can I help you?";
}

function clinicGreetingLanguage(body: { clinicLanguage?: unknown } | null | undefined): MayaSpokenLanguage {
  const value = String(body?.clinicLanguage || "").trim().toLowerCase();
  if (value === "hi" || value === "mr" || value === "en") return value;
  return "en";
}

function turnLanguageHint(modelLanguage: string, body: { language?: unknown } | null | undefined): string {
  const model = String(modelLanguage || "").trim();
  if (model) return model;
  if (body && Object.prototype.hasOwnProperty.call(body, "language")) return String(body.language ?? "");
  return "";
}

function capturedSlotPrompt(draft: VoiceBookingDraft | null): string {
  const name = usablePatientName(draft?.patientName || "") || "not yet";
  const doctor = String(draft?.doctorName || "").trim() || "not yet";
  const date = String(draft?.date || "").trim() || "not yet";
  const time = String(draft?.timeSlot || "").trim() || "not yet";
  return `Captured this call. Do not ask again for a line that is filled:
- Patient name: ${name}
- Doctor: ${doctor}
- Date: ${date}
- Time: ${time}`;
}

function speechAsksForPatientName(speech: string): boolean {
  return mayaAskedForPatientName(speech);
}

function otherClinicQuestion(message: string): boolean {
  return /where|address|located|location|पता|timing|timings|\bhours\b|what time do you|fee|fees|charge|refill|prescription|medicine/i.test(message);
}

function continuesBookingConversation(message: string, draft: VoiceBookingDraft | null): boolean {
  if (!draft) return false;
  if (draft.status === "awaiting_confirmation") return true;
  if (detectIndicBooking(message)) return true;
  if (otherClinicQuestion(message)) return false;
  return true;
}

function fullCallerName(callerName: string, registeredFirst?: string): string {
  const registered = usablePatientName(registeredFirst || "");
  if (registered) return registered;
  const value = String(callerName || "").trim();
  if (!value || /^patient(\s*\(\+?\d+\))?$/i.test(value) || value === "A1 Test Recipient") return "";
  return value;
}

function patientClinicLabel(name: string | undefined): string {
  const value = String(name || "").trim();
  if (!value || /physio practice/i.test(value)) return "the clinic";
  return value;
}

function cleanRosterDoctor(name: string): string {
  const clean = String(name || "").replace(/^dr\.?\s*/i, "").trim();
  if (!clean || /on-duty physician/i.test(clean)) return "";
  return clean;
}

function tenantVoiceFacts(tenantId: string, clinicName: string, doctors: TenantVoiceDoctor[]): string {
  const schedule = getClinicScheduleSettings(getDb(), tenantId);
  const roster = doctors.filter((doctor) => !/on-duty physician/i.test(doctor.name));
  return formatTenantVoiceFacts({
    clinicName,
    doctors: roster,
    schedule: {
      opdStartTime: schedule.opdStartTime,
      opdEndTime: schedule.opdEndTime,
      slotDurationMinutes: schedule.slotDurationMinutes,
    },
  });
}

function clinicLocationSpeech(clinicName: string, address: string): string {
  const clinic = String(clinicName || "").trim() || "the clinic";
  const place = String(address || "").trim();
  if (place) return `${clinic} is located at ${place}.`;
  return `The front desk at ${clinic} can share the address.`;
}

export const INDIC_LANGUAGES: Record<
  IndicLangCode,
  {
    name: string;
    localName: string;
    emergencyNotice: string;
    bookingFormat: (name: string, doctor: string, specialty: string, slot: string, token: number, when: string) => string;
    greetingText: (name: string, clinicName: string, receptionistName: string) => string;
    timingsText: string;
    locationText: (clinicName: string, address: string) => string;
    refillText: (name: string) => string;
    buttons: {
      emergency: string[];
      booking: string[];
      inquiry: string[];
      timings: string[];
    };
  }
> = {
  hi: {
    name: "Hindi",
    localName: "हिन्दी",
    emergencyNotice: "यह एक गंभीर आपातकालीन स्थिति प्रतीत होती है। कृपया तुरंत नजदीकी अस्पताल के आपातकालीन कक्ष (ER) जाएं या 108 नंबर पर एम्बुलेंस बुलाएं। क्लिनिक स्टाफ को सूचित कर दिया गया है।",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `नमस्ते ${name}, मैंने ${doctor} (${specialty}) के साथ आपका अपॉइंटमेंट ${when} ${slot} के लिए बुक कर दिया है। आपका टोकन नंबर #${token} है। कृपया 10 मिनट पहले पहुंचें।`,
    greetingText: (name, clinicName, receptionistName) =>
      `नमस्ते ${name}! ${clinicName} में आपका स्वागत है। मैं ${receptionistName}, आपकी एआई रिसेप्शनिस्ट हूँ। मैं अपॉइंटमेंट बुक करने, डॉक्टर की टाइमिंग बताने या मेडिकल रिपोर्ट देखने में सहायता कर सकती हूँ। मैं आपकी क्या मदद कर सकती हूँ?`,
    timingsText: "हमारे क्लिनिक की ओपीडी सोमवार से शनिवार सुबह 09:00 बजे से रात 08:00 बजे तक और रविवार सुबह 10:00 बजे से दोपहर 02:00 बजे तक खुली रहती है।",
    locationText: (clinicName, address) =>
      address ? `${clinicName} का पता: ${address}.` : `${clinicName} का पता फ्रंट डेस्क पर मिलेगा।`,
    refillText: (name) =>
      `नमस्ते ${name}, आपका पिछला पर्चा हमारे रिकॉर्ड में दर्ज है। आप व्हाट्सऐप पर डॉक्टर द्वारा हस्ताक्षरित पर्चा देख सकते हैं या फार्मेसी रीफिल का अनुरोध कर सकते हैं।`,
    buttons: {
      emergency: ["🚨 108 एम्बुलेंस", "📍 नजदीकी ER", "📞 हेल्पलाइन"],
      booking: ["🎫 मेरी कतार देखें", "🔄 समय बदलें", "📍 क्लिनिक का पता"],
      inquiry: ["📅 अपॉइंटमेंट बुक करें", "⏰ डॉक्टर समय", "👤 रिसेप्शन से बात करें"],
      timings: ["📅 अपॉइंटमेंट बुक करें", "⏰ डॉक्टर समय", "📍 क्लिनिक का पता"],
    },
  },
  bn: {
    name: "Bengali",
    localName: "বাংলা",
    emergencyNotice: "এটি একটি জরুরি চিকিৎসা পরিস্থিতি বলে মনে হচ্ছে। অনুগ্রহ করে অবিলম্বে নিকটস্থ হাসপাতালের জরুরি বিভাগে (ER) যান অথবা ১০৮ নম্বরে অ্যাম্বুলেন্স ডাকুন। ক্লিনিক টিমকে সতর্ক করা হয়েছে।",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `নমস্কার ${name}, আমি ${doctor} (${specialty}) এর সাথে ${when} ${slot} এ আপনার অ্যাপয়েন্টমেন্ট বুক করেছি। আপনার টোকেন নম্বর #${token}। অনুগ্রহ করে ১০ মিনিট আগে পৌঁছাবেন।`,
    greetingText: (name, clinicName, receptionistName) =>
      `নমস্কার ${name}! ${clinicName} আপনাকে স্বাগতম। আমি ${receptionistName}, আপনার এআই রিসেপশনিস্ট। ডাক্তার দেখানো, সময়সূচী ও প্রেসক্রিপশন সংক্রান্ত বিষয়ে আমি আপনাকে সাহায্য করতে পারি। আজ আপনাকে কীভাবে সাহায্য করতে পারি?`,
    timingsText: "আমাদের ক্লিনিক ওপিডি সোমবার থেকে শনিবার সকাল ০৯:০০ টা থেকে রাত ০৮:০০ টা এবং রবিবার সকাল ১০:০০ টা থেকে দুপুর ০২:০০ টা পর্যন্ত খোলা থাকে।",
    locationText: (clinicName, address) =>
      address ? `${clinicName}-এর ঠিকানা: ${address}.` : `${clinicName}-এর ঠিকানা ফ্রন্ট ডেস্কে পাবেন।`,
    refillText: (name) =>
      `নমস্কার ${name}, আপনার প্রেসক্রিপশন আমাদের রেকর্ডে রয়েছে। আপনি প্রেসক্রিপশন দেখতে পারেন বা ফার্মেসি রিফিলের অনুরোধ করতে পারেন।`,
    buttons: {
      emergency: ["🚨 ১০৮ অ্যাম্বুলেন্স", "📍 নিকটস্থ ER", "📞 হেল্পলাইন"],
      booking: ["🎫 আমার টোকেন", "🔄 সময় পরিবর্তন", "📍 ক্লিনিকের ঠিকানা"],
      inquiry: ["📅 ডাক্তার বুকিং", "⏰ সময়সূচী", "👤 রিসেপশন"],
      timings: ["📅 ডাক্তার বুকিং", "⏰ সময়সূচী", "📍 ক্লিনিকের ঠিকানা"],
    },
  },
  te: {
    name: "Telugu",
    localName: "తెలుగు",
    emergencyNotice: "ఇది తీవ్రమైన అత్యవసర పరిస్థితిగా కనిపిస్తోంది. దయచేసి వెంటనే సమీపంలోని ఆసుపత్రి ఎమర్జెన్సీ రూమ్ (ER) కి వెళ్లండి లేదా 108 కి కాల్ చేసి అంబులెన్స్‌ని పిలవండి. క్లినిక్ సిబ్బందికి సమాచారం అందించబడింది.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `నమస్తే ${name}, నేను ${doctor} (${specialty}) గారితో ${when} ${slot} కి మీ అపాయింట్‌మెంట్ బుక్ చేసాను. మీ టోకెన్ సంఖ్య #${token}. దయచేసి 10 నిమిషాల ముందుగా రండి.`,
    greetingText: (name, clinicName, receptionistName) =>
      `నమస్తే ${name}! ${clinicName} స్వాగతం. నేను ${receptionistName}, మీ ఏఐ రిసెప్షనిస్ట్. డాక్టర్ అపాయింట్‌మెంట్స్, ఓపీడీ సమయాలు మరియు వైద్య నివేదికలలో నేను మీకు సహాయపడగలను. మీకు ఎలా సహాయపడగలను?`,
    timingsText: "మా క్లినిక్ ఓపీడీ సోమవారం నుండి శనివారం వరకు ఉదయం 09:00 నుండి రాత్రి 08:00 వరకు, ఆదివారం ఉదయం 10:00 నుండి మధ్యాహ్నం 02:00 వరకు అందుబాటులో ఉంటుంది.",
    locationText: (clinicName, address) =>
      address ? `${clinicName} చిరునామా: ${address}.` : `${clinicName} చిరునామా ఫ్రంట్ డెస్క్‌లో అడగండి.`,
    refillText: (name) =>
      `నమస్తే ${name}, మీ ప్రిస్క్రిప్షన్ మా రికార్డులలో ఉంది. మీరు ప్రిస్క్రిప్షన్‌ను చూడవచ్చు లేదా ఫార్మసీ రీఫిల్‌ను అభ్యర్థించవచ్చు.`,
    buttons: {
      emergency: ["🚨 108 అంబులెన్స్", "📍 సమీప ER", "📞 హెల్ప్‌లైన్"],
      booking: ["🎫 నా టోకెన్", "🔄 సమయం మార్చండి", "📍 క్లినిక్ చిరునామా"],
      inquiry: ["📅 అపాయింట్‌మెంట్", "⏰ డాక్టర్ సమయాలు", "👤 రిసెప్షన్"],
      timings: ["📅 అపాయింట్‌మెంట్", "⏰ డాక్టర్ సమయాలు", "📍 క్లినిక్ చిరునామా"],
    },
  },
  ta: {
    name: "Tamil",
    localName: "தமிழ்",
    emergencyNotice: "இது அவசர மருத்துவ சூழ்நிலையாகத் தெரிகிறது. தயவுசெய்து உடனடியாக அருகிலுள்ள அவசர சிகிச்சைப் பிரிவிற்கு (ER) செல்லவும் அல்லது 108 என்ற எண்ணில் ஆம்புலன்ஸை அழைக்கவும். மருத்துவமனை குழு எச்சரிக்கப்பட்டுள்ளது.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `வணக்கம் ${name}, நான் ${doctor} (${specialty}) உடன் ${when} ${slot} மணிக்கு உங்கள் முன்பதிவை பதிவு செய்துள்ளேன். உங்கள் டோக்கன் எண் #${token}. தயவுசெய்து 10 நிமிடங்களுக்கு முன்னதாக வரவும்.`,
    greetingText: (name, clinicName, receptionistName) =>
      `வணக்கம் ${name}! ${clinicName} வரவேற்கிறோம். நான் ${receptionistName}, உங்கள் ஏஐ வரவேற்பாளர். மருத்துவர் முன்பதிவு, நேரங்கள் மற்றும் மருத்துவ அறிக்கைகளுக்கு நான் உதவ முடியும். நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?`,
    timingsText: "எங்கள் கிளினிக் ஓபிடி திங்கள் முதல் சனிக்கிழமை வரை காலை 09:00 முதல் இரவு 08:00 மணி வரையிலும், ஞாயிற்றுக்கிழமை காலை 10:00 முதல் மதியம் 02:00 மணி வரையிலும் இயங்கும்.",
    locationText: (clinicName, address) =>
      address ? `${clinicName} முகவரி: ${address}.` : `${clinicName} முகவரியை வரவேற்பறையில் கேளுங்கள்.`,
    refillText: (name) =>
      `வணக்கம் ${name}, உங்கள் மருந்துச் சீட்டு எங்கள் பதிவுகளில் உள்ளது. நீங்கள் அதனை வாட்ஸ்அப்பில் பார்க்கலாம் அல்லது மருந்து ரீபில் கோரலாம்.`,
    buttons: {
      emergency: ["🚨 108 ஆம்புலன்ஸ்", "📍 அவசர பிரிவு", "📞 உதவி எண்"],
      booking: ["🎫 என் டோக்கன்", "🔄 நேர மாற்றம்", "📍 முகவரி"],
      inquiry: ["📅 முன்பதிவு", "⏰ மருத்துவர் நேரம்", "👤 வரவேற்பறை"],
      timings: ["📅 முன்பதிவு", "⏰ மருத்துவர் நேரம்", "📍 முகவரி"],
    },
  },
  kn: {
    name: "Kannada",
    localName: "ಕನ್ನಡ",
    emergencyNotice: "ಇದು ತುರ್ತು ವೈದ್ಯಕೀಯ ಪರಿಸ್ಥಿತಿಯಂತೆ ತೋರುತ್ತಿದೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಯ ತುರ್ತು ಕೋಣೆಗೆ (ER) ತೆರಳಿ ಅಥವಾ 108 ಕ್ಕೆ ಕರೆ ಮಾಡಿ ಆಂಬ್ಯುಲೆನ್ಸ್ ಪಡೆಯಿರಿ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಗೆ ಮಾಹಿತಿ ನೀಡಲಾಗಿದೆ.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `ನಮಸ್ಕಾರ ${name}, ನಾನು ${doctor} (${specialty}) ಅವರೊಂದಿಗೆ ${when} ${slot} ಕ್ಕೆ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿದ್ದೇನೆ. ನಿಮ್ಮ ಟೋಕನ್ ಸಂಖ್ಯೆ #${token}. ದಯವಿಟ್ಟು 10 ನಿಮಿಷ ಮುಂಚಿತವಾಗಿ ಬನ್ನಿ.`,
    greetingText: (name, clinicName, receptionistName) =>
      `ನಮಸ್ಕಾರ ${name}! ${clinicName} ಸುಸ್ವಾಗತ. ನಾನು ${receptionistName}, ನಿಮ್ಮ ಎಐ ರಿಸೆಪ್ಷನಿಸ್ಟ್. ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್ ಮತ್ತು ವೈದ್ಯರ ವೇಳಾಪಟ್ಟಿಗೆ ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`,
    timingsText: "ನಮ್ಮ ಕ್ಲಿನಿಕ್ ಒಪಿಡಿ ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ ಬೆಳಿಗ್ಗೆ 09:00 ರಿಂದ ರಾತ್ರಿ 08:00 ರವರೆಗೆ ಮತ್ತು ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 10:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 02:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.",
    locationText: (clinicName, address) =>
      address ? `${clinicName} ವಿಳಾಸ: ${address}.` : `${clinicName} ವಿಳಾಸವನ್ನು ರಿಸೆಪ್ಷನ್‌ನಲ್ಲಿ ಕೇಳಿ.`,
    refillText: (name) =>
      `ನಮಸ್ಕಾರ ${name}, ನಿಮ್ಮ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿದೆ. ನೀವು ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ವೀಕ್ಷಿಸಬಹುದು ಅಥವಾ ಫಾರ್ಮಸಿ ರೀಫಿಲ್ ಕೋರಬಹುದು.`,
    buttons: {
      emergency: ["🚨 108 ಆಂಬ್ಯುಲೆನ್ಸ್", "📍 ತುರ್ತು ಕೋಣೆ", "📞 ಸಹಾಯವಾಣಿ"],
      booking: ["🎫 ನನ್ನ ಟೋಕನ್", "🔄 ಸಮಯ ಬದಲಿಸಿ", "📍 ಕ್ಲಿನಿಕ್ ವಿಳಾಸ"],
      inquiry: ["📅 ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್", "⏰ ವೈದ್ಯರ ವೇಳಾಪಟ್ಟಿ", "👤 ರಿಸೆಪ್ಷನ್"],
      timings: ["📅 ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್", "⏰ ವೈದ್ಯರ ವೇಳಾಪಟ್ಟಿ", "📍 ಕ್ಲಿನಿಕ್ ವಿಳಾಸ"],
    },
  },
  mr: {
    name: "Marathi",
    localName: "मराठी",
    emergencyNotice: "ही एक गंभीर वैद्यकीय आणीबाणी परिस्थिती दिसते. कृपया त्वरित जवळच्या रुग्णालयातील आपत्कालीन कक्षात (ER) जा किंवा 108 वर रुग्णवाहिका बोलवा. क्लिनिक कर्मचाऱ्यांना सूचित करण्यात आले आहे.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `नमस्कार ${name}, मी ${doctor} (${specialty}) यांच्यासोबत ${when} ${slot} साठी तुमची अपॉइंटमेंट बुक केली आहे. तुमचा टोकन क्रमांक #${token} आहे. कृपया १० मिनिटे आधी पोहोचा.`,
    greetingText: (name, clinicName, receptionistName) =>
      `नमस्कार ${name}! ${clinicName}मध्ये आपले स्वागत आहे. मी ${receptionistName}, तुमची एआय रिसेप्शनिस्ट आहे. अपॉइंटमेंट बुकिंग, डॉक्टरांच्या वेळा किंवा रिपोर्ट तपासण्यात मी मदत करू शकते. मी तुम्हाला कशी मदत करू?`,
    timingsText: "आमची ओपीडी सोमवार ते शनिवार सकाळी ०९:०० ते रात्री ०८:०० आणि रविवारी सकाळी १०:०० ते दुपारी ०२:०० वाजेपर्यंत सुरू असते.",
    locationText: (clinicName, address) =>
      address ? `${clinicName}चा पत्ता: ${address}.` : `${clinicName}चा पत्ता रिसेप्शनवर मिळेल.`,
    refillText: (name) =>
      `नमस्कार ${name}, तुमचे औषधांचे प्रिस्क्रिप्शन आमच्याकडे नोंदणीकृत आहे. तुम्ही ते पाहू शकता किंवा फार्मसी रिफिल मागवू शकता.`,
    buttons: {
      emergency: ["🚨 108 रुग्णवाहिका", "📍 आपत्कालीन कक्ष", "📞 हेल्पलाइन"],
      booking: ["🎫 माझे टोकन", "🔄 वेळ बदला", "📍 क्लिनिक पत्ता"],
      inquiry: ["📅 अपॉइंटमेंट बुक करा", "⏰ डॉक्टरांच्या वेळा", "👤 रिसेप्शन"],
      timings: ["📅 अपॉइंटमेंट बुक करा", "⏰ डॉक्टरांच्या वेळा", "📍 क्लिनिक पत्ता"],
    },
  },
  gu: {
    name: "Gujarati",
    localName: "ગુજરાતી",
    emergencyNotice: "આ એક ગંભીર તબીબી કટોકટી લાગે છે. કૃપા કરીને તાત્કાલિક નજીકની હોસ્પિટલના ઇમરજન્સી રૂમ (ER) માં જાઓ અથવા 108 નંબર પર એમ્બ્યુલન્સ બોલાવો. ક્લિનિક સ્ટાફને જાણ કરવામાં આવી છે.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `નમસ્તે ${name}, મેં ${doctor} (${specialty}) સાથે ${when} ${slot} વાગ્યે તમારી એપોઇન્ટમેન્ટ બુક કરી છે. તમારો ટોકન નંબર #${token} છે. કૃપા કરીને ૧૦ મિનિટ વહેલા પહોંચો.`,
    greetingText: (name, clinicName, receptionistName) =>
      `નમસ્તે ${name}! ${clinicName} તમારું સ્વાગત છે. હું ${receptionistName}, તમારી એઆઈ રિસેપ્શનિસ્ટ છું. એપોઇન્ટમેન્ટ બુકિંગ, ડોક્ટરનો સમય અને રિપોર્ટ જોવામાં હું મદદ કરી શકું છું. હું તમારી શું મદદ કરી શકું?`,
    timingsText: "અમારી ક્લિનિક ઓપીડી સોમવારથી શનિવાર સવારે ૦૯:૦૦ થી રાત્રે ૦૮:૦૦ અને રવિવારે સવારે ૧૦:૦૦ થી બપોરે ૦૨:૦૦ વાગ્યા સુધી કાર્યરત છે.",
    locationText: (clinicName, address) =>
      address ? `${clinicName}નું સરનામું: ${address}.` : `${clinicName}નું સરનામું રિસેપ્શન પર મળશે.`,
    refillText: (name) =>
      `નમસ્તે ${name}, તમારું પ્રિસ્ક્રિપ્શન અમારા રેકોર્ડમાં છે. તમે પ્રિસ્ક્રિપ્શન ચકાસી શકો છો અથવા ફાર્મસી રિફિલની વિનંતી કરી શકો છો.`,
    buttons: {
      emergency: ["🚨 108 એમ્બ્યુલન્સ", "📍 નજીકની ER", "📞 હેલ્પલાઇન"],
      booking: ["🎫 મારું ટોકન", "🔄 સમય બદલો", "📍 ક્લિનિક સરનામું"],
      inquiry: ["📅 એપોઇન્ટમેન્ટ", "⏰ ડોક્ટર સમય", "👤 રિસેપ્શન"],
      timings: ["📅 એપોઇન્ટમેન્ટ", "⏰ ડોક્ટર સમય", "📍 ક્લિનિક સરનામું"],
    },
  },
  ml: {
    name: "Malayalam",
    localName: "മലയാളം",
    emergencyNotice: "ഇതൊരു അത്യാഹിത മെഡിക്കൽ സാഹചര്യമായി തോന്നുന്നു. ദയവായി ഉടൻ അടുത്തുള്ള ആശുപത്രി അത്യാഹിത വിഭാഗത്തിലേക്ക് (ER) പോകുക അല്ലെങ്കിൽ 108 ലേക്ക് ആംബുലൻസ് വിളിക്കുക. ക്ലിനിക് ടീമിനെ അറിയിച്ചിട്ടുണ്ട്.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `നമസ്കാരം ${name}, ${doctor} (${specialty}) മായി ${when} ${slot} ന് നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്തിട്ടുണ്ട്. നിങ്ങളുടെ ടോക്കൺ നമ്പർ #${token} ആണ്. ദയവായി 10 മിനിറ്റ് മുമ്പ് എത്തുക.`,
    greetingText: (name, clinicName, receptionistName) =>
      `നമസ്കാരം ${name}! ${clinicName} സ്വാഗതം. ഞാൻ ${receptionistName}, നിങ്ങളുടെ എഐ റിസപ്ഷനിസ്റ്റ്. ഡോക്ടർ അപ്പോയിന്റ്മെന്റുകൾക്കും ഒപിഡി സമയങ്ങൾക്കും ഞാൻ നിങ്ങളെ സഹായിക്കാം. ഞാൻ എങ്ങനെ സഹായിക്കണം?`,
    timingsText: "ഞങ്ങളുടെ ഒപിഡി തിങ്കൾ മുതൽ ശനി വരെ രാവിലെ 09:00 മുതൽ രാത്രി 08:00 വരെയും ഞായറാഴ്ചകളിൽ രാവിലെ 10:00 മുതൽ ഉച്ചയ്ക്ക് 02:00 വരെയും പ്രവർത്തിക്കുന്നു.",
    locationText: (clinicName, address) =>
      address ? `${clinicName} വിലാസം: ${address}.` : `${clinicName} വിലാസം റിസപ്ഷനിൽ ചോദിക്കുക.`,
    refillText: (name) =>
      `നമസ്കാരം ${name}, നിങ്ങളുടെ കുറിപ്പടി ഞങ്ങളുടെ രേഖകളിലുണ്ട്. നിങ്ങൾക്ക് കുറിപ്പടി കാണാനോ ഫാർമസി റീഫിൽ അഭ്യർത്ഥിക്കാനോ കഴിയും.`,
    buttons: {
      emergency: ["🚨 108 ആംബുലൻസ്", "📍 അത്യാഹിത വിഭാഗം", "📞 ഹെൽപ്പ്‌ലൈൻ"],
      booking: ["🎫 എന്റെ ടോക്കൺ", "🔄 സമയം മാറ്റുക", "📍 വിലാസം"],
      inquiry: ["📅 ബുക്കിംഗ്", "⏰ സമയം", "👤 റിസപ്ഷൻ"],
      timings: ["📅 ബുക്കിംഗ്", "⏰ സമയം", "📍 വിലാസം"],
    },
  },
  pa: {
    name: "Punjabi",
    localName: "ਪੰਜਾਬੀ",
    emergencyNotice: "ਇਹ ਇੱਕ ਗੰਭੀਰ ਮੈਡੀਕਲ ਐਮਰਜੈਂਸੀ ਲੱਗਦੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਤੁਰੰਤ ਨਜ਼ਦੀਕੀ ਹਸਪਤਾਲ ਦੇ ਐਮਰਜੈਂਸੀ ਰੂਮ (ER) ਜਾਓ ਜਾਂ 108 'ਤੇ ਐਂਬੂਲੈਂਸ ਬੁਲਾਓ। ਕਲੀਨਿਕ ਸਟਾਫ ਨੂੰ ਸੂਚਿਤ ਕਰ ਦਿੱਤਾ ਗਿਆ ਹੈ।",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ${name}, ਮੈਂ ${doctor} (${specialty}) ਨਾਲ ${when} ${slot} ਲਈ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ ਕਰ ਦਿੱਤੀ ਹੈ। ਤੁਹਾਡਾ ਟੋਕਨ ਨੰਬਰ #${token} ਹੈ। ਕਿਰਪਾ ਕਰਕੇ 10 ਮਿੰਟ ਪਹਿਲਾਂ ਪਹੁੰਚੋ।`,
    greetingText: (name, clinicName, receptionistName) =>
      `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ${name}! ${clinicName} ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਮੈਂ ${receptionistName}, ਤੁਹਾਡੀ ਏਆਈ ਰਿਸੈਪਸ਼ਨਿਸਟ ਹਾਂ। ਮੈਂ ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ ਕਰਨ ਅਤੇ ਡਾਕਟਰ ਦੇ ਸਮੇਂ ਬਾਰੇ ਜਾਣਕਾਰੀ ਦੇਣ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ। ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?`,
    timingsText: "ਸਾਡੀ ਓਪੀਡੀ ਸੋਮਵਾਰ ਤੋਂ ਸ਼ਨੀਵਾਰ ਸਵੇਰੇ 09:00 ਤੋਂ ਰਾਤ 08:00 ਵਜੇ ਤੱਕ ਅਤੇ ਐਤਵਾਰ ਸਵੇਰੇ 10:00 ਤੋਂ ਦੁਪਹਿਰ 02:00 ਵਜੇ ਤੱਕ ਖੁੱਲ੍ਹੀ ਰਹਿੰਦੀ ਹੈ।",
    locationText: (clinicName, address) =>
      address ? `${clinicName} ਦਾ ਪਤਾ: ${address}.` : `${clinicName} ਦਾ ਪਤਾ ਰਿਸੈਪਸ਼ਨ ਤੇ ਮਿਲੇਗਾ.`,
    refillText: (name) =>
      `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ${name}, ਤੁਹਾਡਾ ਨੁਸਖਾ ਸਾਡੇ ਕੋਲ ਮੌਜੂਦ ਹੈ। ਤੁਸੀਂ ਨੁਸਖਾ ਦੇਖ ਸਕਦੇ ਹੋ ਜਾਂ ਦਵਾਈ ਮੰਗਵਾ ਸਕਦੇ ਹੋ।`,
    buttons: {
      emergency: ["🚨 108 ਐਂਬੂਲੈਂਸ", "📍 ਐਮਰਜੈਂਸੀ ਰੂਮ", "📞 ਹੈਲਪਲਾਈਨ"],
      booking: ["🎫 ਮੇਰਾ ਟੋਕਨ", "🔄 ਸਮਾਂ ਬਦਲੋ", "📍 ਕਲੀਨਿਕ ਪਤਾ"],
      inquiry: ["📅 ਅਪਾਇੰਟਮੈਂਟ", "⏰ ਡਾਕਟਰ ਸਮਾਂ", "👤 ਰਿਸੈਪਸ਼ਨ"],
      timings: ["📅 ਅਪਾਇੰਟਮੈਂਟ", "⏰ ਡਾਕਟਰ ਸਮਾਂ", "📍 ਕਲੀਨਿਕ ਪਤਾ"],
    },
  },
  or: {
    name: "Odia",
    localName: "ଓଡ଼ିଆ",
    emergencyNotice: "ଏହା ଏକ ଜରୁରୀକାଳୀନ ଚିକିତ୍ସା ପରିସ୍ଥିତି ଭଳି ମନେହେଉଛି। ଦୟାକରି ତୁରନ୍ତ ନିକଟସ୍ଥ ହସ୍ପିଟାଲର ଜରୁରୀକାଳୀନ ବିଭାଗ (ER) କୁ ଯାଆନ୍ତୁ କିମ୍ବା ୧୦୮ କୁ କଲ୍ କରି ଆମ୍ବୁଲାନ୍ସ ଡାକନ୍ତୁ।",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `ନମସ୍କାର ${name}, ମୁଁ ${doctor} (${specialty}) ଙ୍କ ସହ ${when} ${slot} ପାଇଁ ଆପଣଙ୍କ ଅପଏଣ୍ଟମେଣ୍ଟ ବୁକ୍ କରିଛି। ଆପଣଙ୍କ ଟୋକନ୍ ନମ୍ବର #${token}। ଦୟାକରି ୧୦ ମିନିଟ୍ ପୂର୍ବରୁ ପହଞ୍ଚନ୍ତୁ।`,
    greetingText: (name, clinicName, receptionistName) =>
      `ନମସ୍କାର ${name}! ${clinicName} ସ୍ୱାଗତ। ମୁଁ ${receptionistName}, ଆପଣଙ୍କ ଏଆଇ ରିସେପ୍ସନିଷ୍ଟ। ଡାକ୍ତର ଅପଏଣ୍ଟମେଣ୍ଟ, ସମୟସୂଚୀ ଏବଂ ରିପୋର୍ଟ ସମ୍ବନ୍ଧରେ ମୁଁ ସାହାଯ୍ୟ କରିପାରିବି। ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?`,
    timingsText: "ଆମ କ୍ଲିନିକ୍ ଓପିଡି ସୋମବାରରୁ ଶନିବାର ସକାଳ ୦୯:୦୦ ରୁ ରାତି ୦୮:୦୦ ଏବଂ ରବିବାର ସକାଳ ୧୦:୦୦ ରୁ ଦିନ ୦୨:୦୦ ପର୍ଯ୍ୟନ୍ତ ଖୋଲା ରହେ।",
    locationText: (clinicName, address) =>
      address ? `${clinicName} ଠିକଣା: ${address}.` : `${clinicName} ଠିକଣା ରିସେପ୍ସନରେ ମିଳିବ.`,
    refillText: (name) =>
      `ନମସ୍କାର ${name}, ଆପଣଙ୍କ ପ୍ରେସକ୍ରିପସନ୍ ଆମ ରେକର୍ଡରେ ଅଛି। ଆପଣ ଏହାକୁ ଦେଖିପାରିବେ କିମ୍ବା ଔଷଧ ପାଇଁ ଅନୁରୋଧ କରିପାରିବେ।`,
    buttons: {
      emergency: ["🚨 ୧୦୮ ଆମ୍ବୁଲାନ୍ସ", "📍 ଜରୁରୀକାଳୀନ ବିଭାଗ", "📞 ହେଲ୍ପଲାଇନ୍"],
      booking: ["🎫 ମୋ ଟୋକନ୍", "🔄 ସମୟ ବଦଳାନ୍ତୁ", "📍 କ୍ଲିନିକ୍ ଠିକଣା"],
      inquiry: ["📅 ଅପଏଣ୍ଟମେଣ୍ଟ", "⏰ ଡାକ୍ତର ସମୟସୂଚୀ", "👤 ରିସେପ୍ସନ୍"],
      timings: ["📅 ଅପଏଣ୍ଟମେଣ୍ଟ", "⏰ ଡାକ୍ତର ସମୟସୂଚୀ", "📍 କ୍ଲିନିକ୍ ଠିକଣା"],
    },
  },
  ur: {
    name: "Urdu",
    localName: "اردو",
    emergencyNotice: "یہ ایک ہنگامی طبی صورتحال معلوم ہوتی ہے۔ براہ کرم فوری طور پر قریبی ایمرجنسی روم (ER) جائیں یا 108 پر ایمبولینس کو کال کریں۔ کلینک عملے کو مطلع کر دیا گیا ہے۔",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `ہیلو ${name}، آپ کی اپائنٹمنٹ ${doctor} (${specialty}) کے ساتھ ${when} ${slot} پر بک کر دی گئی ہے۔ آپ کا ٹوکن نمبر #${token} ہے۔ براہ کرم 10 منٹ پہلے تشریف لائیں۔`,
    greetingText: (name, clinicName, receptionistName) =>
      `ہیلو ${name}! ${clinicName} میں خوش آمدید۔ میں ${receptionistName}, آپ کی اے آئی ریسپشنسٹ ہوں۔ میں اپائنٹمنٹ بک کرنے، ڈاکٹر کے اوقات اور رپورٹس میں مدد کر سکتی ہوں۔ میں آپ کی کیا مدد کر سکتی ہوں؟`,
    timingsText: "ہمارا کلینک او پی ڈی پیر سے ہفتہ صبح 09:00 سے رات 08:00 بجے تک اور اتوار صبح 10:00 سے دوپہر 02:00 بجے تک کھلا رہتا ہے۔",
    locationText: (clinicName, address) =>
      address ? `${clinicName} کا پتہ: ${address}.` : `${clinicName} کا پتہ استقبالیہ پر ملے گا۔`,
    refillText: (name) =>
      `ہیلو ${name}، آپ کا نسخہ ہمارے ریکارڈ میں محفوظ ہے۔ آپ واٹس ایپ پر دیکھ سکتے ہیں یا فارمیسی ریفل کی درخواست کر سکتے ہیں۔`,
    buttons: {
      emergency: ["🚨 108 ایمبولینس", "📍 قریبی ER", "📞 ہیلپ لائن"],
      booking: ["🎫 میرا ٹوکن", "🔄 وقت تبدیل کریں", "📍 کلینک کا پتہ"],
      inquiry: ["📅 اپائنٹمنٹ", "⏰ ڈاکٹر کے اوقات", "👤 استقبالیہ"],
      timings: ["📅 اپائنٹمنٹ", "⏰ ڈاکٹر کے اوقات", "📍 کلینک کا پتہ"],
    },
  },
  en: {
    name: "English",
    localName: "English",
    emergencyNotice: "This sounds like a critical medical emergency. Please proceed directly to the nearest Emergency Room or dial 108 for an ambulance. Our clinical emergency team has been alerted.",
    bookingFormat: (name, doctor, specialty, slot, token, when) =>
      `Hello ${name}, your consultation with ${doctor} (${specialty}) has been booked for ${when} at ${slot}. Your OPD token is #${token}. Please arrive 10 minutes prior to your slot.`,
    greetingText: (name, clinicName, receptionistName) =>
      `Hello ${name}! Welcome to ${clinicName}. I am ${receptionistName}, your AI clinic receptionist. I can help you schedule an appointment, check doctor timings, or access your medical records. How may I assist you today?`,
    timingsText: "Our clinic OPD operates Monday through Saturday from 09:00 AM to 08:00 PM, and Sundays from 10:00 AM to 02:00 PM. Diagnostic lab sample collection begins at 08:00 AM daily.",
    locationText: clinicLocationSpeech,
    refillText: (name) =>
      `Hello ${name}, your verified prescription is on file. You can preview the dosage schedule or request a pharmacy refill directly via WhatsApp.`,
    buttons: {
      emergency: ["🚨 Call 108 Ambulance", "📍 Nearest ER", "📞 Call Helpline"],
      booking: ["🎫 View My Queue", "🔄 Reschedule Slot", "📍 Clinic Location"],
      inquiry: ["📅 Book Appointment", "⏰ Doctor Schedule", "👤 Speak with Front Desk"],
      timings: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location"],
    },
  },
};

const TODAY_WORD: Record<IndicLangCode, string> = {
  en: "today",
  hi: "आज",
  bn: "আজ",
  te: "ఈరోజు",
  ta: "இன்று",
  kn: "ಇಂದು",
  mr: "आज",
  gu: "આજે",
  ml: "ഇന്ന്",
  pa: "ਅੱਜ",
  or: "ଆଜି",
  ur: "آج",
};

const SLOT_FULL: Record<IndicLangCode, string> = {
  en: "I'm sorry, there is no open slot in the coming days. Please ask the clinic desk to arrange a time.",
  hi: "माफ़ कीजिए, आने वाले दिनों में कोई खाली स्लॉट नहीं है। कृपया क्लिनिक डेस्क से समय तय करें।",
  bn: "দুঃখিত, আগামী দিনগুলোতে কোনো খালি স্লট নেই। অনুগ্রহ করে ক্লিনিক ডেস্কের সঙ্গে সময় ঠিক করুন।",
  te: "క్షమించండి, రాబోయే రోజుల్లో ఖాళీ స్లాట్ లేదు. దయచేసి క్లినిక్ డెస్క్‌తో సమయం నిర్ణయించండి.",
  ta: "மன்னிக்கவும், வரும் நாட்களில் காலியான நேரம் இல்லை. தயவுசெய்து கிளினிக் வரவேற்பறையில் நேரம் ஏற்பாடு செய்யுங்கள்.",
  kn: "ಕ್ಷಮಿಸಿ, ಮುಂದಿನ ದಿನಗಳಲ್ಲಿ ಖಾಲಿ ಸ್ಲಾಟ್ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಡೆಸ್ಕ್‌ನಲ್ಲಿ ಸಮಯವನ್ನು ಗೊತ್ತುಪಡಿಸಿ.",
  mr: "माफ करा, येत्या दिवसांत मोकळी स्लॉट नाही. कृपया क्लिनिक डेस्कशी वेळ निश्चित करा.",
  gu: "માફ કરશો, આગામી દિવસોમાં ખાલી સ્લોટ નથી. કૃપા કરીને ક્લિનિક ડેસ્ક પર સમય નક્કી કરો.",
  ml: "ക്ഷമിക്കണം, വരുന്ന ദിവസങ്ങളിൽ ഒഴിഞ്ഞ സ്ലോട്ട് ഇല്ല. ദയവായി ക്ലിനിക് ഡെസ്കിൽ സമയം ക്രമീകരിക്കുക.",
  pa: "ਮਾਫ਼ ਕਰਨਾ, ਆਉਣ ਵਾਲੇ ਦਿਨਾਂ ਵਿੱਚ ਕੋਈ ਖਾਲੀ ਸਲਾਟ ਨਹੀਂ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਕਲੀਨਿਕ ਡੈਸਕ ਨਾਲ ਸਮਾਂ ਤੈਅ ਕਰੋ।",
  or: "କ୍ଷମା କରନ୍ତୁ, ଆଗାମୀ ଦିନଗୁଡ଼ିକରେ ଖାଲି ସ୍ଲଟ୍ ନାହିଁ। ଦୟାକରି କ୍ଲିନିକ୍ ଡେସ୍କରେ ସମୟ ଠିକ୍ କରନ୍ତୁ।",
  ur: "معاف کیجیے، آنے والے دنوں میں کوئی خالی سلاٹ نہیں ہے۔ براہ کرم کلینک ڈیسک سے وقت طے کریں۔",
};

function spokenBookingWhen(lang: IndicLangCode, date: string, now = new Date()): string {
  const today = clinicCalendarDate(now, "Asia/Kolkata");
  if (!date || date === today) return TODAY_WORD[lang];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return utc.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function bookingAction(token: number, date: string, timeSlot: string, now = new Date()): string {
  const today = clinicCalendarDate(now, "Asia/Kolkata");
  const when = !date || date === today ? "today" : date;
  return `Confirmed token #${token} for ${when} at ${timeSlot}`;
}

function confirmedVoiceBooking(
  langCode: IndicLangCode,
  callerName: string,
  appt: { doctorName: string; specialty: string; timeSlot: string; tokenNumber: number; date: string },
  now = new Date()
) {
  const langInfo = INDIC_LANGUAGES[langCode] || INDIC_LANGUAGES.en;
  return {
    speechText: langInfo.bookingFormat(
      callerName,
      appt.doctorName,
      appt.specialty,
      appt.timeSlot,
      appt.tokenNumber,
      spokenBookingWhen(langCode, appt.date, now)
    ),
    suggestedAction: bookingAction(appt.tokenNumber, appt.date, appt.timeSlot, now),
  };
}

const BOOKING_FAILED: Record<IndicLangCode, string> = {
  en: "I'm sorry, I could not save that appointment. Please ask the clinic desk to arrange a time.",
  hi: "माफ़ कीजिए, मैं यह अपॉइंटमेंट सेव नहीं कर पाई। कृपया क्लिनिक डेस्क से समय तय करें।",
  bn: "দুঃখিত, আমি এই অ্যাপয়েন্টমেন্ট সেভ করতে পারিনি। অনুগ্রহ করে ক্লিনিক ডেস্কের সঙ্গে সময় ঠিক করুন।",
  te: "క్షమించండి, ఈ అపాయింట్‌మెంట్ సేవ్ కాలేదు. దయచేసి క్లినిక్ డెస్క్‌తో సమయం నిర్ణయించండి.",
  ta: "மன்னிக்கவும், இந்த முன்பதிவை சேமிக்க முடியவில்லை. தயவுசெய்து கிளினிக் வரவேற்பறையில் நேரம் ஏற்பாடு செய்யுங்கள்.",
  kn: "ಕ್ಷಮಿಸಿ, ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಉಳಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಡೆಸ್ಕ್‌ನಲ್ಲಿ ಸಮಯವನ್ನು ಗೊತ್ತುಪಡಿಸಿ.",
  mr: "माफ करा, ही अपॉइंटमेंट सेव्ह होऊ शकली नाही. कृपया क्लिनिक डेस्कशी वेळ निश्चित करा.",
  gu: "માફ કરશો, આ એપોઇન્ટમેન્ટ સેવ થઈ નથી. કૃપા કરીને ક્લિનિક ડેસ્ક પર સમય નક્કી કરો.",
  ml: "ക്ഷമിക്കണം, ഈ അപ്പോയിന്റ്മെന്റ് സേവ് ചെയ്യാനായില്ല. ദയവായി ക്ലിനിക് ഡെസ്കിൽ സമയം ക്രമീകരിക്കുക.",
  pa: "ਮਾਫ਼ ਕਰਨਾ, ਇਹ ਅਪਾਇੰਟਮੈਂਟ ਸੇਵ ਨਹੀਂ ਹੋ ਸਕੀ। ਕਿਰਪਾ ਕਰਕੇ ਕਲੀਨਿਕ ਡੈਸਕ ਨਾਲ ਸਮਾਂ ਤੈਅ ਕਰੋ।",
  or: "କ୍ଷମା କରନ୍ତୁ, ଏହି ଅପଏଣ୍ଟମେଣ୍ଟ ସେଭ୍ ହେଲା ନାହିଁ। ଦୟାକରି କ୍ଲିନିକ୍ ଡେସ୍କରେ ସମୟ ଠିକ୍ କରନ୍ତୁ।",
  ur: "معاف کیجیے، یہ اپائنٹمنٹ محفوظ نہیں ہو سکی۔ براہ کرم کلینک ڈیسک سے وقت طے کریں۔",
};

function bookingFailureSpeech(langCode: IndicLangCode, err: unknown): { speechText: string; suggestedAction: string } {
  const message = err instanceof Error ? err.message : "";
  if (message === "No open clinic slot") {
    return { speechText: SLOT_FULL[langCode] || SLOT_FULL.en, suggestedAction: "No open clinic slot" };
  }
  return { speechText: BOOKING_FAILED[langCode] || BOOKING_FAILED.en, suggestedAction: "Booking was not saved" };
}

export interface TenantVoiceDoctor {
  name: string;
  specialty: string;
  fee: number;
  timing: string;
  days: string;
  qualification?: string;
}

export interface CallerLearningProfile {
  previousVisitsCount: number;
  lastDoctorName?: string;
  lastSpecialty?: string;
}

export interface TenantVoiceContext {
  letterhead: ReturnType<typeof getTenantLetterhead>;
  voiceSettings: ReturnType<typeof getWhatsAppTenantVoiceSettings>;
  registered: ReturnType<typeof findRegisteredPatient>;
  doctors: TenantVoiceDoctor[];
  callerProfile?: CallerLearningProfile;
}

export function getTenantVoiceContext(tenantId: string, callerPhone: string): TenantVoiceContext {
  const db = getDb();
  const letterhead = getTenantLetterhead(tenantId);
  const voiceSettings = getWhatsAppTenantVoiceSettings(db, tenantId);
  const registered = findRegisteredPatient(db, callerPhone, tenantId);

  let doctors: TenantVoiceDoctor[] = [];

  try {
    const rows = db.prepare(`
      SELECT d.name, d.specialty, d.consultation_fee, d.opd_timing, d.available_days, d.qualification
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      WHERE u.tenant_id = ? AND d.active = 1
    `).all(tenantId) as any[];

    if (rows && rows.length > 0) {
      doctors = rows.map((r) => ({
        name: String(r.name || "").trim(),
        specialty: String(r.specialty || "General Medicine").trim(),
        fee: Number(r.consultation_fee || 500),
        timing: String(r.opd_timing || "09:00 AM - 05:00 PM").trim(),
        days: String(r.available_days || "Mon-Sat").trim(),
        qualification: String(r.qualification || "").trim(),
      }));
    }
  } catch (err) {
    console.warn("[getTenantVoiceContext doctors]", err);
  }

  if (doctors.length === 0) {
    doctors = [
      { name: "Dr. On-Duty Physician", specialty: "General Medicine & Outpatient Care", fee: 500, timing: "09:00 AM - 08:00 PM", days: "Mon-Sat" },
    ];
  }

  // Continuous learning: retrieve caller's past interactions & doctor relationships
  let callerProfile: CallerLearningProfile | undefined;
  try {
    const rawDigits = String(callerPhone || "").replace(/\D/g, "").slice(-10);
    if (rawDigits) {
      const pastAppts = db.prepare(`
        SELECT doctor_name, specialty, created_at
        FROM appointments
        WHERE (patient_phone = ? OR patient_phone LIKE ?) AND tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `).all(callerPhone, `%${rawDigits}`, tenantId) as any[];

      if (pastAppts && pastAppts.length > 0) {
        callerProfile = {
          previousVisitsCount: pastAppts.length,
          lastDoctorName: String(pastAppts[0].doctor_name || "").replace(/^dr\.?\s*/i, ""),
          lastSpecialty: String(pastAppts[0].specialty || ""),
        };
      }
    }
  } catch (profErr) {
    console.warn("[getTenantVoiceContext callerProfile]", profErr);
  }

  return {
    letterhead,
    voiceSettings,
    registered,
    doctors,
    callerProfile,
  };
}

export async function runGeminiVoiceReceptionist(opts: VoiceReceptionistInput): Promise<VoiceReceptionistResult> {
  const { message, callerName = "Patient", callerPhone = "+919999973271", language = "English", tenantId = "", getGenAI, now } = opts;
  const lowerMsg = String(message || "").toLowerCase();
  const db = getDb();
  const tenantContext = getTenantVoiceContext(tenantId, callerPhone);
  const { letterhead, voiceSettings, registered, doctors } = tenantContext;
  const cleanCallerName =
    registered?.firstName ||
    (callerName && !/^patient(\s*\(\+?\d+\))?$/i.test(callerName) && callerName !== "A1 Test Recipient" ? callerName.split(/\s+/)[0] : "there");
  const receptionistName = voiceSettings.receptionistName || "Maya";
  const clinicName = patientClinicLabel(letterhead.clinicName);
  const clinicAddress = [letterhead.address, letterhead.city].filter(Boolean).join(", ");
  const clinicPhone = letterhead.phone || letterhead.whatsappNumber || "";

  const replyLanguage = opts.replyLanguage;
  const langCode = replyLanguage || detectIndicLanguage(message, language);
  const langInfo = INDIC_LANGUAGES[langCode] || INDIC_LANGUAGES.en;
  const lockedReplyRule = replyLanguage ? mayaLockedLanguageInstruction(replyLanguage, true) : "";

  // 1. Critical Medical Emergency Detection across Indian languages
  const isEmergency = detectIndicEmergency(message);

  if (isEmergency) {
    return {
      speechText: langInfo.emergencyNotice,
      intent: "EMERGENCY",
      suggestedAction: "Advise emergency room or call 108 ambulance",
      isEmergency: true,
      buttons: langInfo.buttons.emergency,
    };
  }

  // 2. Primary Conversational AI via Gemini 2.5 Flash on Vertex AI
  if (getGenAI) {
    const ai = getGenAI();
    if (ai) {
      try {
        const historyText = (opts.conversationHistory || [])
          .slice(-12)
          .map((h) => `${h.role === "caller" ? "Caller" : receptionistName}: "${h.text}"`)
          .join("\n");

        const doctorRosterText = doctors
          .map((d) => `  * Dr. ${d.name.replace(/^dr\.?\s*/i, "")} (${d.specialty}) - OPD: ${d.timing} (${d.days}), Fee ₹${d.fee}`)
          .join("\n");

        const prompt = `You are ${receptionistName}, the warm, polite, and intelligent AI Clinic Receptionist at ${clinicName} in ${letterhead.city || "India"}.
You are speaking live to a caller on a WhatsApp voice phone call.

Caller Phone: ${callerPhone}
Caller Name: ${cleanCallerName}
Detected Language: ${langInfo.name} (${langInfo.localName})

Clinic Information:
- Clinic: ${clinicName}
- Doctors & OPD:
${doctorRosterText}
${tenantVoiceFacts(tenantId, clinicName, doctors)}
- Address: ${clinicAddress}.
- Phone: ${clinicPhone}.
${voiceSettings.customGreeting ? `- Greeting Preference: "${voiceSettings.customGreeting}"` : ""}

Previous Call Conversation (if any):
${historyText || "(Start of call)"}
${capturedSlotPrompt(opts.bookingDraft || null)}

Latest Caller Speech: "${message}"

Voice Persona Rules:
1. Speak naturally and warmly like a real receptionist. ${lockedReplyRule || `Match the caller's language (${langInfo.name} / Hinglish / English).`}
2. Keep spoken responses short, concise, and conversational (1 to 2 sentences, 15 to 25 words max) so it sounds like real, natural voice dialogue.
3. If caller explicitly asks to book an appointment (e.g. "book an appointment", "give me a slot", "book Dr. ...", "appointment chahiye", "ha book kardo"), set "shouldBook": true and specify the doctor's name. If the patient name, doctor, date, or time is already captured above, acknowledge it and ask only for what is still missing. Never ask for the patient's name again once it is known. Indian names and Hindi or Marathi transcripts count.
4. If caller is just asking for timings, doctor availability, directions, or asking questions: answer their question warmly using the clinic profile above and ask if they'd like to book. Do NOT book unless they ask or confirm!

Output strict JSON:
{
  "speechText": "Spoken text in ${langInfo.name} / natural Indian conversational style",
  "intent": "BOOKING" | "TIMINGS" | "LOCATION" | "REFILL" | "DOCTOR_INFO" | "INQUIRY",
  "shouldBook": false,
  "doctorName": "doctor name",
  "suggestedAction": "Summary"
}`;

        const gen = await ai.models.generateContent({
          model: vertexGeminiModel(),
          contents: [{ text: prompt }],
          config: {
            maxOutputTokens: 250,
          },
        });
        const txt = String(gen.text || "").trim();
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.speechText) {
            if (parsed.shouldBook) {
              const docToBook = parsed.doctorName || (doctors[0]?.name ? doctors[0].name.replace(/^dr\.?\s*/i, "") : "General Physician");
              try {
                const booked = bookWhatsAppAppointment({
                  tenantId,
                  patientPhone: callerPhone,
                  patientName: cleanCallerName !== "there" ? cleanCallerName : "Patient",
                  doctorName: docToBook,
                  now,
                });
                const appt = booked.appointment;
                const spoken = confirmedVoiceBooking(langCode, cleanCallerName, appt, now);
                return {
                  speechText: spoken.speechText,
                  intent: "BOOKING",
                  suggestedAction: spoken.suggestedAction,
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
                  buttons: langInfo.buttons.booking,
                };
              } catch (bErr) {
                console.warn("[Voice Gemini Booking Error]", bErr);
                const failed = bookingFailureSpeech(langCode, bErr);
                return {
                  speechText: failed.speechText,
                  intent: "INQUIRY",
                  suggestedAction: failed.suggestedAction,
                  isEmergency: false,
                  buttons: langInfo.buttons.inquiry,
                };
              }
            }

            return {
              speechText: parsed.speechText,
              intent: parsed.intent || "INQUIRY",
              suggestedAction: parsed.suggestedAction || "Answered patient inquiry",
              isEmergency: false,
              buttons: langInfo.buttons.inquiry,
            };
          }
        }
      } catch (gemErr) {
        console.warn("[Voicebot Gemini GenAI Error, using resilient fallback]", gemErr);
      }
    }
  }

  // 3. Specialty & Clinical Keywords Fallback matching across Indic languages
  const specialtySearchKeywords: { kws: string[]; specMatch: string; docHint: string }[] = [
    {
      kws: [
        "cardio", "heart", "ecg", "bp", "blood pressure", "palpitation",
        "दिल", "हृदय", "గుండె", "இதயம்", "ಹೃದಯ", "হৃদয়", "હૃદય", "ഹൃദയം", "ਦਿਲ"
      ],
      specMatch: "Cardiology",
      docHint: "Rajesh",
    },
    {
      kws: [
        "skin", "derma", "hair", "acne", "rash", "itching", "allergy", "eczema",
        "त्वचा", "चर्म", "చర్మం", "தோல்", "ಚರ್ಮ", "ত্বক", "ત્વચા", "ചർമ്മം", "ਚਮੜੀ"
      ],
      specMatch: "Dermatology",
      docHint: "Meera",
    },
    {
      kws: [
        "physio", "back pain", "knee pain", "knee", "back", "joint pain", "joint", "ortho", "rehab", "sprain", "posture",
        "घुटना", "घुटने", "कमर", "जोड़ों", "दर्द",
        "మోకాలి", "కీళ్ల", "నడుము", "నొప్పి",
        "முழங்கால்", "மூட்டு", "முதுகு", "வலி",
        "ಮೊಣಕಾಲು", "ಕೀಲು", "ಬೆನ್ನು", "ನೋವು",
        "गुडघा", "गुडघे", "कंबरदुखी", "सांधेदुखी",
        "হাঁটু", "পিঠ", "ব্যথা", "হাঁটুর",
        "ઘૂંટણ", "પીઠ", "સાંધા", "દુખાવો",
        "മുട്ടുവേദന", "സന്ധി", "വേദന",
        "ਗੋਡਾ", "ਗੋਡੇ", "ਦਰਦ", "ਜੋੜਾਂ",
        "ଆଣ୍ଠୁ", "ଗଣ୍ଠି", "ଯନ୍ତ୍ରଣା",
        "گھٹنے", "جوڑوں", "کمر", "درد"
      ],
      specMatch: "Physiotherapy & Rehabilitation",
      docHint: "Siddharth",
    },
    {
      kws: [
        "pediatric", "child", "baby", "kid", "vaccin", "infant",
        "बच्चा", "बच्चे", "పిల్లలు", "குழந்தை", "ಮಗು", "শিশু", "બાળક", "കുട്ടി", "ਬੱਚਾ"
      ],
      specMatch: "Pediatrics",
      docHint: "Ananya",
    },
    {
      kws: [
        "general physician", "physician", "fever", "cold", "cough", "flu", "weakness", "headache", "infection", "body ache", "internal medicine",
        "बुखार", "खांसी", "जुकाम", "ज्वर", "జ్వరం", "దగ్గు", "காய்ச்சல்", "இருமல்", "ಜ್ವರ", "ಕೆಮ್ಮು", "জ্বর", "কাশি", "તાવ", "ઉધરસ", "പനി", "ചുമ", "ਬੁਖਾਰ", "ਖੰਘ", "ଜ୍ୱର", "କାଶ", "بخار", "کھانسی"
      ],
      specMatch: "General Medicine",
      docHint: "Vikram",
    },
    {
      kws: ["eye", "ophthalmology", "vision", "cataract", "आंख", "கண்", "కన్ను", "ಕಣ್ಣು", "চোখ", "આંખ", "കണ്ണ്", "ਅੱਖ", "ଆଖି"],
      specMatch: "Ophthalmology",
      docHint: "Mukherjee",
    },
    {
      kws: ["dental", "teeth", "tooth", "dentist", "gum", "दांत", "दंत", "పన్ను", "பல்", "ಹಲ್ಲು", "দাঁত", "દાંત", "പല്ല്", "ਦੰਦ", "ଦାନ୍ତ"],
      specMatch: "Dental Surgery",
      docHint: "Swamy",
    },
  ];
  const matchedSpec = specialtySearchKeywords.find((item) => item.kws.some((k) => lowerMsg.includes(k) || message.includes(k)));

  // 3. Appointment Booking Intent
  const isBooking = detectIndicBooking(message) || matchedSpec !== undefined;

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
        now,
      });
      const appt = booked.appointment;
      const spoken = confirmedVoiceBooking(langCode, cleanCallerName, appt, now);
      return {
        speechText: spoken.speechText,
        intent: "BOOKING",
        suggestedAction: spoken.suggestedAction,
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
        buttons: langInfo.buttons.booking,
      };
    } catch (bookingErr) {
      console.warn("[Voice Receptionist Booking Fallback]", bookingErr);
      const failed = bookingFailureSpeech(langCode, bookingErr);
      return {
        speechText: failed.speechText,
        intent: "INQUIRY",
        suggestedAction: failed.suggestedAction,
        isEmergency: false,
        buttons: langInfo.buttons.inquiry,
      };
    }
  }

  // 4. Prescription / Medication Refill Inquiry
  if (
    lowerMsg.includes("prescription") || lowerMsg.includes("rx") || lowerMsg.includes("medicine") || lowerMsg.includes("refill") ||
    message.includes("दवा") || message.includes("पर्ची") || message.includes("మందులు") || message.includes("மருந்து") ||
    message.includes("ಔಷಧಿ") || message.includes("ঔষধ") || message.includes("ઓષધ") || message.includes("മരുന്ന്")
  ) {
    return {
      speechText: langInfo.refillText(cleanCallerName),
      intent: "REFILL",
      suggestedAction: "View prescription or request pharmacy refill",
      isEmergency: false,
      buttons: ["📄 View Prescription", "💊 Request Pharmacy Refill", "📅 Book Doctor Appointment"],
    };
  }

  // 5. Clinic Location & Directions
  if (
    lowerMsg.includes("location") || lowerMsg.includes("address") || lowerMsg.includes("where") || lowerMsg.includes("landmark") ||
    message.includes("कहाँ") || message.includes("पता") || message.includes("చిరునామా") || message.includes("முகவரி") || message.includes("ವಿಳಾಸ")
  ) {
    return {
      speechText: langInfo.locationText(clinicName, clinicAddress),
      intent: "LOCATION",
      suggestedAction: "Provided address and directions to clinic",
      isEmergency: false,
      buttons: langInfo.buttons.timings,
    };
  }

  // 6. Timings & Working Hours
  if (
    lowerMsg.includes("timing") || lowerMsg.includes("hours") || lowerMsg.includes("open") || lowerMsg.includes("close") ||
    message.includes("समय") || message.includes("సమయం") || message.includes("நேரம்") || message.includes("ವೇಳೆ")
  ) {
    return {
      speechText: langInfo.timingsText,
      intent: "TIMINGS",
      suggestedAction: "Provided working hours and OPD schedule",
      isEmergency: false,
      buttons: langInfo.buttons.timings,
    };
  }

  // 7. Generative Gemini Call for natural conversational dialogue when available
  if (getGenAI) {
    const ai = getGenAI();
    if (ai) {
      try {
        const prompt = `You are ${receptionistName}, the AI Clinic Receptionist at ${clinicName}.
Caller Name: ${cleanCallerName}
Caller Message: "${message}"
Detected Language: ${langInfo.name} (${langInfo.localName})

Guidelines:
1. Respond warmly and politely as ${receptionistName} the receptionist directly in ${langInfo.name} (${langInfo.localName}).${lockedReplyRule ? ` ${lockedReplyRule}` : ""}
2. Keep the answer spoken, natural, concise (under 30-40 words) suitable for voice audio playback over telephone/WhatsApp voice note.
3. Offer relevant clinical help using only the clinic schedule and doctor list below. Do not invent hours.
${tenantVoiceFacts(tenantId, clinicName, doctors)}
4. Output strict JSON only:
{"speechText": "Spoken text in ${langInfo.name}", "suggestedAction": "English summary"}`;

        const gen = await ai.models.generateContent({
          model: vertexGeminiModel(),
          contents: [{ text: prompt }],
        });
        const txt = String(gen.text || "").trim();
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.speechText) {
            return {
              speechText: parsed.speechText,
              intent: "INQUIRY",
              suggestedAction: parsed.suggestedAction || "Answered patient inquiry in " + langInfo.name,
              isEmergency: false,
              buttons: langInfo.buttons.inquiry,
            };
          }
        }
      } catch (gemErr) {
        console.warn("[Voicebot Gemini GenAI Error, using resilient multilingual fallback]", gemErr);
      }
    }
  }

  // 8. General Receptionist Inquiry & Greeting in the caller's detected Indian language
  return {
    speechText: langInfo.greetingText(cleanCallerName, clinicName, receptionistName),
    intent: "INQUIRY",
    suggestedAction: "Greeted patient and offered clinical services in " + langInfo.name,
    isEmergency: false,
    buttons: langInfo.buttons.inquiry,
  };
}

export function mountGeminiVoiceRoutes(app: Express, getGenAI: () => GoogleGenAI | null) {
  // 4. Voice Bot & Triage Simulator with Emergency Escalation & Resilient Offline Fallback
  app.post("/api/gemini/voice-bot", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, callerName = "Patient", language = "English", callerPhone = "+919999973271", availableDoctors } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      if (!isVoiceStaffRole(req.user?.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const tenantId = String(req.user?.tenantId || "").trim();
      if (!tenantId) return res.status(403).json({ error: "No clinic tenant is linked to this account." });

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
        speechText: "Thank you for calling. Our front desk has noted your request and is ready to assist you.",
        intent: "INQUIRY",
        suggestedAction: "Routed to front desk support",
        isEmergency: false,
      });
    }
  });

  async function synthesizeSpeechNeural(text: string, spoken: MayaSpokenLanguage = "en", callKey = "") {
    return synthesizeCloudTtsDetailed(text, spoken, callKey);
  }

  // 4b. Inbound WhatsApp Voice Call Receiver & Simulator (supports single-pass audioBase64 & direct text)
  const handleInboundVoiceCall = async (req: Request, res: Response) => {
    try {
      const from = String(req.body?.from || req.body?.phone || "+919999973271").trim();
      let message = String(req.body?.message || req.body?.transcript || req.body?.text || "").trim();
      const callerName = String(req.body?.callerName || "Patient").trim();
      const language = String(req.body?.language || "English").trim();
      const callKey = String(req.body?.callId || "").trim()
        || `${from}|${String(req.body?.phoneNumberId || req.body?.phone_number_id || "")}`;
      let scheduleLookup = false;
      const signalScheduleLookup = () => {
        if (scheduleLookup || res.headersSent) return;
        scheduleLookup = true;
        res.status(200);
        res.setHeader("X-Maya-Lookup", "1");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.flushHeaders();
      };
      const sendVoicePayload = (payload: Record<string, unknown>) => {
        if (scheduleLookup) {
          payload.lookup = true;
          if (!res.headersSent) res.setHeader("X-Maya-Lookup", "1");
        }
        if (res.headersSent) {
          res.end(JSON.stringify(payload));
          return;
        }
        res.json(payload);
      };

      const db = getDb();
      const access = inboundVoiceAccess(req);
      if (!access) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const tenantId = access.tenantId;

      const tenantContext = getTenantVoiceContext(tenantId, from);
      const { letterhead, voiceSettings, registered, doctors, callerProfile } = tenantContext;
      const cleanCallerName =
        registered?.firstName ||
        (callerName && !/^patient(\s*\(\+?\d+\))?$/i.test(callerName) && callerName !== "A1 Test Recipient" ? callerName.split(/\s+/)[0] : "there");
      const receptionistName = voiceSettings.receptionistName || "Maya";
      const clinicName = patientClinicLabel(letterhead.clinicName);
      const clinicAddress = [letterhead.address, letterhead.city].filter(Boolean).join(", ");
      const clinicPhone = letterhead.phone || letterhead.whatsappNumber || "";
      const escalationPhone = String(voiceSettings.escalationPhone || clinicPhone || "").trim();

      const doctorRosterText = doctors
        .map((d) => `  * Dr. ${d.name.replace(/^dr\.?\s*/i, "")} (${d.specialty}) - OPD: ${d.timing} (${d.days}), Fee ₹${d.fee}`)
        .join("\n");

      let memoryProfileText = "";
      if (callerProfile && callerProfile.previousVisitsCount > 0) {
        memoryProfileText = `Caller Profile & Continuous Memory:
- Returning Patient: Yes (${callerProfile.previousVisitsCount} prior visits at this clinic)
- Last Consulted Doctor: Dr. ${callerProfile.lastDoctorName} (${callerProfile.lastSpecialty})
- Personalization Tip: If the caller mentions a checkup, follow-up, or does not specify a doctor, warmly ask if they would like to book with their usual doctor, Dr. ${callerProfile.lastDoctorName}.`;
      }

      const history = (req.body?.conversationHistory || []) as VoiceHistoryTurn[];
      const historyText = history
        .slice(-12)
        .map((h) => `${h.role === "caller" ? "Caller" : receptionistName}: "${h.text}"`)
        .join("\n");
      const priorDraft = parseVoiceBookingDraft(req.body?.bookingDraft);

      let speechText = "";
      let intent: VoiceReceptionistResult["intent"] | "TRANSFER" = "INQUIRY";
      let suggestedAction = "Answered patient inquiry";
      let appointmentData: VoiceReceptionistResult["appointment"] | undefined;
      let shouldBook = false;
      let shouldTransfer = false;
      let doctorToBook = "";
      let modelLanguage = "";
      let modelPatientName = "";
      let bookingDraftOut: VoiceBookingDraft | null = priorDraft;

      // Single-pass Multimodal Inference: Transcribe & Formulate Receptionist Spoken Reply in 1 Roundtrip
      if (!message && req.body?.audioBase64) {
        try {
          const ai = getGenAI?.();
          if (ai) {
            const cleanBase64 = String(req.body.audioBase64).replace(/^data:audio\/\w+;base64,/, "");
            const mimeType = String(req.body.mimeType || "audio/wav");

            const priorLanguage = resolveMayaCallLanguage({
              greeting: clinicGreetingLanguage(req.body as { clinicLanguage?: unknown }),
              history,
            });
            const singlePassPrompt = `You are ${receptionistName}, the warm, polite, and intelligent AI Clinic Receptionist at ${clinicName} in ${letterhead.city || "India"}.
You are speaking live to a caller on a WhatsApp voice phone call.

Caller Phone: ${from}
Caller Name: ${usablePatientName(priorDraft?.patientName || "") || fullCallerName(callerName, registered?.firstName) || "not yet captured"}
${memoryProfileText ? `${memoryProfileText}\n` : ""}Clinic Information:
- Clinic: ${clinicName}
- Doctors & OPD:
${doctorRosterText}
${tenantVoiceFacts(tenantId, clinicName, doctors)}
- Address: ${clinicAddress}.
- Phone: ${clinicPhone}.
- Escalation Line: ${escalationPhone}.
${voiceSettings.customGreeting ? `- Greeting Preference: "${voiceSettings.customGreeting}"` : ""}

Previous Call Conversation (if any):
${historyText || "(Start of call)"}
${capturedSlotPrompt(priorDraft)}

Instructions:
1. Listen carefully to the caller's audio clip. Indian English, Hindi, Hinglish, Marathi, Bengali, Tamil, Telugu, and other Indian regional languages are spoken.
2. In "transcript", transcribe what the caller said.
   - The caller may speak fast, softly, or in Hinglish (e.g. "appointment chahiye", "doctor kab baithenge", "dr siddharth se milna hai", "kya timing hai", "aaj slot milega").
   - Match phonetic doctor names and medicine names to the clinic facts above. Do not substitute a doctor who is not on that list.
   - If you hear words, transcribe those words, including soft or fast Indian English, Hindi, Hinglish, or Marathi.
   - If the clip is silence, background noise, a cough, breath, or sounds with no words, set "transcript": "", "speechText": "", and "intent": "SILENCE". Do not invent words, a booking, or a question from noise.
3. ${mayaLockedLanguageInstruction(priorLanguage.language, priorLanguage.locked)}
4. In "speechText", formulate your spoken receptionist response in that reply language, so the words match the voice.
   - If the caller just said their name, acknowledge it (for example "Thank you, Ravi" or "धन्यवाद, रवि") and ask only for details that are still missing.
   - Never ask for the patient's name, doctor, date, or time again once that slot is captured above or earlier in the conversation. Indian names and Hindi or Marathi transcripts count.
   - When the transcript has real words, acknowledge what you heard.
   - When the transcript is empty because the clip had no words, leave speechText empty. Do not ask the caller to repeat noise.
   - Keep answers conversational, warm, and concise (1 to 2 short sentences, 15 to 25 words maximum) suitable for snappy live voice dialogue.
5. If the caller asks to speak to a human, staff, doctor, receptionist, or operator (e.g. "transfer me", "talk to human", "doctor se baat karni hai", "receptionist chahiye", "operator", "emergency", "connect to staff"): set "intent": "TRANSFER", "shouldTransfer": true.
6. If the caller asks to book an appointment, set "shouldBook": true and "doctorName" to a doctor from the clinic facts. Do not say the visit is already booked. The server reads the name, date, time, and phone back and books only after the caller confirms.
7. If caller is asking for timings, fees, doctor availability, directions, or asking medical questions: answer their question warmly using the clinic facts above and ask if they would like to book. Do NOT book unless they ask or confirm!
8. Set "language" to "hi", "mr", or "en" for the language you actually wrote in speechText. Do not set "hi" for Hinglish or for one Hindi word.

Output strict JSON:
{
  "transcript": "transcribed caller speech",
  "speechText": "spoken receptionist response in the locked reply language",
  "language": "hi" | "mr" | "en",
  "intent": "BOOKING" | "TIMINGS" | "LOCATION" | "REFILL" | "DOCTOR_INFO" | "INQUIRY" | "TRANSFER" | "SILENCE",
  "shouldBook": false,
  "shouldTransfer": false,
  "patientName": "name heard from the caller, or empty",
  "doctorName": "doctor name from the clinic facts",
  "suggestedAction": "brief summary"
}`;

            const response = await ai.models.generateContent({
              model: vertexGeminiModel(),
              contents: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: singlePassPrompt,
                },
              ],
              config: {
                maxOutputTokens: 420,
                responseMimeType: "application/json",
              },
            });

            const txt = String(response.text || "").trim();
            const jsonMatch = txt.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              message = String(parsed.transcript || "").trim();
              speechText = String(parsed.speechText || "").trim();
              intent = (parsed.intent || "INQUIRY") as any;
              suggestedAction = String(parsed.suggestedAction || "Answered patient inquiry");
              shouldBook = Boolean(parsed.shouldBook);
              shouldTransfer = Boolean(parsed.shouldTransfer);
              doctorToBook = String(parsed.doctorName || "");
              modelPatientName = String(parsed.patientName || "");
              modelLanguage = String(parsed.language || "");
              console.log(`[Single-Pass Voice AI] Caller: "${message}" | ${receptionistName} (${intent}): "${speechText}" (fast-path)`);
            }
          }
        } catch (singlePassErr) {
          console.error("[Single-Pass Voice AI Error, falling back to 2-pass]", singlePassErr);
        }
      }

      const voiceBody = (req.body || {}) as { clinicLanguage?: unknown; language?: unknown };
      const turnHint = turnLanguageHint(modelLanguage, voiceBody);
      const spoken = resolveMayaCallLanguage({
        greeting: clinicGreetingLanguage(voiceBody),
        history,
        currentText: message,
        currentHint: turnHint,
        currentDetected: message ? detectIndicLanguage(message, turnHint) : "",
      }).language;
      if (speechText && speechConflictsWithLockedLanguage(speechText, spoken)) {
        speechText = "";
      }

      // Check Failover & 3-Attempt Unclear Transfer
      const previousClarifications = history.filter(
        (h) => h.role === "maya" && (
          /couldn't hear that clearly|could you please repeat|trouble hearing|साफ़ नहीं|दोबारा बोलेंगे/i.test(String(h.text || ""))
        )
      ).length;

      // Empty or noise transcripts never start a lookup, a filler, or a reply.
      // Two earlier unclear replies still reach the transfer below when the transcript is empty.
      if (shouldDropVoiceUtterance(message, previousClarifications)) {
        return sendVoicePayload({
          success: true,
          from,
          transcript: "",
          speechText: "",
          intent: "SILENCE",
          hasAudio: false,
          dropped: true,
        });
      }

      const isTransferRequested =
        shouldTransfer ||
        intent === "TRANSFER" ||
        /human|staff|transfer|receptionist|operator|doctor se baat|connect me|emergency/i.test(message);

      const isCurrentTurnUnclear = (!message && !speechText) || /couldn't hear that clearly|could you please repeat|साफ़ नहीं|दोबारा बोलेंगे/i.test(speechText);
      // Transfer after 3 unclear attempts (i.e. already had 2 previous clarifications + current turn is also unclear)
      const isFailoverTriggered = isTransferRequested || (isCurrentTurnUnclear && previousClarifications >= 2);

      let callbackTaskId = "";
      let authoredSpeech = false;
      if (isFailoverTriggered) {
        intent = "TRANSFER";
        authoredSpeech = true;
        if (escalationPhone) {
          speechText = spoken === "hi"
            ? `माफ़ कीजिए, मुझे आपकी आवाज़ साफ़ नहीं आ रही है। इस कॉल को दूसरी लाइन पर ट्रांसफर नहीं किया जा सकता। कृपया हमारे क्लिनिक स्टाफ को ${escalationPhone} पर कॉल करें। मैं यह नंबर व्हाट्सऐप पर भेज रही हूँ।`
            : spoken === "mr"
              ? `माफ करा, मला तुमचा आवाज स्पष्ट ऐकू येत नाही. ही कॉल दुसऱ्या लाईनवर ट्रान्सफर करता येत नाही. कृपया क्लिनिकला ${escalationPhone} वर कॉल करा.`
              : `I'm sorry, I still can't hear you clearly. I can't transfer this WhatsApp call, so please call our clinic staff at ${escalationPhone}. I'm sending that number on WhatsApp.`;
          suggestedAction = `Asked caller to phone the clinic desk (${escalationPhone}); WhatsApp card sent`;
        } else {
          speechText = spoken === "hi"
            ? `माफ़ कीजिए, मुझे आपकी आवाज़ साफ़ नहीं आ रही है। क्लिनिक का फ़ोन नंबर फ़ाइल में नहीं है। हमारे स्टाफ आपको वापस कॉल करेंगे।`
            : spoken === "mr"
              ? `माफ करा, मला तुमचा आवाज स्पष्ट ऐकू येत नाही. क्लिनिकचा फोन नंबर फाइलमध्ये नाही. स्टाफ तुम्हाला परत कॉल करतील.`
              : `I'm sorry, I still can't hear you clearly. A staff member from the clinic will call you back.`;
          suggestedAction = "No clinic number on file; callback task created";
          try {
            callbackTaskId = createVoiceCallbackTask({
              tenantId,
              patientPhone: from,
              patientName: cleanCallerName,
              reason: "Voice caller was unclear after 3 attempts and the clinic has no phone on file",
            });
          } catch (callbackErr) {
            console.warn("[Voice callback task]", callbackErr);
          }
        }
      } else if (!message && !speechText) {
        return sendVoicePayload({
          success: true,
          from,
          transcript: "",
          speechText: "",
          intent: "SILENCE",
          hasAudio: false,
          dropped: true,
        });
      }

      const todayIso = clinicCalendarDate(new Date(), "Asia/Kolkata");
      const heard = collectVoiceSlots(message, history, todayIso);
      const heardNow = collectVoiceSlots(message, [], todayIso);
      const modelName = usablePatientName(modelPatientName);
      if (modelName && !heard.patientName) heard.patientName = modelName;
      const knownCaller = fullCallerName(callerName, registered?.firstName);
      const patientForPlan = heard.patientName || usablePatientName(priorDraft?.patientName || "") || knownCaller;
      const introducedNow = heardNow.patientName || (modelName && modelName !== usablePatientName(priorDraft?.patientName || "") ? modelName : "");
      const recoveringSlots = Boolean(patientForPlan) && (detectIndicBooking(message) || Boolean(heardNow.date) || Boolean(heardNow.timeSlot));
      const wantsBooking =
        !isFailoverTriggered &&
        Boolean(message) &&
        (shouldBook || detectIndicBooking(message) || continuesBookingConversation(message, priorDraft) || recoveringSlots);
      if (wantsBooking) {
        signalScheduleLookup();
        authoredSpeech = true;
        let proposed: { date: string; timeSlot: string } | null = null;
        try {
          proposed = findNextBookableSlot({
            tenantId,
            doctorName: heard.doctorName || doctorToBook || undefined,
          });
        } catch (slotErr) {
          console.warn("[Voice booking slot]", slotErr);
        }
        const plan = planVoiceBooking({
          message,
          draft: priorDraft,
          patientName: patientForPlan,
          phone: from,
          doctorName: heard.doctorName || doctorToBook || cleanRosterDoctor(doctors[0]?.name || ""),
          clinicName,
          clinicPhone: escalationPhone,
          proposed,
          language: spoken,
          history,
        });
        speechText = plan.speechText || speechText;
        bookingDraftOut = plan.draft;
        suggestedAction = plan.callback
          ? "Booking confirmation failed twice; callback task created"
          : plan.commit
            ? "Caller confirmed the booking read-back"
            : "Read booking details back and waited for confirmation";
        if (plan.commit) {
          try {
            const booked = bookWhatsAppAppointment({
              tenantId,
              patientPhone: plan.phone || from,
              patientName: plan.patientName,
              doctorName: plan.doctorName,
              date: plan.date,
              timeSlot: plan.timeSlot,
            });
            const appt = booked.appointment;
            appointmentData = {
              id: String(appt.id),
              tokenNumber: appt.tokenNumber,
              doctorName: appt.doctorName,
              specialty: appt.specialty,
              date: appt.date,
              timeSlot: appt.timeSlot,
              uhid: appt.uhid,
              status: appt.status,
            };
            intent = "BOOKING";
            bookingDraftOut = null;
            const when = formatIstDateSpeech(String(appt.date || plan.date));
            const phoneSpoken = speakablePhone(plan.phone || from);
            const who = plan.patientName || cleanCallerName;
            speechText =
              spoken === "hi"
                ? `बुक हो गया। ${who}, ${when} IST, ${appt.timeSlot}, फ़ोन ${phoneSpoken}. टोकन ${appt.tokenNumber}.`
                : spoken === "mr"
                  ? `बुक झाले. ${who}, ${when} IST, ${appt.timeSlot}, फोन ${phoneSpoken}. टोकन ${appt.tokenNumber}.`
                  : `Booked. ${who} on ${when} at ${appt.timeSlot} IST, phone ${phoneSpoken}. Token ${appt.tokenNumber}.`;
            suggestedAction = `Confirmed token #${appt.tokenNumber} for ${appt.date} at ${appt.timeSlot} IST`;
          } catch (bErr) {
            console.warn("[Voice Booking Error]", bErr);
            intent = "INQUIRY";
            speechText = spoken === "hi"
              ? escalationPhone
                ? `मैं बुकिंग सेव नहीं कर पाई। कृपया क्लिनिक को ${escalationPhone} पर कॉल करें।`
                : `मैं बुकिंग सेव नहीं कर पाई। ${clinicName} का स्टाफ आपको कॉल करेगा।`
              : spoken === "mr"
                ? escalationPhone
                  ? `मी बुकिंग सेव्ह करू शकले नाही. कृपया क्लिनिकला ${escalationPhone} वर कॉल करा.`
                  : `मी बुकिंग सेव्ह करू शकले नाही. ${clinicName} चे स्टाफ तुम्हाला कॉल करेल.`
                : escalationPhone
                  ? `I could not save that booking. Please call the clinic at ${escalationPhone}.`
                  : `I could not save that booking. A staff member from ${clinicName} will call you back.`;
          }
        } else if (plan.callback) {
          intent = "INQUIRY";
          try {
            callbackTaskId = createVoiceCallbackTask({
              tenantId,
              patientPhone: from,
              patientName: plan.patientName || cleanCallerName,
              reason: "Booking details were not confirmed after two attempts",
            });
          } catch (callbackErr) {
            console.warn("[Voice callback task]", callbackErr);
          }
        } else {
          intent = "INQUIRY";
        }
      } else if (!isFailoverTriggered) {
        bookingDraftOut = withHeardSlots(priorDraft, heard);
      }

      if (!speechText) {
        const fallbackRes = await runGeminiVoiceReceptionist({
          message,
          callerName: patientForPlan || callerName,
          callerPhone: from,
          language,
          replyLanguage: spoken,
          tenantId,
          conversationHistory: history.map((turn) => ({
            role: turn.role === "maya" ? "maya" as const : "caller" as const,
            text: String(turn.text || ""),
          })),
          bookingDraft: bookingDraftOut,
          getGenAI,
        });
        speechText = fallbackRes.speechText;
        intent = fallbackRes.intent;
        suggestedAction = fallbackRes.suggestedAction;
        appointmentData = fallbackRes.appointment;
      }

      const rememberedName = usablePatientName(bookingDraftOut?.patientName || "") || patientForPlan;
      if (!isFailoverTriggered && rememberedName && speechAsksForPatientName(speechText)) {
        const repaired = planVoiceBooking({
          message,
          draft: bookingDraftOut?.patientName ? bookingDraftOut : {
            patientName: rememberedName,
            date: bookingDraftOut?.date || heard.date,
            timeSlot: bookingDraftOut?.timeSlot || heard.timeSlot,
            phone: bookingDraftOut?.phone || "",
            doctorName: bookingDraftOut?.doctorName || heard.doctorName,
            failedConfirmations: bookingDraftOut?.failedConfirmations || 0,
            status: "collecting",
          },
          patientName: rememberedName,
          phone: from,
          doctorName: heard.doctorName || doctorToBook || cleanRosterDoctor(doctors[0]?.name || ""),
          clinicName,
          clinicPhone: escalationPhone,
          proposed: null,
          language: spoken,
          history,
        });
        if (repaired.speechText && !speechAsksForPatientName(repaired.speechText)) {
          speechText = repaired.speechText;
          bookingDraftOut = repaired.draft;
        }
      } else if (!isFailoverTriggered && !wantsBooking && introducedNow && speechText && !speechText.includes(introducedNow)) {
        const prefix = spoken === "en" ? `Thank you, ${introducedNow}.` : `धन्यवाद, ${introducedNow}.`;
        speechText = `${prefix} ${speechText}`;
      }

      if (!authoredSpeech && speechText && speechConflictsWithLockedLanguage(speechText, spoken)) {
        speechText = lockedReplyFallback(spoken);
        suggestedAction = `Kept the reply in the locked call language (${spoken})`;
      }

      const now = new Date().toISOString();
      const timeDisplay = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

      // Record voice call exchange into WhatsApp database
      try {
        let conv = db.prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ? AND tenant_id = ?").get(from, tenantId) as { id?: string } | undefined;
        let convId = conv?.id;
        if (!convId) {
          convId = `conv-vc-${Date.now()}`;
          db.prepare(`
            INSERT INTO whatsapp_conversations (id, tenant_id, patient_phone, patient_name, handover_mode, assigned_staff, tags, last_message, last_message_time, updated_at)
            VALUES (?, ?, ?, ?, 'bot', ?, '["Voice Call"]', ?, ?, ?)
          `).run(convId, tenantId, from, rememberedName || (callerName !== "Patient" ? callerName : "Ravee"), `${receptionistName} (AI Voice)`, speechText.slice(0, 100), timeDisplay, now);
        } else {
          db.prepare(`
            UPDATE whatsapp_conversations
            SET last_message = ?, last_message_time = ?, updated_at = ?
            WHERE id = ?
          `).run(speechText.slice(0, 100), timeDisplay, now, convId);
        }

        // Caller voice message
        db.prepare(`
          INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, voice_transcript, time_display, status, created_at, tenant_id)
          VALUES (?, ?, ?, 'patient', ?, ?, ?, ?, 'delivered', ?, ?)
        `).run(`msg-vc-in-${Date.now()}`, convId, from, rememberedName || callerName, `🎤 Voice Note: "${message}"`, message, timeDisplay, now, tenantId);

        // Receptionist response
        db.prepare(`
          INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, buttons, voice_transcript, time_display, status, created_at, tenant_id)
          VALUES (?, ?, ?, 'bot', ?, ?, ?, ?, ?, 'delivered', ?, ?)
        `).run(
          `msg-vc-out-${Date.now()}`,
          convId,
          from,
          `${receptionistName} (AI Receptionist)`,
          speechText,
          JSON.stringify(["📅 Book Appointment", "⏰ Doctor Timings", "📍 Clinic Location"]),
          speechText,
          timeDisplay,
          now,
          tenantId
        );
      } catch (dbErr) {
        console.warn("[Voice Call DB Record Error]", dbErr);
      }

      // ONLY send post-call WhatsApp text confirmation if an appointment was booked, rescheduled, or cancelled
      const isBookingOrChange =
        intent === "BOOKING" ||
        intent === "RESCHEDULE" ||
        intent === "CANCELLATION" ||
        Boolean(appointmentData);

      if (isBookingOrChange && (from.startsWith("+91") || from.startsWith("91"))) {
        const confirmHeader = intent === "CANCELLATION" ? "❌ *Appointment Cancellation Confirmation*" : "📅 *Appointment Confirmation*";
        void dispatchPatientCloudText({
          tenantId,
          to: from,
          textBody: `${confirmHeader}\n\n${speechText}\n\n_Thank you for calling ${clinicName}._`,
          buttons: ["🎫 View My Queue", "🔄 Reschedule Slot", "📍 Clinic Location"],
        }).catch((err) => console.error("[Voice Outbound WhatsApp Error]", err));
      }

      // If call is transferred / escalated to staff: update conversation mode and send instant handover card
      if (intent === "TRANSFER") {
        try {
          db.prepare(`
            UPDATE whatsapp_conversations
            SET handover_mode = 'manual', assigned_staff = 'Front Desk (Escalated Call)', tags = '["Voice Escalation", "Call Transfer"]', updated_at = ?
            WHERE patient_phone = ? AND tenant_id = ?
          `).run(now, from, tenantId);
        } catch (hErr) {
          console.warn("[Voice Handover DB Error]", hErr);
        }

        if (from.startsWith("+91") || from.startsWith("91")) {
          const textBody = escalationPhone
            ? `Please call the clinic front desk. This WhatsApp call cannot be transferred to another phone.\n\n📞 *Call:* ${escalationPhone}\n🏥 *Clinic:* ${clinicName}`
            : `We could not hear you clearly. A staff member from ${clinicName} will call you back.`;
          void dispatchPatientCloudText({
            tenantId,
            to: from,
            textBody,
            buttons: escalationPhone ? ["📞 Call Front Desk", "💬 Chat with Staff", "📅 Book Online"] : ["💬 Chat with Staff", "📅 Book Online"],
          }).catch((err) => console.error("[Voice Escalation WhatsApp Card Error]", err));
        }
      }

      if (voiceTurnNeedsScheduleLookup({ message, intent: String(intent), wantsBooking })) {
        signalScheduleLookup();
      }
      const synthesized = speechText ? await synthesizeSpeechNeural(speechText, spoken, callKey) : null;
      const audioBase64 = synthesized?.audio ?? null;
      const ttsVoice = synthesized?.voice ?? cloudTtsVoice(spoken);

      const payload: Record<string, unknown> = {
        success: true,
        from,
        transcript: message,
        speechText,
        intent,
        shouldTransfer: intent === "TRANSFER",
        suggestedAction,
        appointment: appointmentData,
        audioBase64,
        bookingDraft: bookingDraftOut,
        callerName: rememberedName || "",
        spokenLanguage: spoken,
        ttsLanguage: ttsVoice.languageCode,
        ttsVoice: ttsVoice.name,
      };
      if (access.authenticated) payload.escalationPhone = escalationPhone;
      if (callbackTaskId) payload.callbackTaskId = callbackTaskId;
      return sendVoicePayload(payload);
    } catch (err) {
      console.error("[WhatsApp Voice Call Handler Error]", err);
      if (res.headersSent) {
        res.end(JSON.stringify({ error: "Failed to process voice call" }));
        return;
      }
      return res.status(500).json({ error: "Failed to process voice call" });
    }
  };
  app.post("/api/whatsapp/voice-call", handleInboundVoiceCall);
  app.post("/api/voice/inbound", handleInboundVoiceCall);
  app.post("/meta/voice-call", handleInboundVoiceCall);

  // Greeting, hold, and filler clips for the WebRTC gateway. Same Cloud TTS voice as replies.
  const handleVoiceClip = async (req: Request, res: Response) => {
    if (req.user) {
      const sessionTenant = String(req.user.tenantId || "").trim();
      if (!sessionTenant || !isVoiceStaffRole(req.user.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    } else if (!voiceGatewayAuthorized(req.get("x-voice-gateway-secret"))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const text = String(req.body?.text || "").replace(/\s+/g, " ").trim();
    if (!text) return res.status(400).json({ error: "text is required" });
    if (text.length > 500) return res.status(400).json({ error: "text is too long" });
    const clip = String(req.body?.clip || "greeting").trim();
    if (!["hold", "filler", "greeting", "reply"].includes(clip)) {
      return res.status(400).json({ error: "clip must be hold, filler, greeting, or reply" });
    }
    const hinted = String(req.body?.language || "");
    const spoken = mayaSpokenLanguage(text, hinted, detectIndicLanguage(text, hinted));
    const callKey = String(req.body?.callId || "").trim();
    const synthesized = await synthesizeSpeechNeural(text, spoken, callKey);
    const voice = synthesized.voice;
    const billing = cloudTtsBilling(voice.name);
    return res.json({
      success: true,
      clip,
      text,
      audioBase64: synthesized.audio,
      ttsLanguage: voice.languageCode,
      ttsVoice: voice.name,
      ttsTier: billing.tier,
      freeCharactersPerMonth: billing.freeCharactersPerMonth,
    });
  };
  app.post("/api/voice/clips", handleVoiceClip);

  // Tenant Voice Settings API for WhatsApp Dashboard
  app.get("/api/whatsapp/voice-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = voiceSettingsTenant(req, res);
      if (!tenantId) return;
      const db = getDb();
      const settings = getWhatsAppTenantVoiceSettings(db, tenantId);
      const letterhead = getTenantLetterhead(tenantId);
      const tenantContext = getTenantVoiceContext(tenantId, "");

      return res.json({
        success: true,
        tenantId,
        voiceEnabled: settings.voiceEnabled,
        receptionistName: settings.receptionistName,
        customGreeting: settings.customGreeting,
        escalationPhone: settings.escalationPhone || letterhead.phone || letterhead.whatsappNumber || "",
        clinic: {
          name: letterhead.clinicName && !/physio practice/i.test(letterhead.clinicName) ? letterhead.clinicName : "",
          address: letterhead.address,
          city: letterhead.city,
          phone: letterhead.phone || letterhead.whatsappNumber,
        },
        doctors: tenantContext.doctors,
      });
    } catch (err) {
      console.error("[GET /api/whatsapp/voice-settings]", err);
      return res.status(500).json({ error: "Failed to fetch voice settings" });
    }
  });

  app.post("/api/whatsapp/voice-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = voiceSettingsTenant(req, res);
      if (!tenantId) return;
      const db = getDb();
      const { voiceEnabled, receptionistName, customGreeting, escalationPhone } = req.body || {};
      const updated = saveWhatsAppTenantVoiceSettings(db, tenantId, {
        voiceEnabled: typeof voiceEnabled === "boolean" ? voiceEnabled : undefined,
        receptionistName: typeof receptionistName === "string" ? receptionistName : undefined,
        customGreeting: typeof customGreeting === "string" ? customGreeting : undefined,
        escalationPhone: typeof escalationPhone === "string" ? escalationPhone : undefined,
      });
      return res.json({
        success: true,
        settings: updated,
      });
    } catch (err) {
      console.error("[POST /api/whatsapp/voice-settings]", err);
      return res.status(500).json({ error: "Failed to update voice settings" });
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
