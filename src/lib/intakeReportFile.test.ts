import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeFileProblem, titleFromReportName } from "./intakeReportFile.ts";

describe("reception intake report files", () => {
  it("accepts pdf and jpeg names and rejects HEIC, text, and an 11 MB file", () => {
    assert.equal(intakeFileProblem({ name: "cbc.pdf", size: 1200, type: "application/pdf" }), "");
    assert.equal(intakeFileProblem({ name: "wound.JPG", size: 800, type: "image/jpeg" }), "");
    assert.equal(intakeFileProblem({ name: "scan.png", size: 800, type: "" }), "");
    assert.equal(intakeFileProblem({ name: "photo.heic", size: 800, type: "image/heic" }), "Use a PDF, JPG, or PNG file.");
    assert.equal(intakeFileProblem({ name: "notes.txt", size: 20, type: "text/plain" }), "Use a PDF, JPG, or PNG file.");
    assert.equal(
      intakeFileProblem({ name: "big.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }),
      "Each file must be 10 MB or smaller."
    );
    assert.equal(intakeFileProblem({ name: "empty.pdf", size: 0, type: "application/pdf" }), "Choose a file to upload.");
  });

  it("uses the file name as the title and does not keep the extension", () => {
    assert.equal(titleFromReportName("cbc_panel.pdf"), "cbc panel");
    assert.equal(titleFromReportName(""), "");
  });
});
