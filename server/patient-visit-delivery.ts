/**
 * WhatsApp copy and sends for the visit link.
 * Free-form text only inside the 24 hour window.
 * Outside that window we send a template only when this tenant has an APPROVED row
 * whose name matches a definition. Otherwise the event stays template_pending.
 * Live Graph delivery outside production is limited to +919999973271 unless PATIENT_WA_DELIVER_ANY=1.
 */
import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SqlDatabase } from "./sql-engine.ts";
import { HIDDEN_AMBIENT_SOURCES, hiddenVisitSourceSql } from "./ambient-walkin.ts";
import { dispatchWhatsAppCloudMessage, isWithinCustomerServiceWindow } from "./graph-whatsapp.ts";
import { isProduction } from "./runtime.ts";
import { queueSnapshotFromAppointment, type QueueSnapshot } from "./patient-queue-status.ts";
import {
  buildQueueAskMessage,
  buildTurnNearMessage,
  buildVisitSummaryMessage,
  choosePatientOutbound,
  turnNearTemplateParameters,
} from "./patient-visit-messages.ts";
import { approvedPatientTemplateName } from "./patient-whatsapp-templates.ts";
import {
  claimVisitNotice,
  mintPatientVisitLink,
  patientLinkUrl,
  type MintedPatientLink,
} from "./patient-visit-token.ts";

export const PATIENT_WHATSAPP_TEST_E164 = "+919999973271";

type DeliveryDb = SqlDatabase & Pick<DatabaseSync, "prepare">;

export type PatientDeliveryResult = {
  status: "recorded" | "sent" | "sandbox" | "template_pending" | "skipped" | "failed";
  mode: "freeform" | "template" | "template_pending" | "none";
  eventId?: string;
  templateName?: string;
  error?: string;
};

export function isPatientWhatsAppTestRecipient(phone: string): boolean {
  return String(phone || "").replace(/\D/g, "").endsWith("9999973271");
}

/** Production may message the clinic's own patients. Every other environment messages the test handset only, and only when delivery is turned on. */
export function patientGraphDeliveryAllowed(phone: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProduction()) return true;
  if (String(env.PATIENT_WA_DELIVER || "").trim() !== "1") return false;
  if (String(env.PATIENT_WA_DELIVER_ANY || "").trim() === "1") return true;
  return isPatientWhatsAppTestRecipient(phone);
}

function clinicDoctor(db: DeliveryDb, tenantId: string, doctorName: string): { clinicName: string; doctorName: string } {
  let clinicName = "your clinic";
  try {
    const row = db.prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name?: string } | undefined;
    const name = String(row?.name || "").trim();
    if (name) clinicName = name;
  } catch {
    /* keep fallback */
  }
  const doctor = String(doctorName || "").trim() || "your doctor";
  return { clinicName, doctorName: doctor };
}

