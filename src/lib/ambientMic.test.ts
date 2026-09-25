import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AmbientMicError,
  beginAmbientMicGesture,
  isFatalSpeechError,
  mapAmbientCaptureFailure,
  MAX_AMBIENT_RECORDING_MS,
  micErrorMessage,
  microphoneStatusLabel,
  queryMicrophonePermission,
  RECORDER_MIME_CANDIDATES,
  selectCapturePath,
  selectRecorderMimeType,
  speechRecognitionFailureMessage,
  SPEECH_UNSUPPORTED_NOTICE,
  transcriptBadge,
  transcribeRecordedAudio,
  transcriptionMimeType,
} from "./ambientMic.ts";

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

  it("maps missing SpeechRecognition to the server-transcription fallback notice", () => {
    const mapped = mapAmbientCaptureFailure({ kind: "speech-recognition-missing" });
    assert.equal(mapped.code, "speech-unsupported");
    assert.match(mapped.message, /no live speech-to-text/i);
    assert.match(mapped.message, /WhatsApp and Instagram/i);
    assert.match(mapped.message, steps);
    assert.equal(SPEECH_UNSUPPORTED_NOTICE, mapped.message);
  });
});

describe("Web Speech missing selects the MediaRecorder fallback", () => {
  it("records instead of doing nothing, preferring opus then mp4", () => {
    assert.equal(selectCapturePath(false), "media-recorder");
    assert.equal(selectCapturePath(true), "web-speech");
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

describe("speech recognition failures stay visible", () => {
  it("maps network and permission failures and ignores no-speech", () => {
    assert.match(speechRecognitionFailureMessage("network") || "", /network service/i);
    assert.match(speechRecognitionFailureMessage("not-allowed") || "", /blocked/i);
    assert.equal(speechRecognitionFailureMessage("no-speech"), null);
    assert.equal(speechRecognitionFailureMessage("aborted"), null);
    assert.equal(isFatalSpeechError("network"), true);
    assert.equal(isFatalSpeechError("no-speech"), false);
    assert.match(SPEECH_UNSUPPORTED_NOTICE, /no live speech-to-text/i);
  });
});

describe("server transcription fallback", () => {
  it("surfaces a missing API key instead of an empty transcript", async () => {
    const blob = new Blob([new Uint8Array(200)], { type: "audio/webm" });
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "Gemini AI API key not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      () => transcribeRecordedAudio(blob, fakeFetch as typeof fetch),
      /not configured|API key/i
    );
  });

  it("rejects a recording that is too short to transcribe", async () => {
    const blob = new Blob([new Uint8Array(20)], { type: "audio/webm" });
    await assert.rejects(() => transcribeRecordedAudio(blob, fetch), /too short/i);
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
});
