import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  getDb,
  mapAppointment,
  mapConsentArtefact,
  mapPatient,
  mapPrescription,
  PRESCRIPTION_SPECIALTY_KEYS,
  writeAudit,
} from "./db.ts";
import { clinicLine, getTenantLetterhead } from "./letterhead.ts";
import { requireAuth } from "./auth.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { resolveAbdmMode, type AbdmMode } from "./abdm-mode.ts";
import { registerPatientDocumentRoutes } from "./patient-documents.ts";
import { clinicCalendarDate, parseAppointmentListDate } from "../src/lib/clinicDay.ts";
import { denyUnlessPatientRecordRole } from "./patient-access.ts";
import {
  loadPatientClinicPhone,
  loadPatientTenant,
  requestIsPatient,
  sessionPatientId,
} from "./patient-tenant.ts";
import type { PatientTenantExtras } from "./client-serializers.ts";

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function withPatientTenant<T extends Record<string, unknown>>(
  req: Request,
  tenantId: string,
  body: T,
  extras?: PatientTenantExtras
): T & { tenant?: ReturnType<typeof loadPatientTenant> } {
  if (!requestIsPatient(req)) return body;
  return { ...body, tenant: loadPatientTenant(tenantId, extras) };
}

function prescriptionForClient(req: Request, tenantId: string, row: Record<string, unknown>) {
  const mapped = mapPrescription(row);
  if (!requestIsPatient(req)) return mapped;
  const phone = loadPatientClinicPhone(tenantId, mapped.clinicPhone);
  return { ...mapped, clinicPhone: phone || "" };
}

function patientCanRead(req: Request, recordPatientId: unknown): boolean {
  if (!requestIsPatient(req)) return true;
  const own = sessionPatientId(req);
  return Boolean(own) && own === String(recordPatientId || "").trim();
}

function tenantDoctor(tenantId: string, doctorId: string): Record<string, unknown> | undefined {
  if (!doctorId) return undefined;
  return getDb()
    .prepare(
      `SELECT d.* FROM doctors d
       INNER JOIN users u ON u.id = d.user_id
       WHERE d.id = ? AND u.tenant_id = ?`
    )
    .get(doctorId, tenantId) as Record<string, unknown> | undefined;
}

/** Patient booking accepts doctor, date, slot, and type. Fee, status, and source are server-side. */
function patientBookingBody(tenantId: string, ownPatientId: string, body: Record<string, unknown>): Record<string, unknown> {
  const doctorId = String(body.doctorId || body.doctor_id || "").trim();
  const date = String(body.date || "").trim();
  const timeSlot = String(body.timeSlot || body.time_slot || "").trim();
  const type = String(body.type || "New Consultation").trim() || "New Consultation";
  if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeSlot) {
    throw Object.assign(new Error("doctor, date, and time slot are required"), { status: 400 });
  }
  const doctor = tenantDoctor(tenantId, doctorId);
  if (!doctor) {
    throw Object.assign(new Error("Doctor not found"), { status: 404 });
  }
  return {
    patientId: ownPatientId,
    doctorId,
    date,
    timeSlot,
    type,
    consultationFee: Number(doctor.consultation_fee || 0),
    status: "Waiting",
    source: "Portal",
    isPaid: false,
  };
}

const PATIENT_APPOINTMENT_KEYS = new Set(["date", "timeSlot", "time_slot", "status"]);

/** Patients may reschedule (date and/or slot) or cancel. Other fields are rejected. */
function patientAppointmentPatch(body: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(body || {});
  if (keys.length === 0 || keys.some((key) => !PATIENT_APPOINTMENT_KEYS.has(key))) {
    throw Object.assign(new Error("Patients can only reschedule or cancel their own appointment"), { status: 400 });
  }
  const cancelling = body.status !== undefined;
  const rescheduling = body.date !== undefined || body.timeSlot !== undefined || body.time_slot !== undefined;
  if (cancelling && String(body.status) !== "Cancelled") {
    throw Object.assign(new Error("Patients can only cancel an appointment"), { status: 400 });
  }
  if (cancelling && rescheduling) {
    throw Object.assign(new Error("Patients can only reschedule or cancel their own appointment"), { status: 400 });
  }
  if (rescheduling) {
    const next: Record<string, unknown> = {};
    if (body.date !== undefined) {
      const date = String(body.date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw Object.assign(new Error("date must be YYYY-MM-DD"), { status: 400 });
      }
      next.date = date;
    }
    if (body.timeSlot !== undefined || body.time_slot !== undefined) {
      const slot = String(body.timeSlot ?? body.time_slot).trim();
      if (!slot) throw Object.assign(new Error("time slot is required"), { status: 400 });
      next.timeSlot = slot;
    }
    return next;
  }
  return { status: "Cancelled" };
}

