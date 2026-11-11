import { clinicCalendarDate } from "../src/lib/clinicDay.ts";

export interface VoiceBookingDraft {
  patientName: string;
  date: string;
  timeSlot: string;
  phone: string;
  doctorName: string;
  failedConfirmations: number;
  status: "collecting" | "awaiting_confirmation";
}

export interface VoiceBookingPlan {
  speechText: string;
  intent: "BOOKING" | "INQUIRY";
  draft: VoiceBookingDraft | null;
  commit: boolean;
  callback: boolean;
  patientName: string;
  phone: string;
  date: string;
  timeSlot: string;
  doctorName: string;
}

type Spoken = "hi" | "mr" | "en";

function addDaysIso(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatIstDateSpeech(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 6, 30));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

export function speakablePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length === 10) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  const trimmed = String(phone || "").trim();
  return trimmed;
}

export function storedPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length === 10) return `+91${local}`;
  return String(phone || "").trim();
}

export function usablePatientName(name: string): string {
  const value = String(name || "").trim();
  if (!value || /^(there|patient|caller)$/i.test(value)) return "";
  return value;
}

export function parseVoiceBookingDraft(value: unknown): VoiceBookingDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<VoiceBookingDraft>;
  const status = row.status === "collecting" || row.status === "awaiting_confirmation" ? row.status : null;
  if (!status) return null;
  return {
    patientName: String(row.patientName || "").trim(),
    date: String(row.date || "").trim(),
    timeSlot: String(row.timeSlot || "").trim(),
    phone: String(row.phone || "").trim(),
    doctorName: String(row.doctorName || "").trim(),
    failedConfirmations: Math.max(0, Number(row.failedConfirmations) || 0),
    status,
  };
}

export function classifyBookingReply(message: string): "yes" | "no" | "unclear" {
  const text = String(message || "").trim();
  if (!text) return "unclear";
  const lower = text.toLowerCase();
  if (/\b(no|nope|nah|nahi|nahin|galat|wrong|change)\b/i.test(lower) || /नहीं|नाही|गलत/.test(text)) return "no";
  if (
    /^(yes|yeah|yep|ok|okay|confirm|correct|haan|han|ha|haa|ji|theek|thik|ho|hoy|barobar)\b/.test(lower) ||
    /^(हाँ|हां|हो|होय|ठीक|सही|बरोबर)\b/.test(text) ||
    (text.length <= 40 && /\b(yes|yeah|haan|confirm)\b/i.test(lower))
  ) {
    return "yes";
  }
  return "unclear";
}

function parseSpokenTime(message: string): string {
  const match = String(message || "").match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return "";
  const suffix = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseSpokenDate(message: string, todayIso: string): string {
  const text = String(message || "");
  if (/\b(today|aaj)\b/i.test(text) || /आज/.test(text)) return todayIso;
  if (/\b(tomorrow|kal)\b/i.test(text) || /कल|उद्या/.test(text)) return addDaysIso(todayIso, 1);
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso ? iso[1] : "";
}

function parseSpokenName(message: string): string {
  const match = String(message || "").match(
    /\b(?:my name is|i am|i'm|naam hai|mera naam)\s+([A-Za-z][A-Za-z .'-]{1,40})/i
  );
  if (!match) return "";
  return match[1].trim().split(/\s+/).slice(0, 3).join(" ");
}

function parseSpokenPhone(message: string): string {
  const match = String(message || "").match(/(?:\+91[\s-]*)?\b([6-9]\d{9})\b/);
  return match ? `+91${match[1]}` : "";
}

function readBack(draft: VoiceBookingDraft, language: Spoken): string {
  const when = formatIstDateSpeech(draft.date);
  const phone = speakablePhone(draft.phone);
  const doctor = draft.doctorName.trim() || "the doctor on duty";
  if (language === "hi") {
    return `मैंने नोट किया: नाम ${draft.patientName}, तारीख ${when} IST, समय ${draft.timeSlot}, डॉक्टर ${doctor}, फ़ोन ${phone}. क्या मैं यह अपॉइंटमेंट बुक कर दूँ?`;
  }
  if (language === "mr") {
    return `मी नोंद केली: नाव ${draft.patientName}, तारीख ${when} IST, वेळ ${draft.timeSlot}, डॉक्टर ${doctor}, फोन ${phone}. मी ही अपॉइंटमेंट बुक करू का?`;
  }
  return `I have ${draft.patientName} on ${when} at ${draft.timeSlot} IST with ${doctor}, phone ${phone}. Shall I book this?`;
}

function callbackSpeech(clinicName: string, clinicPhone: string, language: Spoken): string {
  const clinic = clinicName.trim() || "the clinic";
  const phone = clinicPhone.trim();
  if (language === "hi") {
    return phone
      ? `मैं ये विवरण दो बार पक्का नहीं कर पाई। इस कॉल को ट्रांसफर नहीं किया जा सकता। कृपया क्लिनिक को ${phone} पर कॉल करें। स्टाफ आपको वापस कॉल भी करेंगे।`
      : `मैं ये विवरण दो बार पक्का नहीं कर पाई। ${clinic} का फ़ोन नंबर फ़ाइल में नहीं है। स्टाफ आपको वापस कॉल करेंगे।`;
  }
  if (language === "mr") {
    return phone
      ? `मी हे तपशील दोनदा निश्चित करू शकले नाही. ही कॉल ट्रान्सफर करता येत नाही. कृपया क्लिनिकला ${phone} वर कॉल करा. कर्मचारी तुम्हाला परत कॉल करतील.`
      : `मी हे तपशील दोनदा निश्चित करू शकले नाही. ${clinic} चा फोन नंबर फाइलमध्ये नाही. कर्मचारी तुम्हाला परत कॉल करतील.`;
  }
  return phone
    ? `I could not confirm those booking details. I cannot transfer this WhatsApp call. Please call the clinic at ${phone}. A staff member will also call you back.`
    : `I could not confirm those booking details. ${clinic} has no phone number on file. A staff member will call you back.`;
}

