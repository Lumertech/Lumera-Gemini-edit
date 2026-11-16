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
  /** How many times this call already asked for the name, or for the day and time. */
  slotAsks?: { patientName: number; when: number };
  /** Cut-off or unconfirmed fragment. "Yes" on a later turn accepts it. */
  pendingName?: string;
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

function asDraft(draft?: Partial<VoiceBookingDraft> | null): VoiceBookingDraft {
  const slotAsks = draft?.slotAsks;
  const status = draft?.status === "awaiting_confirmation" ? "awaiting_confirmation" : "collecting";
  return {
    patientName: String(draft?.patientName || "").trim(),
    date: String(draft?.date || "").trim(),
    timeSlot: String(draft?.timeSlot || "").trim(),
    phone: String(draft?.phone || "").trim(),
    doctorName: String(draft?.doctorName || "").trim(),
    failedConfirmations: Math.max(0, Number(draft?.failedConfirmations) || 0),
    status,
    slotAsks: {
      patientName: Math.max(0, Number(slotAsks?.patientName) || 0),
      when: Math.max(0, Number(slotAsks?.when) || 0),
    },
    pendingName: String(draft?.pendingName || "").trim(),
  };
}

export function parseVoiceBookingDraft(value: unknown): VoiceBookingDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<VoiceBookingDraft>;
  const status = row.status === "collecting" || row.status === "awaiting_confirmation" ? row.status : null;
  if (!status) return null;
  return asDraft({ ...row, status });
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

/** Devanagari words must be whole tokens. "आज" is today; "आजाद" is a name. */
function devWord(words: string): RegExp {
  return new RegExp(`(?<![\\u0900-\\u097F])(?:${words})(?![\\u0900-\\u097F])`);
}

function parseSpokenDate(message: string, todayIso: string): string {
  const text = String(message || "");
  if (/\b(today|aaj)\b/i.test(text) || devWord("आज").test(text)) return todayIso;
  if (/\b(tomorrow|kal)\b/i.test(text) || devWord("कल|उद्या").test(text)) return addDaysIso(todayIso, 1);
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
  "the", "and", "for", "with", "this", "that", "calling", "here", "speaking", "hmm", "uh", "um", "umm",
  "uhh", "ah", "er", "sorry", "noise", "static", "silence", "inaudible", "unintelligible", "background",
  "cough", "breath", "is", "am", "hai", "hain", "aahe", "ahe", "hoon", "hun", "hu", "name", "naam",
  "naav", "nav", "later", "callback", "human", "staff", "receptionist", "operator",
  "नमस्ते", "नमस्कार", "हाँ", "हां", "नहीं", "आज", "कल", "डॉक्टर", "अपॉइंटमेंट", "जी",
  "हो", "होय", "नाही", "उद्या", "मेरा", "मेरी", "मेरे", "नाम", "नाव", "माझे", "माझा", "माझं", "माझ्या",
  "है", "आहे", "हूँ", "हूं",
]);

/**
 * Clip after the name. Devanagari markers are whole tokens, so names that
 * merely contain those letters (आजाद, कल्याण, संजीव, हैदर, जीवन) stay intact.
 */
const NAME_CLIP = /(?:[।.!?,;]|\b(?:and|please|calling|here|speaking|bol|raha|rahi|hoon|hun|hai|hain|aahe|ahe|for|appointment|book|tomorrow|today|kal|aaj)\b|(?<![\u0900-\u097F])(?:उद्या|आज|कल|है|हूँ|हूं|आहे|जी|बोल)(?![\u0900-\u097F]))/i;

