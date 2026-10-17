import type { Request, Response } from "express";
import { getDb, writeAudit } from "./db.ts";
import { reportCaughtError } from "./error-tracker.ts";
import {
  CLINIC_DOCTOR_NAME_REQUIRED,
  CLINIC_WHATSAPP_NOT_CONNECTED,
  READ_ONLY_WHATSAPP_SEND_ERROR,
  WA_TOKEN_KEY_UNSET_ERROR,
  WHATSAPP_WINDOW_CLOSED_ERROR,
  cloudDispatchHttpStatus,
  isCloudDispatchFailure,
} from "./graph-whatsapp.ts";
import { getTenantLetterhead } from "./letterhead.ts";
import { appPublicUrl, AppPublicUrlError } from "./runtime.ts";
import { PATIENT_PHONE_MISSING, RX_SEND_FAILED } from "../src/lib/signedRxWhatsAppSend.ts";
import { WALLET_INSUFFICIENT_ERROR } from "./usage-wallet.ts";
import { dispatchPatientCloudText } from "./whatsapp-patient-dispatch.ts";
import { upsertScopedConversation } from "./whatsapp-scope.ts";

export const RX_NUMBER_REQUIRED = "RX_NUMBER_REQUIRED";
export const RX_NOT_FOUND = "RX_NOT_FOUND";
export const RX_NOT_SIGNED = "RX_NOT_SIGNED";
export { PATIENT_PHONE_MISSING, RX_SEND_FAILED };

type Sql = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
};

export type SignedRxSend =
  | { ok: false; status: number; code: string }
  | {
      ok: true;
      rxNumber: string;
      phone: string;
      patientName: string;
      doctorName: string;
      text: string;
      pdfUrl: string;
    };

function fail(status: number, code: string): SignedRxSend {
  return { ok: false, status, code };
}

function reviewedBy(row: Record<string, unknown>): string {
  try {
    const modules = JSON.parse(String(row.specialty_modules || "{}")) as { reviewedBy?: unknown };
    return String(modules.reviewedBy || "").trim();
  } catch {
    return "";
  }
}

/** Name of the user or doctor row identified by reviewedBy. Never the free-text doctor_name. */
function treatingDoctorName(db: Sql, tenantId: string, signerId: string): string {
  const user = db.prepare("SELECT name FROM users WHERE id = ? AND tenant_id = ?").get(signerId, tenantId) as
    | { name?: string }
    | undefined;
  const userName = String(user?.name || "").trim();
  if (userName) return userName;
  const doctor = db
    .prepare(
      `SELECT d.name
       FROM doctors d
       INNER JOIN users u ON u.id = d.user_id
       WHERE d.id = ? AND u.tenant_id = ?`
    )
    .get(signerId, tenantId) as { name?: string } | undefined;
  return String(doctor?.name || "").trim();
}

function medicineLines(raw: unknown): { lines: string; count: number } {
  let medicines: Array<{ drugName?: unknown; dosage?: unknown; frequency?: unknown }> = [];
  if (Array.isArray(raw)) medicines = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) medicines = parsed;
    } catch {
      medicines = [];
    }
  }
  const lines = medicines
    .slice(0, 3)
    .map((med, index) => {
      const name = String(med.drugName || "Medicine");
      const dosage = String(med.dosage || "");
      const frequency = String(med.frequency || "");
      return `  ${index + 1}. *${name}* (${dosage} - ${frequency})`;
    })
    .join("\n");
  const more = medicines.length > 3 ? `\n  _...and ${medicines.length - 3} more medications_` : "";
  return { lines: `${lines}${more}`, count: medicines.length };
}

/** Clinic copy for a signed Rx. {{portal_url}} is replaced only with the server origin. */
export function signedRxWhatsAppText(input: {
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string;
  patientName: string;
  uhid: string;
  diagnosis: string;
  medicineLines: string;
  medicineCount: number;
  portalUrl: string;
}): string {
  const clinicName = input.clinicName.trim() || "your clinic";
  const doctorName = input.doctorName.trim() || "your doctor";
  const specialty = input.doctorSpecialty.trim() || "General Medicine";
  const portalUrl = String(input.portalUrl || "").trim().replace(/\/$/, "");
  const template = `🩺 *Prescription from ${clinicName}*\n\nNamaste *${input.patientName}* (UHID: ${input.uhid}),\nYour consultation prescription has been finalized and signed by *${doctorName}* (${specialty}).\n\n📋 *Diagnosis:* ${input.diagnosis}\n💊 *Prescribed Medications (${input.medicineCount}):*\n${input.medicineLines}\n\nPatient portal: {{portal_url}}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`;
  return template.replaceAll("{{portal_url}}", portalUrl);
}

