/** Languages Maya speaks back with a free-tier Cloud TTS voice. */
export type MayaSpokenLanguage = "hi" | "mr" | "en";

export interface CloudTtsVoice {
  languageCode: "hi-IN" | "mr-IN" | "en-IN";
  name: "hi-IN-Wavenet-A" | "mr-IN-Wavenet-A" | "en-IN-Wavenet-A";
}

/**
 * WaveNet shares the Standard free monthly character quota (4 million).
 * Neural2 is a smaller quota and is not used for Maya.
 */
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
