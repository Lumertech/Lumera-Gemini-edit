import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "./auth.ts";
import { writeAudit } from "./db-seed-maps.ts";
import { getDb } from "./db.ts";
import { denyUnlessPrescriber } from "./patient-access.ts";
import { rejectUntrustedTenantClaim } from "./tenant-guard.ts";

/**
 * Per-visit attestation that the patient agreed to this recording.
 * Separate from the #141 health-document consent gate. That gate stays as it is.
 */
export const AMBIENT_SCRIBE_CONSENT_TEXT =
  "I have told the patient that this consult will be recorded and transcribed by an AI service to draft notes, and the patient agreed. Audio is not stored.";

export const AMBIENT_SCRIBE_CONSENT_ACTION = "ambient_scribe_consent";

const AUDIT_DETAILS =
  "Clinician confirmed the patient agreed this consult may be recorded and transcribed to draft notes. Audio is not stored.";

const WALK_IN_SENTINELS = new Set(["unscheduled", "walk-in", "walkin"]);

export function cleanVisitId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (id.length < 1 || id.length > 80) return "";
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) return "";
  return id;
}

export function isWalkInVisitRequest(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const raw = String(value).trim();
  if (!raw) return true;
  return WALK_IN_SENTINELS.has(raw.toLowerCase());
}

/** Transcribe accepts only a real visit id. A missing, invalid, or walk-in sentinel is empty. */
export function transcribeAppointmentId(value: unknown): string {
  if (isWalkInVisitRequest(value)) return "";
  return cleanVisitId(value);
}

type ConsentRow = { timestamp: string; user_id: string | null; tenant_id: string; entity_id: string };

function consentRow(tenantId: string, appointmentId: string): ConsentRow | undefined {
  return getDb()
    .prepare(
      `SELECT timestamp, user_id, tenant_id, entity_id FROM audit_logs
       WHERE action = ? AND tenant_id = ? AND entity_type = 'appointment' AND entity_id = ?
       ORDER BY timestamp DESC LIMIT 1`
    )
    .get(AMBIENT_SCRIBE_CONSENT_ACTION, tenantId, appointmentId) as ConsentRow | undefined;
}

function patientInTenant(tenantId: string, patientId: string): boolean {
  const row = getDb().prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?").get(patientId, tenantId) as
    | { id: string }
    | undefined;
  return Boolean(row?.id);
}

export function hasAmbientScribeConsent(tenantId: string, appointmentId: string): boolean {
  return Boolean(consentRow(tenantId, appointmentId));
}

type AppointmentOwner = { id: string; patient_id: string };

function findAppointment(tenantId: string, appointmentId: string): AppointmentOwner | undefined {
  return getDb()
    .prepare("SELECT id, patient_id FROM appointments WHERE id = ? AND tenant_id = ?")
    .get(appointmentId, tenantId) as AppointmentOwner | undefined;
}