function takeName(raw: string): string {
  const clipped = String(raw || "").split(NAME_CLIP)[0] || "";
  const parts = clipped.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const kept: string[] = [];
  for (let i = 0; i < parts.length && kept.length < 3; i += 1) {
    const part = parts[i];
    if (/^[A-Za-z]\.$/.test(part)) {
      kept.push(part);
      continue;
    }
    const token = part.replace(/^[.'’\-]+|[.'’\-]+$/g, "");
    const lower = token.toLowerCase();
    if (!token || NOT_A_NAME.has(token) || NOT_A_NAME.has(lower)) {
      if (kept.length === 0) continue;
      break;
    }
    if (!/^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'’\-]*$/.test(token)) break;
    if (token.length < 2) {
      const laterName = parts.slice(i + 1).some((item) => item.replace(/[.'’\-]/g, "").length >= 2);
      if (laterName && /^[A-Za-z]$/.test(token)) {
        kept.push(token.toUpperCase());
        continue;
      }
      if (kept.length === 0) continue;
      break;
    }
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
    new RegExp(`\\b(?:my name(?:\\s+is)?|name is|i am|i'm|i’m|this is|patient(?:'s)? name is|booking for)\\s+(${NAME_PHRASE})`, "i"),
    new RegExp(`\\b(?:mera naam(?:\\s+hai)?|naam(?:\\s+hai)?|(?:majhe|majha|mazhe|mazha|maze|maza)\\s+(?:naav|nav)(?:\\s+aahe|\\s+ahe)?)\\s+(${NAME_PHRASE})`, "i"),
    new RegExp(`\\b(?:main|mai)\\s+(${NAME_PHRASE})\\s+(?:bol|hoon|hun|hu)\\b`, "i"),
    new RegExp(`(?:मेरा नाम(?:\\s+है)?|नाम(?:\\s+है)?|माझे नाव(?:\\s+आहे)?|माझं नाव(?:\\s+आहे)?|माझा नाव(?:\\s+आहे)?|माझ्या नाव(?:\\s+आहे)?|नाव(?:\\s+आहे)?)\\s+(${NAME_PHRASE})`),
    new RegExp(`(?:मैं|मी)\\s+(${NAME_PHRASE})\\s+(?:बोल|हूँ|हूं|आहे)`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match ? takeName(match[1]) : "";
    if (name) return name;
  }
  return "";
}

const LEADING_NOISE = /^(?:\[(?:noise|static|silence|inaudible|background|cough|breath|unintelligible|uh+|um+|hmm+)\]|(?:uh+|um+|umm+|uhh+|hmm+|hm+|mm+|ah+|er+|err+|noise|static|inaudible|unintelligible|silence|background|cough|breath|sorry|please|yes|yeah|yep|ok|okay|haan|haa|han|ha|ji|theek|thik|hai|hain|hello|hi|hey|namaste|namaskar|हाँ|हां|हो|होय|ठीक|सही|बरोबर|जी|नमस्ते|नमस्कार))[\s,.:;]+/i;

/** "haan Priya", "uh, Ravi", and "[noise] प्रिया" still carry the name. */
function stripLeadingNoise(text: string): string {
  let value = String(text || "").trim();
  for (let i = 0; i < 6; i += 1) {
    const next = value.replace(LEADING_NOISE, "").trim();
    if (!next || next === value) break;
    value = next;
  }
  return value;
}

const NAME_PREFACE = /^(?:my name is|my name|this is|i am|i'm|i’m|name is|mera naam hai|mera naam|naam hai|naam|majhe naav aahe|majhe naav ahe|majhe naav|majha naav aahe|majha naav|mazhe naav aahe|mazhe naav ahe|mazhe naav|mazha naav aahe|mazha naav|maze naav aahe|maze naav|maza naav aahe|maza naav|majhe nav|majha nav|maze nav|maza nav|naav|मेरा नाम है|मेरा नाम|नाम है|माझे नाव आहे|माझे नाव|माझं नाव आहे|माझं नाव|माझा नाव आहे|माझा नाव|माझ्या नाव आहे|माझ्या नाव|नाव आहे|नाव|नाम)\s+/i;

function stripNamePreface(text: string): string {
  return String(text || "").replace(NAME_PREFACE, "").trim();
}

/** "my name is" or "मेरा नाम" with the name cut off is not a name. */
function isPrefaceOnly(text: string): boolean {
  return /^(?:my name(?:\s+is)?|name is|i am|i'm|i’m|this is|mera naam(?:\s+hai)?|naam(?:\s+hai)?|(?:majhe|majha|mazhe|mazha|maze|maza)\s+(?:naav|nav)(?:\s+(?:aahe|ahe))?|मेरा नाम(?:\s+है)?|नाम(?:\s+है)?|माझे नाव(?:\s+आहे)?|माझं नाव(?:\s+आहे)?|माझा नाव(?:\s+आहे)?|माझ्या नाव(?:\s+आहे)?|नाव(?:\s+आहे)?)\s*[.।!?]*$/i.test(String(text || "").trim());
}

/** "Pri-" or "Priya..." was cut off. The fragment is confirmed later, not stored as the name. */
function cutoffCandidate(text: string): string {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/([\p{L}][\p{L}'’-]{0,24}?)(?:[-–—…]+|\.{3})\s*$/u);
  if (!match) return "";
  const token = match[1].replace(/[.'’\-]+$/g, "");
  if (token.length < 2 || NOT_A_NAME.has(token) || NOT_A_NAME.has(token.toLowerCase())) return "";
  return token;
}

function spelledName(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed || !/^[\p{L}\s.'’-]+$/u.test(trimmed)) return "";
  const groups = trimmed.split(/\s{2,}|\s+space\s+/i);
  const words: string[] = [];
  let sawLetter = false;
  for (const group of groups) {
    const tokens = group.trim().split(/[\s-]+/).filter(Boolean);
    if (tokens.length < 2 || !tokens.every((token) => token.length === 1 && /^\p{L}$/u.test(token))) continue;
    sawLetter = true;
    const raw = tokens.join("");
    words.push(/[A-Za-z]/.test(raw) ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : raw);
  }
  if (!sawLetter) return "";
  return words.join(" ").trim();
}

function bareName(message: string): string {
  const text = String(message || "").trim().replace(/[।.!?]+$/g, "");
  if (!text || text.length > 48) return "";
  if (classifyBookingReply(text) !== "unclear") return "";
  if (parseSpokenTime(text)) return "";
  if (/\b(today|tomorrow|aaj|kal|udya)\b/i.test(text) || devWord("आज|कल|उद्या").test(text)) return "";
  if (!new RegExp(`^${NAME_PHRASE}$`, "i").test(text)) return "";
  return takeName(text);
}

function parseCleanName(text: string, allowBareName: boolean): string {
  if (isPrefaceOnly(text)) return "";
  const introduced = introducedName(text);
  if (introduced) return introduced;
  const prefaced = stripNamePreface(text);
  const spelled = spelledName(text) || spelledName(prefaced);
  if (spelled) return spelled;
  if (!allowBareName) return "";
  return bareName(prefaced) || (prefaced === text ? "" : bareName(text));
}

function parseSpokenName(message: string, allowBareName = false): string {
  const cleaned = stripLeadingNoise(withoutDoctor(message));
  if (!cleaned || cutoffCandidate(cleaned)) return "";
  return parseCleanName(cleaned, allowBareName);
}

function hearPatientName(message: string, allowBareName: boolean, pendingName: string): { name: string; candidate: string } {
  const cleaned = stripLeadingNoise(withoutDoctor(message));
  if (wantsLaterOrHuman(message) && !introducedName(cleaned)) return { name: "", candidate: "" };
  const cut = cutoffCandidate(cleaned);
  if (cut) return { name: "", candidate: cut };
  const name = cleaned ? parseCleanName(cleaned, allowBareName) : "";
  if (name) return { name, candidate: "" };
  if (pendingName && classifyBookingReply(message) === "yes") return { name: pendingName, candidate: "" };
  return { name: "", candidate: "" };
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

export function mayaAskedForWhen(speech: string): boolean {
  return /what date and time should i book|कौन सी तारीख और कौन सा समय|कोणती तारीख आणि कोणती वेळ/i.test(String(speech || ""));
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
  const base = asDraft(prior);
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

const NAME_ASK: Record<Spoken, string> = {
  en: "May I have the patient's name for the appointment?",
  hi: "अपॉइंटमेंट के लिए मरीज का नाम बता दीजिए।",
  mr: "अपॉइंटमेंटसाठी रुग्णाचे नाव सांगा.",
};

const WHEN_ASK: Record<Spoken, string> = {
  en: "What date and time should I book? The time will be in IST.",
  hi: "कौन सी तारीख और कौन सा समय चाहिए? समय IST में होगा।",
  mr: "कोणती तारीख आणि कोणती वेळ हवी? वेळ IST मध्ये असेल.",
};

function historySlotAsks(history: VoiceHistoryTurn[] | undefined, kind: "patientName" | "when"): number {
  const matches = kind === "patientName" ? mayaAskedForPatientName : mayaAskedForWhen;
  return (history || []).filter((turn) => String(turn?.role || "") === "maya" && matches(String(turn?.text || ""))).length;
}

function slotAskCount(history: VoiceHistoryTurn[] | undefined, draft: VoiceBookingDraft, kind: "patientName" | "when"): number {
  const saved = kind === "patientName" ? draft.slotAsks?.patientName : draft.slotAsks?.when;
  return Math.max(Math.max(0, Number(saved) || 0), historySlotAsks(history, kind));
}

function wantsLaterOrHuman(message: string): boolean {
  const text = String(message || "");
  return /\b(?:later|call me back|callback|human|staff|receptionist|operator)\b/i.test(text)
    || /बाद में|कॉल कर|नंतर|स्टाफ|रिसेप्शन/.test(text);
}

function nameGuardSpeech(language: Spoken, candidate: string): string {
  if (language === "hi") {
    return candidate
      ? `मैंने ${candidate} सुना। क्या यह सही है? आप स्पेल कर सकते हैं, बाद में बता सकते हैं, या क्लिनिक आपको कॉल करेगा।`
      : `यह साफ़ नहीं मिला। कृपया स्पेल कीजिए, बाद में बताइए, या क्लिनिक आपको कॉल करेगा।`;
  }
  if (language === "mr") {
    return candidate
      ? `मी ${candidate} ऐकले. हे बरोबर आहे का? तुम्ही स्पेल करू शकता, नंतर सांगू शकता, किंवा क्लिनिक तुम्हाला कॉल करेल.`
      : `हे स्पष्ट ऐकू आले नाही. कृपया स्पेल करा, नंतर सांगा, किंवा क्लिनिक तुम्हाला कॉल करेल.`;
  }
  return candidate
    ? `I heard ${candidate}. Is that right? You can spell it, leave it for later, or I can ask the clinic to call you back.`
    : `I still don't have it. Please spell it, leave it for later, or I can ask the clinic to call you back.`;
}

function whenGuardSpeech(language: Spoken, heard: string): string {
  if (language === "hi") {
    return heard
      ? `मैंने ${heard} सुना। दिन या समय अभी अधूरा है। आप बता सकते हैं, बाद में बता सकते हैं, या क्लिनिक आपको कॉल करेगा।`
      : `दिन और समय अभी नहीं मिला। आप बता सकते हैं, बाद में बता सकते हैं, या क्लिनिक आपको कॉल करेगा।`;
  }
  if (language === "mr") {
    return heard
      ? `मी ${heard} ऐकले. दिवस किंवा वेळ अजून अपुरी आहे. तुम्ही सांगू शकता, नंतर सांगू शकता, किंवा क्लिनिक तुम्हाला कॉल करेल.`
      : `दिवस आणि वेळ अजून मिळाली नाही. तुम्ही सांगू शकता, नंतर सांगू शकता, किंवा क्लिनिक तुम्हाला कॉल करेल.`;
  }
  return heard
    ? `I heard ${heard}. I still need the rest of the day and time. You can say it, leave it for later, or I can ask the clinic to call you back.`
    : `I still don't have the day and time. You can say it, leave it for later, or I can ask the clinic to call you back.`;
}

function withSlotAsk(draft: VoiceBookingDraft, kind: "patientName" | "when", count: number, pendingName?: string): VoiceBookingDraft {
  const slotAsks = {
    patientName: draft.slotAsks?.patientName || 0,
    when: draft.slotAsks?.when || 0,
    [kind]: count,
  };
  return { ...draft, slotAsks, pendingName: pendingName ?? draft.pendingName ?? "" };
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
  const base = asDraft(input.draft);
  const heard = collectVoiceSlots(message, input.history, todayIso);
  const allowBareName = mayaAskedForPatientName(lastMayaText(input.history)) || (!base.patientName && Boolean(input.draft));
  const hearing = hearPatientName(message, allowBareName, base.pendingName || "");
  const spokenName = hearing.name;
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
    const correctedAnyway = mergeDraft(base, message, input, todayIso, heard, allowBareName, spokenName);
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

  const next = mergeDraft(base, message, input, todayIso, heard, allowBareName, spokenName);
  if (!next.patientName) {
    const asked = slotAskCount(input.history, base, "patientName");
    const candidate = hearing.candidate || base.pendingName || "";
    const stalled = { ...next, status: "collecting" as const, pendingName: candidate };
    if ((asked >= 2 && wantsLaterOrHuman(message)) || asked >= 3) {
      return emptyPlan(callbackSpeech(input.clinicName, input.clinicPhone, input.language), null, {
        callback: true,
        patientName: candidate,
      });
    }
    if (asked >= 2) {
      return emptyPlan(nameGuardSpeech(input.language, candidate), withSlotAsk(stalled, "patientName", asked + 1, candidate));
    }
    return emptyPlan(NAME_ASK[input.language], withSlotAsk(stalled, "patientName", asked + 1, candidate));
  }
  if (!next.date || !next.timeSlot) {
    const asked = slotAskCount(input.history, base, "when");
    const heardWhen = [heard.date ? formatIstDateSpeech(heard.date) : "", heard.timeSlot].filter(Boolean).join(", ");
    const collecting = { ...next, status: "collecting" as const, pendingName: "" };
    if ((asked >= 2 && wantsLaterOrHuman(message)) || asked >= 3) {
      return emptyPlan(callbackSpeech(input.clinicName, input.clinicPhone, input.language), null, {
        callback: true,
        patientName: next.patientName,
        phone: storedPhone(next.phone),
        date: next.date,
        timeSlot: next.timeSlot,
        doctorName: next.doctorName,
      });
    }
    if (asked >= 2) {
      const speech = namedThisTurn
        ? `${thanksForName(next.patientName, input.language)} ${whenGuardSpeech(input.language, heardWhen)}`
        : whenGuardSpeech(input.language, heardWhen);
      return emptyPlan(speech, withSlotAsk(collecting, "when", asked + 1, ""));
    }
    const ask = WHEN_ASK[input.language];
    const speech = namedThisTurn ? `${thanksForName(next.patientName, input.language)} ${ask}` : ask;
    return emptyPlan(speech, withSlotAsk(collecting, "when", asked + 1, ""));
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
  allowBareName = false,
  resolvedName?: string
): VoiceBookingDraft {
  const spokenName = resolvedName ?? parseSpokenName(message, allowBareName);
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
    slotAsks: base.slotAsks,
    pendingName: spokenName ? "" : base.pendingName,
  };
}

/**
 * Backstop for a model reply that asks again after Maya already asked twice.
 * History counts only completed turns, so the ask she is speaking now is not counted twice.
 */
export function applyRepeatedSlotGuard(input: {
  speech: string;
  history?: VoiceHistoryTurn[];
  draft: VoiceBookingDraft | null;
  language: Spoken;
  clinicName: string;
  clinicPhone: string;
}): { speech: string; draft: VoiceBookingDraft | null; callback: boolean; replaced: boolean } {
  const speech = String(input.speech || "");
  const draft = input.draft ? asDraft(input.draft) : null;
  const nameAsks = historySlotAsks(input.history, "patientName");
  if (draft && mayaAskedForPatientName(speech) && nameAsks >= 2) {
    if ((draft.slotAsks?.patientName || 0) >= 3) {
      return {
        speech: callbackSpeech(input.clinicName, input.clinicPhone, input.language),
        draft: null,
        callback: true,
        replaced: true,
      };
    }
    const candidate = draft.pendingName || "";
    return {
      speech: nameGuardSpeech(input.language, candidate),
      draft: withSlotAsk(draft, "patientName", Math.max(nameAsks, draft.slotAsks?.patientName || 0) + 1, candidate),
      callback: false,
      replaced: true,
    };
  }
  const whenAsks = historySlotAsks(input.history, "when");
  if (draft && mayaAskedForWhen(speech) && whenAsks >= 2) {
    if ((draft.slotAsks?.when || 0) >= 3) {
      return {
        speech: callbackSpeech(input.clinicName, input.clinicPhone, input.language),
        draft: null,
        callback: true,
        replaced: true,
      };
    }
    const heardWhen = [draft.date ? formatIstDateSpeech(draft.date) : "", draft.timeSlot].filter(Boolean).join(", ");
    return {
      speech: whenGuardSpeech(input.language, heardWhen),
      draft: withSlotAsk(draft, "when", Math.max(whenAsks, draft.slotAsks?.when || 0) + 1, ""),
      callback: false,
      replaced: true,
    };
  }
  return { speech, draft: input.draft, callback: false, replaced: false };
}
