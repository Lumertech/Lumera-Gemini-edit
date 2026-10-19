/**
 * Per-clinic WhatsApp template catalog.
 *
 * Names are clinic_* and are never the platform lumera_* templates.
 * Bodies use positional {{1}}…{{n}} only. Footers have no variables.
 * URL buttons are a fixed base plus one trailing variable.
 *
 * WhatsApp Manager on 2026-10-19:
 * lumera_payment_receipt_v2 body is
 * "Hi {{1}}, your payment of {{2}} was received by {{3}} ({{4}}). Ref {{5}}. View your receipt here: {{6}}. Thank you."
 * Slots: patient first name, amount "INR 700", clinic_name, doctor, receipt ref, opaque receipt URL.
 * lumera_payment_receipt (the name currently on Cloud Run) is 4 slots:
 * patient, amount, clinic, receipt URL.
 */

import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { graphApiVersion } from "./runtime.ts";

export type ReceiptParameterFields = {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  amount?: number | string;
  invoiceId?: string;
  date?: string;
  receiptUrl?: string;
};

export const TEMPLATE_NOT_APPROVED = "TEMPLATE_NOT_APPROVED";
export const TEMPLATE_NOT_APPROVED_ERROR =
  "TEMPLATE_NOT_APPROVED: No approved WhatsApp template for this message. A normal chat reply is available only within 24 hours of the patient's last message.";

export const CLINIC_TEMPLATE_LANGUAGE = "en";

export const LUMERA_RECEIPT_TEMPLATE_V1 = "lumera_payment_receipt";
export const LUMERA_RECEIPT_TEMPLATE_V2 = "lumera_payment_receipt_v2";

const CLINIC_FALLBACK = "your clinic";
const DOCTOR_FALLBACK = "your clinician";

export type ClinicTemplateKind =
  | "appointment_reminder"
  | "book_confirmation"
  | "payment_receipt"
  | "prescription_ready";

export type ClinicTemplateSpec = {
  kind: ClinicTemplateKind;
  name: string;
  category: "UTILITY";
  language: string;
  label: string;
  body: string;
  example: string[];
  footer: string;
  urlButton?: { text: string; url: string; example: string };
};

export const CLINIC_TEMPLATE_CATALOG: readonly ClinicTemplateSpec[] = [
  {
    kind: "appointment_reminder",
    name: "clinic_appointment_reminder",
    category: "UTILITY",
    language: CLINIC_TEMPLATE_LANGUAGE,
    label: "Appointment reminder",
    body: "Namaste {{1}}, this is a reminder from {{2}}. Your visit with {{3}} is on {{4}} at {{5}}. Please arrive 10 minutes early.",
    example: ["Asha Rao", "Sunrise Clinic", "Dr Mehta", "20 Oct 2026", "9:30 AM"],
    footer: "Reply to this chat if you need to reschedule.",
  },
  {
    kind: "book_confirmation",
    name: "clinic_booking_confirmation",
    category: "UTILITY",
    language: CLINIC_TEMPLATE_LANGUAGE,
    label: "Booking confirmation",
    body: "Namaste {{1}}, {{2}} confirmed your visit with {{3}} on {{4}} at {{5}}. Your token is {{6}}.",
    example: ["Asha Rao", "Sunrise Clinic", "Dr Mehta", "20 Oct 2026", "9:30 AM", "4"],
    footer: "Reply to this chat if you need a different time.",
  },
  {
    kind: "payment_receipt",
    name: "clinic_payment_receipt",
    category: "UTILITY",
    language: CLINIC_TEMPLATE_LANGUAGE,
    label: "Payment receipt",
    body: "Hi {{1}}, your payment of {{2}} was received by {{3}} ({{4}}). Ref {{5}}. View your receipt here: {{6}}. Thank you.",
    example: ["Asha", "INR 700", "Sunrise Clinic", "Dr Mehta", "RCP-1001", "https://www.mylumera.in/pay/v/opaqueexampletoken"],
    footer: "Reply to this chat if you need a copy of this receipt.",
  },
  {
    kind: "prescription_ready",
    name: "clinic_prescription_ready",
    category: "UTILITY",
    language: CLINIC_TEMPLATE_LANGUAGE,
    label: "Prescription ready",
    body: "Namaste {{1}}, {{2}} has a prescription that {{3}} reviewed and signed.",
    example: ["Asha Rao", "Sunrise Clinic", "Dr Mehta"],
    footer: "Follow the dose your doctor wrote. Reply to this chat if you need help.",
    urlButton: {
      text: "View prescription",
      url: "https://www.mylumera.in/rx/v/{{1}}",
      example: "https://www.mylumera.in/rx/v/opaqueexampletoken",
    },
  },
] as const;

