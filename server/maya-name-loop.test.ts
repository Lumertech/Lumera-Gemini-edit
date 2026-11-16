import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planVoiceBooking, type VoiceBookingPlan } from "./voice-booking-confirm.ts";
import { speechConflictsWithLockedLanguage } from "./voice-language-lock.ts";

const now = new Date("2026-11-16T06:00:00.000Z");

function turn(
  message: string,
  prev: VoiceBookingPlan | null,
  language: "en" | "hi" | "mr" = "en"
): VoiceBookingPlan {
  const history = prev?.speechText ? [{ role: "maya", text: prev.speechText }] : [];
  return planVoiceBooking({
    message,
    draft: prev?.draft ?? null,
    patientName: "",
    phone: "+919876543210",
    doctorName: "",
    clinicName: "North Clinic",
    clinicPhone: "+91 98000 33333",
    proposed: null,
    language,
    now,
    history,
  });
}

describe("Maya name collection", () => {
  it("keeps English, Hindi, and Marathi names, including a one-word answer", () => {
    const english = turn("I need an appointment", null);
    assert.match(english.speechText, /patient's name/i);
    const ravi = turn("Ravi", english);
    assert.equal(ravi.draft?.patientName, "Ravi");
    assert.match(ravi.speechText, /Thank you, Ravi/);
    assert.doesNotMatch(ravi.speechText, /patient's name/i);

    const hindiAsk = turn("अपॉइंटमेंट चाहिए", null, "hi");
    const hindi = turn("रवि", hindiAsk, "hi");
    assert.equal(hindi.draft?.patientName, "रवि");
    assert.doesNotMatch(hindi.speechText, /मरीज का नाम/);
    assert.equal(speechConflictsWithLockedLanguage(hindi.speechText, "hi"), false);

    const marathiAsk = turn("अपॉइंटमेंट हवी", null, "mr");
    const marathi = turn("प्रिया", marathiAsk, "mr");
    assert.equal(marathi.draft?.patientName, "प्रिया");
    assert.doesNotMatch(marathi.speechText, /रुग्णाचे नाव/);
    assert.equal(speechConflictsWithLockedLanguage(marathi.speechText, "mr"), false);

    assert.equal(turn("Om", english).draft?.patientName, "Om");
    assert.equal(turn("Priya Sharma", english).draft?.patientName, "Priya Sharma");
  });

  it("hears a name after haan, ji, a filler, or a noisy transcript", () => {
    const asked = turn("I need an appointment", null);
    for (const [message, name] of [
      ["haan Priya", "Priya"],
      ["ji Ravi Sharma", "Ravi Sharma"],
      ["yes, Priya", "Priya"],
      ["uh Priya", "Priya"],
      ["um, Ravi Kumar", "Ravi Kumar"],
      ["[noise] Priya", "Priya"],
      ["my name Priya", "Priya"],
      ["my name is Priya Sharma", "Priya Sharma"],
      ["naam Priya hai", "Priya"],
      ["P R I Y A", "Priya"],
    ] as const) {
      const heard = turn(message, asked);
      assert.equal(heard.draft?.patientName, name, message);
      assert.doesNotMatch(heard.speechText, /patient's name/i, message);
    }

    const hindiAsk = turn("अपॉइंटमेंट चाहिए", null, "hi");
    assert.equal(turn("हां प्रिया", hindiAsk, "hi").draft?.patientName, "प्रिया");
    assert.equal(turn("जी प्रिया शर्मा", hindiAsk, "hi").draft?.patientName, "प्रिया शर्मा");
    assert.equal(turn("hmm प्रिया", hindiAsk, "hi").draft?.patientName, "प्रिया");

    const marathiAsk = turn("अपॉइंटमेंट हवी", null, "mr");
    assert.equal(turn("होय प्रिया", marathiAsk, "mr").draft?.patientName, "प्रिया");
    assert.equal(turn("माझे नाव प्रिया आहे", marathiAsk, "mr").draft?.patientName, "प्रिया");
    assert.equal(turn("माझं नाव प्रिया आहे", marathiAsk, "mr").draft?.patientName, "प्रिया");
    assert.equal(turn("mazhe naav Priya aahe", marathiAsk, "mr").draft?.patientName, "Priya");
  });

  it("does not treat a Devanagari name as a date or clip it down to one syllable", () => {
    const asked = turn("अपॉइंटमेंट चाहिए", null, "hi");
    for (const name of ["आजाद", "कल्याण", "संजीव", "हैदर", "जीवन"]) {
      const heard = turn(name, asked, "hi");
      assert.equal(heard.draft?.patientName, name);
      assert.equal(heard.draft?.date, "");
      assert.doesNotMatch(heard.speechText, /मरीज का नाम/);
    }
  });

  it("does not store a cut-off introduction, then confirms it instead of asking a third time", () => {
    const asked = turn("I need an appointment", null);
    const cutOff = turn("my name is", asked);
    assert.equal(cutOff.draft?.patientName, "");
    assert.match(cutOff.speechText, /patient's name/i);

    const hindiAsk = turn("अपॉइंटमेंट चाहिए", null, "hi");
    assert.equal(turn("मेरा नाम", hindiAsk, "hi").draft?.patientName, "");

    const partial = turn("Pri-", cutOff);
    assert.equal(partial.draft?.patientName, "");
    assert.equal(partial.draft?.pendingName, "Pri");
    assert.match(partial.speechText, /I heard Pri/);
    assert.doesNotMatch(partial.speechText, /patient's name/i);
    const confirmed = turn("yes", partial);
    assert.equal(confirmed.draft?.patientName, "Pri");
    assert.match(confirmed.speechText, /Thank you, Pri/);
  });

  it("asks for the same slot at most twice, then offers spelling, later, or a callback", () => {
    let plan = turn("I need an appointment", null);
    plan = turn("uh", plan);
    assert.match(plan.speechText, /patient's name/i);
    assert.equal(plan.draft?.slotAsks?.patientName, 2);
    plan = turn("hmm", plan);
    assert.equal(plan.callback, false);
    assert.match(plan.speechText, /spell it/i);
    assert.doesNotMatch(plan.speechText, /patient's name/i);
    plan = turn("later", plan);
    assert.equal(plan.callback, true);
    assert.match(plan.speechText, /98000 33333/);
    assert.doesNotMatch(plan.speechText, /patient's name/i);

    let when = turn("Ravi", turn("I need an appointment", null));
    assert.match(when.speechText, /What date and time should I book/);
    when = turn("uh", when);
    assert.match(when.speechText, /What date and time should I book/);
    when = turn("hmm", when);
    assert.doesNotMatch(when.speechText, /What date and time should I book/);
    assert.match(when.speechText, /day and time/i);
    when = turn("uh", when);
    assert.equal(when.callback, true);
  });

  it("keeps a captured name when the caller switches language", () => {
    const asked = turn("I need an appointment", null);
    const named = turn("My name is Ravi Kumar", asked);
    assert.equal(named.draft?.patientName, "Ravi Kumar");
    const switched = planVoiceBooking({
      message: "मला उद्या डॉक्टरकडे दाखवायचे आहे",
      draft: named.draft,
      patientName: "",
      phone: "+919876543210",
      doctorName: "",
      clinicName: "North Clinic",
      clinicPhone: "+91 98000 33333",
      proposed: null,
      language: "mr",
      now,
      history: [
        { role: "maya", text: asked.speechText },
        { role: "caller", text: "My name is Ravi Kumar" },
        { role: "maya", text: named.speechText },
      ],
    });
    assert.equal(switched.draft?.patientName, "Ravi Kumar");
    assert.doesNotMatch(switched.speechText, /patient's name|मरीज का नाम|रुग्णाचे नाव/);
    assert.equal(speechConflictsWithLockedLanguage(switched.speechText, "mr"), false);
  });
});
