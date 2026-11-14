import type { MayaSpokenLanguage } from "./voice-tts.ts";

/**
 * Call-level language for Maya.
 *
 * mayaSpokenLanguage still classifies one utterance. A live call must not use
 * that result as the voice for the turn. The gateway already keeps
 * conversationHistory and bookingDraft on active_calls[call_id] and sends them
 * back on the next turn (the slot memory from the one-voice change). This lock
 * is rebuilt from that same history plus the current transcript, so it stays
 * on the call without a second store.
 *
 * The greeting language (English, or an explicit clinic default) is used until
 * the first substantive utterance. After that Maya follows the caller on the
 * same turn when the utterance is clearly English, Hindi, or Marathi: enough
 * words, and more than one language signal. An explicit request
 * ("Hindi mein baat karo", "Marathi madhe bola", "speak English") also
 * switches immediately. A name, number, yes/no, haan, ok, date, doctor name,
 * or a loanword such as okay, doctor, or appointment does not move the lock.
 * Mixed Hinglish, where English and Hindi are both strong, stays put. That
 * confidence and word-count check replaces the old two-turn wait. Roman
 * Hinglish counts as Hindi only with several Hindi words, not from a model
 * hint or one word.
 */

export interface MayaLanguageTurn {
  role?: string;
  text?: string;
}

export interface MayaCallLanguage {
  language: MayaSpokenLanguage;
  locked: boolean;
  /** Always empty. A clear utterance switches on this turn, so nothing waits. */
  pendingLanguage: MayaSpokenLanguage | null;
  pendingCount: number;
}

/** A clear utterance needs at least this many words, not a single loanword. */
export const MIN_CLEAR_LANGUAGE_WORDS = 3;

const LOANWORDS = new Set([
  "okay", "ok", "doctor", "dr", "appointment", "slot", "clinic", "token", "opd",
]);

const ENGLISH_FUNCTION = new Set([
  "i", "im", "me", "my", "mine", "you", "your", "we", "our", "the", "a", "an",
  "please", "need", "want", "where", "when", "what", "how", "can", "could",
  "would", "should", "is", "are", "am", "for", "to", "of", "with", "help",
  "located", "location", "this", "that", "have", "has", "do", "does", "did",
  "be", "was", "were", "will", "just", "like", "about", "from", "there", "here",
  "address", "book", "booking", "open", "hours", "timing", "timings", "fee", "fees",
]);

/** Roman Hindi content words. Fillers and dates are intentionally absent. */
const ROMAN_HINDI = new Set([
  "mujhe", "mujhko", "mereko", "mera", "meri", "mere", "chahiye", "chahie", "chaiye",
  "chaahiye", "kripya", "kripaya", "bataiye", "batao", "bataye", "kahan", "kaha",
  "kaise", "kaese", "kya", "kyun", "kyon", "baat", "karo", "karna", "kijiye",
  "kijiyega", "hai", "hain", "hoon", "hun", "aap", "aapka", "apka", "apki", "aapko",
  "namaste", "namaskar", "bukhar", "dikhao", "dikhaiye", "dikhana", "milna",
  "suniye", "suno", "rukiye", "zaroor", "zarur", "bilkul", "shukriya", "dhanyavad",
  "dhanyavaad", "maaf", "maafi", "samay", "tarikh", "waqt", "kitna", "kitne",
  "kaun", "kaunsa", "konsa", "konsi", "baithenge",
]);

/** Roman Marathi content words. Shared yes/no words are not in this set. */
const ROMAN_MARATHI = new Set([
  "pahije", "aahe", "ahe", "mala", "majhe", "majha", "mazhe", "mazha",
  "tumcha", "tumchi", "tumhala", "dakhvayche", "dakhavayche", "dakhva", "konate",
  "konta", "konti", "kasa", "kase", "madhe", "madhye", "bolat",
]);

const HINDI_MARKERS = new Set([
  "है", "हैं", "हूँ", "हो", "मुझे", "मेरा", "मेरी", "मेरे", "चाहिए", "चाहिये",
  "क्या", "कौन", "कब", "कहाँ", "कहां", "कैसे", "बताइए", "बताओ", "कीजिए", "करो",
  "करना", "नहीं", "आप", "आपका", "आपकी", "लिए", "यह", "वह", "और", "का", "की",
  "के", "को", "में", "से", "ने", "भी", "नमस्ते", "माफ़", "माफ", "कृपया",
]);