function recordEvent(
  db: DeliveryDb,
  input: {
    tenantId: string;
    phone: string;
    name: string;
    eventType: string;
    status: string;
    details: string;
    payload: Record<string, unknown>;
  }
): string {
  const id = `evt-${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.eventType,
    input.phone,
    input.name || "Patient",
    input.status,
    input.details,
    JSON.stringify(input.payload),
    now,
    input.tenantId
  );
  return id;
}

async function sendPatientWhatsApp(opts: {
  db: DeliveryDb;
  tenantId: string;
  phone: string;
  name: string;
  eventType: string;
  mode: "freeform" | "template" | "template_pending";
  textBody: string;
  templateName?: string;
  templateParameters?: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<PatientDeliveryResult> {
  const env = opts.env || process.env;
  const payload = {
    mode: opts.mode,
    templateName: opts.templateName || "",
    templateParameters: opts.templateParameters || [],
  };
  if (opts.mode === "template_pending") {
    const eventId = recordEvent(opts.db, {
      tenantId: opts.tenantId,
      phone: opts.phone,
      name: opts.name,
      eventType: opts.eventType,
      status: "template_pending",
      details: opts.textBody,
      payload,
    });
    return { status: "template_pending", mode: "template_pending", eventId, templateName: opts.templateName };
  }
  if (!patientGraphDeliveryAllowed(opts.phone, env)) {
    const eventId = recordEvent(opts.db, {
      tenantId: opts.tenantId,
      phone: opts.phone,
      name: opts.name,
      eventType: opts.eventType,
      status: "recorded",
      details: opts.textBody,
      payload,
    });
    return { status: "recorded", mode: opts.mode, eventId, templateName: opts.templateName };
  }
  const graph = await dispatchWhatsAppCloudMessage({
    to: opts.phone,
    kind: "text",
    textBody: opts.textBody,
    templateName: opts.mode === "template" ? opts.templateName : "",
    templateParameters: opts.mode === "template" ? opts.templateParameters : undefined,
    db: opts.db as DatabaseSync,
    tenantId: opts.tenantId,
    fetchImpl: opts.fetchImpl,
    inCustomerServiceWindow: opts.mode === "freeform",
  });
  let status: "sent" | "sandbox" | "failed" = "failed";
  let graphError = "";
  if (graph.ok) status = graph.channel === "sandbox" ? "sandbox" : "sent";
  else graphError = "error" in graph ? graph.error : "send failed";
  const eventId = recordEvent(opts.db, {
    tenantId: opts.tenantId,
    phone: opts.phone,
    name: opts.name,
    eventType: opts.eventType,
    status,
    details: opts.textBody,
    payload: { ...payload, error: graphError },
  });
  if (!graph.ok) {
    return { status: "failed", mode: opts.mode, eventId, error: graphError, templateName: opts.templateName };
  }
  return { status, mode: opts.mode, eventId, templateName: opts.templateName };
}

export function queueAskMessageForAppointment(
  db: DeliveryDb,
  tenantId: string,
  appointment: Record<string, unknown>,
  phone: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const patientId = String(appointment.patient_id || appointment.patientId || "").trim();
  if (!patientId) return null;
  const minted = mintPatientVisitLink(
    db,
    {
      tenantId,
      patientId,
      appointmentId: String(appointment.id || ""),
      phone: phone || String(appointment.patient_phone || appointment.patientPhone || ""),
    },
    env
  );
  const snapshot = queueSnapshotFromAppointment(db, { ...appointment, tenant_id: tenantId });
  return buildQueueAskMessage(snapshot, minted ? patientLinkUrl(minted.id, env) : "", minted?.otp || "");
}

export function recordsLinkSuffix(
  db: DeliveryDb,
  tenantId: string,
  rx: Record<string, unknown>,
  phone: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const patientId = String(rx.patient_id || "").trim();
  if (!patientId) return "";
  const minted = mintPatientVisitLink(
    db,
    {
      tenantId: String(rx.tenant_id || tenantId),
      patientId,
      appointmentId: "",
      phone,
    },
    env
  );
  if (!minted) return "";
  const names = clinicDoctor(db, String(rx.tenant_id || tenantId), String(rx.doctor_name || ""));
  return (
    `\n\n${buildVisitSummaryMessage({
      clinicName: names.clinicName,
      doctorName: names.doctorName,
      rxNumber: String(rx.rx_number || ""),
      linkUrl: patientLinkUrl(minted.id, env),
      otp: minted.otp,
    })}`
  );
}

export async function deliverSignedVisitSummary(
  db: DeliveryDb,
  input: {
    tenantId: string;
    patientId: string;
    patientPhone: string;
    patientName?: string;
    doctorName?: string;
    rxNumber: string;
    rxId: string;
    appointmentId?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): Promise<PatientDeliveryResult> {
  const phone = String(input.patientPhone || "").trim();
  if (!phone) return { status: "skipped", mode: "none", error: "no_phone" };
  const noticeKey = `rx:${input.rxId}`;
  if (!claimVisitNotice(db, input.tenantId, noticeKey, "visit_summary")) {
    return { status: "skipped", mode: "none", error: "already_sent" };
  }
  const minted: MintedPatientLink | null = mintPatientVisitLink(
    db,
    {
      tenantId: input.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId || "",
      phone,
    },
    env
  );
  if (!minted) return { status: "skipped", mode: "none", error: "link_secret_missing" };
  const names = clinicDoctor(db, input.tenantId, input.doctorName || "");
  const inWindow = isWithinCustomerServiceWindow(db as DatabaseSync, input.tenantId, phone);
  const approved = approvedPatientTemplateName(db, input.tenantId, "clinic_visit_summary");
  const mode = choosePatientOutbound(inWindow, approved);
  const textBody = buildVisitSummaryMessage({
    clinicName: names.clinicName,
    doctorName: names.doctorName,
    rxNumber: input.rxNumber,
    linkUrl: patientLinkUrl(minted.id, env),
    otp: minted.otp,
  });
  return sendPatientWhatsApp({
    db,
    tenantId: input.tenantId,
    phone,
    name: input.patientName || "Patient",
    eventType: "visit_summary",
    mode,
    textBody,
    templateName: mode === "freeform" ? undefined : "clinic_visit_summary",
    templateParameters: mode === "template" ? [names.clinicName, names.doctorName] : undefined,
    env,
    fetchImpl,
  });
}

export async function notifyTurnNearForDoctor(
  db: DeliveryDb,
  input: { tenantId: string; doctorId: string; date: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): Promise<PatientDeliveryResult[]> {
  const tenantId = String(input.tenantId || "").trim();
  const doctorId = String(input.doctorId || "").trim();
  const date = String(input.date || "").trim();
  if (!tenantId || !doctorId || !date) return [];
  let rows: Record<string, unknown>[] = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ? AND doctor_id = ? AND date = ?
           AND status IN ('Waiting', 'Triage / Vitals')
           AND ${hiddenVisitSourceSql()}
         ORDER BY token_number ASC`
      )
      .all(tenantId, doctorId, date, ...HIDDEN_AMBIENT_SOURCES) as Record<string, unknown>[];
  } catch {
    return [];
  }
  const results: PatientDeliveryResult[] = [];
  for (const row of rows) {
    const snapshot: QueueSnapshot = queueSnapshotFromAppointment(db, row);
    if (snapshot.peopleAhead > 2) continue;
    const appointmentId = String(row.id || "");
    const phone = String(row.patient_phone || "").trim();
    if (!phone) continue;
    if (!claimVisitNotice(db, tenantId, appointmentId, "turn_near")) continue;
    const minted = mintPatientVisitLink(
      db,
      {
        tenantId,
        patientId: String(row.patient_id || ""),
        appointmentId,
        phone,
      },
      env
    );
    const inWindow = isWithinCustomerServiceWindow(db as DatabaseSync, tenantId, phone);
    const approved = approvedPatientTemplateName(db, tenantId, "clinic_queue_turn_near");
    const mode = choosePatientOutbound(inWindow, approved);
    const textBody = minted
      ? `${buildTurnNearMessage(snapshot)}\n${patientLinkUrl(minted.id, env)}\nCode: ${minted.otp}`
      : buildTurnNearMessage(snapshot);
    results.push(
      await sendPatientWhatsApp({
        db,
        tenantId,
        phone,
        name: String(row.patient_name || "Patient"),
        eventType: "queue_turn_near",
        mode,
        textBody,
        templateName: mode === "freeform" ? undefined : "clinic_queue_turn_near",
        templateParameters: mode === "template" ? turnNearTemplateParameters(snapshot) : undefined,
        env,
        fetchImpl,
      })
    );
  }
  return results;
}
