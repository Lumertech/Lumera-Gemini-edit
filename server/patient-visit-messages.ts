import { formatQueueToken, type QueueSnapshot } from "./patient-queue-status.ts";

function etaLabel(snapshot: QueueSnapshot): string {
  if (!snapshot.visitIsToday) return `your visit is on ${snapshot.visitDate}`;
  if (!snapshot.clinicOpen) return "clinic is closed";
  if (snapshot.etaMinutes === 0) return "now";
  if (snapshot.etaMinutes == null) return "when the clinic is open";
  return `${snapshot.etaMinutes} min`;
}

/** Free-form queue reply. Clinic and doctor names come from the visit, not a fixed brand. */
export function buildQueueAskMessage(snapshot: QueueSnapshot, linkUrl: string, otp: string): string {
  const lines = [
    `*${snapshot.clinicName}*`,
    `Live queue with *${snapshot.doctorName}*`,
    `Your token: *${formatQueueToken(snapshot.yourToken)}*`,
    `Now serving: *${formatQueueToken(snapshot.currentToken)}*`,
    `People ahead: *${snapshot.peopleAhead}*`,
    `ETA: *${etaLabel(snapshot)}*`,
    `Clinic: *${snapshot.clinicOpen ? "Open" : "Closed"}*`,
  ];
  if (linkUrl) {
    lines.push("", `Secure visit link (expires soon):`, linkUrl);
  }
  if (otp) {
    lines.push(`Code: ${otp}`, "Do not forward this code. It expires in 15 minutes.");
  }
  return lines.join("\n");
}

/** Inside the 24h window. No template name, no platform brand. */
export function buildTurnNearMessage(snapshot: QueueSnapshot): string {
  return [
    `*${snapshot.clinicName}*`,
    `Your turn with *${snapshot.doctorName}* is near.`,
    `Your token: *${formatQueueToken(snapshot.yourToken)}*`,
    `Now serving: *${formatQueueToken(snapshot.currentToken)}*`,
    `People ahead: *${snapshot.peopleAhead}*`,
    `ETA: *${etaLabel(snapshot)}*`,
    `Clinic: *${snapshot.clinicOpen ? "Open" : "Closed"}*`,
    "Open the secure visit link already in this chat. It expires.",
  ].join("\n");
}

export function buildVisitSummaryMessage(input: {
  clinicName: string;
  doctorName: string;
  rxNumber: string;
  linkUrl: string;
  otp: string;
}): string {
  const clinic = input.clinicName.trim() || "your clinic";
  const doctor = input.doctorName.trim() || "your doctor";
  return [
    `*${clinic}*`,
    `*${doctor}* shared your visit summary${input.rxNumber ? ` (${input.rxNumber})` : ""}.`,
    "Open it on the secure link. The link expires.",
    input.linkUrl,
    `Code: ${input.otp}`,
    "Do not forward this code.",
  ].join("\n");
}

export function turnNearTemplateParameters(snapshot: QueueSnapshot): string[] {
  return [
    snapshot.clinicName,
    snapshot.doctorName,
    formatQueueToken(snapshot.yourToken),
    String(snapshot.peopleAhead),
  ];
}

export type PatientOutboundMode = "freeform" | "template" | "template_pending";

/** Inside 24h: free-form. Outside: an approved template, otherwise hold for Meta. */
export function choosePatientOutbound(inWindow: boolean, approvedTemplateName: string | null): PatientOutboundMode {
  if (inWindow) return "freeform";
  if (approvedTemplateName) return "template";
  return "template_pending";
}
