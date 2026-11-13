/** Languages Maya speaks back with a free-tier Cloud TTS voice. */
export type MayaSpokenLanguage = "hi" | "mr" | "en";

/**
 * Free-tier voices only. WaveNet and Standard share SKU 9D01-5995-B545 and
 * the first 4 million characters each month. Neural2, Chirp, Studio, and
 * Gemini TTS are absent from this list.
 * https://cloud.google.com/text-to-speech/pricing
 * https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
 */
export const MAYA_TTS_VOICES = {
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

export type MayaTtsVoiceName = (typeof MAYA_TTS_VOICES)[MayaSpokenLanguage][number];

export interface CloudTtsVoice {
  languageCode: "hi-IN" | "mr-IN" | "en-IN";
  name: MayaTtsVoiceName;
}

/**
 * One voice per language for every clip Maya speaks (greeting, hold, filler, reply).
 *
 * English default is en-IN-Wavenet-D. Google's female en-IN WaveNet voices are
 * A, D, and E. B, C, and F are male. Published listening notes put A near
 * 173 words per minute with slight breathiness, which thins the Indian accent
 * on a phone. That is the voice callers heard. D is the same WaveNet tier at
 * about 161 words per minute, with no significant breathiness and a steady
 * receptionist cadence. E is female and allowed, and it has no published
 * profile that is more natural than D for a clinic call.
 * Hindi stays on hi-IN-Wavenet-A and Marathi on mr-IN-Wavenet-A. Marathi has
 * no Wavenet-D. Both are the female WaveNet voices for those languages.
 *
 * MAYA_TTS_VOICE_EN, MAYA_TTS_VOICE_HI, and MAYA_TTS_VOICE_MR override the
 * default only when the value is on that language's allowlist. Anything else
 * is ignored and the default is used. There is no second engine.
 */
export const CLOUD_TTS_TIER = "WaveNet";
export const CLOUD_TTS_FREE_CHARACTERS_PER_MONTH = 4_000_000;
export const CLOUD_TTS_SKU = "9D01-5995-B545";
export const MAYA_TTS_DEFAULTS: Record<MayaSpokenLanguage, MayaTtsVoiceName> = {
  en: "en-IN-Wavenet-D",
  hi: "hi-IN-Wavenet-A",
  mr: "mr-IN-Wavenet-A",
};

const MAYA_TTS_ENV: Record<MayaSpokenLanguage, string> = {
  en: "MAYA_TTS_VOICE_EN",
  hi: "MAYA_TTS_VOICE_HI",
  mr: "MAYA_TTS_VOICE_MR",
};

const LANGUAGE_CODE: Record<MayaSpokenLanguage, CloudTtsVoice["languageCode"]> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
};

const clipAudioCache = new Map<string, string>();
const ignoredVoiceEnv = new Set<string>();

export function cloudTtsVoice(language: MayaSpokenLanguage, env: NodeJS.ProcessEnv = process.env): CloudTtsVoice {
  const key = MAYA_TTS_ENV[language];
  const requested = String(env[key] || "").trim();
  const allowed = MAYA_TTS_VOICES[language] as readonly string[];
  const name = requested && allowed.includes(requested) ? requested : MAYA_TTS_DEFAULTS[language];
  if (requested && name !== requested && !ignoredVoiceEnv.has(`${key}:${requested}`)) {
    ignoredVoiceEnv.add(`${key}:${requested}`);
    console.warn(`[Cloud TTS] ${key}=${requested} is not a free-tier ${LANGUAGE_CODE[language]} WaveNet or Standard voice. Using ${name}.`);
  }
  return { languageCode: LANGUAGE_CODE[language], name: name as MayaTtsVoiceName };
}

/**
 * Hindi and Marathi from the model hint or a detected Indic code.
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

/**
 * Google Cloud Text-to-Speech WaveNet MP3, base64. Null when the metadata
 * token or the synthesize call fails. Callers keep silence and retry.
 * There is no other voice.
 */
export async function synthesizeCloudTts(text: string, spoken: MayaSpokenLanguage): Promise<string | null> {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const voice = cloudTtsVoice(spoken);
  const key = `${voice.name}\n${cleaned}`;
  const cached = clipAudioCache.get(key);
  if (cached) return cached;
  try {
    const tokenRes = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    let accessToken = "";
    if (tokenRes && tokenRes.ok) {
      const json = await tokenRes.json() as { access_token?: string };
      accessToken = json.access_token || "";
    }
    if (!accessToken) return null;
    const ttsRes = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-goog-user-project": "gen-lang-client-0108182367",
      },
      body: JSON.stringify({
        input: { text: cleaned },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.98, pitch: 0.0 },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!ttsRes.ok) return null;
    const data = await ttsRes.json() as { audioContent?: string };
    const audio = data.audioContent || "";
    if (!audio) return null;
    clipAudioCache.set(key, audio);
    if (clipAudioCache.size > 200) {
      const oldest = clipAudioCache.keys().next().value;
      if (oldest) clipAudioCache.delete(oldest);
    }
    return audio;
  } catch (err) {
    console.warn("[Cloud TTS WaveNet synthesis error]", err);
    return null;
  }
}
