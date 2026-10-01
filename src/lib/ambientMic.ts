export type AmbientMicErrorCode =
  | "permission-denied"
  | "no-microphone"
  | "mic-busy"
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

export type TranscriptOrigin = "empty" | "sample" | "live" | "server" | "typed";

/** Sample dialogue must never be presented as a live capture. */
export function microphoneStatusLabel(input: {
  requesting: boolean;
  recording: boolean;
  transcriptOrigin: TranscriptOrigin;
  transcribing?: boolean;
}): string {
  if (input.transcribing) return "Transcribing…";
  if (input.requesting) return "Waiting for microphone permission";
  if (input.transcriptOrigin === "sample") return "Sample/Demo";
  if (input.recording) return "Live microphone";
  return "Microphone idle";
}

export function transcriptBadge(origin: TranscriptOrigin): string {
  if (origin === "sample") return "Sample/Demo";
  if (origin === "live") return "Live transcript";
  if (origin === "server") return "Server transcript";
  if (origin === "typed") return "Typed consult";
  return "";
}

/**
 * How a doctor unblocks a persisted microphone deny.
 * Chrome Android, iOS Safari, and in-app webviews (WhatsApp, Instagram) differ.
 */
export const MIC_UNBLOCK_STEPS =
  "Chrome on Android: tap the lock icon (or Site settings), then Microphone, then Allow, then reload. " +
  "iPhone or iPad: Settings, then Safari, then Microphone, then Allow (or tap aA, then Website Settings, then Microphone). " +
  "If this page is open inside WhatsApp, Instagram, or another in-app browser, choose Open in Chrome or Open in Safari.";

export type AmbientCaptureFailure =
  | { kind: "exception"; name?: string; message?: string }
  | { kind: "insecure-context" }
  | { kind: "speech-recognition-missing" };

/**
 * Pure mapping from a capture failure to the in-app message.
 * Does not touch the microphone or the network.
 */
export function mapAmbientCaptureFailure(failure: AmbientCaptureFailure): { code: AmbientMicErrorCode; message: string } {
  if (failure.kind === "insecure-context") {
    return {
      code: "insecure-context",
      message:
        "Microphone requires a secure page (HTTPS or localhost). Open this clinic in Chrome or Safari, then allow the microphone. " +
        MIC_UNBLOCK_STEPS,
    };
  }
  if (failure.kind === "speech-recognition-missing") {
    return {
      code: "speech-unsupported",
      message:
        "This browser has no live speech-to-text (Web Speech API). The microphone level is still live. Lumera will send the recording for transcription, or you can type the consult. " +
        "In-app browsers such as WhatsApp and Instagram usually have no SpeechRecognition — open this page in Chrome or Safari. " +
        MIC_UNBLOCK_STEPS,
    };
  }
  const name = failure.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      code: "permission-denied",
      message: "Microphone access was blocked for this site. " + MIC_UNBLOCK_STEPS,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "no-microphone",
      message:
        "No microphone was found. Plug in a mic or check system sound settings, then try again. " + MIC_UNBLOCK_STEPS,
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "mic-busy",
      message:
        "The microphone could not be started. Another app may be using it, or the browser could not open the track. Close other apps using the mic and try again. " +
        MIC_UNBLOCK_STEPS,
    };
  }
  if (name === "SecurityError") {
    return {
      code: "insecure-context",
      message:
        "The browser blocked the microphone (SecurityError), often because the page is not a secure context. Use HTTPS and open the page in Chrome or Safari. " +
        MIC_UNBLOCK_STEPS,
    };
  }
  if (name === "AbortError") {
    return {
      code: "unknown",
      message: "The microphone request was aborted. Close other apps using the mic and tap Start listening again.",
    };
  }
  const msg = failure.message?.trim() || "Could not start the microphone.";
  return { code: "unknown", message: msg };
}

export const SPEECH_UNSUPPORTED_NOTICE = mapAmbientCaptureFailure({ kind: "speech-recognition-missing" }).message;

export const SPEECH_STOPPED_NOTICE =
  "Live transcription stopped immediately. This browser's speech service is unavailable. The microphone level is still live; Lumera will send the recording for transcription, or you can type the consult. " +
  MIC_UNBLOCK_STEPS;

