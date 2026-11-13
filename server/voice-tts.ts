/** Languages Maya speaks back with a free-tier Cloud TTS voice. */
export type MayaSpokenLanguage = "hi" | "mr" | "en";

/**
 * Free-tier voices only.
 *
 * Default is Chirp 3: HD (SKU F977-2280-6F1B), which includes the first
 * 1 million characters each month. The persona is Aoede, a female voice
 * available as en-IN, hi-IN, and mr-IN Chirp3-HD.
 * https://cloud.google.com/text-to-speech/pricing
 * https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
 * https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
 *
 * If a Chirp synthesize call fails before this call has committed to it,
 * Maya falls back to the WaveNet voices below. WaveNet and Standard share
 * SKU 9D01-5995-B545 and the first 4 million characters each month.
 * Neural2, Studio, Journey, and Gemini TTS are not on this list. There is
 * no second provider.
 */
export const CHIRP3_HD_PERSONAS = [
  "Achernar",
  "Achird",
  "Algenib",
  "Algieba",
  "Alnilam",
  "Aoede",
  "Autonoe",
  "Callirrhoe",
  "Charon",
  "Despina",
  "Enceladus",
  "Erinome",
  "Fenrir",
  "Gacrux",
  "Iapetus",
  "Kore",
  "Laomedeia",
  "Leda",
  "Orus",
  "Pulcherrima",
  "Puck",
  "Rasalgethi",
  "Sadachbia",
  "Sadaltager",
  "Schedar",
  "Sulafat",
  "Umbriel",
  "Vindemiatrix",
  "Zephyr",
  "Zubenelgenubi",
] as const;

const LANGUAGE_CODE: Record<MayaSpokenLanguage, "hi-IN" | "mr-IN" | "en-IN"> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
};

const WAVE_AND_STANDARD = {
  en: [
    "en-IN-Wavenet-A",
    "en-IN-Wavenet-B",
    "en-IN-Wavenet-C",
    "en-IN-Wavenet-D",
    "en-IN-Wavenet-E",
    "en-IN-Wavenet-F",
    "en-IN-Standard-A",
    "en-IN-Standard-B",
    "en-IN-Standard-C",
    "en-IN-Standard-D",
    "en-IN-Standard-E",
    "en-IN-Standard-F",
  ],
  hi: [
    "hi-IN-Wavenet-A",
    "hi-IN-Wavenet-B",
    "hi-IN-Wavenet-C",
    "hi-IN-Wavenet-D",
    "hi-IN-Wavenet-E",
    "hi-IN-Wavenet-F",
    "hi-IN-Standard-A",
    "hi-IN-Standard-B",
    "hi-IN-Standard-C",
    "hi-IN-Standard-D",
    "hi-IN-Standard-E",
    "hi-IN-Standard-F",
  ],
  mr: [
    "mr-IN-Wavenet-A",
    "mr-IN-Wavenet-B",
    "mr-IN-Wavenet-C",
    "mr-IN-Standard-A",
    "mr-IN-Standard-B",
    "mr-IN-Standard-C",
  ],
} as const;

function chirp3HdNames(language: MayaSpokenLanguage): string[] {
  const locale = LANGUAGE_CODE[language];
  return CHIRP3_HD_PERSONAS.map((persona) => `${locale}-Chirp3-HD-${persona}`);
}

export const MAYA_TTS_VOICES: Record<MayaSpokenLanguage, readonly string[]> = {
  en: [...chirp3HdNames("en"), ...WAVE_AND_STANDARD.en],
  hi: [...chirp3HdNames("hi"), ...WAVE_AND_STANDARD.hi],
  mr: [...chirp3HdNames("mr"), ...WAVE_AND_STANDARD.mr],
};

export type MayaTtsVoiceName = string;

export interface CloudTtsVoice {
  languageCode: "hi-IN" | "mr-IN" | "en-IN";
  name: MayaTtsVoiceName;
}

/**
 * One voice per language for every clip Maya speaks (greeting, hold, filler, reply).
 *
 * The default persona is Chirp 3: HD Aoede for English, Hindi, and Marathi.
 * MAYA_TTS_VOICE_EN, MAYA_TTS_VOICE_HI, and MAYA_TTS_VOICE_MR override the
 * default only when the value is on that language's free-tier allow-list.
 * Anything else is ignored and the Chirp 3 HD default is used.
 *
 * A call keeps the voice that first succeeded for that language. A later
 * failure does not switch from Chirp to WaveNet, or the other way, mid-call.
 */
export const CLOUD_TTS_TIER = "Chirp3-HD";
export const CLOUD_TTS_FREE_CHARACTERS_PER_MONTH = 1_000_000;
export const CLOUD_TTS_SKU = "F977-2280-6F1B";
export const CLOUD_TTS_WAVENET_TIER = "WaveNet";
export const CLOUD_TTS_WAVENET_FREE_CHARACTERS_PER_MONTH = 4_000_000;
export const CLOUD_TTS_WAVENET_SKU = "9D01-5995-B545";

