export const WHATSAPP_SEND_FAILED = "WHATSAPP_SEND_FAILED";
export const WHATSAPP_SEND_UNREACHABLE = "WHATSAPP_SEND_UNREACHABLE";

export type WhatsAppDeliveryStatus = "unsent" | "queued" | "delivered" | "read";

export type WhatsAppDispatchDecision =
  | { outcome: "delivered" }
  | { outcome: "failed"; code: string };

export type WhatsAppDispatchRecord = {
  whatsappSentStatus: WhatsAppDeliveryStatus;
  failureCode: string | null;
  showSuccess: boolean;
};

const FIXED_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

function fixedReasonCode(body: unknown): string {
  if (!body || typeof body !== "object") return WHATSAPP_SEND_FAILED;
  const code = String((body as { code?: unknown }).code || "").trim();
  return FIXED_CODE.test(code) ? code : WHATSAPP_SEND_FAILED;
}

/** Success is only an HTTP 2xx body with success: true. Anything else keeps the prior status. */
export function interpretWhatsAppSendResponse(status: number, body: unknown): WhatsAppDispatchDecision {
  const ok = status >= 200 && status < 300;
  const success = Boolean(body && typeof body === "object" && (body as { success?: unknown }).success === true);
  if (ok && success) return { outcome: "delivered" };
  return { outcome: "failed", code: fixedReasonCode(body) };
}

/** A thrown fetch never confirms delivery. The exception text is not a reason code. */
export function interpretWhatsAppNetworkError(): WhatsAppDispatchDecision {
  return { outcome: "failed", code: WHATSAPP_SEND_UNREACHABLE };
}

export function recordWhatsAppDispatch(
  previousStatus: WhatsAppDeliveryStatus,
  decision: WhatsAppDispatchDecision
): WhatsAppDispatchRecord {
  if (decision.outcome === "delivered") {
    return { whatsappSentStatus: "delivered", failureCode: null, showSuccess: true };
  }
  return { whatsappSentStatus: previousStatus, failureCode: decision.code, showSuccess: false };
}

export function whatsAppDispatchErrorCopy(code: string): string {
  return `WhatsApp did not send. Delivery status was left unchanged. Reason: ${code}`;
}

export function buildRxWhatsAppText(input: {
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string;
  patientName: string;
  uhid: string;
  diagnosis: string;
  medicines: ReadonlyArray<{ drugName?: unknown; dosage?: unknown; frequency?: unknown }>;
  pdfUrl: string;
}): string {
  const clinicName = input.clinicName.trim() || "your clinic";
  const doctorName = input.doctorName.trim() || "your doctor";
  const specialty = input.doctorSpecialty.trim() || "General Medicine";
  const medicines = input.medicines;
  const medsText = medicines
    .slice(0, 3)
    .map((med, index) => {
      const name = String(med.drugName || "Medicine");
      const dosage = String(med.dosage || "");
      const frequency = String(med.frequency || "");
      return `  ${index + 1}. *${name}* (${dosage} - ${frequency})`;
    })
    .join("\n");
  const moreMeds = medicines.length > 3 ? `\n  _...and ${medicines.length - 3} more medications_` : "";
  return `🩺 *${clinicName}*\n*Official Digital Prescription*\n\nNamaste *${input.patientName}* (UHID: ${input.uhid}),\nYour consultation prescription has been finalized and signed by *${doctorName}* (${specialty}).\n\n📋 *Diagnosis:* ${input.diagnosis}\n💊 *Prescribed Medications (${medicines.length}):*\n${medsText}${moreMeds}\n\n📄 *Download Official PDF Prescription:*\n${input.pdfUrl}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`;
}
