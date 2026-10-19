import { apiFetchResponse } from "../api/http";
import { ambientMicStartDecision, type AmbientMicStartDecision } from "./ambientScribeConsent";

export type AmbientMicErrorCode =
  | "permission-denied"
  | "no-microphone"
  | "mic-busy"
  | "insecure-context"
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

/** Shown when a lock or background ends the track. The next tap must call getUserMedia again. */
export const MIC_STOPPED_RESUME = "Mic stopped. Tap to resume.";

/**
 * In-app WebViews sometimes never resolve getUserMedia or permissions.query.
 * Fail visibly instead of leaving the consult on "Waiting for microphone".
 */
export const MIC_PROMPT_TIMEOUT_MS = 12_000;

export function micPromptTimeoutMessage(): string {
  return (
    "The microphone request timed out before the browser answered. If this page is inside WhatsApp, Instagram, or another in-app browser, open it in Chrome or Safari. " +
    MIC_UNBLOCK_STEPS
  );
}

/**
 * A dead track after screen lock or backgrounding is a stopped mic.
 * A hidden page whose track is still live is not.
 */
export function describeMicrophoneRecovery(input: {
  event: "track-ended" | "visibilitychange";
  visibilityState: string;
  trackStates: string[];
}): string | null {
  const dead = input.trackStates.length === 0 || input.trackStates.every((state) => state !== "live");
  if (!dead) return null;
  if (input.event === "track-ended" || input.event === "visibilitychange") return MIC_STOPPED_RESUME;
  return null;
}

export type AmbientCaptureFailure =
  | { kind: "exception"; name?: string; message?: string }
  | { kind: "insecure-context" };

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

/** Prefer Opus in WebM, then MP4 (iOS Safari MediaRecorder). */
export const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4"] as const;

/** The scribe always uploads the MediaRecorder clip. There is no live-caption path. */
export function shouldUploadAmbientRecording(): boolean {
  return true;
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

export async function transcribeRecordedAudio(
  blob: Blob,
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  durationMs?: number,
  appointmentId?: string,
  acceptEmpty = false
): Promise<string> {
  if (blob.size < 100) {
    throw new Error("The recording was too short to transcribe. Speak for a few seconds, then stop listening.");
  }
  const mimeType = transcriptionMimeType(blob.type);
  // The data URL lives only for this request. Nothing writes the clip to disk, localStorage, or the chart.
  const dataUrl = await blobToDataUrl(blob, mimeType);
  const claimedDuration = Number(durationMs);
  const init: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: dataUrl,
      mimeType,
      ...(Number.isFinite(claimedDuration) && claimedDuration > 0 ? { durationMs: Math.round(claimedDuration) } : {}),
      ...(appointmentId ? { appointmentId } : {}),
    }),
  };
  const res = fetchImpl
    ? await fetchImpl("/api/gemini/transcribe", init)
    : await apiFetchResponse("/api/gemini/transcribe", init);
  const raw = await res.text();
  let data: { success?: boolean; transcription?: string; error?: string; code?: string } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    data = { error: raw.slice(0, 180) || "Transcription failed." };
  }
  const transcription = data.transcription?.trim() || "";
  if (res.ok && (acceptEmpty || (data.success && transcription))) return transcription;
  if (res.status === 413) {
    throw new Error("The recording is too long to transcribe. Record a shorter consult, or type it.");
  }
  if (res.status === 415) {
    throw new Error("This recording format cannot be transcribed. Type the consult.");
  }
  if (res.status === 429) {
    throw new Error("Too many transcription requests. Wait a moment, then try again.");
  }
  if (data.code === "AI_TRANSCRIPTION_NOT_CONFIGURED") {
    throw new Error("Server transcription is not configured. Type the consult.");
  }
  if (data.code === "AI_TRANSCRIPTION_UNAVAILABLE" || data.code === "transcribe_unavailable" || res.status === 503) {
    throw new Error("Transcription is temporarily unavailable. Tap Retry.");
  }
  if (res.status === 404) {
    throw new Error("Server transcription is unavailable. Type the consult.");
  }
  if (res.status === 409 || data.code === "consent_required") {
    throw new Error("Record the patient agreement for this visit, then tap Start listening.");
  }
  if (res.status === 400 && data.code === "appointment_required") {
    throw new Error("This visit needs a recorded patient agreement before transcription.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("Transcription was refused. Sign in again, then retry the microphone.");
  }
  throw new Error("Server transcription failed. Type the consult.");
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

/**
 * One MediaStream for the page. Later consults reuse it while a track is live,
 * so the origin is not prompted again. A screen lock that ends the track
 * clears this, and the next tap calls getUserMedia inside that gesture.
 */
let retainedStream: MediaStream | null = null;
let pendingStream: Promise<MediaStream> | null = null;

export function resetAmbientMicrophoneSession(): void {
  pendingStream = null;
  const current = retainedStream;
  retainedStream = null;
  if (!current) return;
  try {
    current.getTracks().forEach((track) => track.stop());
  } catch {
    /* ignore */
  }
}

function streamIsLive(stream: MediaStream | null): stream is MediaStream {
  if (!stream) return false;
  try {
    return stream.getAudioTracks().some((track) => track.readyState === "live");
  } catch {
    return false;
  }
}

function rememberStream(stream: MediaStream): void {
  retainedStream = stream;
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (retainedStream === stream && !streamIsLive(stream)) retainedStream = null;
    });
  }
}