const CATALOG_BY_KIND = new Map(CLINIC_TEMPLATE_CATALOG.map((spec) => [spec.kind, spec]));
const CATALOG_BY_NAME = new Map(CLINIC_TEMPLATE_CATALOG.map((spec) => [spec.name, spec]));

const HINDI_BODIES: Record<ClinicTemplateKind, { body: string; example: string[]; footer: string }> = {
  appointment_reminder: {
    body: "नमस्ते {{1}}, यह {{2}} की याद दिलाना है। {{3}} के साथ आपकी मुलाकात {{4}} को {{5}} बजे है।",
    example: ["Asha", "Sunrise Clinic", "Dr Mehta", "20 Oct 2026", "9:30 AM"],
    footer: "समय बदलना हो तो इस चैट में जवाब दें।",
  },
  book_confirmation: {
    body: "नमस्ते {{1}}, {{2}} ने {{3}} के साथ {{4}} को {{5}} बजे मुलाकात पक्की की है। टोकन {{6}}।",
    example: ["Asha", "Sunrise Clinic", "Dr Mehta", "20 Oct 2026", "9:30 AM", "4"],
    footer: "दूसरा समय चाहिए तो इस चैट में जवाब दें।",
  },
  payment_receipt: {
    body: "नमस्ते {{1}}, {{2}} का भुगतान {{3}} ({{4}}) को मिला। संदर्भ {{5}}। रसीद यहाँ देखें: {{6}}। धन्यवाद।",
    example: ["Asha", "INR 700", "Sunrise Clinic", "Dr Mehta", "RCP-1001", "https://www.mylumera.in/pay/v/opaqueexampletoken"],
    footer: "रसीद की प्रति चाहिए तो इस चैट में जवाब दें।",
  },
  prescription_ready: {
    body: "नमस्ते {{1}}, {{2}} में {{3}} ने इस पर्ची को देखकर हस्ताक्षर किए हैं।",
    example: ["Asha", "Sunrise Clinic", "Dr Mehta"],
    footer: "खुराक वही रखें जो डॉक्टर ने लिखी है।",
  },
};

/** English catalog plus Hindi (hi) copies of the same names. */
export function clinicTemplatesToProvision(): ClinicTemplateSpec[] {
  const hindi = CLINIC_TEMPLATE_CATALOG.map((spec) => {
    const copy = HINDI_BODIES[spec.kind];
    return {
      ...spec,
      language: "hi",
      body: copy.body,
      example: copy.example,
      footer: copy.footer,
    };
  });
  return [...CLINIC_TEMPLATE_CATALOG, ...hindi];
}

export function clinicTemplateSpec(kind: string): ClinicTemplateSpec | undefined {
  return CATALOG_BY_KIND.get(kind as ClinicTemplateKind);
}

export function clinicTemplateName(kind: string): string {
  return clinicTemplateSpec(kind)?.name || "";
}

export function isClinicCatalogTemplate(name: string): boolean {
  return CATALOG_BY_NAME.has(String(name || "").trim());
}

function paramText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/** WhatsApp {{1}} is the patient's first name only. */
export function patientFirstName(name: unknown): string {
  const first = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  return first || "Patient";
}

