import type { Request, Response } from "express";
import { CLINICIAN_ROLES, isPlatformAdminRole } from "./auth.ts";
import { getDb, writeAudit } from "./db.ts";
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
import { reportCaughtError } from "./error-tracker.ts";
import { WALLET_INSUFFICIENT_ERROR } from "./usage-wallet.ts";
import { dispatchPatientCloudText } from "./whatsapp-patient-dispatch.ts";
import { upsertScopedConversation } from "./whatsapp-scope.ts";
import { buildRxWhatsAppText, WHATSAPP_SEND_FAILED } from "../src/lib/whatsappRxDispatch.ts";
import type { SqlDatabase } from "./sql-engine.ts";

export const PATIENT_PHONE_REQUIRED = "PATIENT_PHONE_REQUIRED";
export const RX_NOT_FOUND = "RX_NOT_FOUND";
export const RX_NUMBER_REQUIRED = "RX_NUMBER_REQUIRED";
export const WHATSAPP_NOT_CONNECTED = "WHATSAPP_NOT_CONNECTED";
export const WHATSAPP_POLICY_BLOCKED = "WHATSAPP_POLICY_BLOCKED";
export const WALLET_INSUFFICIENT = "WALLET_INSUFFICIENT";

const META_MESSAGE_ID = /^wamid\.\S+$/;

type Medicine = { drugName?: unknown; dosage?: unknown; frequency?: unknown };

/** Graph error text never leaves the server. Callers return `{ code }` only. */
export function mapWhatsAppFailureCode(error: string): string {
  const text = String(error || "");
  if (text === WALLET_INSUFFICIENT_ERROR || text.includes("Top up now")) return WALLET_INSUFFICIENT;
  if (
    text === CLINIC_WHATSAPP_NOT_CONNECTED ||
    text === WA_TOKEN_KEY_UNSET_ERROR ||
    /Clinic WhatsApp not connected/i.test(text) ||
    /WA_TOKEN_KEY is unset/i.test(text) ||
    /Cloud API is not configured/i.test(text)
  ) {
    return WHATSAPP_NOT_CONNECTED;
  }
  if (
    text === READ_ONLY_WHATSAPP_SEND_ERROR ||
    text === WHATSAPP_WINDOW_CLOSED_ERROR ||
    text === CLINIC_DOCTOR_NAME_REQUIRED ||
    /not permitted|24 hours after the patient/i.test(text)
  ) {
    return WHATSAPP_POLICY_BLOCKED;
  }
  return WHATSAPP_SEND_FAILED;
}

function usablePhone(value: unknown): string {
  const phone = String(value || "").trim();
  return phone.replace(/\D/g, "").length >= 8 ? phone : "";
}

function readMedicines(raw: unknown): Medicine[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object") as Medicine[];
}