/** Fatal Web Speech errors become a visible message. no-speech and aborted are normal. */
export function speechRecognitionFailureMessage(code: string | undefined): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Speech recognition was blocked. " + MIC_UNBLOCK_STEPS;
    case "audio-capture":
      return "No microphone was found. Plug in a mic or check system sound settings.";
    case "network":
      return "Live speech recognition could not reach its network service. The microphone level is still live; Lumera will send the recording for transcription, or you can type the consult.";
    case "language-not-supported":
      return "This browser does not support live transcription for en-IN. Lumera will send the recording for transcription, or you can type the consult.";
    case "aborted":
    case "no-speech":
    case undefined:
    case "":
      return null;
    default:
      return `Live transcription failed (${code}). The microphone level is still live; Lumera will send the recording for transcription, or you can type the consult.`;
  }
}

export function isFatalSpeechError(code: string | undefined): boolean {
  return speechRecognitionFailureMessage(code) !== null;
}

/** Prefer Opus in WebM, then MP4 (iOS Safari MediaRecorder). */
export const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4"] as const;

export type CapturePath = "web-speech" | "media-recorder";

/** Web Speech missing → record and POST /api/gemini/transcribe. */
export function selectCapturePath(speechRecognitionAvailable: boolean): CapturePath {
  return speechRecognitionAvailable ? "web-speech" : "media-recorder";
}

export function selectRecorderMimeType(isTypeSupported: (mime: string) => boolean): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      return "";
    }
  }
  return "";
}

/** Codec parameters are for MediaRecorder. The transcribe route expects a bare audio type. */
export function transcriptionMimeType(recorderMime: string | undefined): string {
  const base = String(recorderMime || "").split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/webm" || base === "audio/aac" || base === "audio/mpeg" || base === "audio/wav") {
    return base;
  }
  return "audio/webm";
}

/** Stop and send one clip. Long enough for a consult turn, short enough for one inline upload. */
export const MAX_AMBIENT_RECORDING_MS = 90_000;
export const MAX_AMBIENT_AUDIO_BYTES = 8 * 1024 * 1024;

export type MicrophonePermissionState = "granted" | "denied" | "prompt" | "unsupported";

export async function queryMicrophonePermission(
  permissions: { query?: (desc: { name: "microphone" }) => Promise<{ state: string }> } | null | undefined
): Promise<MicrophonePermissionState> {
  const query = permissions?.query;
  if (!query) return "unsupported";
  try {
    const status = await query.call(permissions, { name: "microphone" });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

export function micErrorMessage(err: unknown): { code: AmbientMicErrorCode; message: string } {
  if (err instanceof AmbientMicError) {
    return { code: err.code, message: err.message };
  }
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  const message = err instanceof Error ? err.message : undefined;
  return mapAmbientCaptureFailure({ kind: "exception", name, message });
}

export async function transcribeRecordedAudio(blob: Blob, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (blob.size < 100) {
    throw new Error("The recording was too short to transcribe. Speak for a few seconds, then stop listening.");
  }
  const mimeType = transcriptionMimeType(blob.type);
  const dataUrl = await blobToDataUrl(blob, mimeType);
  const res = await fetchImpl("/api/gemini/transcribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...browserAuthHeaders() },
    body: JSON.stringify({ audioBase64: dataUrl, mimeType }),
  });
  const raw = await res.text();
  let data: { success?: boolean; transcription?: string; error?: string } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    data = { error: raw.slice(0, 180) || "Transcription failed." };
  }
  const transcription = data.transcription?.trim() || "";
  if (res.ok && data.success && transcription) return transcription;
  if (res.status === 503) {
    throw new Error(
      "Server transcription is not configured (missing API key). Use Chrome or Edge for live speech-to-text, or type the consult."
    );
  }
  if (res.status === 404) {
    throw new Error("Server transcription is unavailable. The transcribe endpoint was not found. Type the consult, or use Chrome or Edge for live speech-to-text.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("Transcription was refused. Sign in again, then retry the microphone.");
  }
  throw new Error(data.error || "Server transcription failed. Type the consult, or use Chrome or Edge for live speech-to-text.");
}

function browserAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|; )lumera_csrf=([^;]*)/);
    if (match?.[1]) {
      try {
        headers["X-CSRF-Token"] = decodeURIComponent(match[1]);
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const token = localStorage.getItem("lumera_session_token");
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers["x-session-token"] = token;
      }
    } catch {
      /* ignore storage errors */
    }
  }
  return headers;
}

