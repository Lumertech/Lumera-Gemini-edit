import type { MayaSpokenLanguage } from "./voice-tts.ts";

/**
 * Maya stays quiet unless a turn is actually checking the schedule and the
 * answer is late. One line per turn, never the next turn as well, never over
 * audio that is already playing, and never while the caller is talking.
 */
export const MAYA_FILLER_DELAY_MS = 1350;

export const MAYA_FILLER_LINES: Record<MayaSpokenLanguage, string> = {
  en: "One moment, let me check the schedule.",
  hi: "एक पल, मैं शेड्यूल देख रही हूँ।",
  mr: "एक क्षण, मी शेड्यूल बघते.",
};

export interface FillerTurnInput {
  elapsedMs: number;
  lookup: boolean;
  replyStarted: boolean;
  bargeIn: boolean;
  alreadyPlayedThisTurn: boolean;
  playedOnPreviousTurn: boolean;
  trackSpeaking: boolean;
  callerSpeaking: boolean;
  /** Set when the utterance was dropped as noise, empty, or still inside the greeting. */
  utteranceDropped?: boolean;
}

export function shouldPlayFiller(input: FillerTurnInput): boolean {
  if (input.utteranceDropped) return false;
  if (input.bargeIn || input.alreadyPlayedThisTurn || input.playedOnPreviousTurn) return false;
  if (input.replyStarted || input.trackSpeaking || input.callerSpeaking) return false;
  if (!input.lookup) return false;
  if (input.elapsedMs < MAYA_FILLER_DELAY_MS) return false;
  return true;
}

/**
 * True when this turn is a slot, booking, or schedule check. A location,
 * refill, or ordinary reply is not a lookup, so Maya does not say she is
 * checking.
 */
export function voiceTurnNeedsScheduleLookup(input: {
  message: string;
  intent: string;
  wantsBooking: boolean;
}): boolean {
  if (input.wantsBooking) return true;
  const intent = String(input.intent || "").toUpperCase();
  if (intent === "BOOKING" || intent === "TIMINGS" || intent === "RESCHEDULE") return true;
  const text = String(input.message || "");
  if (/\b(slot|slots|availability|available|schedule|appointment|booking|timings|timing)\b/i.test(text)) return true;
  if (/\b(hours|open|close)\b/i.test(text) && /\b(clinic|doctor|opd|today|tomorrow)\b/i.test(text)) return true;
  if (/अपॉइंटमेंट|स्लॉट|शेड्यूल|समय|वेळ|वेळा/.test(text)) return true;
  return false;
}