function auditRxSend(
  req: Request,
  tenantId: string,
  rxNumber: string,
  outcome: "sent" | "failed",
  code: string
) {
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

type LoadedRx = {
  rxNumber: string;
  phone: string;
  patientName: string;
  uhid: string;
  doctorName: string;
  doctorSpecialty: string;
  text: string;
  pdfUrl: string;
};

function loadTenantRx(db: SqlDatabase, tenantId: string, body: Record<string, unknown>): LoadedRx | { status: number; code: string } {
  const rxNumber = String(body.rxNumber || body.rx_number || "").trim();
  if (!rxNumber) return { status: 400, code: RX_NUMBER_REQUIRED };
  const rx = db
    .prepare("SELECT * FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
    .get(rxNumber, tenantId) as Record<string, unknown> | undefined;
  if (!rx) return { status: 404, code: RX_NOT_FOUND };

  const patientId = String(rx.patient_id || "").trim();
  let patientPhone = "";
  if (patientId) {
    const patient = db
      .prepare("SELECT phone FROM patients WHERE id = ? AND tenant_id = ?")
      .get(patientId, tenantId) as { phone?: string } | undefined;
    patientPhone = usablePhone(patient?.phone);
  }
  if (!patientPhone) patientPhone = usablePhone(rx.patient_phone);
  if (!patientPhone) return { status: 400, code: PATIENT_PHONE_REQUIRED };

  const letterhead = getTenantLetterhead(tenantId);
  const clinicName = String(rx.clinic_name || "").trim() || letterhead.clinicName || "your clinic";
  const doctorName = String(rx.doctor_name || "").trim();
  const doctorSpecialty = String(rx.doctor_specialty || "").trim();
  const patientName = String(rx.patient_name || "Patient");
  const uhid = String(rx.patient_uhid || "");
  const diagnosis = String(rx.diagnosis || "");
  const medicines = readMedicines(rx.medicines);
  const pdfUrl = `/api/whatsapp/prescription/${rxNumber}/pdf`;
  return {
    rxNumber,
    phone: patientPhone,
    patientName,
    uhid,
    doctorName,
    doctorSpecialty,
    pdfUrl,
    text: buildRxWhatsAppText({
      clinicName,
      doctorName,
      doctorSpecialty,
      patientName,
      uhid,
      diagnosis,
      medicines,
      pdfUrl,
    }),
  };
}

function recordGraphAcceptance(tenantId: string, loaded: LoadedRx, messageId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const timeDisplay = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const preferredId = `conv-${loaded.phone.replace(/\D/g, "").slice(-8) || "pt"}`;
  const convId = upsertScopedConversation({
    preferredId,
    tenantId,
    patientPhone: loaded.phone,
    patientName: loaded.patientName,
    assignedStaff: loaded.doctorName || "Clinic",
    tags: '["Prescription"]',
    preferredLanguage: "en",
    lastMessage: `Prescription ${loaded.rxNumber}`,
    lastMessageTime: timeDisplay,
    now,
  });
  db.prepare(
    `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at, tenant_id)
     VALUES (?, ?, ?, 'agent', ?, ?, null, 'en', ?, ?, ?, 'sent', ?, ?)`
  ).run(
    messageId,
    convId,
    loaded.phone,
    loaded.doctorName || "Clinic",
    loaded.text,
    timeDisplay,
    JSON.stringify([{ type: "URL", text: "View prescription", url: loaded.pdfUrl }]),
    JSON.stringify({ type: "document", url: loaded.pdfUrl }),
    now,
    tenantId
  );
  db.prepare(
    `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
     VALUES (?, 'whatsapp_rx_send', ?, ?, 'sent', ?, ?, ?, ?)`
  ).run(
    messageId,
    loaded.phone,
    loaded.patientName,
    `rxNumber ${loaded.rxNumber}`,
    JSON.stringify({ messageId, rxNumber: loaded.rxNumber, channel: "graph" }),
    now,
    tenantId
  );
  db.prepare(
    `UPDATE prescriptions SET whatsapp_sent_status = 'sent' WHERE rx_number = ? AND tenant_id = ?`
  ).run(loaded.rxNumber, tenantId);
}

/**
 * Tenant-scoped Rx send. The phone, diagnosis, and medicines come from this
 * clinic's prescription row. A Graph accept stores Meta's wamid with status
 * `sent`. Sandbox and Meta rejects do not write a message or mark the Rx sent.
 * The prescriptions table is never upserted from the request body.
 */
export async function handleWhatsAppRxSend(req: Request, res: Response): Promise<void> {
  const body = (req.body || {}) as Record<string, unknown>;
  const rxNumber = String(body.rxNumber || body.rx_number || "").trim();
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const role = req.user.role;
    if (!(CLINICIAN_ROLES as readonly string[]).includes(role) && !isPlatformAdminRole(role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const tenantId = String(req.user.tenantId || "").trim();
    if (!tenantId) {
      auditRxSend(req, "", rxNumber, "failed", RX_NOT_FOUND);
      res.status(404).json({ code: RX_NOT_FOUND });
      return;
    }
    const loaded = loadTenantRx(getDb(), tenantId, body);
    if ("code" in loaded) {
      auditRxSend(req, tenantId, rxNumber, "failed", loaded.code);
      res.status(loaded.status).json({ code: loaded.code });
      return;
    }
    const sent = await dispatchPatientCloudText({
      tenantId,
      to: loaded.phone,
      textBody: loaded.text,
      previewUrl: true,
    });
    if (isCloudDispatchFailure(sent)) {
      const code = mapWhatsAppFailureCode(sent.error);
      auditRxSend(req, tenantId, loaded.rxNumber, "failed", code);
      res.status(cloudDispatchHttpStatus(sent.error, sent.status)).json({ code });
      return;
    }
    const messageId = String(sent.messageId || "").trim();
    if (sent.channel !== "graph" || !META_MESSAGE_ID.test(messageId)) {
      auditRxSend(req, tenantId, loaded.rxNumber, "failed", "SANDBOX_NOT_SENT");
      res.status(200).json({ success: false, channel: "sandbox", status: "sandbox" });
      return;
    }
    recordGraphAcceptance(tenantId, loaded, messageId);
    auditRxSend(req, tenantId, loaded.rxNumber, "sent", "SENT");
    res.status(200).json({ success: true, status: "sent", messageId, channel: "graph" });
  } catch (err) {
    reportCaughtError(err, "whatsapp.send-rx");
    try {
      auditRxSend(req, String(req.user?.tenantId || ""), rxNumber, "failed", WHATSAPP_SEND_FAILED);
    } catch {
      /* audit table may be missing in a partial boot */
    }
    if (!res.headersSent) res.status(500).json({ code: WHATSAPP_SEND_FAILED });
  }
}
