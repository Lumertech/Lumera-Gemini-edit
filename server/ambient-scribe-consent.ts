import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { AMBIENT_WALKIN_SOURCE, isUniqueViolation, openVisitStatusSql, visitStatusIsOpen } from "./ambient-walkin.ts";
import { requireAuth } from "./auth.ts";
import { writeAudit } from "./db-seed-maps.ts";
import { getDb } from "./db.ts";
import { denyUnlessPrescriber } from "./patient-access.ts";
import { rejectUntrustedTenantClaim } from "./tenant-guard.ts";
import { withSqliteTransaction } from "./usage-wallet.ts";

export { AMBIENT_WALKIN_SOURCE };

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

/** Calendar day in Asia/Kolkata. Consent never uses the client clock or UTC date. */
export function istClinicDay(now = new Date()): string {
  return clinicCalendarDate(now, "Asia/Kolkata");
}

export function visitIsOpenToday(visit: { date?: string; status?: string } | undefined, now = new Date()): boolean {
  if (!visit) return false;
  if (String(visit.date || "") !== istClinicDay(now)) return false;
  return visitStatusIsOpen(visit.status);
}

/**
 * Yesterday's hidden walk-ins are not still open. A real booking is left as it is.
 * Request paths pass tenantId. The daily sweep is the only caller that omits it.
 */
export function closeStaleAmbientWalkIns(now = new Date(), tenantId?: string): number {
  const day = istClinicDay(now);
  const tenant = String(tenantId || "").trim();
  const result = tenant
    ? getDb()
        .prepare(
          `UPDATE appointments
           SET status = 'Completed'
           WHERE source = ? AND tenant_id = ? AND date < ? AND ${openVisitStatusSql("status")}`
        )
        .run(AMBIENT_WALKIN_SOURCE, tenant, day)
    : getDb()
        .prepare(
          `UPDATE appointments
           SET status = 'Completed'
           WHERE source = ? AND date < ? AND ${openVisitStatusSql("status")}`
        )
        .run(AMBIENT_WALKIN_SOURCE, day);
  return Number(result.changes || 0);
}

export type StaleWalkInSweepState = { day: string };

const ambientSweepState: StaleWalkInSweepState = { day: "" };

/**
 * At most once per clinic day. Logs the closed count and nothing else.
 * Request paths do not call this; they pass their own tenant into closeStaleAmbientWalkIns.
 */
export function sweepStaleAmbientWalkIns(now = new Date(), state: StaleWalkInSweepState = ambientSweepState): number {
  const day = istClinicDay(now);
  if (state.day === day) return 0;
  const closed = closeStaleAmbientWalkIns(now);
  state.day = day;
  console.info(`ambient walk-in daily sweep closed ${closed}`);
  return closed;
}

export function hasAmbientScribeConsent(tenantId: string, appointmentId: string, now = new Date()): boolean {
  closeStaleAmbientWalkIns(now, tenantId);
  if (!consentRow(tenantId, appointmentId)) return false;
  return visitIsOpenToday(findAppointment(tenantId, appointmentId), now);
}

type AppointmentOwner = { id: string; patient_id: string; date: string; status: string; doctor_id: string; source: string };

function findAppointment(tenantId: string, appointmentId: string): AppointmentOwner | undefined {
  return getDb()
    .prepare(
      "SELECT id, patient_id, date, status, doctor_id, source FROM appointments WHERE id = ? AND tenant_id = ?"
    )
    .get(appointmentId, tenantId) as AppointmentOwner | undefined;
}

function visitSpecialty(user: NonNullable<Request["user"]>): string {
  const doctor = getDb().prepare("SELECT specialty FROM users WHERE id = ?").get(user.id) as { specialty?: string } | undefined;
  const fromDoctor = String(doctor?.specialty || "").trim();
  if (fromDoctor) return fromDoctor;
  const tenant = getDb().prepare("SELECT specialty FROM tenants WHERE id = ?").get(user.tenantId) as
    | { specialty?: string }
    | undefined;
  return String(tenant?.specialty || "").trim();
}

function reusableWalkIn(user: NonNullable<Request["user"]>, patientId: string, day: string): string {
  const row = getDb()
    .prepare(
      `SELECT id FROM appointments
       WHERE tenant_id = ? AND patient_id = ? AND doctor_id = ? AND date = ? AND source = ?
         AND ${openVisitStatusSql("status")}
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(user.tenantId, patientId, user.id, day, AMBIENT_WALKIN_SOURCE) as { id: string } | undefined;
  return String(row?.id || "");
}

function mintWalkInAppointment(user: NonNullable<Request["user"]>, patientId: string): string | null {
  const patient = getDb()
    .prepare("SELECT name, phone, uhid FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, user.tenantId) as { name: string; phone: string; uhid: string } | undefined;
  if (!patient) return null;
  const day = istClinicDay();
  const insert = () => {
    const existing = reusableWalkIn(user, patientId, day);
    if (existing) return existing;
    const id = `apt-${randomUUID().replace(/-/g, "")}`;
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
        0,
        patientId,
        patient.name,
        patient.phone,
        patient.uhid,
        user.id,
        user.name || "Clinician",
        visitSpecialty(user),
        day,
        "",
        "Ambient scribe",
        "Open",
        AMBIENT_WALKIN_SOURCE,
        0,
        0,
        now
      );
    return id;
  };
  try {
    return withSqliteTransaction(getDb(), insert);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return reusableWalkIn(user, patientId, day) || null;
  }
}

function latestOpenConsentForPatient(tenantId: string, patientId: string, now = new Date()): ConsentRow | undefined {
  const day = istClinicDay(now);
  return getDb()
    .prepare(
      `SELECT audit.timestamp, audit.user_id, audit.tenant_id, audit.entity_id
       FROM audit_logs audit
       INNER JOIN appointments apt ON apt.id = audit.entity_id AND apt.tenant_id = audit.tenant_id
       WHERE audit.action = ? AND audit.tenant_id = ? AND audit.patient_id = ?
         AND audit.entity_type = 'appointment' AND apt.patient_id = ? AND apt.date = ?
         AND ${openVisitStatusSql("apt.status")}
       ORDER BY audit.timestamp DESC LIMIT 1`
    )
    .get(AMBIENT_SCRIBE_CONSENT_ACTION, tenantId, patientId, patientId, day) as ConsentRow | undefined;
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
    closeStaleAmbientWalkIns(new Date(), tenantId);
    const rawAppointment = req.query.appointmentId;
    const patientId = cleanVisitId(req.query.patientId);
    if (rawAppointment !== undefined && String(rawAppointment).trim() !== "") {
      const appointmentId = cleanVisitId(rawAppointment);
      if (!appointmentId) return res.status(400).json({ error: "appointmentId is invalid" });
      const row = consentRow(tenantId, appointmentId);
      const open = visitIsOpenToday(findAppointment(tenantId, appointmentId));
      return res.json({
        confirmed: Boolean(row && open),
        appointmentId,
        recordedAt: row && open ? row.timestamp : null,
      });
    }
    if (!patientId) return res.status(400).json({ error: "appointmentId or patientId is required" });
    if (!patientInTenant(tenantId, patientId)) return res.status(404).json({ error: "Patient not found" });
    const row = latestOpenConsentForPatient(tenantId, patientId);
    return res.json({
      confirmed: Boolean(row),
      appointmentId: row?.entity_id || null,
      recordedAt: row?.timestamp || null,
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
      closeStaleAmbientWalkIns(new Date(), tenantId);
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
        if (!visitIsOpenToday(appointment)) {
          return res.status(409).json({ error: "This visit is not open today", code: "visit_closed" });
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