async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // Bare type so the server's `data:audio/<type>;base64,` strip matches (codec suffixes would not).
  return `data:${mimeType};base64,${btoa(binary)}`;
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

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  // Leave the track unprocessed so the level meter follows the microphone.
  // Browser echo cancellation can zero a quiet or synthetic input and look like a dead mic.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

interface GestureAudioContext {
  state: string;
  resume: () => Promise<void>;
  close: () => Promise<void>;
  createMediaStreamSource: (stream: MediaStream) => MediaStreamAudioSourceNode;
  createAnalyser: () => AnalyserNode;
}

export interface AmbientMicGesture {
  permissionPromise: Promise<MicrophonePermissionState>;
  streamPromise: Promise<MediaStream>;
  audioContext: GestureAudioContext;
  resumePromise: Promise<void>;
}

export interface AmbientGestureDeps {
  isSecureContext: boolean;
  mediaDevices: { getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> } | undefined;
  permissions?: { query?: (desc: { name: "microphone" }) => Promise<{ state: string }> } | null;
  createAudioContext: () => GestureAudioContext;
}

function browserGestureDeps(): AmbientGestureDeps {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new AmbientMicError("unknown", "Microphone is only available in the browser.");
  }
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new AmbientMicError("unknown", "This browser cannot open an audio meter (AudioContext).");
  }
  return {
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    permissions: navigator.permissions,
    createAudioContext: () => new Ctx(),
  };
}

/**
 * Call this directly from the tap handler, before any await.
 * getUserMedia and AudioContext.resume run in that same turn so iOS keeps the user activation.
 * permissions.query is started in the same turn and is not awaited before getUserMedia.
 */
export function beginAmbientMicGesture(deps: AmbientGestureDeps = browserGestureDeps()): AmbientMicGesture {
  if (!deps.isSecureContext) {
    const mapped = mapAmbientCaptureFailure({ kind: "insecure-context" });
    throw new AmbientMicError(mapped.code, mapped.message);
  }
  if (!deps.mediaDevices?.getUserMedia) {
    throw new AmbientMicError("unknown", "This browser does not support live microphone capture (MediaDevices).");
  }

  let permissionPromise: Promise<MicrophonePermissionState>;
  try {
    const query = deps.permissions?.query;
    if (!query) {
      permissionPromise = Promise.resolve("unsupported");
    } else {
      permissionPromise = query
        .call(deps.permissions, { name: "microphone" })
        .then((status) => {
          if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
          return "unsupported" as const;
        })
        .catch(() => "unsupported" as const);
    }
  } catch {
    permissionPromise = Promise.resolve("unsupported");
  }

  const streamPromise = deps.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  const audioContext = deps.createAudioContext();
  const resumePromise =
    audioContext.state === "suspended"
      ? audioContext.resume().then(() => undefined).catch(() => undefined)
      : Promise.resolve();

  return { permissionPromise, streamPromise, audioContext, resumePromise };
}

export interface StartAmbientMicOptions {
  lang?: string;
  /** Created synchronously inside the tap via beginAmbientMicGesture. */
  gesture?: AmbientMicGesture;
  onTranscript: (payload: { finalChunk: string; interim: string }) => void;
  onLevel: (level: number) => void;
  onSpeechEnded?: () => void;
  onError?: (message: string) => void;
  /** Non-fatal: mic capture is up, but live speech-to-text is not. */
  onSpeechNotice?: (message: string) => void;
  onAudioRecorded?: (blob: Blob) => void;
  /** Fired when the session stops itself (length cap) or the caller stops it. */
  onStopped?: () => void;
}

function releaseStream(streamPromise: Promise<MediaStream>): void {
  streamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
}