/** Manager sample for the amount slot is "INR 700", not a rupee-formatted string. */
export function receiptAmountInr(amount: unknown): string {
  const raw = String(amount ?? "").trim();
  if (!raw) return "INR 0";
  if (/^INR\s+\d/i.test(raw)) return raw.replace(/^inr/i, "INR");
  const numeric = typeof amount === "number" ? amount : Number(raw.replace(/[,₹]/g, "").replace(/^INR\s*/i, ""));
  if (!Number.isFinite(numeric)) return `INR ${raw}`;
  const formatted = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
  return `INR ${formatted}`;
}

/**
 * Positional body for a payment receipt. Verified against WhatsApp Manager on 2026-10-19.
 * lumera_payment_receipt: {{1}} patient, {{2}} amount, {{3}} clinic, {{4}} receipt URL.
 * lumera_payment_receipt_v2 and clinic_payment_receipt:
 * {{1}} patient first name, {{2}} INR amount, {{3}} clinic_name, {{4}} doctor, {{5}} ref, {{6}} receipt URL.
 */
export function receiptTemplateParameters(fields: ReceiptParameterFields, templateName?: string | null): string[] {
  const patient = patientFirstName(fields.patientName);
  const amount = receiptAmountInr(fields.amount);
  const clinic = paramText(fields.clinicName, CLINIC_FALLBACK);
  const doctor = paramText(fields.doctorName, DOCTOR_FALLBACK);
  const ref = paramText(fields.invoiceId, "receipt");
  const url = paramText(fields.receiptUrl, "");
  if (String(templateName || "").trim() === LUMERA_RECEIPT_TEMPLATE_V1) {
    return [patient, amount, clinic, url];
  }
  return [patient, amount, clinic, doctor, ref, url];
}

export function reminderTemplateParameters(fields: {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  date?: string;
  timeSlot?: string;
}): string[] {
  return [
    patientFirstName(fields.patientName),
    paramText(fields.clinicName, CLINIC_FALLBACK),
    paramText(fields.doctorName, DOCTOR_FALLBACK),
    paramText(fields.date, "the scheduled date"),
    paramText(fields.timeSlot, "OPD"),
  ];
}

export function bookConfirmationTemplateParameters(fields: {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
  date?: string;
  timeSlot?: string;
  tokenNumber?: string | number;
}): string[] {
  const token = paramText(fields.tokenNumber, "");
  return [
    patientFirstName(fields.patientName),
    paramText(fields.clinicName, CLINIC_FALLBACK),
    paramText(fields.doctorName, DOCTOR_FALLBACK),
    paramText(fields.date, "the scheduled date"),
    paramText(fields.timeSlot, "OPD"),
    token || "pending",
  ];
}

export function prescriptionReadyTemplateParameters(fields: {
  patientName?: string;
  clinicName?: string;
  doctorName?: string;
}): string[] {
  return [
    patientFirstName(fields.patientName),
    paramText(fields.clinicName, CLINIC_FALLBACK),
    paramText(fields.doctorName, DOCTOR_FALLBACK),
  ];
}

/** Trailing URL variable. Slashes would change the path Meta already fixed. */
export function prescriptionUrlSuffix(rxNumber: string): string {
  return String(rxNumber || "").replace(/[^A-Za-z0-9_-]/g, "");
}

export function graphComponentsForClinicTemplate(spec: ClinicTemplateSpec): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [
    {
      type: "BODY",
      text: spec.body,
      example: { body_text: [spec.example] },
    },
    { type: "FOOTER", text: spec.footer },
  ];
  if (spec.urlButton) {
    components.push({
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: spec.urlButton.text,
          url: spec.urlButton.url,
          example: [spec.urlButton.example],
        },
      ],
    });
  }
  return components;
}

