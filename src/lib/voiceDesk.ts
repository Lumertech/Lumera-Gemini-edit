import { mayaDefaultGreeting } from "./clinicNav";

export type MayaCallType = "whatsapp" | "ivrn";

/** Opening line Maya speaks. A saved greeting wins. Otherwise the clinic's own name is used. */
export function mayaOpeningGreeting(clinicName: string, customGreeting?: string): string {
  const custom = String(customGreeting || "").trim();
  if (custom) return custom;
  return mayaDefaultGreeting(clinicName);
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
  if (!opts.voiceEnabled) return "Maya is not answering calls — messaging only";
  if (opts.callType === "ivrn") return "Maya answers WhatsApp calls — PSTN IVR status is not available";
  return "Maya answers calls";
}

/** Matches voice-settings save: clinic admin, polyclinic admin, and platform admin. Not doctors. */
const CLINIC_VOICE_EDITOR_ROLES = new Set(["CLINIC_ADMIN", "polyclinic_admin", "super_admin", "admin"]);

export function canEditClinicVoiceSettings(role?: string | null): boolean {
  return CLINIC_VOICE_EDITOR_ROLES.has(String(role || ""));
}