function acquireMicrophone(
  mediaDevices: { getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> }
): Promise<MediaStream> {
  const live = streamIsLive(retainedStream) ? retainedStream : null;
  if (!live) {
    if (retainedStream && !streamIsLive(retainedStream)) retainedStream = null;
  } else {
    return Promise.resolve(live);
  }
  if (pendingStream) return pendingStream;
  const promise = mediaDevices
    .getUserMedia(MIC_CONSTRAINTS)
    .then((stream) => {
      if (pendingStream === promise) pendingStream = null;
      rememberStream(stream);
      return stream;
    })
    .catch((err) => {
      if (pendingStream === promise) pendingStream = null;
      throw err;
    });
  pendingStream = promise;
  return promise;
}

function startPermissionQuery(
  permissions: AmbientGestureDeps["permissions"]
): Promise<MicrophonePermissionState> {
  try {
    const query = permissions?.query;
    if (!query) return Promise.resolve("unsupported");
    return query
      .call(permissions, { name: "microphone" })
      .then((status) => {
        if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
        return "unsupported" as const;
      })
      .catch(() => "unsupported" as const);
  } catch {
    return Promise.resolve("unsupported");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

  // Query and getUserMedia both start in this turn. Nothing is awaited first,
  // so iOS still treats the tap as the user activation. A live stream is reused
  // and getUserMedia is not called again.
  const permissionPromise = startPermissionQuery(deps.permissions);
  const streamPromise = acquireMicrophone(deps.mediaDevices);
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
  onTranscript?: (payload: { finalChunk: string; interim: string }) => void;
  onLevel: (level: number) => void;
  onError?: (message: string) => void;
  onAudioRecorded?: (blob: Blob) => void;
  /** Fired when the session stops itself (length cap) or the caller stops it. */
  onStopped?: () => void;
  /** Screen lock or backgrounding ended the track. */
  onInterrupted?: (message: string) => void;
  /** Override for tests. Production waits MIC_PROMPT_TIMEOUT_MS. */
  streamTimeoutMs?: number;
}

function releaseStream(streamPromise: Promise<MediaStream>): void {
  streamPromise
    .then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      if (retainedStream === stream) retainedStream = null;
    })
    .catch(() => {});
}