export const GRAPH_ERROR_GUIDANCE: Record<string, string> = {
  "190": "The WhatsApp connection expired. Use Reconnect and sign in with Meta again.",
  "133010": "This phone number is not registered for WhatsApp. Use Reconnect to register it again.",
  "131048": "WhatsApp is limiting this number because of message quality. Pause bulk sends and try again later.",
  "131056": "Too many messages were sent to this patient. Wait before messaging them again.",
  "130429": "WhatsApp is throttling this number. Wait a few minutes and try again.",
  "132000": "The message parameters do not match the approved template. Resync templates, then try again.",
  "132001": "That template is not approved for this language. Check the template status before sending.",
};

export function graphErrorGuidance(code: string | number | undefined): string {
  return GRAPH_ERROR_GUIDANCE[String(code ?? "").trim()] || "";
}

export function formatGraphSendError(code: string, message: string): string {
  const guidance = graphErrorGuidance(code);
  const base = message.trim() || "WhatsApp rejected the message.";
  if (!code) return base;
  return guidance ? `${base} (#${code}) ${guidance}` : `${base} (#${code})`;
}

export type ApprovedClinicTemplate = { name: string; language: string; category: string };

export function approvedClinicTemplate(
  db: DatabaseSync | null | undefined,
  tenantId: string,
  kind: string
): ApprovedClinicTemplate | null {
  const spec = clinicTemplateSpec(kind);
  const tenant = String(tenantId || "").trim();
  if (!db || !spec || !tenant) return null;
  try {
    const row = db
      .prepare(
        `SELECT name, language, category FROM meta_templates
         WHERE tenant_id = ? AND name = ? AND UPPER(status) = 'APPROVED'
         ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      )
      .get(tenant, spec.name) as { name?: string; language?: string; category?: string } | undefined;
    const name = String(row?.name || "").trim();
    if (name !== spec.name) return null;
    return {
      name,
      language: String(row?.language || spec.language).trim() || spec.language,
      category: String(row?.category || spec.category).trim() || spec.category,
    };
  } catch {
    return null;
  }
}

type FetchImpl = typeof fetch;

function graphErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { message?: string; error_user_msg?: string } }).error;
    return String(error?.message || error?.error_user_msg || `Graph error (HTTP ${status})`);
  }
  return `Graph request failed (HTTP ${status}).`;
}

function alreadyExists(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("error" in data)) return false;
  const error = (data as { error?: { message?: string; error_user_msg?: string; error_subcode?: number } }).error;
  const text = `${error?.message || ""} ${error?.error_user_msg || ""}`.toLowerCase();
  if (/already exists|duplicate|content in this language/.test(text)) return true;
  return Number(error?.error_subcode) === 2388024;
}

function upsertClinicTemplateRow(
  db: DatabaseSync,
  opts: {
    tenantId: string;
    wabaId: string;
    spec: ClinicTemplateSpec;
    metaTemplateId?: string;
    status?: string;
    rejectionReason?: string | null;
    keepExistingStatus?: boolean;
  }
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id, status, meta_template_id, rejection_reason FROM meta_templates
       WHERE tenant_id = ? AND name = ? AND language = ?`
    )
    .get(opts.tenantId, opts.spec.name, opts.spec.language) as
    | { id: string; status?: string; meta_template_id?: string; rejection_reason?: string | null }
    | undefined;
  const components = JSON.stringify(graphComponentsForClinicTemplate(opts.spec));
  if (!existing) {
    db.prepare(
      `INSERT INTO meta_templates
        (id, tenant_id, waba_id, name, category, language, status, components, meta_template_id, rejection_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `tpl-${crypto.randomUUID()}`,
      opts.tenantId,
      opts.wabaId,
      opts.spec.name,
      opts.spec.category,
      opts.spec.language,
      opts.status || "PENDING",
      components,
      opts.metaTemplateId || "",
      opts.rejectionReason ?? null,
      now,
      now
    );
    return;
  }
  const status = opts.keepExistingStatus
    ? String(existing.status || "PENDING")
    : opts.status || String(existing.status || "PENDING");
  const metaId = opts.metaTemplateId || String(existing.meta_template_id || "");
  const reason =
    opts.rejectionReason !== undefined ? opts.rejectionReason : existing.rejection_reason ?? null;
  db.prepare(
    `UPDATE meta_templates
     SET waba_id = ?, category = ?, status = ?, components = ?, meta_template_id = ?, rejection_reason = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`
  ).run(opts.wabaId, opts.spec.category, status, components, metaId, reason, now, existing.id, opts.tenantId);
}

export type ProvisionResult = {
  recorded: Array<{ name: string; status: "PENDING"; outcome: "created" | "exists" }>;
  failed: Array<{ name: string; error: string }>;
};

/** POST each clinic template. Re-running on reconnect does not fail signup or downgrade APPROVED. */
export async function provisionClinicMessageTemplates(opts: {
  db: DatabaseSync;
  tenantId: string;
  wabaId: string;
  accessToken: string;
  fetchImpl?: FetchImpl;
}): Promise<ProvisionResult> {
  const recorded: ProvisionResult["recorded"] = [];
  const failed: ProvisionResult["failed"] = [];
  const version = graphApiVersion();
  const fetchImpl = opts.fetchImpl || fetch;
  const wabaId = String(opts.wabaId || "").trim();
  const token = String(opts.accessToken || "").trim();
  for (const spec of clinicTemplatesToProvision()) {
    if (!wabaId || !token) {
      failed.push({ name: spec.name, error: "WABA id and business token are required to create templates." });
      continue;
    }
    try {
      const res = await fetchImpl(
        `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: spec.name,
            language: spec.language,
            category: spec.category,
            parameter_format: "POSITIONAL",
            components: graphComponentsForClinicTemplate(spec),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      const metaId = String((data as { id?: string })?.id || "").trim();
      if (res.ok && !(data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error)) {
        upsertClinicTemplateRow(opts.db, {
          tenantId: opts.tenantId,
          wabaId,
          spec,
          metaTemplateId: metaId,
          status: "PENDING",
          rejectionReason: null,
          keepExistingStatus: true,
        });
        recorded.push({ name: spec.name, status: "PENDING", outcome: "created" });
        continue;
      }
      if (alreadyExists(data)) {
        upsertClinicTemplateRow(opts.db, {
          tenantId: opts.tenantId,
          wabaId,
          spec,
          status: "PENDING",
          keepExistingStatus: true,
        });
        recorded.push({ name: spec.name, status: "PENDING", outcome: "exists" });
        continue;
      }
      const error = graphErrorMessage(data, res.status);
      upsertClinicTemplateRow(opts.db, {
        tenantId: opts.tenantId,
        wabaId,
        spec,
        status: "PENDING",
        rejectionReason: error,
        keepExistingStatus: true,
      });
      failed.push({ name: spec.name, error });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Template create failed.";
      failed.push({ name: spec.name, error });
    }
  }
  return { recorded, failed };
}

type GraphTemplateRow = {
  id?: string;
  name?: string;
  status?: string;
  language?: string;
  rejected_reason?: string;
  category?: string;
};

/** GET /{waba}/message_templates and copy status plus rejection reason onto this tenant's rows. */
export async function resyncClinicMessageTemplates(opts: {
  db: DatabaseSync;
  tenantId: string;
  wabaId: string;
  accessToken: string;
  fetchImpl?: FetchImpl;
}): Promise<{ updated: string[] }> {
  const version = graphApiVersion();
  const fetchImpl = opts.fetchImpl || fetch;
  const wabaId = String(opts.wabaId || "").trim();
  const token = String(opts.accessToken || "").trim();
  if (!wabaId || !token) {
    throw Object.assign(new Error("Connect the clinic WhatsApp number before resyncing templates."), { status: 409 });
  }
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates?limit=100&fields=id,name,status,language,rejected_reason,category`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json().catch(() => ({}))) as { data?: GraphTemplateRow[]; error?: { message?: string } };
  if (!res.ok || data.error) {
    throw Object.assign(new Error(graphErrorMessage(data, res.status)), { status: 502 });
  }
  const updated: string[] = [];
  const rows = Array.isArray(data.data) ? data.data : [];
  for (const remote of rows) {
    const name = String(remote.name || "").trim();
    const spec = CATALOG_BY_NAME.get(name);
    if (!spec) continue;
    const language = String(remote.language || spec.language).trim() || spec.language;
    if (language !== spec.language) continue;
    const status = String(remote.status || "PENDING").trim().toUpperCase() || "PENDING";
    const reasonRaw = String(remote.rejected_reason || "").trim();
    const reason = !reasonRaw || reasonRaw.toUpperCase() === "NONE" ? null : reasonRaw;
    upsertClinicTemplateRow(opts.db, {
      tenantId: opts.tenantId,
      wabaId,
      spec,
      metaTemplateId: String(remote.id || "").trim(),
      status,
      rejectionReason: reason,
      keepExistingStatus: false,
    });
    updated.push(name);
  }
  return { updated };
}

function tenantOwnsNumberRow(db: DatabaseSync, tenantId: string): boolean {
  try {
    const row = db
      .prepare(`SELECT id FROM whatsapp_numbers WHERE owner_type = 'tenant' AND owner_id = ? LIMIT 1`)
      .get(tenantId) as { id?: string } | undefined;
    return Boolean(row?.id);
  } catch {
    return false;
  }
}

/** Connected tenant numbers first. tenants.waba_id only when that tenant has no number row. */
export function tenantIdsForWaba(db: DatabaseSync, wabaId: string): string[] {
  const ids = new Set<string>();
  const waba = String(wabaId || "").trim();
  if (!waba) return [];
  try {
    const numbers = db
      .prepare(
        `SELECT owner_id FROM whatsapp_numbers WHERE owner_type = 'tenant' AND status = 'connected' AND waba_id = ?`
      )
      .all(waba) as Array<{ owner_id?: string }>;
    for (const row of numbers) {
      const id = String(row.owner_id || "").trim();
      if (id) ids.add(id);
    }
  } catch {
    /* ownership table missing */
  }
  try {
    const tenants = db.prepare(`SELECT id FROM tenants WHERE waba_id = ?`).all(waba) as Array<{ id?: string }>;
    for (const row of tenants) {
      const id = String(row.id || "").trim();
      if (id && !tenantOwnsNumberRow(db, id)) ids.add(id);
    }
  } catch {
    /* tenants.waba_id missing */
  }
  return [...ids];
}

/**
 * message_template_status_update. UPDATE-ONLY for an existing (tenant, name, language) row.
 * A webhook never inserts a template row.
 */
export function applyMessageTemplateStatusUpdate(
  db: DatabaseSync,
  wabaId: string,
  value: Record<string, unknown> | null | undefined
): number {
  if (!value) return 0;
  const name = String(value.message_template_name || "").trim();
  const spec = CATALOG_BY_NAME.get(name);
  if (!spec) return 0;
  const event = String(value.event || "").trim().toUpperCase();
  if (!event) return 0;
  const language = String(value.message_template_language || spec.language).trim() || spec.language;
  if (language !== spec.language && language !== "hi") return 0;
  const info = value.rejection_info as { reason?: string; recommendation?: string } | undefined;
  const reasonRaw = String(value.reason || info?.reason || info?.recommendation || "").trim();
  const reason = !reasonRaw || reasonRaw.toUpperCase() === "NONE" ? null : reasonRaw;
  const metaId = String(value.message_template_id || "").trim();
  const storedReason = event === "APPROVED" ? null : reason;
  const owners = tenantIdsForWaba(db, wabaId);
  let changes = 0;
  for (const tenantId of owners) {
    const before = db
      .prepare(
        `SELECT id, status, rejection_reason FROM meta_templates WHERE tenant_id = ? AND name = ? AND language = ?`
      )
      .get(tenantId, spec.name, language) as
      | { id?: string; status?: string; rejection_reason?: string | null }
      | undefined;
    if (!before?.id) continue;
    const sameStatus = String(before.status || "").toUpperCase() === event;
    const sameReason = (before.rejection_reason ?? null) === storedReason;
    if (sameStatus && sameReason) continue;
    db.prepare(
      `UPDATE meta_templates
       SET status = ?, rejection_reason = ?, meta_template_id = CASE WHEN ? = '' THEN meta_template_id ELSE ? END,
           waba_id = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(event, storedReason, metaId, metaId, wabaId, new Date().toISOString(), before.id, tenantId);
    changes += 1;
  }
  return changes;
}

