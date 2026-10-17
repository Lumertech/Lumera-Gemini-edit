import { apiFetch } from "../api/http";
import { clinicCalendarDate } from "./clinicDay";

/** Exact attestation. Do not paraphrase. */
export const AMBIENT_SCRIBE_CONSENT_TEXT =
  "I have told the patient that this consult will be recorded and transcribed by an AI service to draft notes, and the patient agreed. Audio is not stored.";

/** Shown under the microphone. Do not name the transcription vendor. */
export const AMBIENT_RECORDING_DISCLOSURE =
  "Recording is sent to an AI transcription service. Audio is not saved. Text stays a suggestion until you apply it.";

export type AmbientMicStartDecision = "stop" | "start" | "ask-consent" | "ignore";

/**
 * The microphone and getUserMedia run only for "start".
 * "ask-consent" opens the attestation and must not request a stream.
 */
export function ambientMicStartDecision(input: {
  force?: "start" | "stop";
  listening: boolean;
  requesting: boolean;
  busy: boolean;
  consentGranted: boolean;
}): AmbientMicStartDecision {
  const shouldStop = input.force === "stop" || (input.force !== "start" && (input.listening || input.requesting));
  if (shouldStop) return "stop";
  if (input.listening || input.requesting || input.busy) return "ignore";
  if (!input.consentGranted) return "ask-consent";
  return "start";
}

/** Real appointment id, or a same-day visit key when the consult is not on the queue yet. */
export function ambientVisitKey(appointmentId: string | undefined, patientId: string, day = clinicCalendarDate()): string {
  const appointment = String(appointmentId || "").trim();
  if (appointment) return appointment;
  const patient = String(patientId || "").trim();
  if (!patient || !day) return "";
  return `unscheduled:${patient}:${day}`;
}

export async function fetchAmbientScribeConsent(appointmentId: string): Promise<{ confirmed: boolean; recordedAt?: string | null }> {
  const query = encodeURIComponent(appointmentId);
  return apiFetch(`/api/ambient-scribe/consent?appointmentId=${query}`);
}

export async function saveAmbientScribeConsent(appointmentId: string, patientId: string): Promise<{ confirmed: boolean }> {
  return apiFetch("/api/ambient-scribe/consent", {
    method: "POST",
    body: JSON.stringify({
      appointmentId,
      patientId,
      attested: true,
      statement: AMBIENT_SCRIBE_CONSENT_TEXT,
    }),
  });
}