function emptyPlan(speechText: string, draft: VoiceBookingDraft | null, extra?: Partial<VoiceBookingPlan>): VoiceBookingPlan {
  return {
    speechText,
    intent: "INQUIRY",
    draft,
    commit: false,
    callback: false,
    patientName: draft?.patientName || "",
    phone: draft?.phone || "",
    date: draft?.date || "",
    timeSlot: draft?.timeSlot || "",
    doctorName: draft?.doctorName || "",
    ...extra,
  };
}

export function planVoiceBooking(input: {
  message: string;
  draft: VoiceBookingDraft | null;
  patientName: string;
  phone: string;
  doctorName: string;
  clinicName: string;
  clinicPhone: string;
  proposed: { date: string; timeSlot: string } | null;
  language: Spoken;
  now?: Date;
}): VoiceBookingPlan {
  const todayIso = clinicCalendarDate(input.now ?? new Date(), "Asia/Kolkata");
  const message = String(input.message || "");
  const base: VoiceBookingDraft = input.draft || {
    patientName: "",
    date: "",
    timeSlot: "",
    phone: "",
    doctorName: "",
    failedConfirmations: 0,
    status: "collecting",
  };

  if (base.status === "awaiting_confirmation") {
    const kind = classifyBookingReply(message);
    if (kind === "yes" && base.patientName && base.date && base.timeSlot && base.phone) {
      return emptyPlan("", base, {
        commit: true,
        intent: "BOOKING",
        patientName: base.patientName,
        phone: storedPhone(base.phone),
        date: base.date,
        timeSlot: base.timeSlot,
        doctorName: base.doctorName,
      });
    }
    if (kind === "no") {
      const corrected = mergeDraft(base, message, input, todayIso);
      const changed =
        corrected.patientName !== base.patientName ||
        corrected.date !== base.date ||
        corrected.timeSlot !== base.timeSlot ||
        corrected.phone !== base.phone;
      if (changed && corrected.patientName && corrected.date && corrected.timeSlot && corrected.phone) {
        const next = { ...corrected, status: "awaiting_confirmation" as const, failedConfirmations: 0 };
        return emptyPlan(readBack(next, input.language), next);
      }
      const collecting = { ...base, status: "collecting" as const };
      const ask =
        input.language === "hi"
          ? "क्या बदलना है: नाम, तारीख, समय, या फ़ोन?"
          : input.language === "mr"
            ? "काय बदलायचे आहे: नाव, तारीख, वेळ की फोन?"
            : "What should I change: the name, the date, the time, or the phone?";
      return emptyPlan(ask, collecting);
    }
    const fails = base.failedConfirmations + 1;
    if (fails >= 2) {
      return emptyPlan(callbackSpeech(input.clinicName, input.clinicPhone, input.language), null, {
        callback: true,
        patientName: base.patientName,
        phone: storedPhone(base.phone),
        date: base.date,
        timeSlot: base.timeSlot,
        doctorName: base.doctorName,
      });
    }
    const pending = { ...base, failedConfirmations: fails };
    const again =
      input.language === "hi"
        ? "कृपया हाँ या नहीं कहें। " + readBack(pending, input.language)
        : input.language === "mr"
          ? "कृपया होय किंवा नाही म्हणा. " + readBack(pending, input.language)
          : `Please say yes or no. ${readBack(pending, input.language)}`;
    return emptyPlan(again, pending);
  }

  const next = mergeDraft(base, message, input, todayIso);
  if (!next.patientName) {
    const ask =
      input.language === "hi"
        ? "अपॉइंटमेंट के लिए मरीज का नाम बता दीजिए।"
        : input.language === "mr"
          ? "अपॉइंटमेंटसाठी रुग्णाचे नाव सांगा."
          : "May I have the patient's name for the appointment?";
    return emptyPlan(ask, { ...next, status: "collecting" });
  }
  if (!next.date || !next.timeSlot) {
    const ask =
      input.language === "hi"
        ? "कौन सी तारीख और कौन सा समय चाहिए? समय IST में होगा।"
        : input.language === "mr"
          ? "कोणती तारीख आणि कोणती वेळ हवी? वेळ IST मध्ये असेल."
          : "What date and time should I book? The time will be in IST.";
    return emptyPlan(ask, { ...next, status: "collecting" });
  }
  const ready = { ...next, status: "awaiting_confirmation" as const, failedConfirmations: 0 };
  return emptyPlan(readBack(ready, input.language), ready);
}

function mergeDraft(
  base: VoiceBookingDraft,
  message: string,
  input: {
    patientName: string;
    phone: string;
    doctorName: string;
    proposed: { date: string; timeSlot: string } | null;
  },
  todayIso: string
): VoiceBookingDraft {
  const spokenName = parseSpokenName(message);
  const spokenPhone = parseSpokenPhone(message);
  const spokenDate = parseSpokenDate(message, todayIso);
  const spokenTime = parseSpokenTime(message);
  return {
    patientName: spokenName || base.patientName || usablePatientName(input.patientName),
    date: spokenDate || base.date || input.proposed?.date || "",
    timeSlot: spokenTime || base.timeSlot || input.proposed?.timeSlot || "",
    phone: spokenPhone || base.phone || storedPhone(input.phone),
    doctorName: base.doctorName || String(input.doctorName || "").trim(),
    failedConfirmations: base.failedConfirmations,
    status: base.status,
  };
}