export const MAYA_TTS_DEFAULTS: Record<MayaSpokenLanguage, MayaTtsVoiceName> = {
  en: "en-IN-Chirp3-HD-Aoede",
  hi: "hi-IN-Chirp3-HD-Aoede",
  mr: "mr-IN-Chirp3-HD-Aoede",
};

export const MAYA_TTS_WAVENET_FALLBACK: Record<MayaSpokenLanguage, MayaTtsVoiceName> = {
  en: "en-IN-Wavenet-D",
  hi: "hi-IN-Wavenet-A",
  mr: "mr-IN-Wavenet-A",
};

const MAYA_TTS_ENV: Record<MayaSpokenLanguage, string> = {
  en: "MAYA_TTS_VOICE_EN",
  hi: "MAYA_TTS_VOICE_HI",
  mr: "MAYA_TTS_VOICE_MR",
};

const clipAudioCache = new Map<string, string>();
const ignoredVoiceEnv = new Set<string>();
const voicePins = new Map<string, string>();

export function isChirp3HdVoice(name: string): boolean {
  return /-Chirp3-HD-/.test(name);
}

export function cloudTtsBilling(voiceName: string): { tier: string; freeCharactersPerMonth: number; sku: string } {
  if (isChirp3HdVoice(voiceName)) {
    return {
      tier: CLOUD_TTS_TIER,
      freeCharactersPerMonth: CLOUD_TTS_FREE_CHARACTERS_PER_MONTH,
      sku: CLOUD_TTS_SKU,
    };
  }
  return {
    tier: CLOUD_TTS_WAVENET_TIER,
    freeCharactersPerMonth: CLOUD_TTS_WAVENET_FREE_CHARACTERS_PER_MONTH,
    sku: CLOUD_TTS_WAVENET_SKU,
  };
}

export function resetCloudTtsVoicePinsForTests(): void {
  voicePins.clear();
}

function pinScope(callKey: string): string {
  const trimmed = String(callKey || "").trim();
  return trimmed || "shared";
}

function pinMapKey(callKey: string, spoken: MayaSpokenLanguage): string {
  return `${pinScope(callKey)}:${spoken}`;
}

function pinnedVoiceName(callKey: string, spoken: MayaSpokenLanguage): string | null {
  const own = voicePins.get(pinMapKey(callKey, spoken));
  if (own) return own;
  if (pinScope(callKey) !== "shared") return voicePins.get(pinMapKey("shared", spoken)) || null;
  return null;
}

function rememberPin(callKey: string, spoken: MayaSpokenLanguage, voiceName: string): void {
  voicePins.set(pinMapKey(callKey, spoken), voiceName);
}

export function cloudTtsVoice(language: MayaSpokenLanguage, env: NodeJS.ProcessEnv = process.env): CloudTtsVoice {
  const key = MAYA_TTS_ENV[language];
  const requested = String(env[key] || "").trim();
  const allowed = MAYA_TTS_VOICES[language];
  const name = requested && allowed.includes(requested) ? requested : MAYA_TTS_DEFAULTS[language];
  if (requested && name !== requested && !ignoredVoiceEnv.has(`${key}:${requested}`)) {
    ignoredVoiceEnv.add(`${key}:${requested}`);
    console.warn(`[Cloud TTS] ${key}=${requested} is not a free-tier ${LANGUAGE_CODE[language]} Chirp 3 HD, WaveNet, or Standard voice. Using ${name}.`);
  }
  return { languageCode: LANGUAGE_CODE[language], name };
}

export function wavenetFallbackVoice(language: MayaSpokenLanguage): CloudTtsVoice {
  return { languageCode: LANGUAGE_CODE[language], name: MAYA_TTS_WAVENET_FALLBACK[language] };
}

/**
 * Chirp 3: HD does not take the audioConfig pitch parameter. The list-voices
 * note also rejects speakingRate; the Chirp 3 page later allows speaking_rate
 * only. Pitch and speakingRate are omitted so a Chirp call is not rejected.
 * Input is plain text. WaveNet keeps the previous rate and pitch.
 * https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
 * https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
 */
export function cloudTtsSynthesizeRequest(text: string, voice: CloudTtsVoice): {
  input: { text: string };
  voice: { languageCode: CloudTtsVoice["languageCode"]; name: string };
  audioConfig: { audioEncoding: "MP3"; speakingRate?: number; pitch?: number };
} {
  const audioConfig = isChirp3HdVoice(voice.name)
    ? { audioEncoding: "MP3" as const }
    : { audioEncoding: "MP3" as const, speakingRate: 0.98, pitch: 0 };
  return {
    input: { text },
    voice: { languageCode: voice.languageCode, name: voice.name },
    audioConfig,
  };
}

/**
 * One utterance only. A hint of Hindi or Hinglish, a detected hi/mr code, or any
 * Devanagari letter chooses the voice immediately. Live calls must not use this
 * as the call language. resolveMayaCallLanguage in voice-language-lock.ts keeps
 * one language for the call and is what /api/voice/inbound speaks with.
 * `detectedCode` is the result of detectIndicLanguage. Every other language stays en-IN.
 */