/**
 * Load one signed prescription for the session tenant.
 * patientPhone, patientName, diagnosis, medicines, and portal_url on the body are never read.
 */
export function resolveSignedRxWhatsAppSend(
  db: Sql,
  tenantId: string,
  body: unknown,
  portalUrl: string
): SignedRxSend {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rxNumber = String(record.rxNumber || record.rx_number || "").trim();
  if (!rxNumber) return fail(400, RX_NUMBER_REQUIRED);
  const tenant = String(tenantId || "").trim();
  if (!tenant) return fail(404, RX_NOT_FOUND);

  const rx = db
    .prepare("SELECT * FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
    .get(rxNumber, tenant) as Record<string, unknown> | undefined;
  if (!rx) return fail(404, RX_NOT_FOUND);
  const signerId = reviewedBy(rx);
  const doctorId = String(rx.doctor_id || "").trim();
  if (!signerId || signerId !== doctorId) return fail(409, RX_NOT_SIGNED);
  const signerName = treatingDoctorName(db, tenant, signerId);

  const patientId = String(rx.patient_id || "").trim();
  const patient = patientId
    ? (db.prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?").get(patientId, tenant) as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const phone = String(patient?.phone || "").trim();
  if (!patient) return fail(404, RX_NOT_FOUND);
  if (!phone) return fail(422, PATIENT_PHONE_MISSING);

  const storedRxNumber = String(rx.rx_number || rxNumber);
  const pdfUrl = `/api/whatsapp/prescription/${storedRxNumber}/pdf`;
  const meds = medicineLines(rx.medicines);
  const clinicName = getTenantLetterhead(tenant).clinicName;
  const text = signedRxWhatsAppText({
    clinicName,
    doctorName: signerName,
    doctorSpecialty: String(rx.doctor_specialty || ""),
    patientName: String(patient.name || "").trim() || "Patient",
    uhid: String(patient.uhid || ""),
    diagnosis: String(rx.diagnosis || ""),
    medicineLines: meds.lines,
    medicineCount: meds.count,
    portalUrl,
  });
  return {
    ok: true,
    rxNumber: storedRxNumber,
    phone,
    patientName: String(patient.name || "").trim() || "Patient",
    doctorName: signerName || "your doctor",
    text,
    pdfUrl,
  };
}

const META_MESSAGE_ID = /^wamid\.\S+$/;

function rxFailureCode(error: string): string {
  const text = String(error || "");
  if (text === WALLET_INSUFFICIENT_ERROR || text.includes("Top up now")) return "WALLET_INSUFFICIENT";
  if (
    text === CLINIC_WHATSAPP_NOT_CONNECTED ||
    text === WA_TOKEN_KEY_UNSET_ERROR ||
    /Clinic WhatsApp not connected/i.test(text) ||
    /WA_TOKEN_KEY is unset/i.test(text) ||
    /Cloud API is not configured/i.test(text)
  ) {
    return "WHATSAPP_NOT_CONNECTED";
  }
  if (
    text === READ_ONLY_WHATSAPP_SEND_ERROR ||
    text === WHATSAPP_WINDOW_CLOSED_ERROR ||
    text === CLINIC_DOCTOR_NAME_REQUIRED ||
    /not permitted|24 hours after the patient/i.test(text)
  ) {
    return "WHATSAPP_POLICY_BLOCKED";
  }
  return RX_SEND_FAILED;
}

function auditRxSend(req: Request, tenantId: string, rxNumber: string, outcome: "sent" | "failed", code: string) {
  const actorId = String(req.user?.id || "").trim();
  const rx = String(rxNumber || "").trim();
  writeAudit(
    getDb(),
    actorId || null,
    String(req.user?.name || "Staff"),
    "whatsapp_rx_send",
    `tenant ${tenantId} actor ${actorId} rxNumber ${rx} outcome ${outcome} code ${code}`,
    {
      tenantId,
      actorRole: String(req.user?.role || ""),
      entityType: "prescription",
      entityId: rx,
    }
  );
}

function recordGraphRxSend(tenantId: string, resolved: Extract<SignedRxSend, { ok: true }>, messageId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const timeDisplay = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const preferredId = `conv-${resolved.phone.replace(/\D/g, "").slice(-8) || "pt"}`;
  const convId = upsertScopedConversation({
    preferredId,
    tenantId,
    patientPhone: resolved.phone,
    patientName: resolved.patientName,
    assignedStaff: resolved.doctorName || "Clinic",
    tags: '["Prescription"]',
    preferredLanguage: "en",
    lastMessage: `Prescription ${resolved.rxNumber}`,
    lastMessageTime: timeDisplay,
    now,
  });
  db.prepare(
    `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at, tenant_id)
     VALUES (?, ?, ?, 'agent', ?, ?, null, 'en', ?, ?, ?, 'sent', ?, ?)`
  ).run(
    messageId,
    convId,
    resolved.phone,
    resolved.doctorName || "Clinic",
    resolved.text,
    timeDisplay,
    null,
    null,
    now,
    tenantId
  );
  db.prepare(
    `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
     VALUES (?, 'whatsapp_rx_send', ?, ?, 'sent', ?, ?, ?, ?)`
  ).run(
    messageId,
    resolved.phone,
    resolved.patientName,
    `rxNumber ${resolved.rxNumber}`,
    JSON.stringify({ messageId, rxNumber: resolved.rxNumber, channel: "graph" }),
    now,
    tenantId
  );
  db.prepare(
    `UPDATE prescriptions SET whatsapp_sent_status = 'sent' WHERE rx_number = ? AND tenant_id = ?`
  ).run(resolved.rxNumber, tenantId);
}

/**
 * One send for the billing route and the inbox route.
 * Sandbox writes no message and does not mark the Rx sent. A Graph accept stores Meta's wamid as sent.
 */
export async function handleSignedRxWhatsAppSend(req: Request, res: Response): Promise<void> {
  const body = (req.body || {}) as Record<string, unknown>;
  const rxNumber = String(body.rxNumber || body.rx_number || "").trim();
  try {
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) {
      auditRxSend(req, "", rxNumber, "failed", RX_NOT_FOUND);
      res.status(404).json({ code: RX_NOT_FOUND });
      return;
    }
    let portalUrl = "";
    try {
      portalUrl = appPublicUrl(req.get("host") || undefined, req.protocol);
    } catch (err) {
      if (err instanceof AppPublicUrlError) {
        auditRxSend(req, tenantId, rxNumber, "failed", RX_SEND_FAILED);
        res.status(500).json({ code: RX_SEND_FAILED });
        return;
      }
      throw err;
    }
    const resolved = resolveSignedRxWhatsAppSend(getDb(), tenantId, req.body, portalUrl);
    if (resolved.ok === false) {
      auditRxSend(req, tenantId, rxNumber, "failed", resolved.code);
      res.status(resolved.status).json({ code: resolved.code });
      return;
    }
    const sent = await dispatchPatientCloudText({
      tenantId,
      to: resolved.phone,
      textBody: resolved.text,
      previewUrl: true,
    });
    if (isCloudDispatchFailure(sent)) {
      const code = rxFailureCode(sent.error);
      auditRxSend(req, tenantId, resolved.rxNumber, "failed", code);
      res.status(cloudDispatchHttpStatus(sent.error, sent.status)).json({ code });
      return;
    }
    const messageId = String(sent.messageId || "").trim();
    if (sent.channel !== "graph" || !META_MESSAGE_ID.test(messageId)) {
      auditRxSend(req, tenantId, resolved.rxNumber, "failed", "SANDBOX_NOT_SENT");
      res.status(200).json({ success: false, channel: "sandbox", status: "sandbox" });
      return;
    }
    recordGraphRxSend(tenantId, resolved, messageId);
    auditRxSend(req, tenantId, resolved.rxNumber, "sent", "SENT");
    res.status(200).json({ success: true, status: "sent", messageId, channel: "graph" });
  } catch (err) {
    reportCaughtError(err, "whatsapp.send-rx");
    try {
      auditRxSend(req, String(req.user?.tenantId || ""), rxNumber, "failed", RX_SEND_FAILED);
    } catch {
      /* audit table may be missing in a partial boot */
    }
    if (!res.headersSent) res.status(500).json({ code: RX_SEND_FAILED });
  }
}