/**
 * Opens the gesture's MediaStream, drives an AnalyserNode level meter on both
 * the Web Speech and MediaRecorder paths, and records when live speech-to-text is missing.
 */
export async function startAmbientMic(options: StartAmbientMicOptions): Promise<AmbientMicSession> {
  const gesture = options.gesture ?? beginAmbientMicGesture();
  const permission = await gesture.permissionPromise;
  if (permission === "denied") {
    releaseStream(gesture.streamPromise);
    void gesture.audioContext.close().catch(() => {});
    const mapped = mapAmbientCaptureFailure({ kind: "exception", name: "NotAllowedError" });
    throw new AmbientMicError(mapped.code, mapped.message);
  }

  let stream: MediaStream;
  try {
    stream = await gesture.streamPromise;
  } catch (err) {
    void gesture.audioContext.close().catch(() => {});
    const mapped = micErrorMessage(err);
    throw new AmbientMicError(mapped.code, mapped.message);
  }

  await gesture.resumePromise;
  if (gesture.audioContext.state === "suspended") {
    await gesture.audioContext.resume().catch(() => {});
  }

  const audioCtx = gesture.audioContext;
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  source.connect(analyser);
  const time = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) {
      const n = (time[i] - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / Math.max(time.length, 1));
    options.onLevel(Math.min(100, Math.round(rms * 280)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const canRecord = typeof MediaRecorder !== "undefined";
  const mimeType = canRecord
    ? selectRecorderMimeType((mime) => (typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported(mime) : false))
    : "";

  let mediaRecorder: MediaRecorder | null = null;
  const audioChunks: Blob[] = [];
  const Ctor = speechRecognitionCtor();
  const capturePath = selectCapturePath(Boolean(Ctor));
  let recognition: SpeechRecognitionLike | null = null;
  let intentionalStop = false;
  let fatalSpeech = false;
  let startedAt = 0;
  let rapidEnds = 0;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (intentionalStop) return;
    intentionalStop = true;
    if (capTimer) clearTimeout(capTimer);
    cancelAnimationFrame(raf);
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }

    const finalizeAudio = () => {
      const recordedType = mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunks, { type: recordedType });
      options.onAudioRecorded?.(audioBlob);
      stream.getTracks().forEach((track) => track.stop());
      void audioCtx.close().catch(() => {});
      options.onLevel(0);
      options.onStopped?.();
    };

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = finalizeAudio;
      try {
        mediaRecorder.stop();
      } catch {
        finalizeAudio();
      }
    } else {
      finalizeAudio();
    }
  };

  try {
    if (!canRecord) throw new Error("MediaRecorder unavailable");
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
      const total = audioChunks.reduce((sum, part) => sum + part.size, 0);
      if (total >= MAX_AMBIENT_AUDIO_BYTES) stop();
    };
    mediaRecorder.start(1000);
  } catch (err) {
    console.warn("MediaRecorder start warning:", err);
  }

  const armRecognition = () => {
    if (!recognition || intentionalStop || fatalSpeech) return;
    startedAt = Date.now();
    try {
      recognition.start();
    } catch {
      /* already started */
    }
  };

  if (capturePath === "media-recorder") {
    options.onSpeechNotice?.(SPEECH_UNSUPPORTED_NOTICE);
  } else if (Ctor) {
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.lang || "en-IN";
    recognition.onresult = (event) => {
      rapidEnds = 0;
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
      const message = speechRecognitionFailureMessage(ev.error);
      if (!message) return;
      fatalSpeech = true;
      options.onError?.(message);
    };
    recognition.onend = () => {
      if (intentionalStop || fatalSpeech) {
        options.onSpeechEnded?.();
        return;
      }
      const lived = Date.now() - startedAt;
      if (lived < 800) rapidEnds += 1;
      else rapidEnds = 0;
      if (rapidEnds >= 2) {
        fatalSpeech = true;
        options.onError?.(SPEECH_STOPPED_NOTICE);
        options.onSpeechEnded?.();
        return;
      }
      armRecognition();
    };
    armRecognition();
  }

  capTimer = setTimeout(() => stop(), MAX_AMBIENT_RECORDING_MS);

  return { stream, stop };
}
