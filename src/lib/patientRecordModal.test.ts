import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const modal = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../components/PatientRecordModal.tsx"),
  "utf8"
);

describe("PatientRecordModal has no seeded chart fiction", () => {
  it("does not ship placeholder uploads, Unsplash, or hardcoded vitals", () => {
    assert.equal(modal.includes("unsplash"), false);
    assert.equal(modal.includes("120/80"), false);
    assert.equal(modal.includes("78 bpm"), false);
    assert.equal(modal.includes("98.4"), false);
    assert.equal(modal.includes("createObjectURL"), false);
    assert.equal(modal.includes("Complete Blood Count"), false);
    assert.match(modal, /Not recorded/);
  });
});
