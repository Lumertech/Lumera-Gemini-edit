import type { SqlDatabase } from "./sql-engine.ts";
import { vertexGenerateContent, vertexGeminiModel } from "./vertex-gemini.ts";

export type WhatsAppLangCode =
  | "en"
  | "hi"
  | "mr"
  | "ta"
  | "te"
  | "kn"
  | "bn"
  | "gu"
  | "ml"
  | "pa"
  | "or"
  | "ur";

export const WHATSAPP_LANG_NAMES: Record<WhatsAppLangCode, { english: string; native: string }> = {
  en: { english: "English", native: "English" },
  hi: { english: "Hindi", native: "हिन्दी" },
  mr: { english: "Marathi", native: "मराठी" },
  ta: { english: "Tamil", native: "தமிழ்" },
  te: { english: "Telugu", native: "తెలుగు" },
  kn: { english: "Kannada", native: "ಕನ್ನಡ" },
  bn: { english: "Bengali", native: "বাংলা" },
  gu: { english: "Gujarati", native: "ગુજરાતી" },
  ml: { english: "Malayalam", native: "മലയാളം" },
  pa: { english: "Punjabi", native: "ਪੰਜਾਬੀ" },
  or: { english: "Odia", native: "ଓଡ଼ିଆ" },
  ur: { english: "Urdu", native: "اردو" },
};

const MARATHI_DEVANAGARI_WORDS = [
  "आहे",
  "आहेत",
  "नाही",
  "नाहीत",
  "झाले",
  "झाली",
  "मला",
  "माझा",
  "माझी",
  "माझे",
  "तुम्ही",
  "तुमचा",
  "तुमची",
  "तुमचे",
  "तुम्हाला",
  "हवा",
  "हवी",
  "हवे",
  "पाहिजे",
  "दाखवायचे",
  "दाखवा",
  "कोणते",
  "कोणता",
  "कोणती",
  "कुठे",
  "कधी",
  "कसे",
  "मध्ये",
  "नमस्कार",
  "कंबरदुखी",
  "गुडघेदुखी",
  "डोकेदुखी",
  "वेळापत्रक",
  "तपासणी",
  "औषधपत्र",
  "औषधे",
  "अहवाल",
  "रांग",
  "रांगेची",
  "पत्ता",
  "रद्द करा",
  "बुक करा",
  "वेळ बदला",
  "संपर्क साधा",
  "बोलू",
  "बोला",
  "सांगा",
  "उद्या",
  "सकाळी",
  "दुपारी",
  "संध्याकाळी",
  "दालन",
];

const HINDI_DEVANAGARI_WORDS = [
  "है",
  "हैं",
  "हूँ",
  "मुझे",
  "मेरा",
  "मेरी",
  "मेरे",
  "चाहिए",
  "चाहिये",
  "कहाँ",
  "कहां",
  "कैसे",
  "बताइए",
  "बताओ",
  "कीजिए",
  "करें",
  "आपका",
  "आपकी",
  "आपको",
  "नमस्ते",
  "कृपया",
  "पता",
  "समय सारणी",
  "पर्ची",
  "दवाइयाँ",
  "जांच",
  "कतार",
  "रद्द करें",
  "बुक करें",
  "समय बदलें",
  "बुखार",
  "खांसी",
  "सिरदर्द",
];

const ROMAN_MARATHI_REGEX =
  /\b(mala|majha|majhi|majhe|mazha|mazhi|mazhe|tumhi|tumcha|tumchi|tumhala|aahe|ahet|pahije|dakhva|dakhvayche|dakhavayche|kuthe|kasa|kase|madhe|madhye|bola|sanga|udya|sakali|sandhyakali|velapatrak|tapasani|aushadh|kambardukhi|gudghedukhi|dokedukhi|marathit)\b/i;

const ROMAN_HINDI_REGEX =
  /\b(mujhe|mujhko|mera|meri|mere|chahiye|chaahiye|chaiye|kripya|kripaya|bataiye|batao|bataye|kahan|kaise|kya|baat|kijiye|karo|hoon|hun|aapka|apka|aapko|bukhar|dikhana|dikhaiye|samay|kitna|kitne|kaunsa|konsa|dard|dikkat)\b/i;

const ENGLISH_SENTENCE_WORDS = new Set([
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "the",
  "a",
  "an",
  "please",
  "need",
  "want",
  "where",
  "when",
  "what",
  "how",
  "can",
  "could",
  "would",
  "is",
  "are",
  "am",
  "for",
  "to",
  "with",
  "from",
  "have",
  "has",
  "do",
  "does",
]);

/**
 * Detects an explicit user request to communicate in a specific language
 * (e.g. "talk in Hindi", "Hindi mein baat karo", "मराठीत बोला", "Marathi", "in Marathi", "speak English").
 */
