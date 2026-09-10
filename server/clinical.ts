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
import { resolveAbdmMode, type AbdmMode } from "./abdm-mode.ts";

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = tenantIdOf(req);
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
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
  "NHA sandbox: ABHA link and consent artefact storage until NHA credentials are provisioned.";

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function phoneMatchKey(phone: string): string {
  const digits = digitsOnly(phone);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

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

/**
 * Persist an NHA sandbox consent artefact for the ABDM path only.
 * The practice-simple onboard path must not call this.
 */
export function storeConsentArtefact(
  tenantId: string,
  patientId: string,
  artefact: Record<string, unknown>,
  actor?: { id?: string | null; name?: string }
) {
  const consentId = String(artefact.consentId || artefact.consent_id || "").trim();
  if (!consentId) {
    throw httpError(400, "consentArtefact.consentId is required");
  }
  const patient = getTenantPatient(tenantId, patientId);
  if (!patient) {
    throw httpError(404, "Patient not found");
  }
  const now = new Date().toISOString();
  const kind = String(artefact.kind || artefact.artefactKind || "consent").trim() || "consent";
  const payload = JSON.stringify({ ...artefact, consentId, kind });
  const existing = getDb()
    .prepare("SELECT id FROM abdm_consent_artefacts WHERE tenant_id = ? AND consent_id = ?")
    .get(tenantId, consentId) as { id: string } | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE abdm_consent_artefacts
         SET patient_id = ?, artefact_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(patientId, payload, now, existing.id, tenantId);
  } else {
    getDb()
      .prepare(
        `INSERT INTO abdm_consent_artefacts (
          id, tenant_id, patient_id, consent_id, artefact_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(shortId("consent"), tenantId, patientId, consentId, payload, now, now);
  }
  writeAudit(
    getDb(),
    actor?.id || null,
    actor?.name || "Clinician",
    "ABHA consent stored (NHA sandbox)",
    `patient ${patientId} consent ${consentId}`
  );
  return listTenantConsentArtefacts(tenantId, patientId);
}

export const KYC_LINKED_SANDBOX = "LINKED_SANDBOX";

const LINK_SOURCES = new Set(["aadhaar_otp", "abha_search", "qr"]);

export function rejectUnlockedKyc(body: Record<string, unknown>) {
  const kyc = String(body.kycStatus || body.kyc_status || "");
  if (/^verified$/i.test(kyc) || /government|unlocked/i.test(kyc)) {
    throw httpError(400, "NHA sandbox kycStatus must be LINKED_SANDBOX");
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

function specialtyModulesFromBody(body: Record<string, unknown>): string {
  const modules: Record<string, unknown> = {};
  for (const key of PRESCRIPTION_SPECIALTY_KEYS) {
    if (body[key] !== undefined) modules[key] = body[key];
  }
  if (body.specialtyModules && typeof body.specialtyModules === "object") {
    Object.assign(modules, body.specialtyModules as Record<string, unknown>);
  }
  return JSON.stringify(modules);
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
    "ABHA linked (NHA sandbox)",
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
  const date = String(body.date || new Date().toISOString().slice(0, 10));
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
      mappedPatient.phone,
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
  body: Record<string, unknown>
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
  getDb()
    .prepare(
      `UPDATE appointments SET
        status = ?, token_number = ?, vitals = ?, is_paid = ?,
        type = ?, time_slot = ?, date = ?, doctor_id = ?, doctor_name = ?, specialty = ?
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
      appointmentId,
      tenantId
    );
  return getTenantAppointment(tenantId, appointmentId)!;
}

function insertPrescription(tenantId: string, body: Record<string, unknown>) {
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
 * POST /appointments          → { appointment }  body { patientId, doctorId, date, timeSlot, type?, source? }
 *   server fills names/uhid/phone, next tokenNumber, default status Waiting
 * PATCH /appointments/:id     → { appointment }  body { status?, tokenNumber?, vitals?, isPaid? }
 *
 * Prescriptions CRUD is owned by Platform #13 — do not expand here.
 */
export function createClinicalRouter(): Router {
  const api = Router();

  api.get("/patients", requireAuth, (req, res) => {
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ patients: [] });
      const rows = getDb()
        .prepare("SELECT * FROM patients WHERE tenant_id = ? ORDER BY name ASC")
        .all(tenantId) as Record<string, unknown>[];
      res.json({ patients: rows.map(mapPatient) });
    } catch {
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  api.get("/patients/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantPatient(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Patient not found" });
    res.json({ patient: patientWithConsents(row, tenantId) });
  });

  api.post("/patients", requireAuth, (req, res) => {
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
    res.json({ patient: mapPatient(getTenantPatient(tenantId, req.params.id)!) });
  });

  api.get("/appointments", requireAuth, (req, res) => {
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ appointments: [] });
      const rows = getDb()
        .prepare("SELECT * FROM appointments WHERE tenant_id = ? ORDER BY token_number ASC")
        .all(tenantId) as Record<string, unknown>[];
      res.json({ appointments: rows.map(mapAppointment) });
    } catch {
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  api.get("/appointments/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantAppointment(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Appointment not found" });
    res.json({ appointment: mapAppointment(row) });
  });

  api.post("/appointments", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = insertAppointment(tenantId, req.body || {}, { id: req.user?.id, name: req.user?.name });
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Clinician",
        "Appointment created",
        `${mapAppointment(row).patientName} token ${mapAppointment(row).tokenNumber}`
      );
      res.status(201).json({ appointment: mapAppointment(row) });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create appointment";
      res.status(status || 500).json({ error: message });
    }
  });

  api.patch("/appointments/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = updateAppointment(tenantId, req.params.id, req.body || {});
      res.json({ appointment: mapAppointment(row) });
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
      const patientId = String(req.query.patientId || req.query.patient_id || "").trim();
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
      res.json({ prescriptions: rows.map(mapPrescription) });
    } catch {
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
    if (!row) return res.status(404).json({ error: "Prescription not found" });
    res.json({ prescription: mapPrescription(row) });
  });

  api.post("/prescriptions", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = insertPrescription(tenantId, req.body || {});
      const mapped = mapPrescription(row);
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Clinician",
        "Prescription signed",
        `${mapped.rxNumber} for ${mapped.patientName}`
      );
      res.status(201).json({ prescription: mapped });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create prescription";
      res.status(status || 500).json({ error: message });
    }
  });

  return api;
}
