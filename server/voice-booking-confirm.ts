import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { prepareMayaSpokenText, stripDoctorTitles, withSingleDoctorTitle } from "./voice-doctor-name.ts";

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
  if (!value || /^(there|patient|caller|unknown)$/i.test(value)) return "";
  return value;
}

export interface VoiceHistoryTurn {
  role?: string;
  text?: string;
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

function formatClock(hour: number, minute: number, suffix: "AM" | "PM"): string {
  if (hour < 1 || hour > 12 || minute > 59) return "";
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseSpokenTime(message: string): string {
  const text = String(message || "");
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (match) {
    const suffix = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
    return formatClock(Number(match[1]), match[2] ? Number(match[2]) : 0, suffix);
  }
  const daypart = text.match(/(सुबह|सकाळी|morning|subah|शाम|संध्याकाळी|evening|shaam|दोपहर|दुपारी|afternoon)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (daypart) {
    const word = daypart[1].toLowerCase();
    const pm = /शाम|संध्या|evening|shaam|दोपहर|दुपार|afternoon/.test(word);
    return formatClock(Number(daypart[2]), daypart[3] ? Number(daypart[3]) : 0, pm ? "PM" : "AM");
  }
  const baje = text.match(/(\d{1,2})(?::(\d{2}))?\s*(?:बजे|वाजता)/);
  if (!baje) return "";
  const hour = Number(baje[1]);
  const minute = baje[2] ? Number(baje[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return "";
  return formatClock(hour, minute, hour >= 1 && hour <= 7 ? "PM" : "AM");
}

function parseSpokenDate(message: string, todayIso: string): string {
  const text = String(message || "");
  if (/\b(today|aaj)\b/i.test(text) || /आज/.test(text)) return todayIso;
  if (/\b(tomorrow|kal)\b/i.test(text) || /कल|उद्या/.test(text)) return addDaysIso(todayIso, 1);
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso ? iso[1] : "";
}

const LATIN_NAME = "[A-Za-z][A-Za-z.'’\\-]*";
const DEV_NAME = "[\\u0900-\\u097F][\\u0900-\\u097F.'’\\-]*";
const NAME_TOKEN = `(?:${LATIN_NAME}|${DEV_NAME})`;
const NAME_PHRASE = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2}`;

const NOT_A_NAME = new Set([
  "there", "patient", "caller", "unknown", "doctor", "dr", "appointment", "book", "booking", "slot",
  "today", "tomorrow", "yesterday", "yes", "no", "yeah", "yep", "ok", "okay", "haan", "han", "ha", "ji",
  "hello", "hi", "hey", "namaste", "namaskar", "aaj", "kal", "udya", "please", "thanks", "thank", "you",
  "the", "and", "for", "with", "this", "that", "calling", "here", "speaking", "hmm", "uh", "um",
  "नमस्ते", "नमस्कार", "हाँ", "हां", "नहीं", "आज", "कल", "डॉक्टर", "अपॉइंटमेंट", "जी",
  "हो", "होय", "नाही", "उद्या",
]);

function takeName(raw: string): string {
  const clipped = String(raw || "").split(
    /(?:[।.!?,;]|\b(?:and|please|calling|here|speaking|bol|raha|rahi|hoon|hun|hai|hain|aahe|ahe|for|appointment|book|tomorrow|today|kal|aaj)\b|उद्या|आज|कल|है|हूँ|हूं|आहे|जी|बोल)/i
  )[0] || "";
  const parts = clipped.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const kept: string[] = [];
  for (const part of parts) {
    if (/^[A-Za-z]\.$/.test(part)) {
      kept.push(part);
      continue;
    }
    const token = part.replace(/^[.'’\-]+|[.'’\-]+$/g, "");
    if (!token || NOT_A_NAME.has(token) || NOT_A_NAME.has(token.toLowerCase())) break;
    if (!/^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*$/.test(token)) break;
    if (token.length < 2) break;
    kept.push(token);
  }
  return kept.join(" ").trim();
}

function withoutDoctor(message: string): string {
  return String(message || "").replace(
    /(?:^|\s)(?:dr\.?|doctor|डॉक्टर|डॉ\.?)\s+[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*(?:\s+[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*){0,2}/gi,
    " "
  );
}

function introducedName(message: string): string {
  const text = String(message || "");
  const patterns = [
    new RegExp(`\\b(?:my name is|name is|i am|i'm|this is|patient(?:'s)? name is|booking for)\\s+(${NAME_PHRASE})`, "i"),
    new RegExp(`\\b(?:mera naam(?:\\s+hai)?|naam hai|majhe naav(?:\\s+aahe)?|majha nav|maze nav|maza nav|majhe nav)\\s+(${NAME_PHRASE})`, "i"),
    new RegExp(`\\b(?:main|mai)\\s+(${NAME_PHRASE})\\s+(?:bol|hoon|hun|hu)\\b`, "i"),
    new RegExp(`(?:मेरा नाम(?:\\s+है)?|नाम है|माझे नाव(?:\\s+आहे)?|नाव आहे)\\s+(${NAME_PHRASE})`),
    new RegExp(`(?:मैं|मी)\\s+(${NAME_PHRASE})\\s+(?:बोल|हूँ|हूं|आहे)`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match ? takeName(match[1]) : "";
    if (name) return name;
  }
  return "";
}

function bareName(message: string): string {
  const text = String(message || "").trim().replace(/[।.!?]+$/g, "");
  if (!text || text.length > 48) return "";
  if (classifyBookingReply(text) !== "unclear") return "";
  if (parseSpokenTime(text)) return "";
  if (/\b(today|tomorrow|aaj|kal|udya)\b|आज|कल|उद्या/i.test(text)) return "";
  if (!new RegExp(`^${NAME_PHRASE}$`, "i").test(text)) return "";
  return takeName(text);
}

function parseSpokenName(message: string, allowBareName = false): string {
  const introduced = introducedName(withoutDoctor(message));
  if (introduced) return introduced;
  if (allowBareName) return bareName(withoutDoctor(message));
  return "";
}

export function parseSpokenDoctor(message: string): string {
  const match = String(message || "").match(
    /(?:^|\s)(?:dr\.?|doctor|डॉक्टर|डॉ\.?)\s+([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*(?:\s+[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*){0,2})/i
  );
  return match ? takeName(stripDoctorTitles(match[1])) : "";
}

export function mayaAskedForPatientName(speech: string): boolean {
  return /patient's name|may i have the (?:patient's )?name|what is your name|your name for the appointment|मरीज का नाम|नाम बता|रुग्णाचे नाव|नाव सांग/i.test(String(speech || ""));
}

function lastMayaText(history: VoiceHistoryTurn[] | undefined): string {
  const turns = history || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    if (String(turns[i]?.role || "") === "maya" && String(turns[i]?.text || "").trim()) {
      return String(turns[i]?.text || "");
    }
  }
  return "";
}

export interface CollectedVoiceSlots {
  patientName: string;
  doctorName: string;
  date: string;
  timeSlot: string;
}

/** Names, doctor, and date/time heard earlier in the call, including this utterance. */
export function collectVoiceSlots(message: string, history: VoiceHistoryTurn[] | undefined, todayIso: string): CollectedVoiceSlots {
  const sequence = [...(history || []), { role: "caller", text: message }];
  let patientName = "";
  let doctorName = "";
  let date = "";
  let timeSlot = "";
  let previousMaya = "";
  for (const turn of sequence) {
    const role = String(turn?.role || "");
    const text = String(turn?.text || "").trim();
    if (!text) continue;
    if (role === "maya") {
      previousMaya = text;
      continue;
    }
    if (role !== "caller") continue;
    const name = parseSpokenName(text, mayaAskedForPatientName(previousMaya));
    if (name) patientName = name;
    const doctor = parseSpokenDoctor(text);
    if (doctor) doctorName = doctor;
    const spokenDate = parseSpokenDate(text, todayIso);
    if (spokenDate) date = spokenDate;
    const spokenTime = parseSpokenTime(text);
    if (spokenTime) timeSlot = spokenTime;
  }
  return { patientName, doctorName, date, timeSlot };
}

export function withHeardSlots(prior: VoiceBookingDraft | null, heard: CollectedVoiceSlots): VoiceBookingDraft | null {
  const learned = Boolean(heard.patientName || heard.doctorName || heard.date || heard.timeSlot);
  if (!prior && !learned) return null;
  const base: VoiceBookingDraft = prior || {
    patientName: "",
    date: "",
    timeSlot: "",
    phone: "",
    doctorName: "",
    failedConfirmations: 0,
    status: "collecting",
  };
  return {
    ...base,
    patientName: heard.patientName || base.patientName,
    doctorName: heard.doctorName || base.doctorName,
    date: heard.date || base.date,
    timeSlot: heard.timeSlot || base.timeSlot,
  };
}

function thanksForName(name: string, language: Spoken): string {
  if (language === "en") return `Thank you, ${name}.`;
  return `धन्यवाद, ${name}.`;
}

function parseSpokenPhone(message: string): string {
  const match = String(message || "").match(/(?:\+91[\s-]*)?\b([6-9]\d{9})\b/);
  return match ? `+91${match[1]}` : "";
}

function titledDoctor(name: string, language: Spoken): string {
  const titled = withSingleDoctorTitle(name, language);
  if (titled) return titled;
  if (language === "hi" || language === "mr") return "डॉक्टर";
  return "the doctor on duty";
}

function readBack(draft: VoiceBookingDraft, language: Spoken): string {
  const when = formatIstDateSpeech(draft.date);
  const phone = speakablePhone(draft.phone);
  const doctor = titledDoctor(draft.doctorName, language);
  if (language === "hi") {
    return prepareMayaSpokenText(`मैंने नोट किया: नाम ${draft.patientName}, तारीख ${when} IST, समय ${draft.timeSlot}, ${doctor}, फ़ोन ${phone}. क्या मैं यह अपॉइंटमेंट बुक कर दूँ?`);
  }
  if (language === "mr") {
    return prepareMayaSpokenText(`मी नोंद केली: नाव ${draft.patientName}, तारीख ${when} IST, वेळ ${draft.timeSlot}, ${doctor}, फोन ${phone}. मी ही अपॉइंटमेंट बुक करू का?`);
  }
  return prepareMayaSpokenText(`I have ${draft.patientName} on ${when} at ${draft.timeSlot} IST with ${doctor}, phone ${phone}. Shall I book this?`);
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
  history?: VoiceHistoryTurn[];
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
  const heard = collectVoiceSlots(message, input.history, todayIso);
  const allowBareName = mayaAskedForPatientName(lastMayaText(input.history)) || (!base.patientName && Boolean(input.draft));
  const spokenName = parseSpokenName(message, allowBareName);
  const namedThisTurn = Boolean(spokenName) && spokenName !== base.patientName;

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
        corrected.phone !== base.phone ||
        corrected.doctorName !== base.doctorName;
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
    const correctedAnyway = mergeDraft(base, message, input, todayIso, heard, allowBareName);
    const slotChanged =
      correctedAnyway.patientName !== base.patientName ||
      correctedAnyway.date !== base.date ||
      correctedAnyway.timeSlot !== base.timeSlot ||
      correctedAnyway.phone !== base.phone ||
      correctedAnyway.doctorName !== base.doctorName;
    if (slotChanged && correctedAnyway.patientName && correctedAnyway.date && correctedAnyway.timeSlot && correctedAnyway.phone) {
      const next = { ...correctedAnyway, status: "awaiting_confirmation" as const, failedConfirmations: 0 };
      return emptyPlan(readBack(next, input.language), next);
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

  const next = mergeDraft(base, message, input, todayIso, heard, allowBareName);
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
    const speech = namedThisTurn ? `${thanksForName(next.patientName, input.language)} ${ask}` : ask;
    return emptyPlan(speech, { ...next, status: "collecting" });
  }
  const ready = { ...next, status: "awaiting_confirmation" as const, failedConfirmations: 0 };
  const read = readBack(ready, input.language);
  const speech = namedThisTurn ? `${thanksForName(ready.patientName, input.language)} ${read}` : read;
  return emptyPlan(speech, ready);
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
  todayIso: string,
  heard?: CollectedVoiceSlots,
  allowBareName = false
): VoiceBookingDraft {
  const spokenName = parseSpokenName(message, allowBareName);
  const spokenPhone = parseSpokenPhone(message);
  const spokenDate = parseSpokenDate(message, todayIso);
  const spokenTime = parseSpokenTime(message);
  const spokenDoctor = parseSpokenDoctor(message);
  const doctorSource = spokenDoctor || base.doctorName || heard?.doctorName || String(input.doctorName || "");
  return {
    patientName: spokenName || base.patientName || heard?.patientName || usablePatientName(input.patientName),
    date: spokenDate || base.date || heard?.date || input.proposed?.date || "",
    timeSlot: spokenTime || base.timeSlot || heard?.timeSlot || input.proposed?.timeSlot || "",
    phone: spokenPhone || base.phone || storedPhone(input.phone),
    doctorName: stripDoctorTitles(doctorSource) || doctorSource.trim(),
    failedConfirmations: base.failedConfirmations,
    status: base.status,
  };
}