export function detectExplicitWhatsAppLanguageRequest(text: string): WhatsAppLangCode | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/\b(?:don't|do not|dont|never|not)\s+(?:speak|talk|reply|respond|write|use)\b/i.test(raw)) {
    return null;
  }

  const lower = raw.toLowerCase();

  // Marathi explicit requests
  if (
    /^(?:marathi|मराठी|in\s+marathi|marathi\s+please|मराठीत|मराठी\s*मध्ये|मराठीमध्ये)[.!?।]*$/i.test(raw) ||
    /\b(?:in\s+marathi|marathi\s+(?:language|please|only)|(?:speak|talk|reply|respond|chat|write|answer|explain|tell)\s+(?:to\s+me\s+)?(?:in\s+)?marathi)\b/i.test(lower) ||
    /\bmarathi(?:t)?\s+(?:madhe|madhye|mein|me|mde)?\s*(?:bola|bol|baat|bolo|sanga|sang|uttar|mahiti|madat)\b/i.test(lower) ||
    /\b(?:mala\s+)?marathi(?:t|\s+madhe|\s+madhye)\b/i.test(lower) ||
    /मराठीत\s*(?:बोल|बोला|सांगा|सांग|माहिती|उत्तर|संवाद)|मराठी\s*मध्ये\s*(?:बोल|बोला|सांगा|माहिती|उत्तर)|मराठीमध्ये\s*(?:बोल|बोला|सांगा|माहिती|उत्तर)|मराठी\s*भाषे(?:त|मध्ये)/.test(raw)
  ) {
    return "mr";
  }

  // Hindi explicit requests
  if (
    /^(?:hindi|हिंदी|हिन्दी|in\s+hindi|hindi\s+please|हिंदी\s*में|हिन्दी\s*में)[.!?।]*$/i.test(raw) ||
    /\b(?:in\s+hindi|hindi\s+(?:language|please|only)|(?:speak|talk|reply|respond|chat|write|answer|explain|tell)\s+(?:to\s+me\s+)?(?:in\s+)?hindi)\b/i.test(lower) ||
    /\bhindi\s+(?:mein|me|mai|main|m)\s*(?:baat|bolo|boliye|bol|karo|kariye|kijiye|batao|bataiye|jawab|jawaab)\b/i.test(lower) ||
    /हिंदी\s*में|हिन्दी\s*में|हिंदी\s*भाषा\s*में|हिन्दी\s*भाषा\s*में/.test(raw)
  ) {
    return "hi";
  }

  // English explicit requests
  if (
    /^(?:english|in\s+english|english\s+please|अंग्रेजी|इंग्रजी)[.!?।]*$/i.test(raw) ||
    /\b(?:in\s+english|english\s+(?:language|please|only)|(?:speak|talk|reply|respond|chat|write|answer)\s+(?:to\s+me\s+)?(?:in\s+)?english)\b/i.test(lower) ||
    /\benglish\s+(?:mein|me|madhe|madhye)\s*(?:baat|bolo|boliye|bola|karo|sanga)\b/i.test(lower) ||
    /अंग्रेजी\s*में|अंग्रेज़ी\s*में|इंग्लिश\s*में|इंग्रजीत\s*(?:बोला|बोल|सांगा)|इंग्रजी\s*मध्ये/.test(raw)
  ) {
    return "en";
  }

  // Other major Indian languages
  if (/\b(?:in\s+tamil|(?:speak|talk|reply)\s+(?:in\s+)?tamil)\b|^tamil$/i.test(lower) || /தமிழில்/.test(raw)) return "ta";
  if (/\b(?:in\s+telugu|(?:speak|talk|reply)\s+(?:in\s+)?telugu)\b|^telugu$/i.test(lower) || /తెలుగులో/.test(raw)) return "te";
  if (/\b(?:in\s+kannada|(?:speak|talk|reply)\s+(?:in\s+)?kannada)\b|^kannada$/i.test(lower) || /ಕನ್ನಡದಲ್ಲಿ/.test(raw)) return "kn";
  if (/\b(?:in\s+bengali|(?:speak|talk|reply)\s+(?:in\s+)?bengali|bangla)\b|^bengali$/i.test(lower) || /বাংলায়/.test(raw)) return "bn";
  if (/\b(?:in\s+gujarati|(?:speak|talk|reply)\s+(?:in\s+)?gujarati)\b|^gujarati$/i.test(lower) || /ગુજરાતીમાં/.test(raw)) return "gu";
  if (/\b(?:in\s+malayalam|(?:speak|talk|reply)\s+(?:in\s+)?malayalam)\b|^malayalam$/i.test(lower) || /മലയാളത്തിൽ/.test(raw)) return "ml";
  if (/\b(?:in\s+punjabi|(?:speak|talk|reply)\s+(?:in\s+)?punjabi)\b|^punjabi$/i.test(lower) || /ਪੰਜਾਬੀ\s*ਵਿੱਚ/.test(raw)) return "pa";

  return null;
}

/**
 * Classifies the language of a single WhatsApp message from script + vocabulary.
 */
export function detectWhatsAppMessageLanguage(
  text: string,
  currentPreferred?: WhatsAppLangCode
): WhatsAppLangCode | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const explicit = detectExplicitWhatsAppLanguageRequest(raw);
  if (explicit) return explicit;

  if (/[\u0C00-\u0C7F]/.test(raw)) return "te";
  if (/[\u0B80-\u0BFF]/.test(raw)) return "ta";
  if (/[\u0C80-\u0CFF]/.test(raw)) return "kn";
  if (/[\u0D00-\u0D7F]/.test(raw)) return "ml";
  if (/[\u0980-\u09FF]/.test(raw)) return "bn";
  if (/[\u0A80-\u0AFF]/.test(raw)) return "gu";
  if (/[\u0A00-\u0A7F]/.test(raw)) return "pa";
  if (/[\u0B00-\u0B7F]/.test(raw)) return "or";
  if (/[\u0600-\u06FF]/.test(raw)) return "ur";

  if (/[\u0900-\u097F]/.test(raw)) {
    // Retroflex lateral 'ळ' (\u0933) is standard in Marathi and absent in standard Hindi
    const hasMarathiLa = /\u0933/.test(raw);
    const mrHits = MARATHI_DEVANAGARI_WORDS.filter((w) => raw.includes(w)).length + (hasMarathiLa ? 2 : 0);
    const hiHits = HINDI_DEVANAGARI_WORDS.filter((w) => raw.includes(w)).length;
    if (mrHits > hiHits) return "mr";
    if (hiHits > mrHits) return "hi";
    if (mrHits > 0) return "mr";
    // Neutral Devanagari (names, shared loanwords/buttons like "📅 अपॉइंटमेंट बुक", "बुक: डॉ. सिद्धार्थ"):
    // preserve Marathi if the conversation is already in Marathi!
    if (currentPreferred === "mr") return "mr";
    return "hi";
  }

  const lower = raw.toLowerCase();
  if (/\b(naaku|nenu|nopi|baadhaga|undi|kavali|cheyandi)\b/i.test(lower)) return "te";
  if (/\b(enakku|vali|irukku|vendum|theriyuma)\b/i.test(lower)) return "ta";
  if (/\b(nanage|novu|ide|beku|hege)\b/i.test(lower)) return "kn";
  if (/\b(aamar|byatha|korche|chai|dekhte)\b/i.test(lower)) return "bn";
  if (/\b(mane|dukhavo|chhe|joiye|tamari)\b/i.test(lower)) return "gu";
  if (/\b(enikku|vedana|undu|kaanan|aano)\b/i.test(lower)) return "ml";

  const mrRomanMatches = (lower.match(new RegExp(ROMAN_MARATHI_REGEX.source, "gi")) || []).length;
  const hiRomanMatches = (lower.match(new RegExp(ROMAN_HINDI_REGEX.source, "gi")) || []).length;
  if (mrRomanMatches > 0 && mrRomanMatches >= hiRomanMatches) return "mr";
  if (hiRomanMatches >= 2 || (hiRomanMatches === 1 && !/\b(hello|hi|help|where|what|when|book|please)\b/i.test(lower))) {
    return "hi";
  }

  const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const engHits = words.filter((w) => ENGLISH_SENTENCE_WORDS.has(w)).length;
  if (words.length >= 4 && engHits >= 2) return "en";

  return null;
}

export function normalizeStoredLangCode(raw: unknown): WhatsAppLangCode {
  const code = String(raw || "").trim().toLowerCase();
  if (code in WHATSAPP_LANG_NAMES) return code as WhatsAppLangCode;
  return "en";
}

/**
 * Resolves the active conversation language for this turn:
 * 1. Explicit language request always wins immediately ("talk in Marathi", "हिंदी में बात करो").
 * 2. Clear script / Romanized Indic detection switches to that language.
 * 3. Clear multi-word English sentence switches back to English.
 * 4. Short / ambiguous replies ("1", "Ravee, 42", "Dr. Siddharth", "ok", button taps) preserve `conv.preferred_language`.
 */
