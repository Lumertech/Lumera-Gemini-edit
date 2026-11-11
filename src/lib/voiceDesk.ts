export type MayaCallType = "whatsapp" | "ivrn";

/** Opening line Maya speaks. A saved greeting wins. Otherwise the clinic's own name is used. */
export function mayaOpeningGreeting(clinicName: string, customGreeting?: string): string {
  const custom = String(customGreeting || "").trim();
  if (custom) return custom;
  const name = String(clinicName || "").trim();
  if (!name) return "Hello! Thank you for calling. How may I assist your health appointment today?";
  return `Hello! Thank you for calling ${name}. How may I assist your health appointment today?`;
}

export function mayaWhatsAppLine(opts: { connected: boolean; displayNumber: string }): string {
  if (!opts.connected) return "No WhatsApp number connected yet";
  const number = String(opts.displayNumber || "").trim();
  if (!number) return "WhatsApp is connected, but no clinic number is saved on the profile yet";
  return `Ready to answer WhatsApp audio calls from patients (${number})`;
}

/**
 * Honest desk status from the voice-settings flag and the connected WhatsApp number.
 * There is no separate PSTN IVR probe, so that line says so instead of a standby label.
 */
export function mayaDeskStatus(opts: {
  loaded: boolean;
  inCall: boolean;
  callType: MayaCallType;
  voiceEnabled: boolean;
  connected: boolean;
}): string {
  if (opts.inCall) {
    return opts.callType === "whatsapp" ? "WhatsApp Voice Call Connected" : "Inbound call connected";
  }
  if (!opts.loaded) return "Checking voice desk status…";
  if (!opts.connected) return "WhatsApp number not connected";
  if (!opts.voiceEnabled) return "1-ring pickup off — messaging only";
  if (opts.callType === "ivrn") return "1-ring WhatsApp pickup on — PSTN IVR status is not available";
  return "1-ring pickup on";
}

const CLINIC_VOICE_EDITOR_ROLES = new Set(["doctor", "polyclinic_admin", "CLINIC_ADMIN"]);

export function canEditClinicVoiceSettings(role?: string | null): boolean {
  return CLINIC_VOICE_EDITOR_ROLES.has(String(role || ""));
}
