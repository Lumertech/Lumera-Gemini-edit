import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalTranscribeMime,
  derivedTranscribeDurationMs,
  MAX_TRANSCRIBE_DURATION_MS,
  resolveTranscribeDurationMs,
  TRANSCRIBE_DURATION_BYTES_PER_SECOND,
  transcribeDurationTooLong,
} from "./transcribe-policy.ts";

describe("ambient transcribe policy", () => {
  it("allowlists the recorder types and rejects anything else", () => {
    assert.equal(canonicalTranscribeMime("audio/webm;codecs=opus"), "audio/webm");
    assert.equal(canonicalTranscribeMime("audio/mp4"), "audio/mp4");
    assert.equal(canonicalTranscribeMime("audio/aac"), "audio/aac");
    assert.equal(canonicalTranscribeMime("audio/mpeg"), "audio/mpeg");
    assert.equal(canonicalTranscribeMime("audio/wav"), "audio/wav");
    assert.equal(canonicalTranscribeMime(""), "audio/webm");
    assert.equal(canonicalTranscribeMime("audio/ogg"), null);
    assert.equal(canonicalTranscribeMime("video/webm"), null);
  });

  it("caps duration at 90 seconds and derives it from size when the client omits it", () => {
    assert.equal(transcribeDurationTooLong(1000, 90_000), false);
    assert.equal(transcribeDurationTooLong(1000, 90_001), true);
    const under = TRANSCRIBE_DURATION_BYTES_PER_SECOND * 90;
    const over = under + TRANSCRIBE_DURATION_BYTES_PER_SECOND;
    assert.equal(derivedTranscribeDurationMs(under) <= MAX_TRANSCRIBE_DURATION_MS, true);
    assert.equal(transcribeDurationTooLong(over, undefined), true);
    assert.equal(resolveTranscribeDurationMs(1000, undefined), derivedTranscribeDurationMs(1000));
    assert.equal(resolveTranscribeDurationMs(over, 1000) > MAX_TRANSCRIBE_DURATION_MS, true);
  });
});
