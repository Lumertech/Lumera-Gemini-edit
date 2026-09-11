import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AmbientMicError, micErrorMessage } from "./ambientMic.ts";

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
