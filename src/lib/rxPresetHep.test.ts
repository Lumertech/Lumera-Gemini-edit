import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RX_PRESETS } from "../data/clinicalData.ts";
import { clonePresetExercises, presetHepToastMessage } from "./rxPresetHep.ts";

describe("HEP quick preset overwrite", () => {
  it("clones frozen-shoulder exercises with new ids so the HEP table remounts", () => {
    const frozen = RX_PRESETS.find((p) => p.id === "preset-physio-frozen-shoulder");
    assert.ok(frozen?.prescribedExercises?.length === 3);
    const cloned = clonePresetExercises(frozen.prescribedExercises, 1_700_000_000_000);
    assert.equal(cloned.length, 3);
    assert.deepEqual(
      cloned.map((e) => e.id),
      ["hep-1700000000000-0", "hep-1700000000000-1", "hep-1700000000000-2"]
    );
    assert.notEqual(cloned[0].id, frozen.prescribedExercises[0].id);
    assert.equal(cloned[0].exerciseName, frozen.prescribedExercises[0].exerciseName);
    assert.equal(cloned[0].sets, frozen.prescribedExercises[0].sets);
    assert.equal(cloned[1].reps, frozen.prescribedExercises[1].reps);
    assert.equal(cloned[2].holdSeconds, frozen.prescribedExercises[2].holdSeconds);
  });

  it("overwrites a prior HEP array rather than appending", () => {
    const lumbar = RX_PRESETS.find((p) => p.id === "preset-physio-lumbar-radiculopathy");
    const prior = clonePresetExercises(
      RX_PRESETS.find((p) => p.id === "preset-physio-frozen-shoulder")?.prescribedExercises,
      1
    );
    const next = clonePresetExercises(lumbar?.prescribedExercises, 2);
    assert.ok(prior.length > 0);
    assert.ok(next.length > 0);
    assert.notDeepEqual(
      next.map((e) => e.exerciseName),
      prior.map((e) => e.exerciseName)
    );
  });

  it("formats the confirmation toast", () => {
    assert.equal(presetHepToastMessage(3), "Preset Applied: 3 Exercises Added to HEP");
    assert.equal(presetHepToastMessage(1), "Preset Applied: 1 Exercise Added to HEP");
  });
});