export function attachMicrophoneRecovery(
  stream: MediaStream,
  target: EventTarget & { visibilityState?: string },
  onInterrupted: (message: string) => void
): () => void {
  let fired = false;
  const consider = (event: "track-ended" | "visibilitychange") => {
    if (fired) return;
    const message = describeMicrophoneRecovery({
      event,
      visibilityState: target.visibilityState || "visible",
      trackStates: stream.getAudioTracks().map((track) => track.readyState),
    });
    if (!message) return;
    fired = true;
    onInterrupted(message);
  };
  const onEnded = () => consider("track-ended");
  const onVisibility = () => consider("visibilitychange");
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", onEnded);
  }
  target.addEventListener("visibilitychange", onVisibility);
  return () => {
    for (const track of stream.getAudioTracks()) {
      track.removeEventListener("ended", onEnded);
    }
    target.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * Opens the gesture's MediaStream, drives an AnalyserNode level meter,
 * and records with MediaRecorder for the server transcription route.
 */
export async function startAmbientMic(options: StartAmbientMicOptions): Promise<AmbientMicSession> {
  const gesture = options.gesture ?? beginAmbientMicGesture();
  const timeoutMs = options.streamTimeoutMs ?? MIC_PROMPT_TIMEOUT_MS;
  const timeoutError = () => new AmbientMicError("permission-denied", micPromptTimeoutMessage());
  let permission: MicrophonePermissionState;
  try {
    permission = await withTimeout(gesture.permissionPromise, timeoutMs, timeoutError);
  } catch (err) {
    void gesture.audioContext.close().catch(() => {});
    if (err instanceof AmbientMicError) throw err;
    const mapped = micErrorMessage(err);
    throw new AmbientMicError(mapped.code, mapped.message);
  }
  if (permission === "denied") {
    releaseStream(gesture.streamPromise);
    void gesture.audioContext.close().catch(() => {});
    const mapped = mapAmbientCaptureFailure({ kind: "exception", name: "NotAllowedError" });
    throw new AmbientMicError(mapped.code, mapped.message);
  }

  let stream: MediaStream;
  try {
    stream = await withTimeout(gesture.streamPromise, timeoutMs, timeoutError);
  } catch (err) {
    void gesture.audioContext.close().catch(() => {});
    if (err instanceof AmbientMicError) throw err;
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
  let intentionalStop = false;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let detachRecovery: () => void = () => {};

  const stop = () => {
    if (intentionalStop) return;
    intentionalStop = true;
    detachRecovery();
    if (capTimer) clearTimeout(capTimer);
    cancelAnimationFrame(raf);

    const finalizeAudio = () => {
      const recordedType = mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunks, { type: recordedType });
      audioChunks.length = 0;
      options.onAudioRecorded?.(audioBlob);
      // Leave a live track open so the next consult does not call getUserMedia again.
      if (!streamIsLive(stream) && retainedStream === stream) retainedStream = null;
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

  if (typeof document !== "undefined") {
    detachRecovery = attachMicrophoneRecovery(stream, document, () => {
      if (intentionalStop) return;
      options.onInterrupted?.(MIC_STOPPED_RESUME);
      stop();
    });
  }

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

  capTimer = setTimeout(() => stop(), MAX_AMBIENT_RECORDING_MS);

  return { stream, stop };
}

/** Stay on Starting… until a live track has produced a non-empty chunk and the first transcribe returned 2xx. */
export const AMBIENT_FIRST_CHUNK_MS = 10_000;
export const AMBIENT_TRANSCRIBE_MS = 10_000;
export const AMBIENT_NO_CHUNK_MESSAGE = "No audio arrived from the microphone. Tap Retry.";
export const AMBIENT_NO_TRANSCRIPT_MESSAGE = "No transcript arrived from the recording. Tap Retry.";

export type AmbientRunPhase = "idle" | "starting" | "listening" | "error" | "stopped";

export interface AmbientRunSnapshot {
  phase: AmbientRunPhase;
  error: string | null;
  transcript: string;
  canRetry: boolean;
}

export interface AmbientTapSlot {
  phase: AmbientRunPhase;
  sessions: number;
}

/**
 * One tap starts exactly one getUserMedia call and one session.
 * A second tap while the phase is starting is ignored, so it cannot start another session or tear the first one down.
 * getUserMedia runs in this call, before the function returns.
 */
export function commitAmbientTap(
  slot: AmbientTapSlot,
  input: {
    force?: "start" | "stop";
    busy?: boolean;
    consentGranted: boolean;
    deps?: AmbientGestureDeps;
  }
): { decision: AmbientMicStartDecision; gesture?: AmbientMicGesture; error?: string } {
  const decision = ambientMicStartDecision({
    force: input.force,
    listening: slot.phase === "listening",
    requesting: slot.phase === "starting",
    busy: Boolean(input.busy),
    consentGranted: input.consentGranted,
  });
  if (decision === "stop") {
    slot.phase = "idle";
    return { decision };
  }
  if (decision !== "start") return { decision };
  try {
    const gesture = beginAmbientMicGesture(input.deps);
    slot.phase = "starting";
    slot.sessions += 1;
    return { decision, gesture };
  } catch (err) {
    slot.phase = "error";
    const mapped = micErrorMessage(err);
    return { decision, error: mapped.message };
  }
}

export interface AmbientCaptureRun {
  stop: () => void;
}

/**
 * Listening is published only after the track is live, a non-empty chunk arrived,
 * and the first transcribe call returned 2xx. An empty transcript counts as success.
 * No chunk within 10s, or no 2xx within 10s of that chunk, stays off Listening.
 */
export function startAmbientCaptureRun(options: {
  gesture: AmbientMicGesture;
  appointmentId?: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onLevel?: (level: number) => void;
  onUpdate: (snap: AmbientRunSnapshot) => void;
  firstChunkMs?: number;
  transcribeMs?: number;
  streamTimeoutMs?: number;
  createRecorder?: (stream: MediaStream, mimeType: string) => MediaRecorder;
  isTypeSupported?: (mime: string) => boolean;
}): AmbientCaptureRun {
  const firstChunkMs = options.firstChunkMs ?? AMBIENT_FIRST_CHUNK_MS;
  const transcribeMs = options.transcribeMs ?? AMBIENT_TRANSCRIBE_MS;
  const streamTimeoutMs = options.streamTimeoutMs ?? MIC_PROMPT_TIMEOUT_MS;
  let phase: AmbientRunPhase = "starting";
  let error: string | null = null;
  let transcript = "";
  let finished = false;
  let sawChunk = false;
  let recorder: MediaRecorder | null = null;
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;
  let transcribeTimer: ReturnType<typeof setTimeout> | null = null;
  let detachRecovery: () => void = () => {};

  const publish = () => {
    options.onUpdate({
      phase,
      error,
      transcript,
      canRetry: phase === "error" || phase === "stopped",
    });
  };

  const clearTimers = () => {
    if (chunkTimer) clearTimeout(chunkTimer);
    if (transcribeTimer) clearTimeout(transcribeTimer);
    chunkTimer = null;
    transcribeTimer = null;
  };

  const fail = (message: string) => {
    if (finished) return;
    finished = true;
    clearTimers();
    detachRecovery();
    phase = "error";
    error = message;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    void options.gesture.audioContext.close().catch(() => {});
    options.onLevel?.(0);
    publish();
  };

  const stop = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    detachRecovery();
    phase = "idle";
    error = null;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    void options.gesture.audioContext.close().catch(() => {});
    options.onLevel?.(0);
    publish();
  };

  publish();

  chunkTimer = setTimeout(() => {
    if (!sawChunk) fail(AMBIENT_NO_CHUNK_MESSAGE);
  }, firstChunkMs);

  const uploadFirst = (blob: Blob) => {
    const timeoutError = () => new Error(AMBIENT_NO_TRANSCRIPT_MESSAGE);
    void withTimeout(
      transcribeRecordedAudio(blob, options.fetchImpl, firstChunkMs, options.appointmentId, true),
      transcribeMs,
      timeoutError
    )
      .then((text) => {
        if (finished) return;
        if (transcribeTimer) clearTimeout(transcribeTimer);
        transcribeTimer = null;
        transcript = text;
        phase = "listening";
        error = null;
        publish();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Server transcription failed. Type the consult.";
        fail(message);
      });
  };

  void (async () => {
    let stream: MediaStream;
    try {
      stream = await withTimeout(
        options.gesture.streamPromise,
        streamTimeoutMs,
        () => new AmbientMicError("permission-denied", micPromptTimeoutMessage())
      );
    } catch (err) {
      const mapped = micErrorMessage(err);
      fail(mapped.message);
      return;
    }
    if (finished) return;
    const live = stream.getAudioTracks().some((track) => track.readyState === "live");
    if (!live) {
      fail(MIC_STOPPED_RESUME);
      return;
    }

    if (typeof document !== "undefined") {
      detachRecovery = attachMicrophoneRecovery(stream, document, () => {
        if (finished) return;
        finished = true;
        clearTimers();
        phase = "stopped";
        error = MIC_STOPPED_RESUME;
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          /* ignore */
        }
        options.onLevel?.(0);
        publish();
      });
    } else {
      const onEnded = () => {
        if (finished) return;
        const stillLive = stream.getAudioTracks().some((track) => track.readyState === "live");
        if (stillLive) return;
        finished = true;
        clearTimers();
        phase = "stopped";
        error = MIC_STOPPED_RESUME;
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          /* ignore */
        }
        options.onLevel?.(0);
        publish();
      };
      for (const track of stream.getAudioTracks()) track.addEventListener("ended", onEnded);
      detachRecovery = () => {
        for (const track of stream.getAudioTracks()) track.removeEventListener("ended", onEnded);
      };
    }

    try {
      options.gesture.audioContext.createMediaStreamSource(stream);
    } catch {
      /* The level meter is optional. Capture still proceeds. */
    }

    const mimeType = selectRecorderMimeType((mime) => {
      if (options.isTypeSupported) return options.isTypeSupported(mime);
      if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
        return MediaRecorder.isTypeSupported(mime);
      }
      return false;
    });

    try {
      recorder = options.createRecorder
        ? options.createRecorder(stream, mimeType)
        : mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
    } catch {
      fail("The microphone could not be started. Tap Retry.");
      return;
    }

    const parts: Blob[] = [];
    let uploadStarted = false;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (finished || !event.data || event.data.size <= 0) return;
      const trackLive = stream.getAudioTracks().some((track) => track.readyState === "live");
      if (!trackLive) return;
      if (!sawChunk) {
        sawChunk = true;
        if (chunkTimer) clearTimeout(chunkTimer);
        chunkTimer = null;
        transcribeTimer = setTimeout(() => {
          if (phase !== "listening") fail(AMBIENT_NO_TRANSCRIPT_MESSAGE);
        }, transcribeMs);
      }
      if (uploadStarted || phase === "listening") return;
      parts.push(event.data);
      const total = parts.reduce((sum, part) => sum + part.size, 0);
      if (total < 100) return;
      uploadStarted = true;
      const blob = new Blob(parts, { type: transcriptionMimeType(mimeType || event.data.type) });
      parts.length = 0;
      uploadFirst(blob);
    };
    try {
      recorder.start(1000);
    } catch {
      fail("The microphone could not be started. Tap Retry.");
    }
  })();

  return { stop };
}