export type ClinicTemplateStatusRow = {
  name: string;
  label: string;
  kind: ClinicTemplateKind;
  status: "PENDING" | "APPROVED" | "REJECTED" | "MISSING";
  rejectionReason: string;
  sending: string;
};

function sendingMeaning(status: string, reason: string): string {
  if (status === "APPROVED") {
    return "Approved. This message can be sent even when the patient has not written in the last 24 hours.";
  }
  if (status === "REJECTED") {
    const why = reason ? ` Meta said: ${reason}.` : "";
    return `Rejected.${why} Until a template is approved, this message can go out only as a chat reply within 24 hours of the patient's last message.`;
  }
  if (status === "PENDING") {
    return "Pending Meta review. Until it is approved, this message can go out only as a chat reply within 24 hours of the patient's last message.";
  }
  return "Not created on this WhatsApp account yet. Reconnect to submit it, or resync after it exists in Meta.";
}

function publicStatus(raw: string): ClinicTemplateStatusRow["status"] {
  const status = String(raw || "").trim().toUpperCase();
  if (status === "APPROVED" || status === "REJECTED" || status === "PENDING") return status;
  if (!status) return "MISSING";
  if (status.includes("REJECT")) return "REJECTED";
  return "PENDING";
}

export function listClinicTemplateStatus(db: DatabaseSync, tenantId: string): ClinicTemplateStatusRow[] {
  const tenant = String(tenantId || "").trim();
  const rows = tenant
    ? (db
        .prepare(
          `SELECT name, status, rejection_reason FROM meta_templates WHERE tenant_id = ?`
        )
        .all(tenant) as Array<{ name?: string; status?: string; rejection_reason?: string | null }>)
    : [];
  const byName = new Map(rows.map((row) => [String(row.name || ""), row]));
  return CLINIC_TEMPLATE_CATALOG.flatMap((spec) => {
    const row = byName.get(spec.name);
    if (!row) return [];
    const status = publicStatus(String(row.status || ""));
    const rejectionReason = String(row?.rejection_reason || "").trim();
    return [
      {
        name: spec.name,
        label: spec.label,
        kind: spec.kind,
        status,
        rejectionReason,
        sending: sendingMeaning(status, rejectionReason),
      },
    ];
  });
}

export function latestGraphErrorForTenant(
  db: DatabaseSync,
  tenantId: string
): { code: string; guidance: string; at: string } | null {
  const tenant = String(tenantId || "").trim();
  if (!tenant) return null;
  let rows: Array<{ details?: string; sent_at?: string; status?: string }> = [];
  try {
    rows = db
      .prepare(
        `SELECT details, sent_at, status FROM whatsapp_outbound_events
         WHERE tenant_id = ? AND lower(status) = 'failed'
         ORDER BY sent_at DESC
         LIMIT 20`
      )
      .all(tenant) as typeof rows;
  } catch {
    return null;
  }
  for (const row of rows) {
    const detail = String(row.details || "");
    const match = detail.match(/#(\d{3,6})/);
    const code = match?.[1] || "";
    const guidance = graphErrorGuidance(code);
    if (!guidance) continue;
    return { code, guidance, at: String(row.sent_at || "") };
  }
  return null;
}