export function resolveWhatsAppConversationLanguage(
  text: string,
  conv?: Record<string, unknown> | null
): { lang: WhatsAppLangCode; explicitRequest: WhatsAppLangCode | null; changed: boolean } {
  const stored = normalizeStoredLangCode(conv?.preferred_language);
  const explicitRequest = detectExplicitWhatsAppLanguageRequest(text);
  if (explicitRequest) {
    return { lang: explicitRequest, explicitRequest, changed: explicitRequest !== stored };
  }
  const detected = detectWhatsAppMessageLanguage(text, stored);
  if (detected) {
    return { lang: detected, explicitRequest: null, changed: detected !== stored };
  }
  return { lang: stored, explicitRequest: null, changed: false };
}

export function persistConversationLanguage(
  db: SqlDatabase | null | undefined,
  conv: Record<string, unknown> | null | undefined,
  lang: WhatsAppLangCode
): void {
  if (!db || !conv?.id) return;
  conv.preferred_language = lang;
  try {
    db.prepare("UPDATE whatsapp_conversations SET preferred_language = ? WHERE id = ?").run(lang, String(conv.id));
  } catch {
    /* isolated tests without preferred_language */
  }
}

/**
 * Returns true when the message is ONLY asking to switch languages (and does not contain
 * a clinical question like timings, fees, booking, address, prescription, or symptoms).
 */
export function isPureLanguageSwitchMessage(text: string): boolean {
  const explicit = detectExplicitWhatsAppLanguageRequest(text);
  if (!explicit) return false;

  const stripped = String(text || "")
    .toLowerCase()
    .replace(
      /\b(can|could|would|will|you|please|plz|pls|kindly|speak|talk|reply|respond|chat|write|answer|communicate|switch|change|to|in|with|me|only|language|bhasha|hindi|marathi|english|tamil|telugu|kannada|bengali|bangla|gujarati|malayalam|punjabi|mein|me|mai|madhe|madhye|marathit|baat|bolo|boliye|bola|bol|karo|kariye|kijiye|sanga|sang|namaste|namaskar|hi|hello|hey|ok|okay|haan|ho)\b/gi,
      " "
    )
    .replace(
      /(कृपया|प्लीज|नमस्ते|नमस्कार|आप|तुम्ही|मुझसे|माझ्याशी|अब|आता|सिर्फ|फक्त|केवल|पूरी तरह|पूर्णपणे|हिंदी|हिन्दी|मराठी|मराठीत|अंग्रेजी|अंग्रेज़ी|इंग्लिश|इंग्रजी|इंग्रजीत|भाषा|भाषेमध्ये|भाषेत|में|मध्ये|बात|बोलिए|बोलो|बोला|बोल|करो|कीजिए|सांगा|संवाद|साधा|उत्तर|द्या|दें)/g,
      " "
    )
    .replace(/[^a-z0-9\u0900-\u0D7F]+/gi, " ")
    .trim();

  return stripped.length === 0;
}

