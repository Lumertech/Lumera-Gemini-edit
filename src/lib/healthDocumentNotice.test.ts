import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clinicNameForNotice,
  healthDocumentNoticeBody,
  HEALTH_DOCUMENT_NOTICE_EN_TITLE,
  patientIsMinor,
} from "./healthDocumentNotice.ts";

const ENGLISH =
  "Sunrise Clinic will store the medical reports you share (photos or PDFs) in your patient record so your doctor and clinic staff can use them for your care. They are stored securely by Lumera, the software the clinic uses, and are visible only to authorised staff at this clinic. We keep them as long as medical record rules require, then delete them. You can withdraw consent at any time by telling the clinic; new reports will then not be stored. For questions or complaints, contact the clinic. For how Lumera handles data, see https://www.mylumera.in/privacy-policy or write to ravee@lumer.me.";

describe("health document notice v1", () => {
  it("uses the Compliance English paragraph with the tenant clinic name", () => {
    assert.equal(HEALTH_DOCUMENT_NOTICE_EN_TITLE, "Storing your medical reports");
    assert.equal(healthDocumentNoticeBody("en", "Sunrise Clinic"), ENGLISH);
    assert.equal(healthDocumentNoticeBody("en", "  ").startsWith("This clinic will store"), true);
    assert.equal(clinicNameForNotice(""), "This clinic");
    assert.equal(healthDocumentNoticeBody("en", "Sunrise Clinic").startsWith("Lumera will store"), false);
  });

  it("offers the same notice in Hindi, still naming the clinic and not Lumera as the clinic", () => {
    const hindi = healthDocumentNoticeBody("hi", "Sunrise Clinic");
    assert.equal(hindi.startsWith("Sunrise Clinic "), true);
    assert.match(hindi, /https:\/\/www\.mylumera\.in\/privacy-policy/);
    assert.match(hindi, /ravee@lumer\.me/);
    assert.equal(hindi.includes("Lumera आपके द्वारा"), false);
  });

  it("treats a date of birth under 18, or a recorded age under 18, as a minor", () => {
    assert.equal(patientIsMinor({ dateOfBirth: "2015-01-02", age: 40 }, new Date("2026-10-15T00:00:00Z")), true);
    assert.equal(patientIsMinor({ dateOfBirth: "1990-01-02", age: 10 }, new Date("2026-10-15T00:00:00Z")), false);
    assert.equal(patientIsMinor({ age: 12 }, new Date("2026-10-15T00:00:00Z")), true);
    assert.equal(patientIsMinor({ age: 30 }, new Date("2026-10-15T00:00:00Z")), false);
  });
});