const MARATHI_MARKERS = new Set([
  "आहे", "आहेत", "नाही", "झाले", "मला", "माझे", "माझा", "तुमची", "तुमच्या",
  "तुमचे", "तुम्ही", "हवी", "हवे", "दाखवायचे", "दाखवा", "कोणते", "कोणती",
  "कोणता", "मध्ये", "नमस्कार", "पाहिजे", "कंबरदुखी", "बोला",
]);

const YES_NO = new Set([
  "yes", "yeah", "yep", "yup", "ok", "okay", "confirm", "correct", "haan", "han",
  "ha", "haa", "ji", "jee", "theek", "thik", "ho", "hoy", "barobar", "no", "nope",
  "nah", "nahi", "nahin", "na", "right", "sure", "हाँ", "हां", "हो", "होय", "ठीक",
  "सही", "बरोबर", "नहीं", "नाही", "ना", "जी",
]);

const DATE_WORDS = new Set([
  "today", "tomorrow", "yesterday", "aaj", "aj", "kal", "udya", "udyaa", "parso",
  "parva", "morning", "evening", "afternoon", "night", "subah", "shaam", "dopahar",
  "sakali", "ist", "baje", "o'clock", "next", "coming", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed",
  "thu", "fri", "sat", "sun", "सुबह", "शाम", "दोपहर", "सकाळी", "संध्याकाळी",
  "दुपारी", "आज", "कल", "उद्या", "परवा", "बजे", "वाजता", "सकाळ", "रात्री", "पहाटे",
]);

const DATE_MODIFIERS = new Set(["next", "this", "coming", "on", "at", "in", "the", "for", "around", "about"]);