/** Strips trailing "in Hindi" / "in Marathi" language directives so intent matchers see the clean query. */
export function stripLanguageDirectiveFromQuery(text: string): string {
  return String(text || "")
    .replace(/\b(?:in|into)\s+(?:hindi|marathi|english|tamil|telugu|kannada|bengali|gujarati|malayalam|punjabi)\b/gi, " ")
    .replace(/(?:हिंदी\s*में|हिन्दी\s*में|मराठीत|मराठी\s*मध्ये|मराठीमध्ये)\s*(?:बताइए|बताओ|सांगा)?/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const SPECIALTY_TRANSLATIONS: Record<string, { hi: string; mr: string }> = {
  "general medicine": { hi: "सामान्य चिकित्सा", mr: "सामान्य वैद्यकशास्त्र" },
  "internal medicine": { hi: "आंतरिक चिकित्सा", mr: "अंतर्गत वैद्यकशास्त्र" },
  physiotherapy: { hi: "फिजियोथेरेपी", mr: "फिजिओथेरपी" },
  "physiotherapy & rehabilitation": { hi: "फिजियोथेरेपी एवं पुनर्वास", mr: "फिजिओथेरपी व पुनर्वसन" },
  "physiotherapy & rehab": { hi: "फिजियोथेरेपी एवं पुनर्वास", mr: "फिजिओथेरपी व पुनर्वसन" },
  pediatrics: { hi: "बाल रोग विभाग", mr: "बालरोग विभाग" },
  dermatology: { hi: "त्वचा रोग विभाग", mr: "त्वचारोग विभाग" },
  cardiology: { hi: "हृदय रोग विभाग", mr: "हृदयरोग विभाग" },
  gynecology: { hi: "स्त्री एवं प्रसूति रोग", mr: "स्त्रीरोग व प्रसूतीशास्त्र" },
  "obstetrics & gynecology": { hi: "स्त्री एवं प्रसूति रोग", mr: "स्त्रीरोग व प्रसूतीशास्त्र" },
  orthopedics: { hi: "हड्डी एवं जोड़ रोग", mr: "अस्थिरोग विभाग" },
  "dental surgery": { hi: "दंत चिकित्सा", mr: "दंतचिकित्सा" },
  dentistry: { hi: "दंत चिकित्सा", mr: "दंतचिकित्सा" },
  ophthalmology: { hi: "नेत्र रोग विभाग", mr: "नेत्ररोग विभाग" },
  ent: { hi: "कान-नाक-गला रोग", mr: "कान-नाक-घसा विभाग" },
  neurology: { hi: "तंत्रिका रोग (न्यूरोलॉजी)", mr: "मेंदू व मज्जासंस्था विभाग" },
  psychiatry: { hi: "मनोरोग विभाग", mr: "मनोविकार विभाग" },
  specialist: { hi: "विशेषज्ञ", mr: "तज्ज्ञ डॉक्टर" },
};

const KNOWN_NAME_DEVANAGARI: Array<[RegExp, string]> = [
  [/\bDr\.?\s*/gi, "डॉ. "],
  [/\(PT\)/gi, "(फिजियोथेरेपिस्ट)"],
  [/\bSiddharth\b/gi, "सिद्धार्थ"],
  [/\bVerma\b/gi, "वर्मा"],
  [/\bVarma\b/gi, "वर्मा"],
  [/\bVikram\b/gi, "विक्रम"],
  [/\bMalhotra\b/gi, "मल्होत्रा"],
  [/\bAnanya\b/gi, "अनन्या"],
  [/\bSen\b/gi, "सेन"],
  [/\bMeera\b/gi, "मीरा"],
  [/\bVasudevan\b/gi, "वासुदेवन"],
  [/\bRajesh\b/gi, "राजेश"],
  [/\bSharma\b/gi, "शर्मा"],
  [/\bHarshvardhan\b/gi, "हर्षवर्धन"],
  [/\bPatel\b/gi, "पटेल"],
  [/\bGupta\b/gi, "गुप्ता"],
  [/\bSingh\b/gi, "सिंह"],
  [/\bKumar\b/gi, "कुमार"],
  [/\bJoshi\b/gi, "जोशी"],
  [/\bPatil\b/gi, "पाटील"],
  [/\bPawar\b/gi, "पवार"],
  [/\bShinde\b/gi, "शिंदे"],
  [/\bChavan\b/gi, "चव्हाण"],
  [/\bJadhav\b/gi, "जाधव"],
  [/\bGokhale\b/gi, "गोखले"],
  [/\bBhosale\b/gi, "भोसले"],
  [/\bIyer\b/gi, "अय्यर"],
  [/\bRao\b/gi, "राव"],
  [/\bReddy\b/gi, "रेड्डी"],
  [/\bMehta\b/gi, "मेहता"],
  [/\bShah\b/gi, "शाह"],
  [/\bAgarwal\b/gi, "अग्रवाल"],
  [/\bChatterjee\b/gi, "चटर्जी"],
  [/\bBanerjee\b/gi, "बनर्जी"],
  [/\bArunachalam\b/gi, "अरुणाचलम"],
  [/\bSwamy\b/gi, "स्वामी"],
  [/\bAlok\b/gi, "आलोक"],
  [/\bNath\b/gi, "नाथ"],
  [/\bMukherjee\b/gi, "मुखर्जी"],
  [/\bPriya\b/gi, "प्रिया"],
  [/\bNair\b/gi, "नायर"],
  [/\bRohan\b/gi, "रोहन"],
  [/\bKulkarni\b/gi, "कुलकर्णी"],
  [/\bKavita\b/gi, "कविता"],
  [/\bAnita\b/gi, "अनीता"],
  [/\bDeshmukh\b/gi, "देशमुख"],
  [/\bRavee\b/gi, "रवि"],
  [/\bRajiv\b/gi, "राजीव"],
  [/\bApex PolyClinic\b/gi, "एपेक्स पॉलीक्लिनिक"],
  [/\bLumera Apex PolyClinic\b/gi, "लुमेरा एपेक्स पॉलीक्लिनिक"],
  [/\bLumera Polyclinic\b/gi, "लुमेरा पॉलीक्लिनिक"],
  [/\bPolyClinic\b/gi, "पॉलीक्लिनिक"],
  [/\bPolyclinic\b/gi, "पॉलीक्लिनिक"],
  [/\bClinic\b/gi, "क्लिनिक"],
  [/\bHospital\b/gi, "अस्पताल"],
  [/\bHealthcare\b/gi, "हेल्थकेयर"],
  [/\bTowers\b/gi, "टावर्स"],
  [/\bTower\b/gi, "टावर"],
  [/\bSuite\b/gi, "सूट"],
  [/\bPark\b/gi, "पार्क"],
  [/\bCircus\b/gi, "सर्कस"],
  [/\bAvenue\b/gi, "एवेन्यू"],
  [/\bRoad\b/gi, "रोड"],
  [/\bStreet\b/gi, "स्ट्रीट"],
  [/\bSector\b/gi, "सेक्टर"],
  [/\bPhase\b/gi, "फेज"],
  [/\bNagar\b/gi, "नगर"],
  [/\bMarg\b/gi, "मार्ग"],
  [/\bKolkata\b/gi, "कोलकाता"],
  [/\bMumbai\b/gi, "मुंबई"],
  [/\bPune\b/gi, "पुणे"],
  [/\bNagpur\b/gi, "नागपुर"],
  [/\bNashik\b/gi, "नाशिक"],
  [/\bThane\b/gi, "ठाणे"],
  [/\bDelhi\b/gi, "दिल्ली"],
  [/\bNew Delhi\b/gi, "नई दिल्ली"],
  [/\bGurgaon\b/gi, "गुरुग्राम"],
  [/\bGurugram\b/gi, "गुरुग्राम"],
  [/\bNoida\b/gi, "नोएडा"],
  [/\bBengaluru\b/gi, "बेंगलुरु"],
  [/\bBangalore\b/gi, "बेंगलुरु"],
  [/\bHyderabad\b/gi, "हैदराबाद"],
  [/\bChennai\b/gi, "चेन्नई"],
  [/\bAhmedabad\b/gi, "अहमदाबाद"],
  [/\bJaipur\b/gi, "जयपुर"],
  [/\bLucknow\b/gi, "लखनऊ"],
  [/\bMaharashtra\b/gi, "महाराष्ट्र"],
  [/\bHaryana\b/gi, "हरियाणा"],
  [/\bWest Bengal\b/gi, "पश्चिम बंगाल"],
  [/\bKarnataka\b/gi, "कर्नाटक"],
  [/\bIndia\b/gi, "भारत"],
  [/\bLumera\b/gi, "लुमेरा"],
  [/\bSunrise Family Clinic\b/gi, "सनराइज फैमिली क्लिनिक"],
];

const CONSONANT_MAP: Array<[string, string]> = [
  ["ksh", "क्ष"],
  ["dny", "ज्ञ"],
  ["gy", "ज्ञ"],
  ["sh", "श"],
  ["chh", "छ"],
  ["ch", "च"],
  ["kh", "ख"],
  ["gh", "घ"],
  ["th", "थ"],
  ["dh", "ध"],
  ["ph", "फ"],
  ["bh", "भ"],
  ["jh", "झ"],
  ["tr", "त्र"],
  ["k", "क"],
  ["g", "ग"],
  ["j", "ज"],
  ["t", "त"],
  ["d", "द"],
  ["n", "न"],
  ["p", "प"],
  ["f", "फ"],
  ["b", "ब"],
  ["m", "म"],
  ["y", "य"],
  ["r", "र"],
  ["l", "ल"],
  ["v", "व"],
  ["w", "व"],
  ["s", "स"],
  ["z", "ज़"],
  ["h", "ह"],
  ["c", "क"],
  ["q", "क"],
  ["x", "क्स"],
];

const VOWEL_MATRA: Array<[string, string, string]> = [
  ["ai", "ऐ", "ै"],
  ["au", "औ", "ौ"],
  ["aa", "आ", "ा"],
  ["ee", "ई", "ी"],
  ["oo", "ऊ", "ू"],
  ["ou", "औ", "ौ"],
  ["a", "अ", ""],
  ["i", "इ", "ि"],
  ["u", "उ", "ु"],
  ["e", "ए", "े"],
  ["o", "ओ", "ो"],
];

/** Phonetic fallback so arbitrary Latin proper nouns/rooms render in Devanagari for hi/mr. */
export function transliterateWordToDevanagari(word: string): string {
  const s = word.toLowerCase();
  if (!/^[a-z]+$/.test(s)) return word;
  let i = 0;
  let out = "";
  let prevWasConsonant = false;

  while (i < s.length) {
    let matchedCons = false;
    for (const [lat, dev] of CONSONANT_MAP) {
      if (s.startsWith(lat, i)) {
        if (prevWasConsonant) out += "्";
        out += dev;
        i += lat.length;
        prevWasConsonant = true;
        matchedCons = true;
        break;
      }
    }
    if (matchedCons) continue;

    let matchedVowel = false;
    for (const [lat, indep, matra] of VOWEL_MATRA) {
      if (s.startsWith(lat, i)) {
        if (prevWasConsonant) {
          if (lat === "a" && i + 1 === s.length && s.length > 2) {
            // Trailing 'a' in Indian names (e.g. "Rama" vs "Verma"): keep inherent vowel
          } else {
            out += matra;
          }
          prevWasConsonant = false;
        } else {
          out += indep;
        }
        i += lat.length;
        matchedVowel = true;
        break;
      }
    }
    if (!matchedVowel) {
      i += 1;
    }
  }
  return out || word;
}

export function localizePersonOrClinicName(name: string, lang: WhatsAppLangCode): string {
  const clean = String(name || "").trim();
  if (!clean || lang === "en") return clean;
  if (lang !== "hi" && lang !== "mr") return clean;
  if (/^patient(\s*\([+\d\s-]+\))?$/i.test(clean)) {
    return lang === "mr" ? "रुग्ण" : "मरीज";
  }
  let out = clean;
  for (const [pattern, replacement] of KNOWN_NAME_DEVANAGARI) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\b[A-Za-z]{2,}\b/g, (token) => transliterateWordToDevanagari(token));
  out = out.replace(/\b([A-Za-z])\b/g, (ch) => transliterateWordToDevanagari(ch));
  return out.replace(/\s{2,}/g, " ").trim();
}

export function localizeRoomLabel(rawRoom: string, lang: "hi" | "mr"): string {
  const clean = String(rawRoom || "101").trim() || "101";
  let out = clean
    .replace(/&/g, lang === "hi" ? "एवं" : "व")
    .replace(/\bEye\b/gi, "नेत्र")
    .replace(/\bRefraction\b/gi, lang === "hi" ? "जांच" : "तपासणी")
    .replace(/\bDental\b/gi, "दंत")
    .replace(/\bOperatory\b/gi, lang === "hi" ? "कक्ष" : "दालन")
    .replace(/\bOrtho\b/gi, "अस्थि")
    .replace(/\bDerma\b/gi, "त्वचा")
    .replace(/\bCardiac\b/gi, "हृदय")
    .replace(/\bPediatrics?\b/gi, "बाल")
    .replace(/\bRehab\b/gi, lang === "hi" ? "पुनर्वास" : "पुनर्वसन")
    .replace(/\bPhysio\b/gi, lang === "hi" ? "फिजियो" : "फिजिओ")
    .replace(/\bWing\b/gi, "विभाग")
    .replace(/\bOPD\b/gi, "ओपीडी")
    .replace(/\b(?:Room|Suite|Cabin|Chamber)\b/gi, lang === "hi" ? "कक्ष" : "दालन क्र.");
  out = localizePersonOrClinicName(out, lang);
  const word = lang === "hi" ? "कक्ष" : "दालन क्र.";
  if (!out.includes("कक्ष") && !out.includes("दालन")) {
    out = `${word} ${out}`;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function localizeSpecialtyLabel(specialty: string, lang: WhatsAppLangCode): string {
  const clean = String(specialty || "").trim();
  if (!clean || lang === "en") return clean || "Specialist";
  const key = clean.toLowerCase();
  const exact = SPECIALTY_TRANSLATIONS[key];
  if (exact && (lang === "hi" || lang === "mr")) return exact[lang];
  for (const [k, v] of Object.entries(SPECIALTY_TRANSLATIONS)) {
    if (key.includes(k) && (lang === "hi" || lang === "mr")) return v[lang];
  }
  return lang === "mr" ? "तज्ज्ञ विभाग" : lang === "hi" ? "विशेषज्ञ विभाग" : clean;
}

export function localizeTimingLabel(timing: string, lang: WhatsAppLangCode): string {
  const clean = String(timing || "").trim() || "09:00 AM - 01:00 PM";
  if (lang === "en") return clean;
  if (lang === "hi") {
    return clean
      .replace(/\bOPD hours\b/gi, "ओपीडी समय")
      .replace(/(\d{1,2}:\d{2})\s*AM/gi, "सुबह $1")
      .replace(/(\d{1,2}:\d{2})\s*PM/gi, "शाम $1");
  }
  if (lang === "mr") {
    return clean
      .replace(/\bOPD hours\b/gi, "ओपीडी वेळ")
      .replace(/(\d{1,2}:\d{2})\s*AM/gi, "सकाळी $1")
      .replace(/(\d{1,2}:\d{2})\s*PM/gi, "संध्याकाळी $1");
  }
  return clean;
}

export function localizeAppointmentStatus(status: string, lang: WhatsAppLangCode): string {
  const s = String(status || "").trim().toLowerCase();
  if (lang === "hi") {
    if (s === "waiting") return "प्रतीक्षारत";
    if (s === "confirmed") return "पुष्टि की गई";
    if (s === "completed") return "पूर्ण";
    if (s === "cancelled" || s === "canceled") return "रद्द";
    return "सक्रिय";
  }
  if (lang === "mr") {
    if (s === "waiting") return "प्रतीक्षेत";
    if (s === "confirmed") return "निश्चित";
    if (s === "completed") return "पूर्ण";
    if (s === "cancelled" || s === "canceled") return "रद्द";
    return "सक्रिय";
  }
  return status;
}

export function localizeMedTiming(timing: string, lang: WhatsAppLangCode): string {
  const clean = String(timing || "").trim();
  if (lang === "hi") {
    return clean
      .replace(/After Meals/gi, "भोजन के बाद")
      .replace(/Before Meals/gi, "भोजन से पहले")
      .replace(/After Lunch/gi, "दोपहर के भोजन के बाद")
      .replace(/After Dinner/gi, "रात के भोजन के बाद")
      .replace(/Empty Stomach/gi, "खाली पेट")
      .replace(/At Bedtime/gi, "सोते समय");
  }
  if (lang === "mr") {
    return clean
      .replace(/After Meals/gi, "जेवणानंतर")
      .replace(/Before Meals/gi, "जेवणापूर्वी")
      .replace(/After Lunch/gi, "दुपारच्या जेवणानंतर")
      .replace(/After Dinner/gi, "रात्रीच्या जेवणानंतर")
      .replace(/Empty Stomach/gi, "रिकाम्या पोटी")
      .replace(/At Bedtime/gi, "झोपण्यापूर्वी");
  }
  return clean;
}

/** Keeps Meta WhatsApp interactive button titles within the 20-char Graph API limit. */
export function compactDoctorBookButton(doctorName: string, lang: WhatsAppLangCode): string {
  if (lang === "en") return `Book ${doctorName}`;
  const localized = localizePersonOrClinicName(doctorName, lang)
    .replace(/\(.*?\)/g, "")
    .trim();
  const parts = localized.replace(/^डॉ\.\s*/, "").split(/\s+/).filter(Boolean);
  const shortDoc = parts[0] ? `डॉ. ${parts[0]}` : localized;
  const candidate = `बुक: ${shortDoc}`;
  return candidate.length <= 20 ? candidate : candidate.slice(0, 20).trim();
}

export const LOCALIZED_BUTTONS = {
  hi: {
    bookAppointment: "📅 अपॉइंटमेंट बुक",
    doctorSchedule: "⏰ डॉक्टर समय",
    clinicLocation: "📍 क्लिनिक पता",
    speakReception: "👤 रिसेप्शन संपर्क",
    myPrescription: "💊 मेरी पर्ची",
    followUpStatus: "🔔 फॉलो-अप स्थिति",
    callHelpline: "📞 हेल्पलाइन कॉल",
    otherSlots: "⏰ अन्य स्लॉट",
    otherDoctors: "⏰ अन्य डॉक्टर",
    allSlots: "📅 सभी स्लॉट",
    bookFollowUp: "📅 फॉलो-अप बुक",
    previewRx: "📄 पर्ची देखें",
    downloadPdf: "📥 पीडीएफ डाउनलोड",
    refillRx: "💊 दवा रिफिल",
    previewLab: "🔬 रिपोर्ट देखें",
    consultDoctor: "🩺 डॉक्टर परामर्श",
    skipViewSlots: "स्लॉट्स देखें",
    viewQueue: "🎫 कतार स्थिति",
    refreshQueue: "🔄 कतार रिफ्रेश",
    reschedule: "🔄 समय बदलें",
    cancelAppt: "❌ बुकिंग रद्द करें",
    urgentSlot: "📅 तत्काल स्लॉट",
    returnToBot: "🤖 बॉट चालू करें",
  },
  mr: {
    bookAppointment: "📅 अपॉइंटमेंट बुक",
    doctorSchedule: "⏰ डॉक्टर वेळापत्रक",
    clinicLocation: "📍 क्लिनिक पत्ता",
    speakReception: "👤 रिसेप्शन संपर्क",
    myPrescription: "💊 माझे औषधपत्र",
    followUpStatus: "🔔 फॉलो-अप स्थिती",
    callHelpline: "📞 हेल्पलाइन कॉल",
    otherSlots: "⏰ इतर वेळ",
    otherDoctors: "⏰ इतर डॉक्टर",
    allSlots: "📅 सर्व स्लॉट्स",
    bookFollowUp: "📅 फॉलो-अप बुक",
    previewRx: "📄 औषधपत्र पहा",
    downloadPdf: "📥 पीडीएफ डाउनलोड",
    refillRx: "💊 औषध रिफिल",
    previewLab: "🔬 अहवाल पहा",
    consultDoctor: "🩺 डॉक्टर सल्ला",
    skipViewSlots: "स्लॉट्स पहा",
    viewQueue: "🎫 रांग स्थिती",
    refreshQueue: "🔄 स्थिती तपासा",
    reschedule: "🔄 वेळ बदला",
    cancelAppt: "❌ बुकिंग रद्द करा",
    urgentSlot: "📅 तातडीची वेळ",
    returnToBot: "🤖 बॉट सुरू करा",
  },
} as const;

export function localizeButtonsList(buttons: string[] | undefined, lang: WhatsAppLangCode): string[] | undefined {
  if (!buttons || lang === "en") return buttons;
  if (lang !== "hi" && lang !== "mr") return buttons;
  const b = LOCALIZED_BUTTONS[lang];
  return buttons.map((btn) => {
    const low = btn.toLowerCase();
    if (/^book\s+/i.test(btn) && !low.includes("appointment") && !low.includes("follow-up") && !low.includes("urgent")) {
      return compactDoctorBookButton(btn.replace(/^book\s+/i, "").trim(), lang);
    }
    if (low.includes("urgent")) return b.urgentSlot;
    if (low.includes("follow-up") && low.includes("book")) return b.bookFollowUp;
    if (low.includes("follow-up")) return b.followUpStatus;
    if (low.includes("book")) return b.bookAppointment;
    if (low.includes("schedule") || low.includes("doctor timing") || low.includes("all doctor")) return b.doctorSchedule;
    if (low.includes("location")) return b.clinicLocation;
    if (low.includes("reception") || low.includes("front desk")) return b.speakReception;
    if (low.includes("prescription") && low.includes("preview")) return b.previewRx;
    if (low.includes("prescription")) return b.myPrescription;
    if (low.includes("download")) return b.downloadPdf;
    if (low.includes("refill")) return b.refillRx;
    if (low.includes("lab")) return b.previewLab;
    if (low.includes("consult")) return b.consultDoctor;
    if (low.includes("skip")) return b.skipViewSlots;
    if (low.includes("refresh") && low.includes("queue")) return b.refreshQueue;
    if (low.includes("queue")) return b.viewQueue;
    if (low.includes("reschedule")) return b.reschedule;
    if (low.includes("cancel")) return b.cancelAppt;
    if (low.includes("helpline") || low.includes("call 108")) return b.callHelpline;
    if (low.includes("return to bot")) return b.returnToBot;
    if (low.includes("other doctor")) return b.otherDoctors;
    if (low.includes("other slot")) return b.otherSlots;
    if (low.includes("all slot")) return b.allSlots;
    return localizePersonOrClinicName(btn, lang).slice(0, 20);
  });
}

export function buildLanguageSwitchConfirmation(opts: {
  lang: WhatsAppLangCode;
  clinicName: string;
  firstName?: string;
  isRegistered?: boolean;
}): { content: string; buttons: string[] } | null {
  const clinic = localizePersonOrClinicName(opts.clinicName, opts.lang);
  const fName = opts.firstName ? localizePersonOrClinicName(opts.firstName, opts.lang) : "";

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const greet = opts.isRegistered && fName ? `नमस्ते ${fName}! 🙏` : `नमस्ते! 🙏`;
    return {
      content:
        `${greet} निश्चित रूप से, अब मैं आपसे पूरी तरह *हिन्दी* में संवाद करूँगी। *${clinic}* में आपका स्वागत है।\n\n` +
        `मैं माया हूँ — आपकी २४/७ एआई क्लिनिक रिसेप्शनिस्ट। मैं इन सेवाओं में आपकी सहायता कर सकती हूँ:\n\n` +
        `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध स्लॉट देखें और तुरंत टोकन बुक करें\n` +
        `• ⏰ *डॉक्टर समय सारणी और ओपीडी समय* — विशेषज्ञ डॉक्टरों की उपलब्धता\n` +
        `• 💊 *पर्ची और दवाइयाँ* — डिजिटल हस्ताक्षरित पर्ची देखें व डाउनलोड करें\n` +
        `• 🔔 *फॉलो-अप स्थिति* — अगली परामर्श तिथि जानें\n` +
        `• 🔬 *जांच रिपोर्ट* — पैथोलॉजी और लैब रिपोर्ट देखें\n` +
        `• 📍 *क्लिनिक का पता और समय* — पता, दिशा-निर्देश और हेल्पलाइन\n\n` +
        `कृपया बताइए आज मैं आपकी क्या सहायता करूँ, या नीचे दिए गए विकल्प चुनें:`,
      buttons: opts.isRegistered
        ? [b.bookAppointment, b.doctorSchedule, b.myPrescription, b.followUpStatus]
        : [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  if (opts.lang === "mr") {
    const b = LOCALIZED_BUTTONS.mr;
    const greet = opts.isRegistered && fName ? `नमस्कार ${fName}! 🙏` : `नमस्कार! 🙏`;
    return {
      content:
        `${greet} नक्कीच, आता मी तुमच्याशी पूर्णपणे *मराठीत* संवाद साधेन. *${clinic}* मध्ये आपले स्वागत आहे.\n\n` +
        `मी माया आहे — तुमची २४/७ एआय क्लिनिक रिसेप्शनिस्ट. मी तुम्हाला खालील सेवांमध्ये मदत करू शकते:\n\n` +
        `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध वेळ तपासा आणि लगेच टोकन बुक करा\n` +
        `• ⏰ *डॉक्टर वेळापत्रक आणि ओपीडी वेळ* — तज्ज्ञ डॉक्टरांची उपलब्धता\n` +
        `• 💊 *औषधपत्र आणि औषधे* — डिजिटल स्वाक्षरी केलेले औषधपत्र पहा व डाउनलोड करा\n` +
        `• 🔔 *फॉलो-अप स्थिती* — पुढील तपासणीची तारीख तपासा\n` +
        `• 🔬 *तपासणी अहवाल* — लॅब आणि पॅथॉलॉजी अहवाल पहा\n` +
        `• 📍 *क्लिनिकचा पत्ता आणि वेळ* — पत्ता, दिशा आणि हेल्पलाइन\n\n` +
        `कृपया तुम्हाला कोणती मदत हवी आहे ते सांगा किंवा खालील पर्याय निवडा:`,
      buttons: opts.isRegistered
        ? [b.bookAppointment, b.doctorSchedule, b.myPrescription, b.followUpStatus]
        : [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  if (opts.lang === "en") {
    const greet = opts.isRegistered && opts.firstName ? `Hello ${opts.firstName}! 🙏` : `Hello! 🙏`;
    return {
      content:
        `${greet} Certainly, I will continue assisting you in *English*. Welcome to *${opts.clinicName}*.\n\n` +
        `I am your automated AI Clinic Receptionist, available 24/7 with:\n\n` +
        `• 📅 *Doctor Appointments* — check slots & instant token booking\n` +
        `• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n` +
        `• 💊 *Prescriptions & Refills* — view & download signed Rx PDF\n` +
        `• 🔔 *Follow-Up Status* — verify your next recommended review\n` +
        `• 🔬 *Diagnostic Reports* — lab & test results\n` +
        `• 📍 *Clinic Location & Timings* — address, directions & helpline\n\n` +
        `Please reply with what you need or tap an option below:`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Front Desk"],
    };
  }

  return null;
}

export function buildLocalizedHumanHandoverAck(lang: WhatsAppLangCode): { content: string; buttons: string[] } {
  if (lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    return {
      content:
        `नमस्ते! 🙏 आपका संदेश हमारे क्लिनिक रिसेप्शन डेस्क को प्राप्त हो गया है। हमारे स्टाफ सदस्य आपकी जानकारी देख रहे हैं और शीघ्र ही उत्तर देंगे।\n\n` +
        `_(स्वचालित एआई रिसेप्शनिस्ट से जुड़ने के लिए किसी भी समय *बॉट* या *मेनू* लिखकर भेजें।)_`,
      buttons: [b.returnToBot, b.bookAppointment],
    };
  }
  if (lang === "mr") {
    const b = LOCALIZED_BUTTONS.mr;
    return {
      content:
        `नमस्कार! 🙏 तुमचा संदेश आमच्या क्लिनिक रिसेप्शन डेस्कला मिळाला आहे. आमचे कर्मचारी तुमची चौकशी पाहत आहेत आणि लवकरच उत्तर देतील.\n\n` +
        `_(स्वयंचलित एआय रिसेप्शनिस्टकडे परत जाण्यासाठी कधीही *बॉट* किंवा *मेनू* असे पाठवा.)_`,
      buttons: [b.returnToBot, b.bookAppointment],
    };
  }
  return {
    content:
      `Namaste! 🙏 Your message has been received by our clinic reception desk. A staff member is reviewing your query and will reply shortly.\n\n` +
      `_(Reply *bot* or *menu* at any time to return to the automated receptionist.)_`,
    buttons: ["🤖 Return to Bot", "📅 Book Appointment"],
  };
}

export function buildLocalizedFallbackReply(opts: {
  lang: WhatsAppLangCode;
  firstName?: string;
  patientName?: string;
  queryText?: string;
}): { content: string; buttons: string[] } {
  const cleanFirst =
    opts.firstName ||
    (opts.patientName && !opts.patientName.startsWith("Patient (") && opts.patientName !== "Patient"
      ? opts.patientName
      : "");

  if (opts.lang === "hi") {
    const b = LOCALIZED_BUTTONS.hi;
    const fName = cleanFirst ? localizePersonOrClinicName(cleanFirst, "hi") : "";
    const greet = fName ? `नमस्ते ${fName}! 🙏` : `नमस्ते! 🙏`;
    const ack = opts.queryText ? ` हमें आपका संदेश प्राप्त हुआ।` : "";
    return {
      content:
        `${greet}${ack} इस विशेष प्रश्न का सटीक उत्तर अभी मेरे पास उपलब्ध नहीं है, लेकिन हमारी क्लिनिक रिसेप्शन टीम आपकी पूरी सहायता करेगी।\n\n` +
        `मैं २४/७ इन सेवाओं में आपकी तुरंत सहायता कर सकती हूँ:\n\n` +
        `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध स्लॉट देखें व तुरंत टोकन बुक करें\n` +
        `• ⏰ *डॉक्टर समय सारणी और ओपीडी समय* — विशेषज्ञ उपलब्धता\n` +
        `• 💊 *पर्ची और दवाइयाँ* — डिजिटल पर्ची देखें व डाउनलोड करें\n` +
        `• 🔔 *फॉलो-अप स्थिति* — अगली परामर्श तिथि जानें\n` +
        `• 🔬 *जांच रिपोर्ट* — पैथोलॉजी व लैब रिपोर्ट देखें\n` +
        `• 📍 *क्लिनिक का पता और समय* — पता, मार्ग व हेल्पलाइन\n` +
        `• 👤 *रिसेप्शन से बात करें* — क्लिनिक स्टाफ से जुड़ें\n\n` +
        `कृपया नीचे दिए गए विकल्पों में से चुनें या क्लिनिक स्टाफ से बात करने के लिए *रिसेप्शन* लिखें।`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  if (opts.lang === "mr") {
    const b = LOCALIZED_BUTTONS.mr;
    const fName = cleanFirst ? localizePersonOrClinicName(cleanFirst, "mr") : "";
    const greet = fName ? `नमस्कार ${fName}! 🙏` : `नमस्कार! 🙏`;
    const ack = opts.queryText ? ` आम्हाला तुमचा संदेश मिळाला आहे.` : "";
    return {
      content:
        `${greet}${ack} या विशिष्ट प्रश्नाचे अचूक उत्तर सध्या माझ्याकडे उपलब्ध नाही, परंतु आमची क्लिनिक रिसेप्शन टीम तुम्हाला नक्की मदत करेल.\n\n` +
        `मी २४/७ खालील सेवांमध्ये तुम्हाला लगेच मदत करू शकते:\n\n` +
        `• 📅 *डॉक्टर अपॉइंटमेंट* — उपलब्ध वेळ तपासा व लगेच टोकन बुक करा\n` +
        `• ⏰ *डॉक्टर वेळापत्रक आणि ओपीडी वेळ* — तज्ज्ञ डॉक्टरांची उपलब्धता\n` +
        `• 💊 *औषधपत्र आणि औषधे* — डिजिटल औषधपत्र पहा व डाउनलोड करा\n` +
        `• 🔔 *फॉलो-अप स्थिती* — पुढील तपासणीची तारीख तपासा\n` +
        `• 🔬 *तपासणी अहवाल* — लॅब व पॅथॉलॉजी अहवाल पहा\n` +
        `• 📍 *क्लिनिकचा पत्ता आणि वेळ* — पत्ता, दिशा व हेल्पलाइन\n` +
        `• 👤 *रिसेप्शनशी बोला* — क्लिनिक कर्मचाऱ्यांशी संपर्क साधा\n\n` +
        `कृपया खालील पर्याय निवडा किंवा कर्मचाऱ्यांशी बोलण्यासाठी *रिसेप्शन* असे पाठवा.`,
      buttons: [b.bookAppointment, b.doctorSchedule, b.clinicLocation, b.speakReception],
    };
  }

  const greetingPrefix = opts.patientName && !opts.patientName.startsWith("Patient (") && opts.patientName !== "Patient"
    ? `Namaste ${opts.patientName}! 🙏`
    : cleanFirst
      ? `Hello ${cleanFirst}! 🙏`
      : `Hello! 🙏`;
  const queryAck = opts.queryText ? ` We have received your query: "${opts.queryText}".` : "";
  return {
    content:
      `${greetingPrefix}${queryAck} I do not have an answer to that specific question right now, but our clinic front desk team is happy to assist you.\n\n` +
      `Here is what I can help you with 24/7:\n\n` +
      `• 📅 *Doctor Appointments* — check slots & instant token booking\n` +
      `• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n` +
      `• 💊 *Prescriptions & Refills* — view & download your prescriptions\n` +
      `• 🔔 *Follow-Up Status* — check your scheduled review dates\n` +
      `• 🔬 *Diagnostic Reports* — lab & test results\n` +
      `• 📍 *Clinic Location & Timings* — address, directions & helpline\n` +
      `• 👤 *Speak with Front Desk* — connect with our clinic staff\n\n` +
      `Please let me know if you would like help with any of the above, or reply *front desk* to speak with our reception.`,
    buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Receptionist"],
  };
}

/**
 * Checks whether a reply intended for a non-English Indic language still has
 * substantial English prose (excluding URLs, UHIDs, and phone numbers).
 */
export function hasSubstantialEnglishLeakage(text: string): boolean {
  const withoutUrlsAndCodes = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\/api\/\S+/gi, " ")
    .replace(/\b(?:UHID|RX|LUM|IN-HFR|IN-HPR)[-\w]*/gi, " ")
    .replace(/\+?\d[\d\s()-]{5,}/g, " ");
  const latinLetters = (withoutUrlsAndCodes.match(/[A-Za-z]/g) || []).length;
  const indicLetters = (withoutUrlsAndCodes.match(/[\u0900-\u0D7F\u0600-\u06FF]/g) || []).length;
  if (latinLetters >= 25 && latinLetters > indicLetters * 0.35) return true;
  if (latinLetters >= 45) return true;
  return false;
}

/**
 * Uses Vertex Gemini to rewrite any mixed/English WhatsApp text strictly into the target
 * user language with zero English prose or English headings remaining.
 */
export async function ensureFullTargetLanguageText(
  text: string,
  lang: WhatsAppLangCode
): Promise<string> {
  if (lang === "en" || !text) return text;
  if ((lang === "hi" || lang === "mr") && !hasSubstantialEnglishLeakage(text)) {
    return text;
  }
  const info = WHATSAPP_LANG_NAMES[lang];
  if (!info) return text;

  try {
    const res = await vertexGenerateContent({
      model: vertexGeminiModel(),
      contents: [
        {
          text:
            `Rewrite the following clinic WhatsApp message so that 100% of the text, headings, labels, and instructions are written strictly in ${info.english} (${info.native}) using native script.\n` +
            `Rules:\n` +
            `- Do NOT leave ANY English words, English headings, or Romanized words (keep only URLs, ₹ amounts, phone numbers, and ID codes like RX-... or LUM-... unchanged).\n` +
            `${lang === "mr" ? "- Write natural, idiomatic Marathi (मराठी), NOT Hindi.\n" : ""}` +
            `${lang === "hi" ? "- Write natural, polite Hindi (हिन्दी) in Devanagari script.\n" : ""}` +
            `- Preserve WhatsApp formatting (*bold*, bullet points, emojis, line breaks).\n` +
            `- Output ONLY the translated message and nothing else.\n\n` +
            `Message:\n${text}`,
        },
      ],
    });
    const out = String(res.text || "").trim();
    if (out) return out;
  } catch {
    /* keep original or caller fallback */
  }
  return text;
}

