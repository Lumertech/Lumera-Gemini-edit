import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clinicNameForNotice,
  healthDocumentNoticeBody,
  healthDocumentNotices,
  HEALTH_DOCUMENT_NOTICE_EN_TITLE,
  HEALTH_DOCUMENT_NOTICE_HI_TITLE,
  patientIsMinor,
} from "./healthDocumentNotice.ts";

const ENGLISH =
  "Sunrise Clinic will store the medical reports you share (photos or PDFs) in your patient record so your doctor and clinic staff can use them for your care. They are stored securely by Lumera, the software the clinic uses, and are visible only to authorised staff at this clinic. We keep them as long as medical record rules require, then delete them. You can withdraw consent at any time by telling the clinic; new reports will then not be stored. For questions or complaints, contact the clinic. For how Lumera handles data, see https://www.mylumera.in/privacy-policy or write to ravee@lumer.me.";

describe("health document notice v1", () => {
  it("uses the Compliance English paragraph with the tenant clinic name", () => {
    assert.equal(HEALTH_DOCUMENT_NOTICE_EN_TITLE, "Storing your medical reports");
    assert.equal(healthDocumentNoticeBody("en", "Sunrise Clinic"), ENGLISH);
    assert.equal(clinicNameForNotice(""), "");
    assert.equal(clinicNameForNotice("  "), "");
    assert.throws(() => healthDocumentNoticeBody("en", "  "), /clinic name/i);
    assert.equal(healthDocumentNotices("").en.body, "");
    assert.equal(healthDocumentNotices(" ").en.body.includes("This clinic"), false);
    assert.equal(healthDocumentNoticeBody("en", "Sunrise Clinic").startsWith("Lumera will store"), false);
  });

  it("uses the Compliance Hindi title and paragraph, with a Hindi fallback only when the name is blank", () => {
    const hindi = healthDocumentNoticeBody("hi", "Sunrise Clinic");
    assert.equal(HEALTH_DOCUMENT_NOTICE_HI_TITLE, "आपकी मेडिकल रिपोर्ट रखने के बारे में");
    assert.equal(
      hindi,
      "Sunrise Clinic आपकी दी हुई मेडिकल रिपोर्ट (फ़ोटो या PDF) आपके मरीज़ रिकॉर्ड में रखेगा, ताकि आपके डॉक्टर और क्लिनिक का स्टाफ़ आपके इलाज के लिए उनका इस्तेमाल कर सकें। ये रिपोर्ट Lumera में सुरक्षित रूप से सेव की जाती हैं। Lumera वह सॉफ़्टवेयर है जिसे यह क्लिनिक इस्तेमाल करता है। इन्हें सिर्फ़ इस क्लिनिक के वही कर्मचारी देख सकते हैं जिन्हें इसकी अनुमति है। मेडिकल रिकॉर्ड के नियमों के अनुसार जितने समय तक ज़रूरी हो, हम इन्हें रखते हैं, उसके बाद इन्हें मिटा देते हैं। आप कभी भी क्लिनिक को बताकर अपनी सहमति वापस ले सकते हैं; इसके बाद आपकी कोई नई रिपोर्ट सेव नहीं की जाएगी। किसी सवाल या शिकायत के लिए क्लिनिक से संपर्क करें। Lumera आपका डेटा कैसे संभालता है, यह जानने के लिए https://www.mylumera.in/privacy-policy देखें या ravee@lumer.me पर लिखें।"
    );
    assert.equal(healthDocumentNoticeBody("hi", "  ").startsWith("यह क्लिनिक "), true);
    assert.equal(healthDocumentNoticeBody("hi", "").includes("This clinic"), false);
  });

  it("treats a date of birth under 18, or a recorded age under 18, as a minor", () => {
    assert.equal(patientIsMinor({ dateOfBirth: "2015-01-02", age: 40 }, new Date("2026-10-15T00:00:00Z")), true);
    assert.equal(patientIsMinor({ dateOfBirth: "1990-01-02", age: 10 }, new Date("2026-10-15T00:00:00Z")), false);
    assert.equal(patientIsMinor({ age: 12 }, new Date("2026-10-15T00:00:00Z")), true);
    assert.equal(patientIsMinor({ age: 30 }, new Date("2026-10-15T00:00:00Z")), false);
  });
});
