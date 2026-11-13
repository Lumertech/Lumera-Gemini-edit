/** Languages Maya speaks back with a free-tier Cloud TTS voice. */
export type MayaSpokenLanguage = "hi" | "mr" | "en";

export interface CloudTtsVoice {
  languageCode: "hi-IN" | "mr-IN" | "en-IN";
  name: "hi-IN-Wavenet-A" | "mr-IN-Wavenet-A" | "en-IN-Wavenet-A";
}

/**
 * One WaveNet voice per language Maya speaks. WaveNet is a legacy Cloud TTS
 * voice on SKU 9D01-5995-B545 (the same SKU as Standard). The free monthly
 * allowance is the first 4 million characters. Past that, Google bills the
 * project, so Maya stays on this voice and does not switch engines.
 * Neural2 is a separate 1 million character allowance and is not used.
 * Chirp 3 HD, Studio, and Gemini TTS are not used.
 * https://cloud.google.com/text-to-speech/pricing
 */
export const CLOUD_TTS_TIER = "WaveNet";
export const CLOUD_TTS_FREE_CHARACTERS_PER_MONTH = 4_000_000;
export const CLOUD_TTS_SKU = "9D01-5995-B545";

const clipAudioCache = new Map<string, string>();

export function cloudTtsVoice(language: MayaSpokenLanguage): CloudTtsVoice {
  if (language === "hi") return { languageCode: "hi-IN", name: "hi-IN-Wavenet-A" };
  if (language === "mr") return { languageCode: "mr-IN", name: "mr-IN-Wavenet-A" };
  return { languageCode: "en-IN", name: "en-IN-Wavenet-A" };
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
