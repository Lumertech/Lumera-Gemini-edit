import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPECIALTY_PACK_IDS,
  mapSpecialtyToPackId,
  persistSpecialtyPackId,
} from "./specialtyPack.ts";

describe("specialty pack id SoT", () => {
  it("freezes the six persistable pack ids", () => {
    assert.deepEqual([...SPECIALTY_PACK_IDS], ["gp", "physio", "dentist", "spa_salon", "therapist", "consultant"]);
  });

  it("maps UI labels to pack ids and fails closed on unknown", () => {
    assert.equal(mapSpecialtyToPackId("Dental Surgery"), "dentist");
    assert.equal(mapSpecialtyToPackId("Wellness & Spas"), "spa_salon");
    assert.equal(mapSpecialtyToPackId("Physiotherapy & Rehabilitation"), "physio");
    assert.equal(mapSpecialtyToPackId("General Medicine"), "gp");
    assert.equal(mapSpecialtyToPackId("Psychiatry & Mental Health"), "therapist");
    assert.equal(mapSpecialtyToPackId("Consulting"), "consultant");
    assert.equal(mapSpecialtyToPackId("gp"), "gp");
    assert.equal(mapSpecialtyToPackId("not-a-real-specialty"), null);
    const stored = persistSpecialtyPackId("Dental Surgery");
    assert.equal(stored.ok, true);
    assert.equal(stored.id, "dentist");
    const unknown = persistSpecialtyPackId("Quantum Healing");
    assert.equal(unknown.ok, false);
    const empty = persistSpecialtyPackId("");
    assert.equal(empty.ok, true);
    assert.equal(empty.id, "");
  });
});
