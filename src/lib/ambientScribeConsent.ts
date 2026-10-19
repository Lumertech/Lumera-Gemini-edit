import { apiFetch } from "../api/http";
import { clinicCalendarDate } from "./clinicDay";

/** Exact attestation. Do not paraphrase. */
export const AMBIENT_SCRIBE_CONSENT_TEXT =
  "I have told the patient that this consult will be recorded and transcribed by Google Cloud Vertex AI (India) to draft notes, and the patient agreed. Audio is not stored.";

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
  // A tap while capture is still starting must not open a second session or stop the first one.
  if (input.requesting) return "ignore";
  const shouldStop = input.force === "stop" || (input.force !== "start" && input.listening);
  if (shouldStop) return "stop";
  if (input.listening || input.busy) return "ignore";
  if (!input.consentGranted) return "ask-consent";
  return "start";
}

export type ConsentWriteNextStep = "second-tap" | "blocked";

/**
 * A successful audit write does not open the microphone.
 * iOS drops the user activation across that await, so the next Start listening tap opens it.
 * A failed write blocks the microphone.
 */
export function consentWriteNextStep(writeSucceeded: boolean): ConsentWriteNextStep {
  return writeSucceeded ? "second-tap" : "blocked";
}

/** A closed visit must be confirmed again. The old visit id is not reused. */
export function closedVisitNeedsFreshConsent(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const body = err as { code?: unknown; status?: unknown };
  return body.code === "visit_closed" && body.status === 409;
}

/** A queue appointment id only. Walk-in ids are minted by the server. */
export function ambientVisitKey(appointmentId: string | undefined, _patientId?: string, _day = clinicCalendarDate()): string {
  return String(appointmentId || "").trim();
}

export async function fetchAmbientScribeConsent(query: {
  appointmentId?: string;
  patientId?: string;
}): Promise<{ confirmed: boolean; appointmentId?: string | null; recordedAt?: string | null }> {
  const params = new URLSearchParams();
  if (query.appointmentId) params.set("appointmentId", query.appointmentId);
  else if (query.patientId) params.set("patientId", query.patientId);
  return apiFetch(`/api/ambient-scribe/consent?${params.toString()}`);
}

export async function saveAmbientScribeConsent(
  patientId: string,
  appointmentId?: string
): Promise<{ confirmed: boolean; appointmentId: string }> {
  return apiFetch("/api/ambient-scribe/consent", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      ...(appointmentId ? { appointmentId } : {}),
      attested: true,
      statement: AMBIENT_SCRIBE_CONSENT_TEXT,
    }),
  });
}