function appointmentDoctorExtras(row: Record<string, unknown>): PatientTenantExtras {
  const doctorId = String(row.doctor_id || "").trim();
  const doctor = doctorId
    ? (getDb().prepare("SELECT reg_number FROM doctors WHERE id = ?").get(doctorId) as
        | { reg_number?: string }
        | undefined)
    : undefined;
  return {
    doctorName: String(row.doctor_name || ""),
    doctorRegNumber: String(doctor?.reg_number || ""),
  };
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = tenantIdOf(req);
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

/** Patient must belong to the caller's clinic. Empty id skips the check. */
function requireTenantPatient(tenantId: string, patientId: string, res: Response): boolean {
  const id = String(patientId || "").trim();
  if (!id) return true;
  const row = getDb()
    .prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as { id?: string } | undefined;
  if (!row?.id) {
    res.status(404).json({ error: "Patient not found" });
    return false;
  }
  return true;
}

function jsonText(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function yearToken(prefix: string): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function tenantTimezone(tenantId: string): string {
  const row = getDb().prepare("SELECT timezone FROM tenants WHERE id = ?").get(tenantId) as
    | { timezone?: string }
    | undefined;
  return String(row?.timezone || "IST (UTC+5:30)");
}

function clinicDayForTenant(tenantId: string, now = new Date()): string {
  return clinicCalendarDate(now, tenantTimezone(tenantId));
}

export function listTenantAppointments(tenantId: string, date?: string | null): Record<string, unknown>[] {
  if (date) {
    return getDb()
      .prepare("SELECT * FROM appointments WHERE tenant_id = ? AND date = ? ORDER BY token_number ASC")
      .all(tenantId, date) as Record<string, unknown>[];
  }
  return getDb()
    .prepare("SELECT * FROM appointments WHERE tenant_id = ? ORDER BY token_number ASC")
    .all(tenantId) as Record<string, unknown>[];
}

export function nextTokenNumber(tenantId: string, date: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(token_number), 0) AS max_token
       FROM appointments WHERE tenant_id = ? AND date = ?`
    )
    .get(tenantId, date) as { max_token: number };
  return Number(row?.max_token || 0) + 1;
}

export function getTenantPatient(tenantId: string, id: string) {
  return getDb()
    .prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as Record<string, unknown> | undefined;
}

/** NHA sandbox notice — Platform persists ABHA/consent for the sandbox path only. */
export const ABHA_SANDBOX_NOTICE =
  "ABHA link and consent artefact storage until credentials are provisioned.";

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function phoneMatchKey(phone: string): string {
  const digits = digitsOnly(phone);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * India-first E.164. 10-digit nationals become +91…; numbers that already
 * include a country code keep that prefix. Empty when there are no usable digits.
 */
export function toE164Phone(phone: string): string {
  let digits = digitsOnly(phone);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

/** E.164 when possible. A non-empty phone we cannot normalize is kept so the snapshot is not blank. */
export function canonicalAppointmentPhone(phone: string): string {
  const raw = String(phone || "").trim();
  return toE164Phone(raw) || raw;
}

/** Live patient phone for an appointment row. Falls back to the existing snapshot when the patient has none. */
export function appointmentPhoneFromPatient(tenantId: string, patientId: string, snapshot = ""): string {
  const patient = patientId ? getTenantPatient(tenantId, patientId) : undefined;
  const live = canonicalAppointmentPhone(String(patient?.phone || ""));
  if (live) return live;
  return String(snapshot || "").trim();
}

const CLOSED_APPOINTMENT_STATUSES = `('Completed', 'Cancelled', 'No-Show')`;

export function normalizeAbhaNumber(value: string): string {
  return digitsOnly(value);
}

function readAbhaNumber(body: Record<string, unknown>): string {
  return String(body.abhaNumber || body.abha_number || body.abhaId || body.abha_id || "").trim();
}

function readAbhaAddress(body: Record<string, unknown>): string {
  return String(body.abhaAddress || body.abha_address || "").trim();
}

function readConsentArtefact(body: Record<string, unknown>): Record<string, unknown> | null {
  const raw = body.consentArtefact ?? body.consent_artefact ?? body.consent;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const artefact = raw as Record<string, unknown>;
  const consentId = String(artefact.consentId || artefact.consent_id || "").trim();
  if (!consentId) return null;
  return { ...artefact, consentId };
}

export function findTenantPatientByPhone(tenantId: string, phone: string) {
  const key = phoneMatchKey(phone);
  if (!tenantId || !key) return undefined;
  const exact = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ? AND phone = ?")
    .get(tenantId, String(phone || "").trim()) as Record<string, unknown> | undefined;
  if (exact) return exact;
  const rows = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ?")
    .all(tenantId) as Record<string, unknown>[];
  return rows.find((row) => phoneMatchKey(String(row.phone || "")) === key);
}

/** Name, phone (last-10 digits), UHID, ABHA number, or ABHA address. Empty query matches every row. */
export function patientMatchesQuery(row: Record<string, unknown>, query: string): boolean {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(row.name || "").toLowerCase();
  const uhid = String(row.uhid || "").toLowerCase();
  const abhaAddress = String(row.abha_address || "").toLowerCase();
  const abhaRaw = String(row.abha_number || "");
  const phone = String(row.phone || "");
  if (name.includes(q) || uhid.includes(q) || abhaAddress.includes(q) || abhaRaw.toLowerCase().includes(q)) {
    return true;
  }
  const wantedAbha = normalizeAbhaNumber(q);
  if (wantedAbha.length >= 4 && normalizeAbhaNumber(abhaRaw).includes(wantedAbha)) return true;
  const wantedPhone = phoneMatchKey(q);
  const rowPhone = phoneMatchKey(phone);
  if (wantedPhone.length >= 10 && rowPhone.length >= 10 && rowPhone === wantedPhone) return true;
  if (wantedPhone.length >= 4 && wantedPhone.length < 10 && rowPhone.includes(wantedPhone)) return true;
  return false;
}

function patientRecency(row: Record<string, unknown>): string {
  const last = String(row.last_visit || "").trim();
  const created = String(row.created_at || "").trim();
  return last || created;
}

/** Tenant-scoped patient rows, newest visit first. `query` never crosses tenants. */
export function listTenantPatients(tenantId: string, query = ""): Record<string, unknown>[] {
  if (!tenantId) return [];
  const rows = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ?")
    .all(tenantId) as Record<string, unknown>[];
  const matched = String(query || "").trim() ? rows.filter((row) => patientMatchesQuery(row, query)) : rows;
  matched.sort((a, b) => {
    const byDate = patientRecency(b).localeCompare(patientRecency(a));
    if (byDate !== 0) return byDate;
    return String(a.name || "").localeCompare(String(b.name || ""), "en");
  });
  return matched;
}

export function findTenantPatientByAbha(tenantId: string, abhaNumber?: string, abhaAddress?: string) {
  const digits = normalizeAbhaNumber(abhaNumber || "");
  const address = String(abhaAddress || "").trim().toLowerCase();
  if (!tenantId || (!digits && !address)) return undefined;
  if (abhaNumber) {
    const exact = getDb()
      .prepare("SELECT * FROM patients WHERE tenant_id = ? AND abha_number = ? AND TRIM(abha_number) != ''")
      .get(tenantId, String(abhaNumber).trim()) as Record<string, unknown> | undefined;
    if (exact) return exact;
  }
  if (address) {
    const exactAddr = getDb()
      .prepare("SELECT * FROM patients WHERE tenant_id = ? AND LOWER(TRIM(abha_address)) = ? AND TRIM(abha_address) != ''")
      .get(tenantId, address) as Record<string, unknown> | undefined;
    if (exactAddr) return exactAddr;
  }
  const rows = getDb()
    .prepare("SELECT * FROM patients WHERE tenant_id = ? AND (TRIM(abha_number) != '' OR TRIM(abha_address) != '')")
    .all(tenantId) as Record<string, unknown>[];
  return rows.find((row) => {
    const rowDigits = normalizeAbhaNumber(String(row.abha_number || ""));
    const rowAddr = String(row.abha_address || "").trim().toLowerCase();
    return Boolean((digits && rowDigits && rowDigits === digits) || (address && rowAddr && rowAddr === address));
  });
}

export function listTenantConsentArtefacts(tenantId: string, patientId: string) {
  if (!tenantId || !patientId) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM abdm_consent_artefacts
       WHERE tenant_id = ? AND patient_id = ?
       ORDER BY created_at ASC`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  return rows.map(mapConsentArtefact);
}

function patientWithConsents(row: Record<string, unknown>, tenantId: string) {
  const patient = mapPatient(row);
  return { ...patient, consentArtefacts: listTenantConsentArtefacts(tenantId, patient.id) };
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function errorStatus(err: unknown, fallback = 500): number {
  return typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : fallback;
}

export type ConsentArtefactSource = "gateway_signed" | "staff";

/**
 * Persist an NHA sandbox consent artefact for the ABDM path only.
 * The practice-simple onboard path must not call this.
 * `source` is server-set. A value on the artefact object is discarded.
 */
export function storeConsentArtefact(
  tenantId: string,
  patientId: string,
  artefact: Record<string, unknown>,
  actor?: { id?: string | null; name?: string },
  source: ConsentArtefactSource = "staff"
) {
  const consentId = String(artefact.consentId || artefact.consent_id || "").trim();
  if (!consentId) {
    throw httpError(400, "consentArtefact.consentId is required");
  }
  const patient = getTenantPatient(tenantId, patientId);
  if (!patient) {
    throw httpError(404, "Patient not found");
  }
  const serverSource: ConsentArtefactSource = source === "gateway_signed" ? "gateway_signed" : "staff";
  const supplied = { ...artefact };
  delete supplied.source;
  const now = new Date().toISOString();
  const kind = String(supplied.kind || supplied.artefactKind || "consent").trim() || "consent";
  const payload = JSON.stringify({ ...supplied, consentId, kind, source: serverSource });
  const existing = getDb()
    .prepare("SELECT id FROM abdm_consent_artefacts WHERE tenant_id = ? AND consent_id = ?")
    .get(tenantId, consentId) as { id: string } | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE abdm_consent_artefacts
         SET patient_id = ?, artefact_json = ?, source = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(patientId, payload, serverSource, now, existing.id, tenantId);
  } else {
    getDb()
      .prepare(
        `INSERT INTO abdm_consent_artefacts (
          id, tenant_id, patient_id, consent_id, artefact_json, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(shortId("consent"), tenantId, patientId, consentId, payload, serverSource, now, now);
  }
  writeAudit(
    getDb(),
    actor?.id || null,
    actor?.name || "Clinician",
    "ABHA consent stored",
    `patient ${patientId} consent ${consentId}`
  );
  return listTenantConsentArtefacts(tenantId, patientId);
}

export const KYC_LINKED_SANDBOX = "LINKED_SANDBOX";

const LINK_SOURCES = new Set(["aadhaar_otp", "abha_search", "qr"]);

export function rejectUnlockedKyc(body: Record<string, unknown>) {
  const kyc = String(body.kycStatus || body.kyc_status || "");
  if (/^verified$/i.test(kyc) || /government|unlocked/i.test(kyc)) {
    throw httpError(400, "kycStatus must be LINKED_SANDBOX");
  }
}

function ageFromDob(dob: string): number | undefined {
  const raw = String(dob || "").trim();
  if (!raw) return undefined;
  const born = new Date(raw);
  if (Number.isNaN(born.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : undefined;
}

function flattenLinkBody(body: Record<string, unknown>): Record<string, unknown> {
  const demo =
    body.demographics && typeof body.demographics === "object" && !Array.isArray(body.demographics)
      ? (body.demographics as Record<string, unknown>)
      : {};
  const dob = String(body.dob || demo.dob || "");
  const pincode = String(body.pincode || demo.pincode || "").trim();
  const address = String(body.address || demo.address || "").trim();
  return {
    ...body,
    name: body.name || demo.name,
    gender: body.gender || demo.gender,
    dob,
    pincode,
    address: pincode && address && !address.includes(pincode) ? `${address} ${pincode}`.trim() : address,
    phone: body.phone || demo.mobile || demo.phone,
    age: body.age ?? demo.age ?? ageFromDob(dob),
  };
}

function applyAbhaFields(
  tenantId: string,
  patientId: string,
  fields: {
    abhaNumber?: string;
    abhaAddress?: string;
    hfrId?: string;
  }
) {
  const existing = getTenantPatient(tenantId, patientId);
  if (!existing) {
    throw httpError(404, "Patient not found");
  }
  const mapped = mapPatient(existing);
  const abhaNumber = String(fields.abhaNumber || mapped.abhaNumber || "").trim();
  const abhaAddress = String(fields.abhaAddress || mapped.abhaAddress || "").trim();
  const hfrId = String(fields.hfrId || mapped.hfrId || "").trim();
  const alreadyLinked = String(existing.abha_linked_at || mapped.abhaLinkedAt || "").trim();
  const abhaLinkedAt = alreadyLinked || (abhaNumber || abhaAddress ? new Date().toISOString() : "");
  getDb()
    .prepare(
      `UPDATE patients
       SET abha_number = ?, abha_address = ?, kyc_status = ?,
           hfr_id = COALESCE(NULLIF(?, ''), NULLIF(hfr_id, ''), ''),
           abha_linked_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .run(abhaNumber, abhaAddress, KYC_LINKED_SANDBOX, hfrId, abhaLinkedAt, patientId, tenantId);
  return getTenantPatient(tenantId, patientId)!;
}

function enrichPatientDemographics(tenantId: string, patientId: string, body: Record<string, unknown>) {
  const existing = getTenantPatient(tenantId, patientId);
  if (!existing) return;
  const mapped = mapPatient(existing);
  const name = String(body.name || mapped.name).trim() || mapped.name;
  const age = body.age !== undefined && body.age !== null && body.age !== "" ? Number(body.age) : mapped.age;
  const gender = body.gender !== undefined ? String(body.gender) : mapped.gender;
  const email = body.email !== undefined ? String(body.email) : mapped.email;
  const address = body.address !== undefined ? String(body.address) : mapped.address;
  getDb()
    .prepare(
      `UPDATE patients SET name = ?, age = ?, gender = ?, email = ?, address = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .run(name, Number(age || 0), String(gender || "Other"), String(email || ""), String(address || ""), patientId, tenantId);
}

function resolveExistingPatient(
  tenantId: string,
  body: Record<string, unknown>,
  options?: { patientId?: string }
): Record<string, unknown> | undefined {
  const abhaNumber = readAbhaNumber(body);
  const abhaAddress = readAbhaAddress(body);
  const phone = String(body.phone || "").trim();
  const byId = options?.patientId ? getTenantPatient(tenantId, options.patientId) : undefined;
  if (options?.patientId && !byId) {
    throw httpError(404, "Patient not found");
  }
  const byAbha = findTenantPatientByAbha(tenantId, abhaNumber, abhaAddress);
  const byPhone = phone ? findTenantPatientByPhone(tenantId, phone) : undefined;
  const matches = [byId, byAbha, byPhone].filter(Boolean) as Record<string, unknown>[];
  const ids = new Set(matches.map((row) => String(row.id)));
  if (ids.size > 1) {
    throw httpError(409, "Phone and ABHA resolve to different patients in this tenant");
  }
  return matches[0];
}

export function getTenantAppointment(tenantId: string, id: string) {
  return getDb()
    .prepare("SELECT * FROM appointments WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as Record<string, unknown> | undefined;
}

function getTenantPrescription(tenantId: string, id: string) {
  return getDb()
    .prepare("SELECT * FROM prescriptions WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as Record<string, unknown> | undefined;
}

function uniqueUhid(): string {
  for (let i = 0; i < 4; i++) {
    const candidate = yearToken("LUM");
    const taken = getDb().prepare("SELECT id FROM patients WHERE uhid = ?").get(candidate);
    if (!taken) return candidate;
  }
  return yearToken("LUM");
}

function getDoctorById(id: string) {
  if (!id) return undefined;
  return getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
}

function uniqueRxNumber(requested?: string): string {
  const candidate = String(requested || "").trim() || yearToken("RX");
  const taken = getDb().prepare("SELECT id FROM prescriptions WHERE rx_number = ?").get(candidate);
  if (!taken) return candidate;
  return yearToken("RX");
}

const RX_NOTE_KEYS = [
  "historyOfPresentIllness",
  "pastMedicalHistory",
  "reviewOfSystems",
  "physicalExamination",
  "clinicalFindings",
  "differentialDiagnoses",
  "riskLevel",
  "redFlags",
  "followUpDays",
  "aiSource",
  "aiGeneratedAt",
  "transcriptHash",
  "transcriptSummary",
  "ambientRecordingDurationSec",
  "reviewedBy",
  "aiAcknowledged",
  "pendingAiFields",
] as const;

function specialtyModulesFromBody(body: Record<string, unknown>): string {
  const modules: Record<string, unknown> = {};
  for (const key of PRESCRIPTION_SPECIALTY_KEYS) {
    if (body[key] !== undefined) modules[key] = body[key];
  }
  for (const key of RX_NOTE_KEYS) {
    if (body[key] !== undefined) modules[key] = body[key];
  }
  if (body.specialtyModules && typeof body.specialtyModules === "object") {
    Object.assign(modules, body.specialtyModules as Record<string, unknown>);
  }
  return JSON.stringify(modules);
}

/** AI drafts cannot be finalized until a clinician records reviewedBy. Nothing is auto-signed. */
function assertReviewedAiPrescription(body: Record<string, unknown>) {
  const aiSource = String(body.aiSource || "").trim();
  const aiGeneratedAt = String(body.aiGeneratedAt || "").trim();
  if (!aiSource && !aiGeneratedAt) return;
  const reviewedBy = String(body.reviewedBy || "").trim();
  if (!reviewedBy) {
    throw Object.assign(new Error("Finalize requires reviewedBy after an AI draft"), { status: 400 });
  }
}

/**
 * Privacy policy data minimization: persist a SHA-256 of the consult transcript,
 * not the raw transcript, inside prescription_drafts.draft_json.
 */
function scrubDraftForStorage(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  const transcript = typeof next.transcript === "string" ? next.transcript : "";
  if (transcript.trim() && !String(next.transcriptHash || "").trim()) {
    next.transcriptHash = createHash("sha256").update(transcript).digest("hex");
  }
  delete next.transcript;
  return next;
}

export function insertPatient(
  tenantId: string,
  body: Record<string, unknown>,
  options?: { allowAbha?: boolean }
) {
  rejectUnlockedKyc(body);
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const allowAbha = Boolean(options?.allowAbha);
  const abhaNumber = allowAbha ? readAbhaNumber(body) : "";
  const abhaAddress = allowAbha ? readAbhaAddress(body) : "";
  const existing = findTenantPatientByPhone(tenantId, phone);
  if (existing) {
    const existingId = String(existing.id);
    enrichPatientDemographics(tenantId, existingId, body);
    if (allowAbha && (abhaNumber || abhaAddress)) {
      const other = findTenantPatientByAbha(tenantId, abhaNumber, abhaAddress);
      if (other && String(other.id) !== existingId) {
        throw httpError(409, "Phone and ABHA resolve to different patients in this tenant");
      }
      applyAbhaFields(tenantId, existingId, { abhaNumber, abhaAddress });
    }
    const reused = getTenantPatient(tenantId, existingId)!;
    (reused as Record<string, unknown>).__reused = true;
    return reused;
  }
  if (allowAbha && (abhaNumber || abhaAddress)) {
    const byAbha = findTenantPatientByAbha(tenantId, abhaNumber, abhaAddress);
    if (byAbha) {
      enrichPatientDemographics(tenantId, String(byAbha.id), body);
      applyAbhaFields(tenantId, String(byAbha.id), { abhaNumber, abhaAddress });
      const reused = getTenantPatient(tenantId, String(byAbha.id))!;
      (reused as Record<string, unknown>).__reused = true;
      return reused;
    }
  }
  if (!name || !phone) {
    throw httpError(400, "name and phone are required");
  }
  const id = shortId("pat");
  const uhid = uniqueUhid();
  const now = new Date().toISOString();
  const lastVisit = body.lastVisit ? String(body.lastVisit) : now.slice(0, 10);
  const kycStatus = allowAbha && (abhaNumber || abhaAddress) ? KYC_LINKED_SANDBOX : "PENDING";
  const abhaLinkedAt = allowAbha && (abhaNumber || abhaAddress) ? now : "";
  try {
    getDb()
      .prepare(
        `INSERT INTO patients (
          id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies,
          chronic_conditions, emergency_contact, address, last_visit, created_at,
          abha_number, abha_address, kyc_status, hfr_id, abha_linked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        uhid,
        name,
        Number(body.age || 0),
        String(body.gender || "Other"),
        phone,
        String(body.email || ""),
        String(body.bloodGroup || body.blood_group || "O+"),
        jsonText(body.allergies, "[]"),
        jsonText(body.chronicConditions ?? body.chronic_conditions, "[]"),
        String(body.emergencyContact || body.emergency_contact || phone),
        String(body.address || ""),
        lastVisit,
        now,
        abhaNumber,
        abhaAddress,
        kycStatus,
        String(body.hfrId || body.hfr_id || ""),
        abhaLinkedAt
      );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(message)) {
      const raced = findTenantPatientByPhone(tenantId, phone);
      if (raced) {
        (raced as Record<string, unknown>).__reused = true;
        return raced;
      }
      throw httpError(409, "A patient with this phone or ABHA already exists");
    }
    throw err;
  }
  return getTenantPatient(tenantId, id)!;
}

function parseLinkSource(body: Record<string, unknown>): string {
  const source = String(body.source || "aadhaar_otp").trim();
  if (!LINK_SOURCES.has(source)) {
    throw httpError(400, "source must be aadhaar_otp, abha_search, or qr");
  }
  return source;
}

function parseLinkAbdmMode(body: Record<string, unknown>): AbdmMode {
  const requested = String(body.abdmMode || resolveAbdmMode()).trim();
  if (requested !== "stub" && requested !== "sandbox") {
    throw httpError(400, "abdmMode must be stub or sandbox");
  }
  return requested;
}

/**
 * POST /api/patients/link-abha — frozen #35 field names.
 * NHA sandbox attach/find-or-create. Never a second EMR row for tenant+phone
 * or tenant+abhaNumber. Practice-simple POST /patients must not call this.
 */
export function linkPatientAbha(
  tenantId: string,
  body: Record<string, unknown>,
  actor?: { id?: string | null; name?: string }
) {
  rejectUnlockedKyc(body);
  const flat = flattenLinkBody(body);
  const patientId = String(flat.patientId || "").trim();
  const abhaNumber = readAbhaNumber(flat);
  const abhaAddress = readAbhaAddress(flat);
  const consent = readConsentArtefact(flat);
  const source = parseLinkSource(flat);
  const abdmMode = parseLinkAbdmMode(flat);
  if (!abhaNumber) {
    throw httpError(400, "abhaNumber is required");
  }
  if (patientId && !getTenantPatient(tenantId, patientId)) {
    throw httpError(403, "Patient not found");
  }
  let row: Record<string, unknown>;
  try {
    row = resolveExistingPatient(tenantId, flat, patientId ? { patientId } : undefined) as Record<string, unknown>;
  } catch (err: unknown) {
    if (errorStatus(err, 0) === 404 && patientId) {
      throw httpError(403, "Patient not found");
    }
    throw err;
  }
  if (!row) {
    const name = String(flat.name || "").trim();
    const phone = String(flat.phone || "").trim();
    if (!name || !phone) {
      throw httpError(404, "Patient not found");
    }
    row = insertPatient(tenantId, flat, { allowAbha: true });
  } else {
    enrichPatientDemographics(tenantId, String(row.id), flat);
  }
  const id = String(row.id);
  applyAbhaFields(tenantId, id, { abhaNumber, abhaAddress });
  if (consent) {
    storeConsentArtefact(tenantId, id, consent, actor);
  }
  const mapped = mapPatient(getTenantPatient(tenantId, id)!);
  writeAudit(
    getDb(),
    actor?.id || null,
    actor?.name || "Clinician",
    "ABHA linked",
    `patient ${id} ABHA ${mapped.abhaNumber} source ${source} mode ${abdmMode}`
  );
  return {
    abdmMode,
    source,
    row: getTenantPatient(tenantId, id)!,
  };
}

export function insertAppointment(tenantId: string, body: Record<string, unknown>, actor?: { id?: string; name?: string }) {
  const patientId = String(body.patientId || body.patient_id || "").trim();
  if (!patientId) {
    throw Object.assign(new Error("patientId is required"), { status: 400 });
  }
  const patient = getTenantPatient(tenantId, patientId);
  if (!patient) {
    throw Object.assign(new Error("Patient not found"), { status: 404 });
  }
  const mappedPatient = mapPatient(patient);
  const requestedDate = String(body.date || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : clinicDayForTenant(tenantId);
  const tokenNumber =
    body.tokenNumber !== undefined && body.tokenNumber !== null
      ? Number(body.tokenNumber)
      : body.token_number !== undefined && body.token_number !== null
        ? Number(body.token_number)
        : nextTokenNumber(tenantId, date);
  const id = String(body.id || "").trim() || shortId("apt");
  const existing = getDb().prepare("SELECT id FROM appointments WHERE id = ?").get(id);
  if (existing) {
    throw Object.assign(new Error("Appointment id already exists"), { status: 409 });
  }
  const doctorId = String(body.doctorId || body.doctor_id || actor?.id || "");
  const doctor = getDoctorById(doctorId);
  const now = new Date().toISOString();
  const vitals = body.vitals == null ? null : jsonText(body.vitals, "null");
  const patientPhone = canonicalAppointmentPhone(String(mappedPatient.phone || ""));
  getDb()
    .prepare(
      `INSERT INTO appointments (
        id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
        doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
        consultation_fee, is_paid, vitals, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      tokenNumber,
      mappedPatient.id,
      mappedPatient.name,
      patientPhone,
      mappedPatient.uhid,
      doctorId,
      String(body.doctorName || body.doctor_name || doctor?.name || actor?.name || ""),
      String(body.specialty || doctor?.specialty || "General Medicine"),
      date,
      String(body.timeSlot || body.time_slot || ""),
      String(body.type || "New Consultation"),
      String(body.status || "Waiting"),
      String(body.source || "Walk-in"),
      Number(body.consultationFee ?? body.consultation_fee ?? 0),
      body.isPaid === false || body.is_paid === 0 || body.is_paid === false ? 0 : body.isPaid || body.is_paid ? 1 : 0,
      vitals,
      now
    );
  getDb()
    .prepare("UPDATE patients SET last_visit = ? WHERE id = ? AND tenant_id = ?")
    .run(date, mappedPatient.id, tenantId);
  return getTenantAppointment(tenantId, id)!;
}

export function updateAppointment(
  tenantId: string,
  appointmentId: string,
  body: Record<string, unknown>,
  actor?: { id?: string | null; name?: string }
): Record<string, unknown> {
  const existing = getTenantAppointment(tenantId, appointmentId);
  if (!existing) {
    throw Object.assign(new Error("Appointment not found"), { status: 404 });
  }
  const mapped = mapAppointment(existing);
  const status = body.status !== undefined ? String(body.status) : mapped.status;
  const tokenNumber =
    body.tokenNumber !== undefined
      ? Number(body.tokenNumber)
      : body.token_number !== undefined
        ? Number(body.token_number)
        : mapped.tokenNumber;
  let vitalsText: string | null;
  if (body.vitals === null) {
    vitalsText = null;
  } else if (body.vitals !== undefined) {
    vitalsText = jsonText(body.vitals, "null");
  } else {
    vitalsText = existing.vitals == null ? null : String(existing.vitals);
  }
  const isPaid =
    body.isPaid !== undefined
      ? body.isPaid
        ? 1
        : 0
      : body.is_paid !== undefined
        ? body.is_paid
          ? 1
          : 0
        : existing.is_paid;
  const patientPhone = appointmentPhoneFromPatient(
    tenantId,
    String(existing.patient_id || mapped.patientId || ""),
    String(existing.patient_phone || "")
  );
  getDb()
    .prepare(
      `UPDATE appointments SET
        status = ?, token_number = ?, vitals = ?, is_paid = ?,
        type = ?, time_slot = ?, date = ?, doctor_id = ?, doctor_name = ?, specialty = ?,
        patient_phone = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .run(
      status,
      tokenNumber,
      vitalsText,
      Number(isPaid),
      String(body.type ?? mapped.type),
      String(body.timeSlot ?? body.time_slot ?? mapped.timeSlot),
      String(body.date ?? mapped.date),
      String(body.doctorId ?? body.doctor_id ?? mapped.doctorId),
      String(body.doctorName ?? body.doctor_name ?? mapped.doctorName),
      String(body.specialty ?? mapped.specialty),
      patientPhone,
      appointmentId,
      tenantId
    );
  if (body.status !== undefined && (status === "Completed" || status === "Cancelled")) {
    deletePrescriptionDraft({
      tenantId,
      patientId: String(existing.patient_id || mapped.patientId || ""),
      appointmentId,
      actorId: actor?.id || null,
      actorName: actor?.name || "Clinician",
      reason: status,
    });
  }
  return getTenantAppointment(tenantId, appointmentId)!;
}

function draftAppointmentId(body: Record<string, unknown>): string {
  return String(body.appointmentId || body.appointment_id || "").trim();
}

function tenantDoctorRow(tenantId: string, doctorId: string): { id?: string } | undefined {
  if (!doctorId) return undefined;
  return getDb()
    .prepare(
      `SELECT d.id
       FROM doctors d
       INNER JOIN users u ON u.id = d.user_id
       WHERE d.id = ? AND u.tenant_id = ?`
    )
    .get(doctorId, tenantId) as { id?: string } | undefined;
}

/** The visit on this draft must belong to the same patient. */
function draftAppointmentMatchesPatient(tenantId: string, patientId: string, appointmentId: string): boolean {
  if (!appointmentId) return true;
  const apt = getDb()
    .prepare("SELECT patient_id FROM appointments WHERE id = ? AND tenant_id = ?")
    .get(appointmentId, tenantId) as { patient_id?: string } | undefined;
  return Boolean(apt && String(apt.patient_id || "") === patientId);
}

function doctorIdForDraft(req: Request, tenantId: string, body: Record<string, unknown>): string {
  if (String(req.user?.role || "") === "doctor") {
    const linked = getDb()
      .prepare(
        `SELECT d.id
         FROM doctors d
         INNER JOIN users u ON u.id = d.user_id
         WHERE u.id = ? AND u.tenant_id = ?`
      )
      .get(String(req.user?.id || ""), tenantId) as { id?: string } | undefined;
    if (linked?.id) return String(linked.id);
    const userId = String(req.user?.id || "").trim();
    if (!userId) {
      throw Object.assign(new Error("Consulting doctor is not in this clinic"), { status: 400 });
    }
    return userId;
  }
  const id = String(body.doctorId || body.doctor_id || "").trim();
  const row = tenantDoctorRow(tenantId, id);
  if (!row?.id) {
    throw Object.assign(new Error("Consulting doctor is not in this clinic"), { status: 400 });
  }
  return String(row.id);
}

/**
 * Signing omits the visit id sometimes. Use a same-patient appointment from the
 * body, otherwise the open consultation, otherwise the draft's own visit.
 */
function appointmentIdForSignedDraft(tenantId: string, patientId: string, body: Record<string, unknown>): string {
  const requested = draftAppointmentId(body);
  if (requested) {
    return draftAppointmentMatchesPatient(tenantId, patientId, requested) ? requested : "";
  }
  const inConsult = getDb()
    .prepare(
      `SELECT id FROM appointments
       WHERE tenant_id = ? AND patient_id = ? AND status = 'In Consultation'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tenantId, patientId) as { id?: string } | undefined;
  if (inConsult?.id) return String(inConsult.id);
  const drafted = getDb()
    .prepare(
      `SELECT appointment_id FROM prescription_drafts
       WHERE tenant_id = ? AND patient_id = ? AND appointment_id != ''
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(tenantId, patientId) as { appointment_id?: string } | undefined;
  const fromDraft = String(drafted?.appointment_id || "").trim();
  if (fromDraft && draftAppointmentMatchesPatient(tenantId, patientId, fromDraft)) return fromDraft;
  return "";
}

function deletePrescriptionDraft(input: {
  tenantId: string;
  patientId: string;
  appointmentId: string;
  actorId: string | null;
  actorName: string;
  reason: string;
}): void {
  const tenantId = input.tenantId;
  let patientId = String(input.patientId || "").trim();
  const visitId = String(input.appointmentId || "").trim();
  if (!patientId && visitId) {
    const apt = getDb()
      .prepare("SELECT patient_id FROM appointments WHERE id = ? AND tenant_id = ?")
      .get(visitId, tenantId) as { patient_id?: string } | undefined;
    patientId = String(apt?.patient_id || "").trim();
  }
  if (!patientId) return;
  getDb()
    .prepare("DELETE FROM prescription_drafts WHERE tenant_id = ? AND patient_id = ? AND appointment_id = ?")
    .run(tenantId, patientId, visitId);
  writeAudit(
    getDb(),
    input.actorId,
    input.actorName || "Clinician",
    "Prescription draft deleted",
    `tenant ${tenantId}; patient ${patientId}; appointment ${visitId}; reason ${input.reason}`
  );
}

function insertPrescription(tenantId: string, body: Record<string, unknown>) {
  assertReviewedAiPrescription(body);
  const patientId = String(body.patientId || body.patient_id || "").trim();
  const diagnosis = String(body.diagnosis || "").trim();
  if (!patientId) {
    throw Object.assign(new Error("patientId is required"), { status: 400 });
  }
  if (!diagnosis) {
    throw Object.assign(new Error("diagnosis is required"), { status: 400 });
  }
  const patient = getTenantPatient(tenantId, patientId);
  if (!patient) {
    throw Object.assign(new Error("Patient not found"), { status: 404 });
  }
  const mappedPatient = mapPatient(patient);
  const id = shortId("rx");
  const rxNumber = uniqueRxNumber(String(body.rxNumber || body.rx_number || ""));
  const now = new Date().toISOString();
  const date = String(body.date || now.slice(0, 10));
  const letterhead = getTenantLetterhead(tenantId);
  const stamped = clinicLine(letterhead);
  getDb()
    .prepare(
      `INSERT INTO prescriptions (
        id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
        patient_age, patient_gender, doctor_id, doctor_name, doctor_specialty, doctor_reg_number,
        date, diagnosis, icd10_code, chief_complaints, medicines, lab_tests, advice,
        diet_instructions, follow_up_date, pdf_url, created_at, vitals, clinic_name,
        clinic_address, clinic_phone, qr_verification_url, whatsapp_sent_status,
        specialty_type, specialty_modules
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      rxNumber,
      mappedPatient.id,
      String(body.patientName || mappedPatient.name),
      String(body.patientPhone || mappedPatient.phone),
      String(body.patientUhid || mappedPatient.uhid),
      Number(body.patientAge ?? mappedPatient.age ?? 0),
      String(body.patientGender || mappedPatient.gender || ""),
      String(body.doctorId || body.doctor_id || ""),
      String(body.doctorName || body.doctor_name || ""),
      String(body.doctorSpecialty || body.doctor_specialty || ""),
      String(body.doctorRegNumber || body.doctor_reg_number || ""),
      date,
      diagnosis,
      body.icd10Code || body.icd10_code ? String(body.icd10Code || body.icd10_code) : null,
      jsonText(body.chiefComplaints ?? body.chief_complaints, "[]"),
      jsonText(body.medicines, "[]"),
      jsonText(body.labTests ?? body.lab_tests, "[]"),
      jsonText(body.advice, "[]"),
      body.dietInstructions || body.diet_instructions ? String(body.dietInstructions || body.diet_instructions) : null,
      String(body.followUpDate || body.follow_up_date || ""),
      String(body.pdfUrl || body.pdf_url || `/api/emr/prescription/${id}/pdf`),
      now,
      body.vitals == null ? null : jsonText(body.vitals, "null"),
      String(body.clinicName || body.clinic_name || stamped.name || ""),
      String(body.clinicAddress || body.clinic_address || stamped.address || ""),
      String(body.clinicPhone || body.clinic_phone || stamped.phone || ""),
      String(body.qrVerificationUrl || body.qr_verification_url || `https://lumera.health/rx/${rxNumber}`),
      String(body.whatsappSentStatus || body.whatsapp_sent_status || "unsent"),
      String(body.specialtyType || body.specialty_type || ""),
      specialtyModulesFromBody(body)
    );
  return getTenantPrescription(tenantId, id)!;
}

/**
 * Wave 1A + #35 freeze (patient / appointment). Auth = requireAuth.
 * Tenant = req.user.tenantId.
 *
 * GET  /patients              → { patients: Patient[] }
 *   ?q= name | phone | UHID | ABHA number | ABHA address, tenant-scoped
 * GET  /patients/:id/chart    → { patient, visits, prescriptions } same tenant only
 * GET/POST /patients/:id/documents → private files, same tenant only
 * POST /patients              → { patient }  practice-simple; phone-idempotent per tenant
 *   Does not invent ABDM consent or ABHA KYC.
 * POST /patients/link-abha    → { patient, abdmMode }  frozen #35 field names
 *   body { patientId?, phone?, abhaNumber, abhaAddress?, demographics?,
 *          consentArtefact?, source, abdmMode }
 *   kycStatus is always LINKED_SANDBOX (NHA sandbox)
 * PATCH /patients/:id         → { patient }  partial
 * PATCH /patients/:id/abha    → same as link-abha for an existing id
 *
 * GET  /appointments          → { appointments: Appointment[] } (tokenNumber, status, vitals)
 *   ?date=YYYY-MM-DD | today  tenant-scoped clinic day. Omit date for full history.
 * POST /appointments          → { appointment }  body { patientId, doctorId, date, timeSlot, type?, source? }
 *   server fills names/uhid/phone, next tokenNumber, default status Waiting
 * PATCH /appointments/:id     → { appointment }  body { status?, tokenNumber?, vitals?, isPaid? }
 *
 * Prescriptions CRUD is owned by Platform #13 — do not expand here.
 */
export function createClinicalRouter(): Router {
  const api = Router();

  api.get("/patients", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ patients: [] });
      const q = String(req.query.q ?? req.query.search ?? "");
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 0;
      const rows = listTenantPatients(tenantId, q);
      const page = limit ? rows.slice(0, limit) : rows;
      res.json({ patients: page.map(mapPatient) });
    } catch (err) {
      reportCaughtError(err, "clinical.listPatients");
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  api.get("/patients/:id/chart", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = getTenantPatient(tenantId, req.params.id);
      if (!row || !patientCanRead(req, row.id)) return res.status(404).json({ error: "Patient not found" });
      const visits = getDb()
        .prepare(
          `SELECT * FROM appointments
           WHERE tenant_id = ? AND patient_id = ?
           ORDER BY date DESC, time_slot DESC`
        )
        .all(tenantId, req.params.id) as Record<string, unknown>[];
      const prescriptions = getDb()
        .prepare(
          `SELECT * FROM prescriptions
           WHERE tenant_id = ? AND patient_id = ?
           ORDER BY date DESC, created_at DESC`
        )
        .all(tenantId, req.params.id) as Record<string, unknown>[];
      res.json(
        withPatientTenant(req, tenantId, {
          patient: patientWithConsents(row, tenantId),
          visits: visits.map(mapAppointment),
          prescriptions: prescriptions.map((prescription) => prescriptionForClient(req, tenantId, prescription)),
        })
      );
    } catch (err) {
      reportCaughtError(err, "clinical.patientChart");
      res.status(500).json({ error: "Failed to fetch patient chart" });
    }
  });

  api.get("/patients/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantPatient(tenantId, req.params.id);
    if (!row || !patientCanRead(req, row.id)) return res.status(404).json({ error: "Patient not found" });
    res.json({ patient: patientWithConsents(row, tenantId) });
  });

  api.post("/patients", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const incoming = { ...(req.body || {}) } as Record<string, unknown>;
      delete incoming.abhaNumber;
      delete incoming.abha_number;
      delete incoming.abhaId;
      delete incoming.abha_id;
      delete incoming.abhaAddress;
      delete incoming.abha_address;
      delete incoming.consentArtefact;
      delete incoming.consent_artefact;
      delete incoming.consent;
      const row = insertPatient(tenantId, incoming);
      const reused = Boolean((row as Record<string, unknown>).__reused);
      if (!reused) {
        writeAudit(getDb(), req.user?.id || null, req.user?.name || "Clinician", "Patient created", mapPatient(row).name);
      }
      res.status(reused ? 200 : 201).json({ patient: mapPatient(getTenantPatient(tenantId, String(row.id))!) });
    } catch (err: unknown) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to create patient";
      res.status(status || 500).json({ error: message });
    }
  });

  api.post("/patients/link-abha", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const linked = linkPatientAbha(tenantId, req.body || {}, { id: req.user?.id, name: req.user?.name });
      const patient = patientWithConsents(linked.row, tenantId);
      res.json({
        patient,
        abdmMode: linked.abdmMode,
        sandboxNotice: ABHA_SANDBOX_NOTICE,
      });
    } catch (err: unknown) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to link ABHA";
      res.status(status || 500).json({ error: message });
    }
  });

  api.patch("/patients/:id/abha", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const linked = linkPatientAbha(
        tenantId,
        { ...(req.body || {}), patientId: req.params.id },
        { id: req.user?.id, name: req.user?.name }
      );
      const patient = patientWithConsents(linked.row, tenantId);
      res.json({
        success: true,
        patient,
        id: patient.id,
        abhaNumber: patient.abhaNumber,
        abhaAddress: patient.abhaAddress,
        kycStatus: patient.kycStatus,
        abdmMode: linked.abdmMode,
        sandboxNotice: ABHA_SANDBOX_NOTICE,
      });
    } catch (err: unknown) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to update ABHA details";
      res.status(status || 500).json({ error: message });
    }
  });

  api.patch("/patients/:id", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const existing = getTenantPatient(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Patient not found" });
    try {
      rejectUnlockedKyc((req.body || {}) as Record<string, unknown>);
    } catch (err: unknown) {
      const status = errorStatus(err);
      return res.status(status || 400).json({ error: err instanceof Error ? err.message : "Invalid KYC status" });
    }
    const mapped = mapPatient(existing);
    const next = { ...mapped, ...req.body };
    getDb()
      .prepare(
        `UPDATE patients SET
          name = ?, age = ?, gender = ?, phone = ?, email = ?, blood_group = ?,
          allergies = ?, chronic_conditions = ?, emergency_contact = ?, address = ?,
          last_visit = ?, abha_number = ?, abha_address = ?, kyc_status = ?, hfr_id = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(
        String(next.name),
        Number(next.age || 0),
        String(next.gender || "Other"),
        String(next.phone),
        String(next.email || ""),
        String(next.bloodGroup || ""),
        jsonText(next.allergies, "[]"),
        jsonText(next.chronicConditions, "[]"),
        String(next.emergencyContact || ""),
        String(next.address || ""),
        next.lastVisit || mapped.lastVisit || null,
        String(next.abhaNumber || ""),
        String(next.abhaAddress || ""),
        String(next.kycStatus || "PENDING"),
        String(next.hfrId || ""),
        req.params.id,
        tenantId
      );
    const syncedPhone = canonicalAppointmentPhone(String(next.phone || ""));
    if (syncedPhone) {
      getDb()
        .prepare(
          `UPDATE appointments SET patient_phone = ?
           WHERE tenant_id = ? AND patient_id = ? AND status NOT IN ${CLOSED_APPOINTMENT_STATUSES}`
        )
        .run(syncedPhone, tenantId, req.params.id);
    }
    res.json({ patient: mapPatient(getTenantPatient(tenantId, req.params.id)!) });
  });

  api.get("/appointments", requireAuth, (req, res) => {
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ appointments: [] });
      const parsed = parseAppointmentListDate(req.query.date);
      const date = parsed.kind === "all" ? null : parsed.kind === "today" ? clinicDayForTenant(tenantId) : parsed.date;
      const ownPatientId = requestIsPatient(req) ? sessionPatientId(req) : null;
      const rows = listTenantAppointments(tenantId, date).filter((row) => {
        if (!requestIsPatient(req)) return true;
        return Boolean(ownPatientId) && ownPatientId === String(row.patient_id || "");
      });
      const appointments = rows.map(mapAppointment);
      res.json(withPatientTenant(req, tenantId, date ? { appointments, date } : { appointments }));
    } catch (err) {
      const status = errorStatus(err);
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: err instanceof Error ? err.message : "Invalid date" });
      }
      reportCaughtError(err, "clinical.listAppointments");
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  api.get("/appointments/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantAppointment(tenantId, req.params.id);
    if (!row || !patientCanRead(req, row.patient_id)) return res.status(404).json({ error: "Appointment not found" });
    res.json(
      withPatientTenant(req, tenantId, { appointment: mapAppointment(row) }, appointmentDoctorExtras(row))
    );
  });

  api.post("/appointments", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    if (requestIsPatient(req)) {
      const own = sessionPatientId(req);
      const body = (req.body || {}) as Record<string, unknown>;
      const requested = String(body.patientId || body.patient_id || "").trim();
      if (!own || (requested && requested !== own)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      try {
        req.body = patientBookingBody(tenantId, own, body);
      } catch (err: unknown) {
        const status = errorStatus(err);
        const message = err instanceof Error ? err.message : "Failed to create appointment";
        return res.status(status || 400).json({ error: message });
      }
    }
    try {
      const row = insertAppointment(tenantId, req.body || {}, { id: req.user?.id, name: req.user?.name });
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Clinician",
        "Appointment created",
        `${mapAppointment(row).patientName} token ${mapAppointment(row).tokenNumber}`
      );
      res.status(201).json(withPatientTenant(req, tenantId, { appointment: mapAppointment(row) }));
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create appointment";
      res.status(status || 500).json({ error: message });
    }
  });

  api.patch("/appointments/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    let patch = (req.body || {}) as Record<string, unknown>;
    if (requestIsPatient(req)) {
      const existing = getTenantAppointment(tenantId, req.params.id);
      if (!existing || !patientCanRead(req, existing.patient_id)) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      try {
        patch = patientAppointmentPatch(patch);
      } catch (err: unknown) {
        const status = errorStatus(err);
        const message = err instanceof Error ? err.message : "Failed to update appointment";
        return res.status(status || 400).json({ error: message });
      }
    }
    try {
      const row = updateAppointment(tenantId, req.params.id, patch, {
        id: req.user?.id || null,
        name: req.user?.name,
      });
      res.json(withPatientTenant(req, tenantId, { appointment: mapAppointment(row) }));
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to update appointment";
      res.status(status || 500).json({ error: message });
    }
  });

  api.get("/prescriptions", requireAuth, (req, res) => {
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ prescriptions: [] });
      let patientId = String(req.query.patientId || req.query.patient_id || "").trim();
      if (requestIsPatient(req)) {
        const own = sessionPatientId(req);
        if (patientId && patientId !== own) {
          return res.status(404).json({ error: "Prescription not found" });
        }
        if (!own) {
          return res.json(withPatientTenant(req, tenantId, { prescriptions: [] }));
        }
        patientId = own;
      }
      const rows = (
        patientId
          ? getDb()
              .prepare(
                `SELECT * FROM prescriptions
                 WHERE tenant_id = ? AND patient_id = ?
                 ORDER BY created_at DESC`
              )
              .all(tenantId, patientId)
          : getDb()
              .prepare("SELECT * FROM prescriptions WHERE tenant_id = ? ORDER BY created_at DESC")
              .all(tenantId)
      ) as Record<string, unknown>[];
      const prescriptions = rows.map((prescription) => prescriptionForClient(req, tenantId, prescription));
      res.json(withPatientTenant(req, tenantId, { prescriptions }));
    } catch (err) {
      reportCaughtError(err, "clinical.listPrescriptions");
      res.status(500).json({ error: "Failed to fetch prescriptions" });
    }
  });

  api.get("/prescriptions/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row =
      getTenantPrescription(tenantId, req.params.id) ||
      (getDb()
        .prepare("SELECT * FROM prescriptions WHERE tenant_id = ? AND rx_number = ?")
        .get(tenantId, req.params.id) as Record<string, unknown> | undefined);
    if (!row || !patientCanRead(req, row.patient_id)) return res.status(404).json({ error: "Prescription not found" });
    const prescription = prescriptionForClient(req, tenantId, row);
    res.json(
      withPatientTenant(req, tenantId, { prescription }, {
        doctorName: prescription.doctorName,
        doctorRegNumber: prescription.doctorRegNumber,
      })
    );
  });

  api.post("/prescriptions", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = insertPrescription(tenantId, req.body || {});
      const mapped = prescriptionForClient(req, tenantId, row);
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Clinician",
        "Prescription signed",
        `${mapped.rxNumber} for ${mapped.patientName}`
      );
      const patientId = String(req.body.patientId || req.body.patient_id || "").trim();
      let draftCleanupError = "";
      try {
        if (patientId) {
          deletePrescriptionDraft({
            tenantId,
            patientId,
            appointmentId: appointmentIdForSignedDraft(tenantId, patientId, req.body || {}),
            actorId: req.user?.id || null,
            actorName: req.user?.name || "Clinician",
            reason: "sign",
          });
        }
      } catch (err: unknown) {
        reportCaughtError(err, "clinical.deleteDraftOnSign");
        draftCleanupError = "draft_cleanup_failed";
      }
      res.status(201).json(
        withPatientTenant(
          req,
          tenantId,
          {
            prescription: mapped,
            ...(draftCleanupError ? { draftCleanupError } : {}),
          },
          {
            doctorName: mapped.doctorName,
            doctorRegNumber: mapped.doctorRegNumber,
          }
        )
      );
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create prescription";
      res.status(status || 500).json({ error: message });
    }
  });

  api.get("/prescriptions/draft/:patientId", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const patientId = req.params.patientId;
    if (requestIsPatient(req) && !patientCanRead(req, patientId)) {
      return res.status(404).json({ error: "Prescription not found" });
    }
    if (!requireTenantPatient(tenantId, patientId, res)) return;
    const appointmentId = String(req.query.appointmentId || req.query.appointment_id || "").trim();
    if (!draftAppointmentMatchesPatient(tenantId, patientId, appointmentId)) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    const row = getDb()
      .prepare(
        "SELECT * FROM prescription_drafts WHERE tenant_id = ? AND patient_id = ? AND appointment_id = ?"
      )
      .get(tenantId, patientId, appointmentId) as { draft_json?: string; updated_at?: string } | undefined;
    if (!row) {
      return res.json({ draft: null });
    }
    try {
      res.json({ draft: JSON.parse(row.draft_json || "null"), updatedAt: row.updated_at });
    } catch {
      res.json({ draft: null });
    }
  });

  api.post("/prescriptions/draft", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const body = req.body || {};
      const patientId = String(body.patientId || body.patient_id || "").trim();
      const appointmentId = draftAppointmentId(body);
      if (!patientId) {
        return res.status(400).json({ error: "patientId is required for draft auto-save" });
      }
      if (!requireTenantPatient(tenantId, patientId, res)) return;
      if (!draftAppointmentMatchesPatient(tenantId, patientId, appointmentId)) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      const doctorId = doctorIdForDraft(req, tenantId, body);
      const draftJson = JSON.stringify(scrubDraftForStorage(body));
      const now = new Date().toISOString();
      const saved = getDb()
        .prepare(
          `INSERT INTO prescription_drafts (patient_id, tenant_id, doctor_id, draft_json, updated_at, appointment_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, patient_id, appointment_id) DO UPDATE SET
             doctor_id = excluded.doctor_id,
             draft_json = excluded.draft_json,
             updated_at = excluded.updated_at`
        )
        .run(patientId, tenantId, doctorId, draftJson, now, appointmentId);
      if (Number(saved.changes) === 0) {
        return res.status(409).json({ error: "Draft belongs to another clinic." });
      }
      res.json({ success: true, updatedAt: now });
    } catch (err: unknown) {
      const status = errorStatus(err);
      if (status >= 500) {
        reportCaughtError(err, "clinical.saveDraft");
        res.status(500).json({ error: "draft_save_failed" });
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to auto-save draft";
      res.status(status).json({ error: message });
    }
  });

  // Connected Pharmacy, Diagnostics Dispatch & PM-JAY Insurance Pre-Check
  api.post("/pharmacy/dispatch-order", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { patientName, phone, medicines, partner = "Apollo Pharmacy Partner", patientId, patient_id } = req.body;
    if (!requireTenantPatient(tenantId, String(patientId || patient_id || ""), res)) return;
    const orderId = shortId("PHARM");
    res.json({
      success: true,
      orderId,
      partner,
      message: `Pharmacy dispatch recorded for ${partner}. Patient ${patientName || "Patient"} is listed on this clinic order.`,
      timestamp: new Date().toISOString(),
      itemsCount: Array.isArray(medicines) ? medicines.length : 1
    });
  });

  api.post("/diagnostics/dispatch-order", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { patientName, phone, labTests, provider = "Dr. Lal PathLabs Home Collection", patientId, patient_id } = req.body;
    if (!requireTenantPatient(tenantId, String(patientId || patient_id || ""), res)) return;
    const orderId = shortId("LAB");
    res.json({
      success: true,
      orderId,
      provider,
      message: `Diagnostic test collection order dispatched to ${provider}. Phlebotomist assigned for home sample collection for ${patientName || 'Patient'}.`,
      timestamp: new Date().toISOString(),
      testsCount: Array.isArray(labTests) ? labTests.length : 1
    });
  });

  api.post("/insurance/pmjay-precheck", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const { abhaNumber, patientName, patientId, patient_id } = req.body;
    if (!requireTenantPatient(tenantId, String(patientId || patient_id || ""), res)) return;
    const isEligible = Math.random() > 0.2; // local simulation only — not an external payer decision
    const abha = String(abhaNumber || "").trim();
    res.json({
      success: true,
      abhaNumber: abha,
      patientName: patientName || "Beneficiary",
      pmjayEligible: isEligible,
      coverageLimit: isEligible ? 500000 : 0,
      scheme: "Ayushman Bharat PM-JAY (local eligibility simulation)",
      verificationId: shortId("PMJAY"),
      message: isEligible
        ? "PM-JAY eligibility simulation matched. Cashless cover pre-check recorded for this clinic."
        : "PM-JAY eligibility simulation did not match. Standard self-pay applies."
    });
  });

  registerPatientDocumentRoutes(api);

  return api;
}
