import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AMBIENT_FIRST_CHUNK_MS,
  AMBIENT_NO_CHUNK_MESSAGE,
  AMBIENT_NO_TRANSCRIPT_MESSAGE,
  AMBIENT_TRANSCRIBE_MS,
  AmbientMicError,
  attachMicrophoneRecovery,
  beginAmbientMicGesture,
  commitAmbientTap,
  describeMicrophoneRecovery,
  mapAmbientCaptureFailure,
  MAX_AMBIENT_RECORDING_MS,
  MIC_PROMPT_TIMEOUT_MS,
  MIC_STOPPED_RESUME,
  micErrorMessage,
  microphoneStatusLabel,
  queryMicrophonePermission,
  RECORDER_MIME_CANDIDATES,
  resetAmbientMicrophoneSession,
  shouldUploadAmbientRecording,
  selectRecorderMimeType,
  startAmbientCaptureRun,
  startAmbientMic,
  transcriptBadge,
  transcribeRecordedAudio,
  transcriptionMimeType,
  type AmbientGestureDeps,
  type AmbientRunPhase,
  type AmbientRunSnapshot,
  type AmbientTapSlot,
} from "./ambientMic.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

beforeEach(() => {
  resetAmbientMicrophoneSession();
});

describe("ambient mic permission errors", () => {
  it("maps NotAllowedError to a clinician-facing permission denial", () => {
    const err = { name: "NotAllowedError", message: "Permission denied" };
    const mapped = micErrorMessage(err);
    assert.equal(mapped.code, "permission-denied");
    assert.match(mapped.message, /microphone access was blocked/i);
  });

  it("maps NotFoundError when no mic is attached", () => {
    const mapped = micErrorMessage({ name: "NotFoundError", message: "Requested device not found" });
    assert.equal(mapped.code, "no-microphone");
    assert.match(mapped.message, /no microphone/i);
  });

  it("preserves AmbientMicError codes", () => {
    const err = new AmbientMicError("insecure-context", "Microphone requires HTTPS (or localhost).");
    const mapped = micErrorMessage(err);
    assert.equal(mapped.code, "insecure-context");
    assert.match(mapped.message, /https/i);
  });
});

describe("ambient scribe honesty labels", () => {
  it("labels canned dialogue Sample/Demo and never Live", () => {
    const idle = microphoneStatusLabel({ requesting: false, recording: false, transcriptOrigin: "sample" });
    const recording = microphoneStatusLabel({ requesting: false, recording: true, transcriptOrigin: "sample" });
    assert.equal(idle, "Sample/Demo");
    assert.equal(recording, "Sample/Demo");
    assert.equal(transcriptBadge("sample"), "Sample/Demo");
    assert.doesNotMatch(idle, /live/i);
    assert.doesNotMatch(recording, /live/i);
    assert.doesNotMatch(transcriptBadge("sample"), /live/i);
  });

  it("reserves Live for a real microphone transcript", () => {
    assert.equal(
      microphoneStatusLabel({ requesting: false, recording: true, transcriptOrigin: "live" }),
      "Live microphone"
    );
    assert.equal(transcriptBadge("live"), "Live transcript");
    assert.match(
      microphoneStatusLabel({ requesting: true, recording: false, transcriptOrigin: "empty" }),
      /microphone permission/i
    );
  });
});

describe("mapAmbientCaptureFailure", () => {
  const steps = /lock icon[\s\S]*Microphone[\s\S]*Allow[\s\S]*Safari[\s\S]*Microphone[\s\S]*Open in Chrome or Open in Safari/i;

  it("maps NotAllowedError and PermissionDeniedError to the blocked-mic steps", () => {
    for (const name of ["NotAllowedError", "PermissionDeniedError"]) {
      const mapped = mapAmbientCaptureFailure({ kind: "exception", name });
      assert.equal(mapped.code, "permission-denied");
      assert.match(mapped.message, /microphone access was blocked/i);
      assert.match(mapped.message, steps);
    }
  });

  it("maps NotFoundError to a missing microphone", () => {
    const mapped = mapAmbientCaptureFailure({ kind: "exception", name: "NotFoundError" });
    assert.equal(mapped.code, "no-microphone");
    assert.match(mapped.message, /no microphone was found/i);
    assert.match(mapped.message, steps);
  });

  it("maps NotReadableError and TrackStartError to a mic that will not start", () => {
    for (const name of ["NotReadableError", "TrackStartError"]) {
      const mapped = mapAmbientCaptureFailure({ kind: "exception", name });
      assert.equal(mapped.code, "mic-busy");
      assert.match(mapped.message, /could not be started/i);
      assert.match(mapped.message, steps);
    }
  });

  it("maps SecurityError and an insecure context to a secure-page message", () => {
    const security = mapAmbientCaptureFailure({ kind: "exception", name: "SecurityError" });
    const insecure = mapAmbientCaptureFailure({ kind: "insecure-context" });
    assert.equal(security.code, "insecure-context");
    assert.equal(insecure.code, "insecure-context");
    assert.match(security.message, /SecurityError/);
    assert.match(insecure.message, /https or localhost/i);
    assert.match(security.message, steps);
    assert.match(insecure.message, steps);
  });

});

