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

  it("reports whether Maya answers calls instead of a pickup or IVR standby label", () => {
    assert.equal(
      mayaDeskStatus({ loaded: true, inCall: false, callType: "ivrn", voiceEnabled: true, connected: true }),
      "Maya answers WhatsApp calls — PSTN IVR status is not available"
    );
    assert.equal(
      mayaDeskStatus({ loaded: true, inCall: false, callType: "whatsapp", voiceEnabled: false, connected: true }),
      "Maya is not answering calls — messaging only"
    );
    assert.equal(
      mayaDeskStatus({ loaded: true, inCall: false, callType: "whatsapp", voiceEnabled: true, connected: true }),
      "Maya answers calls"
    );
    const standby = mayaDeskStatus({ loaded: true, inCall: false, callType: "whatsapp", voiceEnabled: true, connected: false });
    assert.equal(standby.includes("IVR"), false);
    assert.equal(standby.toLowerCase().includes("pickup"), false);
  });

  it("lets clinic admins and super admin edit, and keeps doctors read-only", () => {
    assert.equal(canEditClinicVoiceSettings("doctor"), false);
    assert.equal(canEditClinicVoiceSettings("CLINIC_ADMIN"), true);
    assert.equal(canEditClinicVoiceSettings("polyclinic_admin"), true);
    assert.equal(canEditClinicVoiceSettings("super_admin"), true);
    assert.equal(canEditClinicVoiceSettings("receptionist"), false);
  });
});
