import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { planVoiceBooking } from "./voice-booking-confirm.ts";
import {
  MAYA_DOCTOR_TITLE_RULE,
  collapseDoubledDoctorTitles,
  prepareMayaSpokenText,
  stripDoctorTitles,
  withSingleDoctorTitle,
} from "./voice-doctor-name.ts";
import { doctorNicknames, formatTenantVoiceFacts } from "./voice-vocabulary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Maya doctor titles", () => {
  it("strips an existing title once and leaves Doctorate and Drake alone", () => {
    assert.equal(stripDoctorTitles("Dr. Meera Shah"), "Meera Shah");
    assert.equal(stripDoctorTitles("Dr Meera Shah"), "Meera Shah");
    assert.equal(stripDoctorTitles("Doctor Meera Shah"), "Meera Shah");
    assert.equal(stripDoctorTitles("डॉक्टर मीरा शाह"), "मीरा शाह");
    assert.equal(stripDoctorTitles("डॉ. मीरा शाह"), "मीरा शाह");
    assert.equal(stripDoctorTitles("डॉ। मीरा शाह"), "मीरा शाह");
    assert.equal(stripDoctorTitles("Doctor Dr. Meera Shah"), "Meera Shah");
    assert.equal(stripDoctorTitles("Dr. Doctor Meera Shah"), "Meera Shah");
    assert.equal(stripDoctorTitles("डॉक्टर डॉ. मीरा"), "मीरा");
    assert.equal(stripDoctorTitles("Doctorate Smith"), "Doctorate Smith");
    assert.equal(stripDoctorTitles("Drake Shah"), "Drake Shah");
    assert.equal(withSingleDoctorTitle("Doctor Meera Shah", "en"), "Dr. Meera Shah");
    assert.equal(withSingleDoctorTitle("Dr. Meera Shah", "hi"), "डॉक्टर Meera Shah");
    assert.equal(withSingleDoctorTitle("डॉक्टर मीरा", "mr"), "डॉक्टर मीरा");
    assert.equal(withSingleDoctorTitle("Meera Shah", "en"), "Dr. Meera Shah");
    assert.equal(withSingleDoctorTitle("", "en"), "");
  });

  it("collapses doubled titles in English, Hindi, and Marathi before TTS", () => {
    assert.equal(collapseDoubledDoctorTitles("Doctor Doctor Meera is free."), "Doctor Meera is free.");
    assert.equal(collapseDoubledDoctorTitles("Dr. Doctor Meera is free."), "Dr. Meera is free.");
    assert.equal(collapseDoubledDoctorTitles("Doctor Dr. Meera is free."), "Doctor Meera is free.");
    assert.equal(collapseDoubledDoctorTitles("Dr. Dr. Meera is free."), "Dr. Meera is free.");
    assert.equal(collapseDoubledDoctorTitles("डॉक्टर डॉक्टर मीरा उपलब्ध हैं।"), "डॉक्टर मीरा उपलब्ध हैं।");
    assert.equal(collapseDoubledDoctorTitles("डॉ. डॉक्टर मीरा उपलब्ध आहेत."), "डॉ. मीरा उपलब्ध आहेत.");
    assert.equal(collapseDoubledDoctorTitles("डॉक्टर डॉ. मीरा"), "डॉक्टर मीरा");
    assert.equal(collapseDoubledDoctorTitles("See Dr. Meera and Dr. Shah."), "See Dr. Meera and Dr. Shah.");
    assert.equal(collapseDoubledDoctorTitles("Dr. Doctorate Smith is here."), "Dr. Doctorate Smith is here.");
    assert.equal(prepareMayaSpokenText("Namaste, Doctor Doctor Meera will see you."), "Namaste, Doctor Meera will see you.");
    assert.equal(prepareMayaSpokenText("the doctor on duty"), "the doctor on duty");
  });

  it("reads a doctor back once in booking confirmations and schedule facts", () => {
    const proposed = { date: "2026-11-12", timeSlot: "10:30 AM" };
    const base = {
      message: "Please book an appointment tomorrow at 10:30 am",
      draft: null,
      patientName: "Meera Shah",
      phone: "+919999973271",
      clinicName: "North Clinic",
      clinicPhone: "+91 98000 33333",
      proposed,
      now: new Date("2026-11-11T06:00:00.000Z"),
    };
    const english = planVoiceBooking({ ...base, doctorName: "Doctor Dr. Meera Shah", language: "en" });
    assert.match(english.speechText, /Dr\. Meera Shah/);
    assert.doesNotMatch(english.speechText, /Doctor Doctor|Dr\. Doctor|Doctor Dr\./i);

    const hindi = planVoiceBooking({ ...base, doctorName: "Dr. Doctor Meera Shah", language: "hi", patientName: "रवि" });
    assert.match(hindi.speechText, /डॉक्टर Meera Shah/);
    assert.doesNotMatch(hindi.speechText, /डॉक्टर डॉक्टर|डॉक्टर Dr|Doctor Doctor/i);

    const marathi = planVoiceBooking({ ...base, doctorName: "डॉक्टर डॉ. मीरा शाह", language: "mr", patientName: "रवि" });
    assert.match(marathi.speechText, /डॉक्टर मीरा शाह/);
    assert.doesNotMatch(marathi.speechText, /डॉक्टर डॉक्टर|डॉ\. डॉक्टर/);

    const facts = formatTenantVoiceFacts({
      clinicName: "North Clinic",
      doctors: [
        { name: "Doctor Meera Shah", specialty: "General Medicine", timing: "10:00 AM - 01:00 PM", days: "Mon-Fri" },
        { name: "डॉ. रेखा जोशी", specialty: "Dermatology", timing: "02:00 PM - 05:00 PM", days: "Mon-Sat" },
      ],
      schedule: { opdStartTime: "10:00 AM", opdEndTime: "05:00 PM", slotDurationMinutes: 15 },
    });
    assert.match(facts, /Dr\. Meera Shah/);
    assert.match(facts, /Dr\. रेखा जोशी/);
    assert.doesNotMatch(facts, /Dr\. Doctor|Doctor Doctor|Dr\. डॉ/);
    assert.deepEqual(doctorNicknames("Doctor Meera Shah (PT)"), ["Meera", "Shah"]);
    assert.deepEqual(doctorNicknames("डॉक्टर मीरा शाह"), ["मीरा", "शाह"]);
    assert.equal(doctorNicknames("Doctor Meera Shah").includes("Doctor"), false);
  });

  it("puts the stored-title rule in Maya prompts and de-dupes speech before TTS", () => {
    const voice = fs.readFileSync(path.join(root, "server/gemini-voice.ts"), "utf8");
    assert.ok(voice.split("MAYA_DOCTOR_TITLE_RULE").length - 1 >= 3);
    assert.match(voice, /prepareMayaSpokenText\(speechText\)/);
    assert.match(voice, /prepareMayaSpokenText\(raw\)/);
    assert.match(voice, /withSingleDoctorTitle/);
    assert.match(MAYA_DOCTOR_TITLE_RULE, /already include a title/);
    assert.match(MAYA_DOCTOR_TITLE_RULE, /डॉक्टर/);
  });
});
