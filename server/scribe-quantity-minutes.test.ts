import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  scribeQuantityMinutes,
  transcriptScribeMinutes,
} from "./usage-billing.ts";

describe("scribeQuantityMinutes duration bound", () => {
  it("wildly understated client durationMinutes does not reduce billed quantity", () => {
    const transcript = Array.from({ length: 650 }, (_, i) => `word${i}`).join(" ");
    const estimated = transcriptScribeMinutes(transcript);
    assert.equal(estimated, 5);
    assert.equal(scribeQuantityMinutes({ transcript }), estimated);
    assert.equal(scribeQuantityMinutes({ transcript, durationMinutes: 5.2 }), 5.2);
    assert.equal(scribeQuantityMinutes({ transcript, durationMinutes: 0.1 }), estimated);
    assert.equal(scribeQuantityMinutes({ transcript, durationMinutes: 1 }), estimated);
    assert.ok(scribeQuantityMinutes({ transcript, durationMinutes: 0.1 }) > 0.1);
  });
});
