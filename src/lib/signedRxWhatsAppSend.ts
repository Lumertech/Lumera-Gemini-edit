/** Failure code for a signed Rx WhatsApp send. */
export const RX_SEND_FAILED = "RX_SEND_FAILED";
export const RX_NOT_SIGNED = "RX_NOT_SIGNED";
export const RX_NOT_FOUND = "RX_NOT_FOUND";
export const WALLET_INSUFFICIENT = "WALLET_INSUFFICIENT";
export const WHATSAPP_NOT_CONNECTED = "WHATSAPP_NOT_CONNECTED";
export const WHATSAPP_POLICY_BLOCKED = "WHATSAPP_POLICY_BLOCKED";
export const PATIENT_PHONE_MISSING = "PATIENT_PHONE_MISSING";
export const SAFETY_REVIEW_REQUIRED = "SAFETY_REVIEW_REQUIRED";
export const WHATSAPP_OPT_IN_REQUIRED = "WHATSAPP_OPT_IN_REQUIRED";

export const SANDBOX_NOT_SENT_COPY = "SANDBOX — not sent";

/** Fixed clinician copy. Raw server text is never shown. */
export const SIGNED_RX_WHATSAPP_COPY: Record<string, string> = {
  [RX_NOT_SIGNED]: "Sign the prescription before sending it on WhatsApp.",
  [RX_NOT_FOUND]: "This prescription was not found for your clinic.",
  [WALLET_INSUFFICIENT]: "The clinic WhatsApp wallet does not have enough balance.",
  [WHATSAPP_NOT_CONNECTED]: "WhatsApp is not connected for this clinic.",
  [WHATSAPP_POLICY_BLOCKED]: "WhatsApp policy blocked this send.",
  [RX_SEND_FAILED]: "WhatsApp did not accept this prescription.",
  [PATIENT_PHONE_MISSING]: "Add the patient's phone before sending on WhatsApp.",
  [SAFETY_REVIEW_REQUIRED]:
    "This prescription was flagged HIGH_RISK by the AI Safety Audit. Review the contraindications above and acknowledge the override before proceeding.",
  [WHATSAPP_OPT_IN_REQUIRED]: "This patient has not opted in to WhatsApp messages from this clinic.",
};

export type SignedRxWhatsAppUi =
  | { kind: "sent"; message: string }
  | { kind: "sandbox"; message: string }
  | { kind: "failed"; code: string; message: string };

export function signedRxWhatsAppRequestBody(rxNumber: string): { rxNumber: string } {
  return { rxNumber };
}

export function patientPhoneBlocksWhatsAppSend(phone: unknown): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return SIGNED_RX_WHATSAPP_COPY[PATIENT_PHONE_MISSING];
  return null;
}

export function sentOnWhatsAppCopy(phone: string): string {
  return `Sent on WhatsApp to ${String(phone || "").trim()}`;
}

/**
 * Success is only HTTP ok + success true + status sent.
 * Sandbox, 409, and 500 never count as sent or delivered.
 */
export function interpretSignedRxWhatsAppResponse(status: number, body: unknown): SignedRxWhatsAppUi {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const httpOk = status >= 200 && status < 300;
  if (httpOk && record.success === true && record.status === "sent") {
    return { kind: "sent", message: "" };
  }
  if (httpOk && record.channel === "sandbox") {
    return { kind: "sandbox", message: SANDBOX_NOT_SENT_COPY };
  }
  const code = typeof record.code === "string" ? record.code : "";
  const known = SIGNED_RX_WHATSAPP_COPY[code];
  return {
    kind: "failed",
    code: known ? code : RX_SEND_FAILED,
    message: known || SIGNED_RX_WHATSAPP_COPY[RX_SEND_FAILED],
  };
}

export function whatsAppDispatchNotice(decision: SignedRxWhatsAppUi, phone: string): string {
  if (decision.kind === "sent") return sentOnWhatsAppCopy(phone);
  return decision.message;
}

export function shouldPersistWhatsAppSent(decision: SignedRxWhatsAppUi): boolean {
  return decision.kind === "sent";
}