describe("MediaRecorder is the capture path", () => {
  it("always uploads the recording and does not reference the browser speech engine", () => {
    assert.equal(shouldUploadAmbientRecording(), true);
    const needles = ["Speech" + "Recognition", "webkit" + "Speech" + "Recognition", "__LUMERA_" + "AMBIENT_" + "WEB_" + "SPEECH__"];
    const allowlist = new Set<string>([]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(root, "src"));
    assert.ok(files.length > 6);
    for (const full of files) {
      const rel = path.relative(root, full);
      if (allowlist.has(rel)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const needle of needles) {
        assert.equal(text.includes(needle), false, `${rel} contains ${needle}`);
      }
    }
    assert.deepEqual([...RECORDER_MIME_CANDIDATES], ["audio/webm;codecs=opus", "audio/mp4"]);
    assert.equal(
      selectRecorderMimeType((mime) => mime === "audio/webm;codecs=opus" || mime === "audio/mp4"),
      "audio/webm;codecs=opus"
    );
    assert.equal(selectRecorderMimeType((mime) => mime === "audio/mp4"), "audio/mp4");
    assert.equal(selectRecorderMimeType(() => false), "");
    assert.equal(transcriptionMimeType("audio/webm;codecs=opus"), "audio/webm");
    assert.equal(transcriptionMimeType("audio/mp4"), "audio/mp4");
    assert.equal(MAX_AMBIENT_RECORDING_MS, 90_000);
  });
});

