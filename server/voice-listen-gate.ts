/**
 * Call opening and noise gate for Maya.
 * The first audio is the clinic greeting, or silence until that greeting is ready.
 * Caller audio is ignored until the greeting has finished plus a short tail.
 * A burst shorter than the minimum Silero speech, or a transcript that is empty
 * or only noise, is dropped: no reply and no filler.
 * The gateway mirrors these rules in deploy/webrtc-voice-gateway/gateway.py.
 */

export const GREETING_TAIL_MS = 300;
export const MIN_SPEECH_MS = 400;
export const SPEECH_FRAME_MS = 32;
/** 512 samples at 16 kHz. 13 frames is 416ms, above the 400ms floor. */
export const MIN_SPEECH_FRAMES = Math.ceil(MIN_SPEECH_MS / SPEECH_FRAME_MS);

export const NOISE_TRANSCRIPT_TOKENS = [
  "uh",
  "um",
  "uhh",
  "umm",
  "hmm",
  "hm",
  "mm",
  "mmm",
  "ah",
  "ahh",
  "er",
  "err",
  "noise",
  "static",
  "silence",
  "inaudible",
  "background",
  "cough",
  "breath",
  "unintelligible",
] as const;

const NOISE_TOKEN_SET = new Set<string>(NOISE_TRANSCRIPT_TOKENS);

export type OpeningAudioKind = "greeting" | "silence";

/** Cache hit speaks the clinic greeting. A miss stays silent. Never a hold or filler. */
export function openingAudioKind(cachedGreetingReady: boolean): OpeningAudioKind {
  return cachedGreetingReady ? "greeting" : "silence";
}

/**
 * True while inbound audio must be ignored: greeting not queued yet, still playing,
 * or inside the post-greeting tail.
 */
export function greetingListenClosed(state: {
  greetingReady: boolean;
  playedGreeting: boolean;
  msAfterGreeting: number;
}): boolean {
  if (!state.greetingReady || !state.playedGreeting) return true;
  return state.msAfterGreeting < GREETING_TAIL_MS;
}

export function acceptsSpeechFrames(speechFrames: number): boolean {
  return speechFrames >= MIN_SPEECH_FRAMES;
}

/** Punctuation-only clips and tokens such as "uh" or "[noise]". Empty is not noise; callers handle it separately. */
export function isNoiseTranscript(transcript: string): boolean {
  const raw = String(transcript || "").trim().toLowerCase();
  if (!raw) return false;
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return true;
  return cleaned.split(" ").every((token) => NOISE_TOKEN_SET.has(token));
}

/**
 * Server drop. An empty transcript is dropped until two earlier unclear replies
 * are already in the history, so the existing third-strike transfer still speaks.
 * Noise tokens are always dropped, including on that third turn.
 */
export function shouldDropVoiceUtterance(transcript: string, priorUnclearCount = 0): boolean {
  if (isNoiseTranscript(transcript)) return true;
  if (!String(transcript || "").trim() && priorUnclearCount < 2) return true;
  return false;
}

/**
 * Gateway playback drop. Empty or noise transcripts do not speak and do not
 * get a filler. A transfer line the server already wrote still plays.
 */
export function shouldDropGatewayUtterance(transcript: string, speechText: string, intent: string): boolean {
  if (String(intent || "").trim().toUpperCase() === "TRANSFER" && String(speechText || "").trim()) return false;
  if (!String(transcript || "").trim()) return true;
  return isNoiseTranscript(transcript);
}

/** False means no handle_caller_utterance, no filler, and no Gemini call. */
export function shouldStartCallerTurn(input: {
  listenClosed: boolean;
  speechFrames: number;
  transcript?: string;
  priorUnclearCount?: number;
}): boolean {
  if (input.listenClosed) return false;
  if (!acceptsSpeechFrames(input.speechFrames)) return false;
  if (input.transcript !== undefined && shouldDropVoiceUtterance(input.transcript, input.priorUnclearCount ?? 0)) return false;
  return true;
}
