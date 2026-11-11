import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canEditClinicVoiceSettings, mayaDeskStatus, mayaOpeningGreeting, mayaWhatsAppLine } from "./voiceDesk.ts";

describe("Maya voice desk copy", () => {
  it("uses the clinic name and a saved greeting", () => {
    assert.equal(
      mayaOpeningGreeting("Malhotra Individual Practice"),
      "Hello! Thank you for calling Malhotra Individual Practice. How may I assist your health appointment today?"
    );
    assert.equal(mayaOpeningGreeting("Ignored", "Namaste, this is Maya."), "Namaste, this is Maya.");
    assert.equal(mayaOpeningGreeting("").includes("Lumera Polyclinic"), false);
  });

  it("shows the connected number or says none is connected", () => {
    assert.equal(mayaWhatsAppLine({ connected: false, displayNumber: "+91 98765 43210" }), "No WhatsApp number connected yet");
    assert.match(mayaWhatsAppLine({ connected: true, displayNumber: "+91 98000 12000" }), /\+91 98000 12000/);
  });

  it("reports 1-ring pickup instead of a static IVR standby", () => {
    assert.equal(
      mayaDeskStatus({ loaded: true, inCall: false, callType: "ivrn", voiceEnabled: true, connected: true }),
      "1-ring WhatsApp pickup on — PSTN IVR status is not available"
    );
    assert.equal(
      mayaDeskStatus({ loaded: true, inCall: false, callType: "whatsapp", voiceEnabled: false, connected: true }),
      "1-ring pickup off — messaging only"
    );
    assert.equal(mayaDeskStatus({ loaded: true, inCall: false, callType: "whatsapp", voiceEnabled: true, connected: false }).includes("IVR"), false);
  });

  it("lets clinic managers edit and keeps reception and platform admin read-only", () => {
    assert.equal(canEditClinicVoiceSettings("doctor"), true);
    assert.equal(canEditClinicVoiceSettings("CLINIC_ADMIN"), true);
    assert.equal(canEditClinicVoiceSettings("polyclinic_admin"), true);
    assert.equal(canEditClinicVoiceSettings("receptionist"), false);
    assert.equal(canEditClinicVoiceSettings("super_admin"), false);
  });
});
