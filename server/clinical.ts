import { Router, type Request, type Response } from "express";
import {
  getDb,
  mapAppointment,
  mapPatient,
  mapPrescription,
  PRESCRIPTION_SPECIALTY_KEYS,
  writeAudit,
} from "./db.ts";
import { clinicLine, getTenantLetterhead } from "./letterhead.ts";
import { requireAuth } from "./auth.ts";

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

function nextTokenNumber(tenantId: string, date: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(token_number), 0) AS max_token
       FROM appointments WHERE tenant_id = ? AND date = ?`
    )
    .get(tenantId, date) as { max_token: number };
  return Number(row?.max_token || 0) + 1;
}

function getTenantPatient(tenantId: string, id: string) {
  return getDb()
    .prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?")
    .get(id, tenantId) as Record<string, unknown> | undefined;
}

function getTenantAppointment(tenantId: string, id: string) {
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

function insertPatient(tenantId: string, body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  if (!name || !phone) {
    throw Object.assign(new Error("name and phone are required"), { status: 400 });
  }
  const id = shortId("pat");
  const uhid = uniqueUhid();
  const now = new Date().toISOString();
  const lastVisit = body.lastVisit ? String(body.lastVisit) : now.slice(0, 10);
  try {
    getDb()
      .prepare(
        `INSERT INTO patients (
          id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies,
          chronic_conditions, emergency_contact, address, last_visit, created_at,
          abha_number, abha_address, kyc_status, hfr_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        String(body.abhaNumber || body.abha_number || ""),
        String(body.abhaAddress || body.abha_address || ""),
        String(body.kycStatus || body.kyc_status || "PENDING"),
        String(body.hfrId || body.hfr_id || "")
      );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(message)) {
      throw Object.assign(new Error("A patient with this phone or UHID already exists"), { status: 409 });
    }
    throw err;
  }
  return getTenantPatient(tenantId, id)!;
}

function insertAppointment(tenantId: string, body: Record<string, unknown>, actor?: { id?: string; name?: string }) {
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
 * Wave 1A contract (patient / appointment). Auth = requireAuth (session JWT
 * cookie or Authorization: Bearer). Tenant = req.user.tenantId.
 *
 * GET  /patients              → { patients: Patient[] }
 * POST /patients              → { patient }  body { name, age, gender, phone, email?,
 *   bloodGroup?, allergies?, chronicConditions?, emergencyContact?, address? }
 *   server assigns id + uhid
 * PATCH /patients/:id         → { patient }  partial
 * PATCH /patients/:id/abha    → { success, id, abhaNumber, abhaAddress, kycStatus }
 *   body { abhaNumber, abhaAddress, kycStatus? }
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
    res.json({ patient: mapPatient(row) });
  });

  api.post("/patients", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = insertPatient(tenantId, req.body || {});
      writeAudit(getDb(), req.user?.id || null, req.user?.name || "Clinician", "Patient created", mapPatient(row).name);
      res.status(201).json({ patient: mapPatient(row) });
    } catch (err: unknown) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create patient";
      res.status(status || 500).json({ error: message });
    }
  });

  api.patch("/patients/:id/abha", requireAuth, (req, res) => {
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      const existing = getTenantPatient(tenantId, req.params.id);
      if (!existing) return res.status(404).json({ error: "Patient not found" });
      const { abhaNumber, abhaAddress, kycStatus = "VERIFIED" } = req.body || {};
      getDb()
        .prepare(
          `UPDATE patients
           SET abha_number = ?, abha_address = ?, kyc_status = ?, hfr_id = COALESCE(NULLIF(hfr_id, ''), 'HFR-IN-8829104')
           WHERE id = ? AND tenant_id = ?`
        )
        .run(abhaNumber || "", abhaAddress || "", kycStatus, req.params.id, tenantId);
      const row = getTenantPatient(tenantId, req.params.id)!;
      res.json({ success: true, patient: mapPatient(row), id: req.params.id, abhaNumber, abhaAddress, kycStatus });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: "Failed to update ABHA details: " + message });
    }
  });

  api.patch("/patients/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const existing = getTenantPatient(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Patient not found" });
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
    const existing = getTenantAppointment(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Appointment not found" });
    const mapped = mapAppointment(existing);
    const body = req.body || {};
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
        req.params.id,
        tenantId
      );
    res.json({ appointment: mapAppointment(getTenantAppointment(tenantId, req.params.id)!) });
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