export function mayaSpokenLanguage(transcript: string, hinted?: string, detectedCode?: string): MayaSpokenLanguage {
  const hint = String(hinted || "").trim().toLowerCase();
  if (hint === "hi" || hint === "hi-in" || hint.includes("hindi") || hint.includes("hinglish")) return "hi";
  if (hint === "mr" || hint === "mr-in" || hint.includes("marathi")) return "mr";
  if (hint === "en" || hint === "en-in" || hint === "english") return "en";
  if (detectedCode === "hi") return "hi";
  if (detectedCode === "mr") return "mr";
  if (/[\u0900-\u097F]/.test(transcript) && /आहे|नाही|झाले|मला|कंबरदुखी|नमस्कार|दाखवायचे/.test(transcript)) return "mr";
  if (/[\u0900-\u097F]/.test(transcript)) return "hi";
  return "en";
}

export interface CloudTtsSynthesis {
  audio: string | null;
  voice: CloudTtsVoice;
}

async function fetchAccessToken(): Promise<string> {
  const tokenRes = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (!tokenRes || !tokenRes.ok) return "";
  const json = await tokenRes.json() as { access_token?: string };
  return json.access_token || "";
}

async function synthesizeOnce(text: string, voice: CloudTtsVoice, accessToken: string): Promise<string | null> {
  const ttsRes = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-goog-user-project": "gen-lang-client-0108182367",
    },
    body: JSON.stringify(cloudTtsSynthesizeRequest(text, voice)),
    signal: AbortSignal.timeout(4000),
  });
  if (!ttsRes.ok) return null;
  const data = await ttsRes.json() as { audioContent?: string };
  return data.audioContent || null;
}

function cachedAudio(voiceName: string, text: string): string | null {
  return clipAudioCache.get(`${voiceName}\n${text}`) || null;
}

function rememberAudio(voiceName: string, text: string, audio: string): void {
  clipAudioCache.set(`${voiceName}\n${text}`, audio);
  if (clipAudioCache.size > 200) {
    const oldest = clipAudioCache.keys().next().value;
    if (oldest) clipAudioCache.delete(oldest);
  }
}

/**
 * Google Cloud Text-to-Speech MP3, base64. Null when the metadata token or
 * the synthesize call fails. Callers keep silence and retry the same voice.
 *
 * MAYA_TTS_OFFLINE=1 returns null before any metadata or synthesize request.
 * Unset, empty, and every other value leave this path unchanged.
 *
 * `callKey` pins the voice for one call and language. An empty key shares
 * the preload pin (greeting, hold, filler). The first success sticks.
 */
export async function synthesizeCloudTts(text: string, spoken: MayaSpokenLanguage, callKey = ""): Promise<string | null> {
  const result = await synthesizeCloudTtsDetailed(text, spoken, callKey);
  return result.audio;
}

export async function synthesizeCloudTtsDetailed(
  text: string,
  spoken: MayaSpokenLanguage,
  callKey = "",
): Promise<CloudTtsSynthesis> {
  const preferred = cloudTtsVoice(spoken);
  if (process.env.MAYA_TTS_OFFLINE === "1") return { audio: null, voice: preferred };
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { audio: null, voice: preferred };

  const pinned = pinnedVoiceName(callKey, spoken);
  const primary = pinned
    ? { languageCode: LANGUAGE_CODE[spoken], name: pinned }
    : preferred;
  const cached = cachedAudio(primary.name, cleaned);
  if (cached) {
    rememberPin(callKey, spoken, primary.name);
    return { audio: cached, voice: primary };
  }

  try {
    const accessToken = await fetchAccessToken();
    if (!accessToken) return { audio: null, voice: primary };
    const primaryAudio = await synthesizeOnce(cleaned, primary, accessToken);
    if (primaryAudio) {
      rememberAudio(primary.name, cleaned, primaryAudio);
      rememberPin(callKey, spoken, primary.name);
      return { audio: primaryAudio, voice: primary };
    }
    if (pinned || !isChirp3HdVoice(primary.name)) {
      if (pinned) rememberPin(callKey, spoken, primary.name);
      return { audio: null, voice: primary };
    }
    const fallback = wavenetFallbackVoice(spoken);
    const fallbackCached = cachedAudio(fallback.name, cleaned);
    if (fallbackCached) {
      rememberPin(callKey, spoken, fallback.name);
      return { audio: fallbackCached, voice: fallback };
    }
    const fallbackAudio = await synthesizeOnce(cleaned, fallback, accessToken);
    if (fallbackAudio) {
      rememberAudio(fallback.name, cleaned, fallbackAudio);
      rememberPin(callKey, spoken, fallback.name);
      return { audio: fallbackAudio, voice: fallback };
    }
    return { audio: null, voice: primary };
  } catch (err) {
    console.warn("[Cloud TTS synthesis error]", err);
    return { audio: null, voice: primary };
  }
}
