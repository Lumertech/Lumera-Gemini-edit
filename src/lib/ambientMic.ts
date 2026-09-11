export type AmbientMicErrorCode =
  | "permission-denied"
  | "no-microphone"
  | "insecure-context"
  | "speech-unsupported"
  | "unknown";

export class AmbientMicError extends Error {
  code: AmbientMicErrorCode;
  constructor(code: AmbientMicErrorCode, message: string) {
    super(message);
    this.name = "AmbientMicError";
    this.code = code;
  }
}

export function micErrorMessage(err: unknown): { code: AmbientMicErrorCode; message: string } {
  if (err instanceof AmbientMicError) {
    return { code: err.code, message: err.message };
  }
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      code: "permission-denied",
      message: "Microphone access was blocked. Allow the mic in the browser address bar, then tap Start listening again.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "no-microphone",
      message: "No microphone was found. Plug in a mic or check system sound settings.",
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      code: "unknown",
      message: "The microphone is already in use by another app. Close it and try again.",
    };
  }
  const msg = err instanceof Error ? err.message : "Could not start the microphone.";
  return { code: "unknown", message: msg };
}

type SpeechRecCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function speechRecognitionCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionAvailable(): boolean {
  return Boolean(speechRecognitionCtor());
}

export interface AmbientMicSession {
  stream: MediaStream;
  stop: () => void;
}

export interface StartAmbientMicOptions {
  lang?: string;
  onTranscript: (payload: { finalChunk: string; interim: string }) => void;
  onLevel: (level: number) => void;
  onSpeechEnded?: () => void;
  onError?: (message: string) => void;
}

/**
 * Requests a real MediaStream, drives an analyser for the visualizer,
 * and streams Web Speech API results while the session is open.
 */
export async function startAmbientMic(options: StartAmbientMicOptions): Promise<AmbientMicSession> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new AmbientMicError("unknown", "Microphone is only available in the browser.");
  }
  if (!window.isSecureContext) {
    throw new AmbientMicError(
      "insecure-context",
      "Microphone requires HTTPS (or localhost). Open this clinic on a secure URL."
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AmbientMicError(
      "unknown",
      "This browser does not support live microphone capture (MediaDevices)."
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const mapped = micErrorMessage(err);
    throw new AmbientMicError(mapped.code, mapped.message);
  }

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteFrequencyData(bins);
    const avg = bins.reduce((sum, v) => sum + v, 0) / Math.max(bins.length, 1);
    options.onLevel(Math.min(100, Math.round((avg / 255) * 100)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const Ctor = speechRecognitionCtor();
  let recognition: SpeechRecognitionLike | null = null;
  let intentionalStop = false;

  if (Ctor) {
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.lang || "en-IN";
    recognition.onresult = (event) => {
      let finalChunk = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalChunk += piece;
        else interim += piece;
      }
      options.onTranscript({
        finalChunk: finalChunk.trim(),
        interim: interim.trim(),
      });
    };
    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        options.onError?.(
          "Speech recognition was blocked. Allow the microphone in the browser address bar, then tap Start listening again."
        );
      } else if (ev.error === "audio-capture") {
        options.onError?.("No microphone was found. Plug in a mic or check system sound settings.");
      } else if (ev.error === "network") {
        options.onError?.("Speech recognition lost its network connection. Check connectivity and try again.");
      }
    };
    recognition.onend = () => {
      if (!intentionalStop && recognition) {
        try {
          recognition.start();
        } catch {
          options.onSpeechEnded?.();
        }
      } else {
        options.onSpeechEnded?.();
      }
    };
    try {
      recognition.start();
    } catch {
      /* already started */
    }
  }

  return {
    stream,
    stop: () => {
      intentionalStop = true;
      cancelAnimationFrame(raf);
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((track) => track.stop());
      void audioCtx.close();
      options.onLevel(0);
    },
  };
}
