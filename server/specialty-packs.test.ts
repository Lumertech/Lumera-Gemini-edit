import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPECIALTY_PACK_IDS,
  SPECIALTY_PACKS,
  assertPacksDifferByMoreThanLabel,
  packFingerprint,
  parseSpecialtyPackInput,
  resolveSpecialtyPack,
  roleHomeForAccount,
} from "./specialty-packs.ts";

describe("specialty packs (Admin UM)", () => {
  it("uses the locked pack ids and fails if packs only differ by label", () => {
    assert.deepEqual([...SPECIALTY_PACK_IDS], ["gp", "physio", "dentist", "spa_salon", "therapist", "consultant"]);
    assertPacksDifferByMoreThanLabel();
    const fingerprints = SPECIALTY_PACK_IDS.map((id) => packFingerprint(SPECIALTY_PACKS[id]));
    assert.equal(new Set(fingerprints).size, fingerprints.length);
    const gp = SPECIALTY_PACKS.gp;
    const spa = SPECIALTY_PACKS.spa_salon;
    assert.ok(gp.modules.includes("soap"));
    assert.ok(gp.modules.includes("major_medical"));
    assert.ok(!spa.modules.includes("soap"));
    assert.notEqual(gp.clinicalMode, spa.clinicalMode);
  });

  it("maps major medical specialties onto gp via config", () => {
    assert.equal(resolveSpecialtyPack("Cardiology")?.id, "gp");
    assert.equal(resolveSpecialtyPack("Pediatrics")?.id, "gp");
    assert.equal(resolveSpecialtyPack("gp")?.id, "gp");
    assert.equal(resolveSpecialtyPack("physio")?.id, "physio");
    assert.equal(resolveSpecialtyPack("Dental Surgery")?.id, "dentist");
    assert.equal(resolveSpecialtyPack("spa_salon")?.id, "spa_salon");
    assert.equal(resolveSpecialtyPack("therapist")?.id, "therapist");
    assert.equal(resolveSpecialtyPack("consultant")?.id, "consultant");
    const parsed = parseSpecialtyPackInput("physio");
    assert.ok(parsed && "packId" in parsed);
    assert.equal(parsed.packId, "physio");
    assert.equal(parseSpecialtyPackInput("not-a-pack") && "error" in (parseSpecialtyPackInput("not-a-pack") || {}), true);
  });

  it("lands each role/pack on a distinct role-home", () => {
    assert.equal(roleHomeForAccount("super_admin").roleHome, "admin");
    assert.equal(roleHomeForAccount("receptionist").homeView, "reception");
    assert.equal(roleHomeForAccount("doctor", "gp").homeView, "queue");
    assert.equal(roleHomeForAccount("doctor", "physio").homeView, "rehab");
    assert.equal(roleHomeForAccount("doctor", "dentist").homeView, "dental");
    assert.equal(roleHomeForAccount("doctor", "spa_salon").homeView, "spa");
    assert.equal(roleHomeForAccount("doctor", "therapist").homeView, "therapy");
    assert.equal(roleHomeForAccount("doctor", "consultant").homeView, "consult");
  });
});
