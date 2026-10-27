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

export const INDIC_LANGUAGES: Record<
  IndicLangCode,
  {
    name: string;
    localName: string;
    emergencyNotice: string;
    bookingFormat: (name: string, doctor: string, specialty: string, slot: string, token: number) => string;
    greetingText: (name: string) => string;
    timingsText: string;
    locationText: string;
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `नमस्ते ${name}, मैंने ${doctor} (${specialty}) के साथ आपका अपॉइंटमेंट आज ${slot} के लिए बुक कर दिया है। आपका टोकन नंबर #${token} है। कृपया 10 मिनट पहले पहुंचें।`,
    greetingText: (name) =>
      `नमस्ते ${name}! लुमेरा अपेक्स पॉलीक्लिनिक में आपका स्वागत है। मैं आपकी एआई रिसेप्शनिस्ट माया हूँ। मैं अपॉइंटमेंट बुक करने, डॉक्टर की टाइमिंग बताने या मेडिकल रिपोर्ट देखने में सहायता कर सकती हूँ। मैं आपकी क्या मदद कर सकती हूँ?`,
    timingsText: "हमारे क्लिनिक की ओपीडी सोमवार से शनिवार सुबह 09:00 बजे से रात 08:00 बजे तक और रविवार सुबह 10:00 बजे से दोपहर 02:00 बजे तक खुली रहती है।",
    locationText: "लुमेरा अपेक्स पॉलीक्लिनिक 104-106, हेल्थ हब, सेक्टर 14, मेट्रो स्टेशन के सामने, गुड़गांव में स्थित है। ऑन-साइट पार्किंग उपलब्ध है।",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `নমস্কার ${name}, আমি ${doctor} (${specialty}) এর সাথে আজ ${slot} এ আপনার অ্যাপয়েন্টমেন্ট বুক করেছি। আপনার টোকেন নম্বর #${token}। অনুগ্রহ করে ১০ মিনিট আগে পৌঁছাবেন।`,
    greetingText: (name) =>
      `নমস্কার ${name}! লুমেরা অ্যাপেক্স পলিক্লিনিকে আপনাকে স্বাগতম। আমি আপনার এআই রিসেপশনিস্ট মায়া। ডাক্তার দেখানো, সময়সূচী ও প্রেসক্রিপশন সংক্রান্ত বিষয়ে আমি আপনাকে সাহায্য করতে পারি। আজ আপনাকে কীভাবে সাহায্য করতে পারি?`,
    timingsText: "আমাদের ক্লিনিক ওপিডি সোমবার থেকে শনিবার সকাল ০৯:০০ টা থেকে রাত ০৮:০০ টা এবং রবিবার সকাল ১০:০০ টা থেকে দুপুর ০২:০০ টা পর্যন্ত খোলা থাকে।",
    locationText: "লুমেরা অ্যাপেক্স পলিক্লিনিক ১০৪-১০৬, হেলথ হাব, সেক্টর ১৪, মেট্রো স্টেশনের বিপরীতে, গুরগাঁওতে অবস্থিত। রোগীর পার্কিং সুবিধা রয়েছে।",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `నమస్తే ${name}, నేను ${doctor} (${specialty}) గారితో ఈరోజు ${slot} కి మీ అపాయింట్‌మెంట్ బుక్ చేసాను. మీ టోకెన్ సంఖ్య #${token}. దయచేసి 10 నిమిషాల ముందుగా రండి.`,
    greetingText: (name) =>
      `నమస్తే ${name}! లుమెరా అపెక్స్ పాలీక్లినిక్‌కి స్వాగతం. నేను మీ ఏఐ రిసెప్షనిస్ట్ మాయను. డాక్టర్ అపాయింట్‌మెంట్స్, ఓపీడీ సమయాలు మరియు వైద్య నివేదికలలో నేను మీకు సహాయపడగలను. మీకు ఎలా సహాయపడగలను?`,
    timingsText: "మా క్లినిక్ ఓపీడీ సోమవారం నుండి శనివారం వరకు ఉదయం 09:00 నుండి రాత్రి 08:00 వరకు, ఆదివారం ఉదయం 10:00 నుండి మధ్యాహ్నం 02:00 వరకు అందుబాటులో ఉంటుంది.",
    locationText: "లుమెరా అపెక్స్ పాలీక్లినిక్ 104-106, హెల్త్ హబ్, సెక్టార్ 14, మెట్రో స్టేషన్ ఎదురుగా, గుర్గావ్‌లో ఉంది. పార్కింగ్ సౌకర్యం ఉంది.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `வணக்கம் ${name}, நான் ${doctor} (${specialty}) உடன் இன்று ${slot} மணிக்கு உங்கள் முன்பதிவை பதிவு செய்துள்ளேன். உங்கள் டோக்கன் எண் #${token}. தயவுசெய்து 10 நிமிடங்களுக்கு முன்னதாக வரவும்.`,
    greetingText: (name) =>
      `வணக்கம் ${name}! லுமேரா அபெக்ஸ் பாலிகிளினிக்கிற்கு வரவேற்கிறோம். நான் உங்கள் ஏஐ வரவேற்பாளர் மாயா. மருத்துவர் முன்பதிவு, நேரங்கள் மற்றும் மருத்துவ அறிக்கைகளுக்கு நான் உதவ முடியும். நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?`,
    timingsText: "எங்கள் கிளினிக் ஓபிடி திங்கள் முதல் சனிக்கிழமை வரை காலை 09:00 முதல் இரவு 08:00 மணி வரையிலும், ஞாயிற்றுக்கிழமை காலை 10:00 முதல் மதியம் 02:00 மணி வரையிலும் இயங்கும்.",
    locationText: "லுமேரா அபெக்ஸ் பாலிகிளினிக் 104-106, ஹெல்த் ஹப், செக்டர் 14, மெட்ரோ நிலையம் எதிரில், குருகிராமில் அமைந்துள்ளது. பார்க்கிங் வசதி உள்ளது.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `ನಮಸ್ಕಾರ ${name}, ನಾನು ${doctor} (${specialty}) ಅವರೊಂದಿಗೆ ಇಂದು ${slot} ಕ್ಕೆ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿದ್ದೇನೆ. ನಿಮ್ಮ ಟೋಕನ್ ಸಂಖ್ಯೆ #${token}. ದಯವಿಟ್ಟು 10 ನಿಮಿಷ ಮುಂಚಿತವಾಗಿ ಬನ್ನಿ.`,
    greetingText: (name) =>
      `ನಮಸ್ಕಾರ ${name}! ಲುಮೆರಾ ಅಪೆಕ್ಸ್ ಪಾಲಿಕ್ಲಿನಿಕ್‌ಗೆ ಸುಸ್ವಾಗತ. ನಾನು ನಿಮ್ಮ ಎಐ ರಿಸೆಪ್ಷನಿಸ್ಟ್ ಮಾಯಾ. ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್ ಮತ್ತು ವೈದ್ಯರ ವೇಳಾಪಟ್ಟಿಗೆ ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`,
    timingsText: "ನಮ್ಮ ಕ್ಲಿನಿಕ್ ಒಪಿಡಿ ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ ಬೆಳಿಗ್ಗೆ 09:00 ರಿಂದ ರಾತ್ರಿ 08:00 ರವರೆಗೆ ಮತ್ತು ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 10:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 02:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.",
    locationText: "ಲುಮೆರಾ ಅಪೆಕ್ಸ್ ಪಾಲಿಕ್ಲಿನಿಕ್ 104-106, ಹೆಲ್ತ್ ಹಬ್, ಸೆಕ್ಟರ್ 14, ಮೆಟ್ರೋ ನಿಲ್ದಾಣದ ಎದುರು, ಗುರ್ಗಾಂವ್‌ನಲ್ಲಿದೆ. ಪಾರ್ಕಿಂಗ್ ಸೌಲಭ್ಯವಿದೆ.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `नमस्कार ${name}, मी ${doctor} (${specialty}) यांच्यासोबत आज ${slot} साठी तुमची अपॉइंटमेंट बुक केली आहे. तुमचा टोकन क्रमांक #${token} आहे. कृपया १० मिनिटे आधी पोहोचा.`,
    greetingText: (name) =>
      `नमस्कार ${name}! लुमेरा अपेक्स पॉलीक्लिनिकमध्ये आपले स्वागत आहे. मी तुमची एआय रिसेप्शनिस्ट माया आहे. अपॉइंटमेंट बुकिंग, डॉक्टरांच्या वेळा किंवा रिपोर्ट तपासण्यात मी मदत करू शकते. मी तुम्हाला कशी मदत करू?`,
    timingsText: "आमची ओपीडी सोमवार ते शनिवार सकाळी ०९:०० ते रात्री ०८:०० आणि रविवारी सकाळी १०:०० ते दुपारी ०२:०० वाजेपर्यंत सुरू असते.",
    locationText: "लुमेरा अपेक्स पॉलीक्लिनिक १०४-१०६, हेल्थ हब, सेक्टर १४, मेट्रो स्टेशन समोर, गुडगाव येथे आहे. पार्किंगची सोय उपलब्ध आहे.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `નમસ્તે ${name}, મેં ${doctor} (${specialty}) સાથે આજે ${slot} વાગ્યે તમારી એપોઇન્ટમેન્ટ બુક કરી છે. તમારો ટોકન નંબર #${token} છે. કૃપા કરીને ૧૦ મિનિટ વહેલા પહોંચો.`,
    greetingText: (name) =>
      `નમસ્તે ${name}! લુમેરા એપેક્સ પોલીક્લિનિકમાં તમારું સ્વાગત છે. હું તમારી એઆઈ રિસેપ્શનિસ્ટ માયા છું. એપોઇન્ટમેન્ટ બુકિંગ, ડોક્ટરનો સમય અને રિપોર્ટ જોવામાં હું મદદ કરી શકું છું. હું તમારી શું મદદ કરી શકું?`,
    timingsText: "અમારી ક્લિનિક ઓપીડી સોમવારથી શનિવાર સવારે ૦૯:૦૦ થી રાત્રે ૦૮:૦૦ અને રવિવારે સવારે ૧૦:૦૦ થી બપોરે ૦૨:૦૦ વાગ્યા સુધી કાર્યરત છે.",
    locationText: "લુમેરા એપેક્સ પોલીક્લિનિક ૧૦૪-૧૦૬, હેલ્થ હબ, સેક્ટર ૧૪, મેટ્રો સ્ટેશન સામે, ગુડગાંવમાં આવેલું છે. પાર્કિંગની સુવિધા ઉપલબ્ધ છે.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `നമസ്കാരം ${name}, ${doctor} (${specialty}) മായി ഇന്ന് ${slot} ന് നിങ്ങളുടെ അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്തിട്ടുണ്ട്. നിങ്ങളുടെ ടോക്കൺ നമ്പർ #${token} ആണ്. ദയവായി 10 മിനിറ്റ് മുമ്പ് എത്തുക.`,
    greetingText: (name) =>
      `നമസ്കാരം ${name}! ലുമേര അപെക്സ് പോളിക്ലിനിക്കിലേക്ക് സ്വാഗതം. ഞാൻ നിങ്ങളുടെ എഐ റിസപ്ഷനിസ്റ്റ് മായയാണ്. ഡോക്ടർ അപ്പോയിന്റ്മെന്റുകൾക്കും ഒപിഡി സമയങ്ങൾക്കും ഞാൻ നിങ്ങളെ സഹായിക്കാം. ഞാൻ എങ്ങനെ സഹായിക്കണം?`,
    timingsText: "ഞങ്ങളുടെ ഒപിഡി തിങ്കൾ മുതൽ ശനി വരെ രാവിലെ 09:00 മുതൽ രാത്രി 08:00 വരെയും ഞായറാഴ്ചകളിൽ രാവിലെ 10:00 മുതൽ ഉച്ചയ്ക്ക് 02:00 വരെയും പ്രവർത്തിക്കുന്നു.",
    locationText: "ലുമേര അപെക്സ് പോളിക്ലിനിക് 104-106, ഹെൽത്ത് ഹബ്, സെക്ടർ 14, മെട്രോ സ്റ്റേഷന് എതിർവശം, ഗുഡ്ഗാവിലാണ് സ്ഥിതി ചെയ്യുന്നത്.",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ${name}, ਮੈਂ ${doctor} (${specialty}) ਨਾਲ ਅੱਜ ${slot} ਲਈ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ ਕਰ ਦਿੱਤੀ ਹੈ। ਤੁਹਾਡਾ ਟੋਕਨ ਨੰਬਰ #${token} ਹੈ। ਕਿਰਪਾ ਕਰਕੇ 10 ਮਿੰਟ ਪਹਿਲਾਂ ਪਹੁੰਚੋ।`,
    greetingText: (name) =>
      `ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ ${name}! ਲੁਮੇਰਾ ਅਪੈਕਸ ਪੌਲੀਕਲੀਨਿਕ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਮੈਂ ਤੁਹਾਡੀ ਏਆਈ ਰਿਸੈਪਸ਼ਨਿਸਟ ਮਾਇਆ ਹਾਂ। ਮੈਂ ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ ਕਰਨ ਅਤੇ ਡਾਕਟਰ ਦੇ ਸਮੇਂ ਬਾਰੇ ਜਾਣਕਾਰੀ ਦੇਣ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ। ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?`,
    timingsText: "ਸਾਡੀ ਓਪੀਡੀ ਸੋਮਵਾਰ ਤੋਂ ਸ਼ਨੀਵਾਰ ਸਵੇਰੇ 09:00 ਤੋਂ ਰਾਤ 08:00 ਵਜੇ ਤੱਕ ਅਤੇ ਐਤਵਾਰ ਸਵੇਰੇ 10:00 ਤੋਂ ਦੁਪਹਿਰ 02:00 ਵਜੇ ਤੱਕ ਖੁੱਲ੍ਹੀ ਰਹਿੰਦੀ ਹੈ।",
    locationText: "ਲੁਮੇਰਾ ਅਪੈਕਸ ਪੌਲੀਕਲੀਨਿਕ 104-106, ਹੈਲਥ ਹੱਬ, ਸੈਕਟਰ 14, ਮੈਟਰੋ ਸਟੇਸ਼ਨ ਦੇ ਸਾਹਮਣੇ, ਗੁੜਗਾਓਂ ਵਿਖੇ ਸਥਿਤ ਹੈ।",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `ନମସ୍କାର ${name}, ମୁଁ ${doctor} (${specialty}) ଙ୍କ ସହ ଆଜି ${slot} ପାଇଁ ଆପଣଙ୍କ ଅପଏଣ୍ଟମେଣ୍ଟ ବୁକ୍ କରିଛି। ଆପଣଙ୍କ ଟୋକନ୍ ନମ୍ବର #${token}। ଦୟାକରି ୧୦ ମିନିଟ୍ ପୂର୍ବରୁ ପହଞ୍ଚନ୍ତୁ।`,
    greetingText: (name) =>
      `ନମସ୍କାର ${name}! ଲୁମେରା ଆପେକ୍ସ ପଲିକ୍ଲିନିକ୍‌କୁ ସ୍ୱାଗତ। ମୁଁ ଆପଣଙ୍କ ଏଆଇ ରିସେପ୍ସନିଷ୍ଟ ମାୟା। ଡାକ୍ତର ଅପଏଣ୍ଟମେଣ୍ଟ, ସମୟସୂଚୀ ଏବଂ ରିପୋର୍ଟ ସମ୍ବନ୍ଧରେ ମୁଁ ସାହାଯ୍ୟ କରିପାରିବି। ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?`,
    timingsText: "ଆମ କ୍ଲିନିକ୍ ଓପିଡି ସୋମବାରରୁ ଶନିବାର ସକାଳ ୦୯:୦୦ ରୁ ରାତି ୦୮:୦୦ ଏବଂ ରବିବାର ସକାଳ ୧୦:୦୦ ରୁ ଦିନ ୦୨:୦୦ ପର୍ଯ୍ୟନ୍ତ ଖୋଲା ରହେ।",
    locationText: "ଲୁମେରା ଆପେକ୍ସ ପଲିକ୍ଲିନିକ୍ ୧୦୪-୧୦୬, ହେଲଥ୍ ହବ୍, ସେକ୍ଟର ୧୪, ମେଟ୍ରୋ ଷ୍ଟେସନ ସମ୍ମୁଖ, ଗୁଡ଼ଗାଓଁରେ ଅବସ୍ଥିତ।",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `ہیلو ${name}، آپ کی اپائنٹمنٹ ${doctor} (${specialty}) کے ساتھ آج ${slot} پر بک کر دی گئی ہے۔ آپ کا ٹوکن نمبر #${token} ہے۔ براہ کرم 10 منٹ پہلے تشریف لائیں۔`,
    greetingText: (name) =>
      `ہیلو ${name}! لومیرا اپیکس پولی کلینک میں خوش آمدید۔ میں آپ کی اے آئی ریسپشنسٹ مایا ہوں۔ میں اپائنٹمنٹ بک کرنے، ڈاکٹر کے اوقات اور رپورٹس میں مدد کر سکتی ہوں۔ میں آپ کی کیا مدد کر سکتی ہوں؟`,
    timingsText: "ہمارا کلینک او پی ڈی پیر سے ہفتہ صبح 09:00 سے رات 08:00 بجے تک اور اتوار صبح 10:00 سے دوپہر 02:00 بجے تک کھلا رہتا ہے۔",
    locationText: "لومیرا اپیکس پولی کلینک 104-106، ہیلتھ ہب، سیکٹر 14، میٹرو اسٹیشن کے سامنے، گڑگاؤں میں واقع ہے۔ پارکنگ کی سہولت دستیاب ہے۔",
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
    bookingFormat: (name, doctor, specialty, slot, token) =>
      `Hello ${name}, your consultation with ${doctor} (${specialty}) has been booked for today at ${slot}. Your OPD token is #${token}. Please arrive 10 minutes prior to your slot.`,
    greetingText: (name) =>
      `Hello ${name}! Welcome to Lumera Apex PolyClinic. I am Maya, your AI clinic receptionist. I can help you schedule an appointment, check doctor timings, or access your medical records. How may I assist you today?`,
    timingsText: "Our clinic OPD operates Monday through Saturday from 09:00 AM to 08:00 PM, and Sundays from 10:00 AM to 02:00 PM. Diagnostic lab sample collection begins at 08:00 AM daily.",
    locationText: "Lumera Apex PolyClinic is located at 104 to 106, Health Hub, Sector 14, Opposite Metro Station, Gurgaon. Dedicated on-site parking is available for all patients.",
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

export async function runGeminiVoiceReceptionist(opts: VoiceReceptionistInput): Promise<VoiceReceptionistResult> {
  const { message, callerName = "Patient", callerPhone = "+919999973271", language = "English", tenantId = "tenant-lumera-main", getGenAI } = opts;
  const lowerMsg = String(message || "").toLowerCase();
  const db = getDb();
  const registered = findRegisteredPatient(db, callerPhone, tenantId);
  const cleanCallerName =
    registered?.firstName ||
    (callerName && !/^patient(\s*\(\+?\d+\))?$/i.test(callerName) && callerName !== "A1 Test Recipient" ? callerName.split(/\s+/)[0] : "there");

  const langCode = detectIndicLanguage(message, language);
  const langInfo = INDIC_LANGUAGES[langCode] || INDIC_LANGUAGES.en;

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

  // 2. Specialty & Clinical Keywords Matching across Indic languages
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
      });
      const appt = booked.appointment;
      const speechText = langInfo.bookingFormat(
        cleanCallerName,
        appt.doctorName,
        appt.specialty,
        appt.timeSlot,
        appt.tokenNumber
      );

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
        buttons: langInfo.buttons.booking,
      };
    } catch (bookingErr) {
      console.warn("[Voice Receptionist Booking Fallback]", bookingErr);
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
      speechText: langInfo.locationText,
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
        const prompt = `You are Maya, Senior AI Clinic Receptionist at Lumera Apex PolyClinic.
Caller Name: ${cleanCallerName}
Caller Message: "${message}"
Detected Language: ${langInfo.name} (${langInfo.localName})

Guidelines:
1. Respond warmly and politely as Maya the receptionist directly in ${langInfo.name} (${langInfo.localName}).
2. Keep the answer spoken, natural, concise (under 30-40 words) suitable for voice audio playback over telephone/WhatsApp voice note.
3. Offer relevant clinical help: OPD booking, timings (Mon-Sat 9AM-8PM), doctor availability, or connecting to reception.
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
    speechText: langInfo.greetingText(cleanCallerName),
    intent: "INQUIRY",
    suggestedAction: "Greeted patient and offered clinical services in " + langInfo.name,
    isEmergency: false,
    buttons: langInfo.buttons.inquiry,
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