describe("microphone permission query", () => {
  it("returns denied without throwing, and unsupported when the query throws", async () => {
    assert.equal(
      await queryMicrophonePermission({ query: async () => ({ state: "denied" }) }),
      "denied"
    );
    assert.equal(
      await queryMicrophonePermission({
        query: async () => {
          throw new TypeError("microphone is not a valid permission");
        },
      }),
      "unsupported"
    );
    assert.equal(await queryMicrophonePermission(undefined), "unsupported");
    assert.equal(await queryMicrophonePermission(null), "unsupported");
  });

  it("calls getUserMedia in the tap, before the permission query resolves", () => {
    const order: string[] = [];
    let resolvePerm: (status: { state: string }) => void = () => {};
    const permission = new Promise<{ state: string }>((resolve) => {
      resolvePerm = resolve;
    });
    beginAmbientMicGesture({
      isSecureContext: true,
      permissions: {
        query: () => {
          order.push("query");
          return permission;
        },
      },
      mediaDevices: {
        getUserMedia: () => {
          order.push("getUserMedia");
          return new Promise(() => {});
        },
      },
      createAudioContext: () => ({
        state: "suspended",
        resume: () => {
          order.push("resume");
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
        createMediaStreamSource: () => {
          throw new Error("not used");
        },
        createAnalyser: () => {
          throw new Error("not used");
        },
      }),
    });
    assert.deepEqual(order, ["query", "getUserMedia", "resume"]);
    resolvePerm({ state: "prompt" });
  });
});

function suspendedAudio() {
  return {
    state: "suspended",
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createMediaStreamSource: () => {
      throw new Error("not used");
    },
    createAnalyser: () => {
      throw new Error("not used");
    },
  };
}

describe("one microphone stream for the page", () => {
  it("does not call getUserMedia again while the first prompt is still open", () => {
    let calls = 0;
    const deps = {
      isSecureContext: true,
      permissions: { query: async () => ({ state: "prompt" }) },
      mediaDevices: {
        getUserMedia: () => {
          calls += 1;
          return new Promise<MediaStream>(() => {});
        },
      },
      createAudioContext: suspendedAudio,
    };
    beginAmbientMicGesture(deps);
    beginAmbientMicGesture(deps);
    assert.equal(calls, 1);
  });

  it("reuses a live stream across consults and skips a second prompt", async () => {
    let calls = 0;
    const track = new EventTarget() as MediaStreamTrack;
    Object.defineProperty(track, "readyState", { value: "live", writable: true });
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    const deps = {
      isSecureContext: true,
      permissions: { query: async () => ({ state: "granted" }) },
      mediaDevices: {
        getUserMedia: async () => {
          calls += 1;
          return stream;
        },
      },
      createAudioContext: suspendedAudio,
    };
    const first = beginAmbientMicGesture(deps);
    assert.equal(await first.streamPromise, stream);
    const second = beginAmbientMicGesture(deps);
    assert.equal(calls, 1);
    assert.equal(await second.streamPromise, stream);
  });

  it("calls getUserMedia again after the retained track has ended", async () => {
    let calls = 0;
    const ended = new EventTarget() as MediaStreamTrack;
    Object.defineProperty(ended, "readyState", { value: "ended" });
    const live = new EventTarget() as MediaStreamTrack;
    Object.defineProperty(live, "readyState", { value: "live" });
    const firstStream = {
      getAudioTracks: () => [ended],
      getTracks: () => [ended],
    } as unknown as MediaStream;
    const secondStream = {
      getAudioTracks: () => [live],
      getTracks: () => [live],
    } as unknown as MediaStream;
    const deps = {
      isSecureContext: true,
      permissions: { query: async () => ({ state: "granted" }) },
      mediaDevices: {
        getUserMedia: async () => {
          calls += 1;
          return calls === 1 ? firstStream : secondStream;
        },
      },
      createAudioContext: suspendedAudio,
    };
    await beginAmbientMicGesture(deps).streamPromise;
    await beginAmbientMicGesture(deps).streamPromise;
    assert.equal(calls, 2);
  });
});

describe("screen lock and background recovery", () => {
  it("stays quiet while the track is live and asks for a tap once it has ended", () => {
    assert.equal(
      describeMicrophoneRecovery({ event: "visibilitychange", visibilityState: "hidden", trackStates: ["live"] }),
      null
    );
    assert.equal(
      describeMicrophoneRecovery({ event: "visibilitychange", visibilityState: "visible", trackStates: ["ended"] }),
      MIC_STOPPED_RESUME
    );
    assert.equal(
      describeMicrophoneRecovery({ event: "track-ended", visibilityState: "hidden", trackStates: ["ended"] }),
      MIC_STOPPED_RESUME
    );
    assert.match(MIC_STOPPED_RESUME, /mic stopped/i);
    assert.match(MIC_STOPPED_RESUME, /tap to resume/i);
  });

  it("fires the resume message from track ended and from visibilitychange", () => {
    const track = new EventTarget() as MediaStreamTrack & { readyState: string };
    track.readyState = "live";
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const page = new EventTarget() as EventTarget & { visibilityState: string };
    page.visibilityState = "visible";
    const messages: string[] = [];
    attachMicrophoneRecovery(stream, page, (message) => messages.push(message));

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    assert.deepEqual(messages, []);

    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    assert.deepEqual(messages, [MIC_STOPPED_RESUME]);
  });
});

describe("WebView microphone timeout", () => {
  it("rejects a prompt that never settles instead of hanging", async () => {
    const gesture = beginAmbientMicGesture({
      isSecureContext: true,
      permissions: { query: () => new Promise(() => {}) },
      mediaDevices: { getUserMedia: () => new Promise(() => {}) },
      createAudioContext: suspendedAudio,
    });
    await assert.rejects(
      () =>
        startAmbientMic({
          gesture,
          streamTimeoutMs: 30,
          onTranscript: () => {},
          onLevel: () => {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof AmbientMicError);
        assert.equal(err.code, "permission-denied");
        assert.match(err.message, /timed out/i);
        assert.match(err.message, /Chrome on Android/);
        assert.match(err.message, /Safari/);
        return true;
      }
    );
    assert.equal(MIC_PROMPT_TIMEOUT_MS, 12_000);
  });
});

describe("server transcription fallback", () => {
  it("surfaces a missing transcription service without naming a vendor", async () => {
    const blob = new Blob([new Uint8Array(200)], { type: "audio/webm" });
    const fakeFetch = async () =>
      new Response(JSON.stringify({ code: "transcribe_unavailable", error: "Gemini AI API key not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      () => transcribeRecordedAudio(blob, fakeFetch as typeof fetch),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /not configured/i);
        assert.doesNotMatch(err.message, /gemini/i);
        assert.doesNotMatch(err.message, /API key/i);
        return true;
      }
    );
  });

  it("does not surface a provider error message when transcription fails", async () => {
    const blob = new Blob([new Uint8Array(200)], { type: "audio/webm" });
    const fakeFetch = async () =>
      new Response(JSON.stringify({ code: "transcribe_failed", error: "Gemini secret failure" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      () => transcribeRecordedAudio(blob, fakeFetch as typeof fetch),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /failed/i);
        assert.doesNotMatch(err.message, /gemini|secret/i);
        return true;
      }
    );
  });

  it("asks for the patient agreement when the server has no consent row", async () => {
    const blob = new Blob([new Uint8Array(200)], { type: "audio/webm" });
    let sentAppointment = "";
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentAppointment = String((JSON.parse(String(init?.body)) as { appointmentId?: string }).appointmentId || "");
      return new Response(JSON.stringify({ code: "consent_required", error: "Patient consent required" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    };
    await assert.rejects(
      () => transcribeRecordedAudio(blob, fakeFetch as typeof fetch, 1000, "apt-visit-1"),
      /record the patient agreement/i
    );
    assert.equal(sentAppointment, "apt-visit-1");
  });

  it("rejects a recording that is too short to transcribe", async () => {
    const blob = new Blob([new Uint8Array(20)], { type: "audio/webm" });
    await assert.rejects(() => transcribeRecordedAudio(blob, fetch), /too short/i);
  });

  it("uploads through the cookie client and does not attach a stored session token", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./ambientMic.ts", import.meta.url), "utf8")
    );
    assert.equal(source.includes("lumera_session_token"), false);
    assert.equal(source.includes("Authorization"), false);
    const blob = new Blob([new Uint8Array(180)], { type: "audio/mp4" });
    let mime = "";
    let durationMs = 0;
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { mimeType?: string; durationMs?: number };
      mime = String(body.mimeType);
      durationMs = Number(body.durationMs);
      return new Response(JSON.stringify({ success: true, transcription: "ok" }), { status: 200 });
    };
    await transcribeRecordedAudio(blob, fakeFetch, 4200);
    assert.equal(mime, "audio/mp4");
    assert.equal(durationMs, 4200);
  });

  it("returns the transcription body from the existing /api/gemini/transcribe route", async () => {
    const blob = new Blob([new Uint8Array(180)], { type: "audio/webm" });
    let url = "";
    const fakeFetch = async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response(JSON.stringify({ success: true, transcription: "Doctor: fever for two days." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const text = await transcribeRecordedAudio(blob, fakeFetch as typeof fetch);
    assert.equal(text, "Doctor: fever for two days.");
    assert.equal(url, "/api/gemini/transcribe");
  });

  it("maps AI_TRANSCRIPTION_NOT_CONFIGURED and the other non-2xx codes to fixed text", async () => {
    const blob = new Blob([new Uint8Array(200)], { type: "audio/webm" });
    const cases: Array<{ status: number; code: string; pattern: RegExp }> = [
      { status: 503, code: "AI_TRANSCRIPTION_NOT_CONFIGURED", pattern: /not configured/i },
      { status: 409, code: "consent_required", pattern: /record the patient agreement/i },
      { status: 413, code: "too_large", pattern: /too long/i },
      { status: 415, code: "unsupported", pattern: /format cannot be transcribed/i },
      { status: 429, code: "rate", pattern: /too many transcription/i },
      { status: 401, code: "unauthorized", pattern: /sign in again/i },
      { status: 403, code: "forbidden", pattern: /sign in again/i },
    ];
    for (const item of cases) {
      const fakeFetch = async () =>
        new Response(JSON.stringify({ code: item.code, error: "Gemini secret failure" }), {
          status: item.status,
          headers: { "Content-Type": "application/json" },
        });
      await assert.rejects(
        () => transcribeRecordedAudio(blob, fakeFetch as typeof fetch),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, item.pattern);
          assert.doesNotMatch(err.message, /gemini|secret/i);
          return true;
        }
      );
    }
  });
});

function liveTrackStream() {
  const track = new EventTarget() as MediaStreamTrack & { readyState: string; stop: () => void };
  track.readyState = "live";
  track.stop = () => {
    track.readyState = "ended";
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}

class FakeRecorder {
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    readonly mimeType: string
  ) {}
  start(_timeslice?: number) {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  emit(data: Blob) {
    this.ondataavailable?.({ data });
  }
}

function tapDeps(stream: MediaStream, onCall: () => void): AmbientGestureDeps {
  return {
    isSecureContext: true,
    permissions: { query: () => new Promise(() => {}) },
    mediaDevices: {
      getUserMedia: () => {
        onCall();
        return Promise.resolve(stream);
      },
    },
    createAudioContext: () => ({
      state: "running",
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
      createMediaStreamSource: () => {
        throw new Error("meter off");
      },
      createAnalyser: () => {
        throw new Error("meter off");
      },
    }),
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function settle() {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
}

describe("one tap capture and no silent listening", () => {
  it("one tap creates one getUserMedia call and one session, and a double tap is ignored", () => {
    const { stream } = liveTrackStream();
    let calls = 0;
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    const deps = tapDeps(stream, () => {
      calls += 1;
    });
    const first = commitAmbientTap(slot, { consentGranted: true, deps });
    const second = commitAmbientTap(slot, { consentGranted: true, deps, force: "start" });
    const third = commitAmbientTap(slot, { consentGranted: true, deps, force: "stop" });
    assert.equal(first.decision, "start");
    assert.equal(second.decision, "ignore");
    assert.equal(third.decision, "ignore");
    assert.equal(calls, 1);
    assert.equal(slot.sessions, 1);
    assert.equal(slot.phase, "starting");
    assert.equal(AMBIENT_FIRST_CHUNK_MS, 10_000);
    assert.equal(AMBIENT_TRANSCRIBE_MS, 10_000);
  });

  it("stays starting until the first chunk, then listens only after a transcript", async () => {
    const { stream } = liveTrackStream();
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    let calls = 0;
    const armed = commitAmbientTap(slot, { consentGranted: true, deps: tapDeps(stream, () => { calls += 1; }) });
    assert.ok(armed.gesture);
    let recorder: FakeRecorder | null = null;
    const phases: AmbientRunPhase[] = [];
    let snap: AmbientRunSnapshot | null = null;
    let pendingFetch: ((response: Response) => void) | null = null;
    let queuedResponse: Response | null = null;
    const fetchImpl = () =>
      new Promise<Response>((resolve) => {
        if (queuedResponse) resolve(queuedResponse);
        else pendingFetch = resolve;
      });
    const respond = (response: Response) => {
      if (pendingFetch) pendingFetch(response);
      else queuedResponse = response;
    };
    startAmbientCaptureRun({
      gesture: armed.gesture,
      fetchImpl: fetchImpl as typeof fetch,
      onUpdate: (next) => {
        phases.push(next.phase);
        snap = next;
      },
      createRecorder: (media, mime) => {
        recorder = new FakeRecorder(media, mime);
        return recorder as unknown as MediaRecorder;
      },
    });
    await flushMicrotasks();
    assert.equal(snap?.phase, "starting");
    assert.equal(phases.includes("listening"), false);
    assert.ok(recorder);
    (recorder as FakeRecorder).emit(new Blob([new Uint8Array(200)], { type: "audio/webm" }));
    await settle();
    assert.equal(snap?.phase, "starting");
    assert.equal(phases.includes("listening"), false);
    respond(new Response(JSON.stringify({ success: true, transcription: "fever for two days" }), { status: 200 }));
    await settle();
    assert.equal(snap?.phase, "listening");
    assert.equal(snap?.transcript, "fever for two days");
    assert.equal(calls, 1);
  });

  it("ends in an error and never listening when no chunk arrives", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { stream } = liveTrackStream();
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    const armed = commitAmbientTap(slot, { consentGranted: true, deps: tapDeps(stream, () => {}) });
    assert.ok(armed.gesture);
    const phases: AmbientRunPhase[] = [];
    let snap: AmbientRunSnapshot | null = null;
    startAmbientCaptureRun({
      gesture: armed.gesture,
      onUpdate: (next) => {
        phases.push(next.phase);
        snap = next;
      },
      createRecorder: (media, mime) => new FakeRecorder(media, mime) as unknown as MediaRecorder,
    });
    await flushMicrotasks();
    assert.equal(snap?.phase, "starting");
    t.mock.timers.tick(AMBIENT_FIRST_CHUNK_MS);
    await flushMicrotasks();
    assert.equal(snap?.phase, "error");
    assert.equal(snap?.error, AMBIENT_NO_CHUNK_MESSAGE);
    assert.equal(snap?.canRetry, true);
    assert.equal(phases.includes("listening"), false);
    t.mock.timers.reset();
  });

  it("ends in an error and never listening when transcribe returns 503", async () => {
    const { stream } = liveTrackStream();
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    const armed = commitAmbientTap(slot, { consentGranted: true, deps: tapDeps(stream, () => {}) });
    assert.ok(armed.gesture);
    let recorder: FakeRecorder | null = null;
    const phases: AmbientRunPhase[] = [];
    let snap: AmbientRunSnapshot | null = null;
    startAmbientCaptureRun({
      gesture: armed.gesture,
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "AI_TRANSCRIPTION_NOT_CONFIGURED", message: "AI transcription not configured" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      onUpdate: (next) => {
        phases.push(next.phase);
        snap = next;
      },
      createRecorder: (media, mime) => {
        recorder = new FakeRecorder(media, mime);
        return recorder as unknown as MediaRecorder;
      },
    });
    await flushMicrotasks();
    assert.ok(recorder);
    (recorder as FakeRecorder).emit(new Blob([new Uint8Array(220)], { type: "audio/webm" }));
    await settle();
    assert.equal(snap?.phase, "error");
    assert.match(snap?.error || "", /not configured/i);
    assert.equal(snap?.canRetry, true);
    assert.equal(phases.includes("listening"), false);
  });

  it("ends in an error and never listening when the first upload does not return", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { stream } = liveTrackStream();
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    const armed = commitAmbientTap(slot, { consentGranted: true, deps: tapDeps(stream, () => {}) });
    assert.ok(armed.gesture);
    let recorder: FakeRecorder | null = null;
    const phases: AmbientRunPhase[] = [];
    let snap: AmbientRunSnapshot | null = null;
    startAmbientCaptureRun({
      gesture: armed.gesture,
      fetchImpl: () => new Promise<Response>(() => {}),
      onUpdate: (next) => {
        phases.push(next.phase);
        snap = next;
      },
      createRecorder: (media, mime) => {
        recorder = new FakeRecorder(media, mime);
        return recorder as unknown as MediaRecorder;
      },
    });
    await flushMicrotasks();
    (recorder as FakeRecorder).emit(new Blob([new Uint8Array(220)], { type: "audio/webm" }));
    await flushMicrotasks();
    assert.equal(snap?.phase, "starting");
    t.mock.timers.tick(AMBIENT_TRANSCRIBE_MS);
    await flushMicrotasks();
    assert.equal(snap?.phase, "error");
    assert.equal(snap?.error, AMBIENT_NO_TRANSCRIPT_MESSAGE);
    assert.equal(phases.includes("listening"), false);
    t.mock.timers.reset();
  });

  it("shows a stopped state when the track ends", async () => {
    const { track, stream } = liveTrackStream();
    const slot: AmbientTapSlot = { phase: "idle", sessions: 0 };
    const armed = commitAmbientTap(slot, { consentGranted: true, deps: tapDeps(stream, () => {}) });
    assert.ok(armed.gesture);
    let snap: AmbientRunSnapshot | null = null;
    startAmbientCaptureRun({
      gesture: armed.gesture,
      onUpdate: (next) => {
        snap = next;
      },
      createRecorder: (media, mime) => new FakeRecorder(media, mime) as unknown as MediaRecorder,
    });
    await flushMicrotasks();
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    await flushMicrotasks();
    assert.equal(snap?.phase, "stopped");
    assert.equal(snap?.error, MIC_STOPPED_RESUME);
    assert.equal(snap?.canRetry, true);
  });
});