function tokenize(text: string): string[] {
  return String(text || "")
    .replace(/['’]/g, "")
    .replace(/[।!?.,;:"“”()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function fold(token: string): string {
  return token.toLowerCase();
}

function isDevanagari(token: string): boolean {
  return /[\u0900-\u097F]/.test(token);
}

function isNumberToken(token: string): boolean {
  return /^[+]?\d[\d:./-]*$/.test(token) || /^(am|pm|a\.m|p\.m)$/i.test(token);
}

function normalizeHint(hinted?: string): MayaSpokenLanguage | null {
  const hint = String(hinted || "").trim().toLowerCase();
  if (!hint) return null;
  if (hint === "hi" || hint === "hi-in" || hint.includes("hindi") || hint.includes("hinglish")) return "hi";
  if (hint === "mr" || hint === "mr-in" || hint.includes("marathi")) return "mr";
  if (hint === "en" || hint === "en-in" || hint === "english") return "en";
  return null;
}

function explicitSwitch(text: string): MayaSpokenLanguage | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/\b(?:don't|do not|dont|never)\s+(?:speak|talk|want|know)\b/i.test(raw)) return null;
  if (/\b(?:speak|talk)\s+(?:in\s+)?english\b/i.test(raw) || /\benglish\s+please\b/i.test(raw)) return "en";
  if (/\benglish\s+(?:mein|me)\s+(?:baat|bolo|boliye|bol|karo)\b/i.test(raw)) return "en";
  if (/इंग्लिश में बोल|अंग्रेजी में बोल|अंग्रेज़ी में बोल|इंग्रजीत बोल/.test(raw)) return "en";
  if (/\b(?:speak|talk)\s+(?:in\s+)?hindi\b/i.test(raw) || /\bhindi\s+please\b/i.test(raw)) return "hi";
  if (/\bhindi\s+mein\s+(?:baat|bolo|boliye|bol|karo)\b/i.test(raw)) return "hi";
  if (/हिंदी में बात|हिंदी में बोल|हिन्दी में बात|हिन्दी में बोल/.test(raw)) return "hi";
  if (/\b(?:speak|talk)\s+(?:in\s+)?marathi\b/i.test(raw)) return "mr";
  if (/\bmarathi\s+(?:madhe|madhye|mein|me)\s+(?:bola|bol|baat|bolo)\b/i.test(raw)) return "mr";
  if (/मराठीत बोल|मराठी मध्ये बोल|मराठीमध्ये बोल/.test(raw)) return "mr";
  return null;
}

function isYesNo(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => YES_NO.has(fold(token)) || YES_NO.has(token));
}

function isLoanwordOnly(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => {
    const key = fold(token);
    return LOANWORDS.has(key) || YES_NO.has(key) || YES_NO.has(token);
  });
}

function isDoctorOnly(text: string): boolean {
  const trimmed = String(text || "").trim().replace(/[।.!?]+$/g, "");
  return /^(?:dr\.?|doctor|डॉक्टर|डॉ\.?)\s+[\p{L}\p{M}.''’-]+(?:\s+[\p{L}\p{M}.''’-]+){0,2}$/iu.test(trimmed);
}

function isNameToken(token: string): boolean {
  const key = fold(token);
  if (ENGLISH_FUNCTION.has(key) || ROMAN_HINDI.has(key) || ROMAN_MARATHI.has(key)) return false;
  if (HINDI_MARKERS.has(token) || MARATHI_MARKERS.has(token) || YES_NO.has(key) || YES_NO.has(token)) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M}.'’-]{0,40}$/u.test(token);
}

function isBareName(tokens: string[]): boolean {
  if (tokens.length < 1 || tokens.length > 4) return false;
  return tokens.every(isNameToken);
}

function isDateOrNumberOnly(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (tokens.every((token) => isNumberToken(token))) return true;
  const residue = tokens.filter((token) => !DATE_WORDS.has(fold(token)) && !DATE_WORDS.has(token) && !isNumberToken(token));
  return residue.every((token) => DATE_MODIFIERS.has(fold(token)));
}

/** Short replies that must not lock or move the call language. */
export function isAmbiguousLanguageTurn(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (explicitSwitch(trimmed)) return false;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return true;
  if (isYesNo(tokens) || isLoanwordOnly(tokens) || isDoctorOnly(trimmed) || isDateOrNumberOnly(tokens) || isBareName(tokens)) return true;
  return false;
}

/**
 * A clear language needs more than one signal. A hint, one Devanagari word,
 * or a single Roman Hindi word is not enough. Null means "not clear".
 */
export function assessCallerLanguage(text: string, hinted?: string, detectedCode?: string): MayaSpokenLanguage | null {
  const hint = normalizeHint(hinted);
  const detected = normalizeHint(detectedCode);
  const tokens = tokenize(text);
  const devTokens = tokens.filter(isDevanagari);
  const mrMarkers = devTokens.filter((token) => MARATHI_MARKERS.has(token));
  const hiMarkers = devTokens.filter((token) => HINDI_MARKERS.has(token));
  const romanHi = tokens.filter((token) => ROMAN_HINDI.has(fold(token)));
  const romanMr = tokens.filter((token) => ROMAN_MARATHI.has(fold(token)));
  const english = tokens.filter((token) => ENGLISH_FUNCTION.has(fold(token)));
  if (tokens.length < MIN_CLEAR_LANGUAGE_WORDS) return null;

  if (devTokens.length >= 2 && (mrMarkers.length + hiMarkers.length > 0 || devTokens.length >= 4)) {
    if (mrMarkers.length > hiMarkers.length) return "mr";
    if (hiMarkers.length > mrMarkers.length) return "hi";
    if (mrMarkers.length > 0 && mrMarkers.length === hiMarkers.length) {
      if (hint === "hi" || detected === "hi") return "hi";
      return "mr";
    }
    return "hi";
  }

  const strongRomanHi = romanHi.length >= 2;
  const strongRomanMr = romanMr.length >= 2 && romanMr.length > romanHi.length;
  const strongEnglish = english.length >= 2;
  if ((strongRomanHi || strongRomanMr) && strongEnglish) return null;
  if (strongRomanMr && english.length < 2 && devTokens.length < 2) return "mr";
  if (strongRomanHi && english.length < 2 && devTokens.length < 2) return "hi";
  if (strongEnglish && romanHi.length < 2 && romanMr.length < 2 && devTokens.length < 2) return "en";
  return null;
}

function applyTurn(
  state: MayaCallLanguage,
  text: string,
  hinted?: string,
  detectedCode?: string
): MayaCallLanguage {
  const requested = explicitSwitch(text);
  if (requested) {
    return { language: requested, locked: true, pendingLanguage: null, pendingCount: 0 };
  }
  if (isAmbiguousLanguageTurn(text)) return state;
  const assessed = assessCallerLanguage(text, hinted, detectedCode);
  if (!assessed) return state;
  return { language: assessed, locked: true, pendingLanguage: null, pendingCount: 0 };
}

export function resolveMayaCallLanguage(input: {
  history?: MayaLanguageTurn[];
  currentText?: string;
  currentHint?: string;
  currentDetected?: string;
  greeting?: MayaSpokenLanguage;
}): MayaCallLanguage {
  const greeting = input.greeting === "hi" || input.greeting === "mr" ? input.greeting : "en";
  let state: MayaCallLanguage = { language: greeting, locked: false, pendingLanguage: null, pendingCount: 0 };
  for (const turn of input.history || []) {
    const role = String(turn?.role || "caller");
    if (role !== "caller") continue;
    state = applyTurn(state, String(turn?.text || ""));
  }
  if (input.currentText !== undefined) {
    state = applyTurn(state, String(input.currentText || ""), input.currentHint, input.currentDetected);
  }
  return state;
}

export function mayaLockedLanguageInstruction(language: MayaSpokenLanguage, locked: boolean): string {
  const name = language === "hi" ? "Hindi" : language === "mr" ? "Marathi" : "English";
  const examples = `"Hindi mein baat karo", "Marathi madhe bola", or "speak English"`;
  if (!locked) {
    return `The greeting language is ${name}. A call language is not locked yet. Reply in ${name} with the ${name} Chirp 3 HD voice unless the caller says a clear sentence of at least ${MIN_CLEAR_LANGUAGE_WORDS} words in English, Hindi, or Marathi, or explicitly asks (${examples}). A name, number, yes or no, haan, ok, okay, doctor, appointment, date, one Devanagari word, or mixed Hinglish is not a clear sentence. Do not choose Hindi just because the hint says Hinglish.`;
  }
  return `LOCKED CALL LANGUAGE: ${name}. Write speechText only in ${name} so the reply matches the ${name} Chirp 3 HD voice. The server already followed this turn: one clear sentence in English, Hindi, or Marathi switches immediately, and so does an explicit request such as ${examples}. Do not switch for a name, number, yes or no, haan, ok, okay, doctor, appointment, a date, one Devanagari word, or mixed Hinglish.`;
}

function hasMarathiReply(text: string): boolean {
  return /आहे|आहेत|नाही|झाले|मला|माझे|माझा|तुमच|हवी|हवे|दाखवा|कोणत|नमस्कार|रुग्ण|मी /.test(text);
}

function hasHindiReply(text: string): boolean {
  return /है|हैं|मुझे|मेरा|चाहिए|क्या |मैंने|माफ़|माफ कीजिए|कृपया|बोलें|आप/.test(text);
}

/**
 * True when reply text should not be spoken in this call language.
 * The long-script check stays, and a short Latin reply is also dropped for
 * a Hindi or Marathi voice so a switch is not read by the previous voice.
 */
export function speechMissesCallLanguage(speech: string, language: MayaSpokenLanguage): boolean {
  if (speechConflictsWithLockedLanguage(speech, language)) return true;
  if (language === "en") return false;
  const lat = (String(speech || "").match(/[A-Za-z]/g) || []).length;
  const dev = (String(speech || "").match(/[\u0900-\u097F]/g) || []).length;
  return lat >= 12 && dev < 6;
}

/** True when the reply text would be spoken by the wrong voice. */
export function speechConflictsWithLockedLanguage(speech: string, language: MayaSpokenLanguage): boolean {
  const text = String(speech || "");
  if (!text.trim()) return false;
  const dev = (text.match(/[\u0900-\u097F]/g) || []).length;
  const lat = (text.match(/[A-Za-z]/g) || []).length;
  if (language === "en") return dev >= 18 && dev > lat;
  if (language === "mr") {
    if (dev < 6 && lat > 24) return true;
    if (dev >= 12 && !hasMarathiReply(text)) return true;
    return false;
  }
  if (dev < 6 && lat > 24) return true;
  if (dev >= 12 && hasMarathiReply(text) && !hasHindiReply(text)) return true;
  return false;
}