function clinicDayIso(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function mintWalkInAppointment(user: NonNullable<Request["user"]>, patientId: string): string | null {
  const patient = getDb()
    .prepare("SELECT name, phone, uhid FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, user.tenantId) as { name: string; phone: string; uhid: string } | undefined;
  if (!patient) return null;
  const id = `apt-${randomUUID().replace(/-/g, "")}`;
  const day = clinicDayIso();
  const token = getDb()
    .prepare("SELECT COALESCE(MAX(token_number), 0) + 1 AS n FROM appointments WHERE tenant_id = ? AND date = ?")
    .get(user.tenantId, day) as { n: number } | undefined;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO appointments (
        id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
        doctor_id, doctor_name, specialty, date, time_slot, type, status, source,
        consultation_fee, is_paid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      user.tenantId,
      Number(token?.n) || 1,
      patientId,
      patient.name,
      patient.phone,
      patient.uhid,
      user.id,
      user.name || "Clinician",
      "General Medicine",
      day,
      "Walk-in",
      "New Consultation",
      "In Consultation",
      "Walk-in",
      0,
      0,
      now
    );
  return id;
}

function latestConsentForPatient(tenantId: string, patientId: string): ConsentRow | undefined {
  return getDb()
    .prepare(
      `SELECT timestamp, user_id, tenant_id, entity_id FROM audit_logs
       WHERE action = ? AND tenant_id = ? AND patient_id = ? AND entity_type = 'appointment'
       ORDER BY timestamp DESC LIMIT 1`
    )
    .get(AMBIENT_SCRIBE_CONSENT_ACTION, tenantId, patientId) as ConsentRow | undefined;
}

/**
 * One audit row per appointment: user, tenant, appointment id, timestamp.
 * The transcript and the audio are never written here.
 */
function prescriberOnly(req: Request, res: Response, next: NextFunction): void {
  if (!denyUnlessPrescriber(req, res)) return;
  next();
}

export function mountAmbientScribeConsentRoutes(app: Express): void {
  app.get("/api/ambient-scribe/consent", requireAuth, prescriberOnly, (req: Request, res: Response) => {
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) return res.status(401).json({ error: "Sign in required", code: "AUTH_REQUIRED" });
    const rawAppointment = req.query.appointmentId;
    const patientId = cleanVisitId(req.query.patientId);
    if (rawAppointment !== undefined && String(rawAppointment).trim() !== "") {
      const appointmentId = cleanVisitId(rawAppointment);
      if (!appointmentId) return res.status(400).json({ error: "appointmentId is invalid" });
      const row = consentRow(tenantId, appointmentId);
      return res.json({
        confirmed: Boolean(row),
        appointmentId,
        recordedAt: row?.timestamp || null,
      });
    }
    if (!patientId) return res.status(400).json({ error: "appointmentId or patientId is required" });
    if (!patientInTenant(tenantId, patientId)) return res.status(404).json({ error: "Patient not found" });
    const row = latestConsentForPatient(tenantId, patientId);
    const appointment = row ? findAppointment(tenantId, row.entity_id) : undefined;
    const owned = appointment && appointment.patient_id === patientId ? appointment.id : "";
    return res.json({
      confirmed: Boolean(owned),
      appointmentId: owned || null,
      recordedAt: owned ? row?.timestamp || null : null,
    });
  });

  app.post(
    "/api/ambient-scribe/consent",
    requireAuth,
    prescriberOnly,
    rejectUntrustedTenantClaim,
    (req: Request, res: Response) => {
      const tenantId = String(req.user?.tenantId || "").trim();
      if (!tenantId) return res.status(401).json({ error: "Sign in required", code: "AUTH_REQUIRED" });
      const body = (req.body || {}) as Record<string, unknown>;
      const patientId = cleanVisitId(body.patientId);
      if (!patientId) return res.status(400).json({ error: "patientId is required" });
      if (body.attested !== true || body.statement !== AMBIENT_SCRIBE_CONSENT_TEXT) {
        return res.status(400).json({ error: "Confirm the patient agreement before recording." });
      }
      if (!patientInTenant(tenantId, patientId)) {
        return res.status(404).json({ error: "Patient not found" });
      }
      let appointmentId = "";
      if (isWalkInVisitRequest(body.appointmentId)) {
        const minted = req.user ? mintWalkInAppointment(req.user, patientId) : null;
        if (!minted) return res.status(404).json({ error: "Patient not found" });
        appointmentId = minted;
      } else {
        appointmentId = cleanVisitId(body.appointmentId);
        if (!appointmentId) return res.status(400).json({ error: "appointmentId is invalid" });
        const appointment = findAppointment(tenantId, appointmentId);
        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.patient_id !== patientId) {
          return res.status(403).json({ error: "Appointment does not belong to this patient" });
        }
      }
      const existing = consentRow(tenantId, appointmentId);
      if (!existing) {
        writeAudit(getDb(), req.user?.id || null, req.user?.name || "Clinician", AMBIENT_SCRIBE_CONSENT_ACTION, AUDIT_DETAILS, {
          tenantId,
          patientId,
          actorRole: req.user?.role || "",
          entityType: "appointment",
          entityId: appointmentId,
        });
      }
      const row = consentRow(tenantId, appointmentId);
      return res.status(existing ? 200 : 201).json({
        confirmed: true,
        appointmentId,
        recordedAt: row?.timestamp || null,
      });
    }
  );
}
