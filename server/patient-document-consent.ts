/**
 * Append-only consent for storing health documents.
 * A row is never updated. Withdrawal inserts a new event.
 * Upload is rejected until the latest v1 event for this patient is "granted",
 * and a minor's grant must name a guardian.
 */
import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import { getDb, writeAudit } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { denyUnlessPatientRecordRole } from "./patient-access.ts";
import { reportCaughtError } from "./error-tracker.ts";
import {
  HEALTH_DOCUMENT_NOTICE_VERSION,
  HEALTH_DOCUMENT_PURPOSE,
  HEALTH_DOCUMENT_RETENTION_YEARS_PLACEHOLDER,
  clinicNameForNotice,
  healthDocumentNotices,
  isHealthDocumentConsentMethod,
  patientIsMinor,
  type HealthDocumentNoticeLanguage,
} from "../src/lib/healthDocumentNotice.ts";

export const CONSENT_REQUIRED_CODE = "CONSENT_REQUIRED";
export const GUARDIAN_REQUIRED_CODE = "GUARDIAN_REQUIRED";

export type ConsentEventRow = {
  id: string;
  tenant_id: string;
  patient_id: string;
  purpose: string;
  notice_version: string;
  language: string;
  method: string;
  captured_by_id: string;
  captured_by_name: string;
  captured_by_role: string;
  captured_at: string;
  guardian_name: string;
  guardian_relation: string;
  event: string;
};

function httpError(status: number, message: string, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, code });
}

function tenantIdOf(req: Request, res: Response): string | null {
  const tenantId = String(req.user?.tenantId || "").trim();
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function patientRow(tenantId: string, patientId: string): { id: string; age: number; date_of_birth: string } | undefined {
  return getDb()
    .prepare("SELECT id, age, date_of_birth FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as { id: string; age: number; date_of_birth: string } | undefined;
}

export function clinicNameForTenant(tenantId: string): string {
  const row = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name?: string } | undefined;
  return clinicNameForNotice(row?.name);
}

export function retentionYearsForTenant(tenantId: string): number {
  try {
    const row = getDb()
      .prepare("SELECT health_document_retention_years AS years FROM tenants WHERE id = ?")
      .get(tenantId) as { years?: number } | undefined;
    const years = Number(row?.years);
    if (Number.isFinite(years) && years >= HEALTH_DOCUMENT_RETENTION_YEARS_PLACEHOLDER) return Math.floor(years);
  } catch {
    /* column is added in migrate; a missing column uses the placeholder */
  }
  return HEALTH_DOCUMENT_RETENTION_YEARS_PLACEHOLDER;
}

export function listConsentEvents(tenantId: string, patientId: string): ConsentEventRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM patient_health_document_consents
       WHERE tenant_id = ? AND patient_id = ? AND purpose = ? AND notice_version = ?
       ORDER BY captured_at ASC, id ASC`
    )
    .all(tenantId, patientId, HEALTH_DOCUMENT_PURPOSE, HEALTH_DOCUMENT_NOTICE_VERSION) as ConsentEventRow[];
}

export function latestConsentEvent(tenantId: string, patientId: string): ConsentEventRow | undefined {
  const events = listConsentEvents(tenantId, patientId);
  return events.length ? events[events.length - 1] : undefined;
}

export function consentIsActive(row: ConsentEventRow | undefined, minor: boolean): boolean {
  if (!row || row.event !== "granted") return false;
  if (minor && (!String(row.guardian_name || "").trim() || !String(row.guardian_relation || "").trim())) return false;
  return true;
}

function publicEvent(row: ConsentEventRow) {
  return {
    id: row.id,
    event: row.event,
    purpose: row.purpose,
    noticeVersion: row.notice_version,
    language: row.language,
    method: row.method,
    capturedAt: row.captured_at,
    capturedByName: row.captured_by_name,
    capturedByRole: row.captured_by_role,
    guardianName: row.guardian_name || "",
    guardianRelation: row.guardian_relation || "",
  };
}

function auditConsent(req: Request, action: string, tenantId: string, patientId: string, eventId: string) {
  writeAudit(getDb(), req.user?.id || null, req.user?.name || "Staff", action, JSON.stringify({
    tenantId,
    patientId,
    entityType: "patient_health_document_consent",
    entityId: eventId,
    purpose: HEALTH_DOCUMENT_PURPOSE,
    noticeVersion: HEALTH_DOCUMENT_NOTICE_VERSION,
  }), {
    tenantId,
    patientId,
    actorRole: String(req.user?.role || ""),
    entityType: "patient_health_document_consent",
    entityId: eventId,
  });
}

export function consentStatus(tenantId: string, patientId: string) {
  const patient = patientRow(tenantId, patientId);
  if (!patient) return null;
  const minor = patientIsMinor({ dateOfBirth: patient.date_of_birth, age: patient.age });
  const events = listConsentEvents(tenantId, patientId);
  const latest = events.length ? events[events.length - 1] : undefined;
  const clinicName = clinicNameForTenant(tenantId);
  return {
    purpose: HEALTH_DOCUMENT_PURPOSE,
    noticeVersion: HEALTH_DOCUMENT_NOTICE_VERSION,
    clinicName,
    minor,
    active: consentIsActive(latest, minor),
    retentionYears: retentionYearsForTenant(tenantId),
    notices: healthDocumentNotices(clinicName),
    latest: latest ? publicEvent(latest) : null,
    events: events.map(publicEvent),
  };
}

/** Throws 409 when this patient has no active v1 grant. Call before any byte is stored. */
export function assertActiveHealthDocumentConsent(tenantId: string, patientId: string): void {
  const status = consentStatus(tenantId, patientId);
  if (!status) throw httpError(404, "Patient not found");
  if (!status.active) {
    const code = status.minor && status.latest?.event === "granted" ? GUARDIAN_REQUIRED_CODE : CONSENT_REQUIRED_CODE;
    const message =
      code === GUARDIAN_REQUIRED_CODE
        ? "A parent or guardian must be recorded before storing a report for this patient."
        : "Record consent before storing a health document.";
    throw httpError(409, message, code);
  }
}

function readLanguage(value: unknown): HealthDocumentNoticeLanguage {
  const language = String(value || "").trim();
  if (language !== "en" && language !== "hi") throw httpError(400, "Choose English or Hindi.");
  return language;
}

function insertEvent(input: {
  tenantId: string;
  patientId: string;
  language: string;
  method: string;
  event: "granted" | "withdrawn";
  userId: string;
  userName: string;
  userRole: string;
  guardianName: string;
  guardianRelation: string;
}): ConsentEventRow {
  const id = `hdc-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO patient_health_document_consents (
        id, tenant_id, patient_id, purpose, notice_version, language, method,
        captured_by_id, captured_by_name, captured_by_role, captured_at,
        guardian_name, guardian_relation, event
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.tenantId,
      input.patientId,
      HEALTH_DOCUMENT_PURPOSE,
      HEALTH_DOCUMENT_NOTICE_VERSION,
      input.language,
      input.method,
      input.userId,
      input.userName,
      input.userRole,
      now,
      input.guardianName,
      input.guardianRelation,
      input.event
    );
  return getDb()
    .prepare("SELECT * FROM patient_health_document_consents WHERE id = ?")
    .get(id) as ConsentEventRow;
}

export function registerPatientDocumentConsentRoutes(api: Router) {
  api.get("/patients/:id/document-consent", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    try {
      const status = consentStatus(tenantId, req.params.id);
      if (!status) return res.status(404).json({ error: "Patient not found" });
      res.json(status);
    } catch (err) {
      reportCaughtError(err, "consent.read");
      res.status(500).json({ error: "Failed to read consent" });
    }
  });

  api.post("/patients/:id/document-consent", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    try {
      const patient = patientRow(tenantId, req.params.id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const body = (req.body || {}) as Record<string, unknown>;
      if (body.attested !== true) {
        return res.status(400).json({ error: "Confirm that the patient was shown this notice and agreed." });
      }
      const language = readLanguage(body.language);
      const method = String(body.method || "").trim();
      if (!isHealthDocumentConsentMethod(method)) {
        return res.status(400).json({ error: "Choose how consent was given." });
      }
      const minor = patientIsMinor({ dateOfBirth: patient.date_of_birth, age: patient.age });
      const guardianName = String(body.guardianName || body.guardian_name || "").trim().slice(0, 120);
      const guardianRelation = String(body.guardianRelation || body.guardian_relation || "").trim().slice(0, 80);
      if (minor && (!guardianName || !guardianRelation)) {
        return res.status(400).json({
          error: "A parent or guardian name and relation are required for a patient under 18.",
          code: GUARDIAN_REQUIRED_CODE,
        });
      }
      const latest = latestConsentEvent(tenantId, req.params.id);
      if (consentIsActive(latest, minor)) {
        return res.json({ consent: publicEvent(latest!), status: consentStatus(tenantId, req.params.id) });
      }
      const row = insertEvent({
        tenantId,
        patientId: req.params.id,
        language,
        method,
        event: "granted",
        userId: String(req.user?.id || ""),
        userName: String(req.user?.name || "Staff"),
        userRole: String(req.user?.role || ""),
        guardianName,
        guardianRelation,
      });
      auditConsent(req, "patient_document_consent.granted", tenantId, req.params.id, row.id);
      res.status(201).json({ consent: publicEvent(row), status: consentStatus(tenantId, req.params.id) });
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to record consent";
      if (status >= 500) reportCaughtError(err, "consent.grant");
      res.status(status || 500).json({ error: status >= 500 ? "Failed to record consent" : message });
    }
  });

  api.post("/patients/:id/document-consent/withdraw", requireAuth, (req, res) => {
    if (!denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    try {
      const patient = patientRow(tenantId, req.params.id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const latest = latestConsentEvent(tenantId, req.params.id);
      if (!latest || latest.event !== "granted") {
        return res.status(409).json({ error: "There is no active consent to withdraw.", code: "CONSENT_NOT_ACTIVE" });
      }
      const row = insertEvent({
        tenantId,
        patientId: req.params.id,
        language: latest.language === "hi" ? "hi" : "en",
        method: latest.method,
        event: "withdrawn",
        userId: String(req.user?.id || ""),
        userName: String(req.user?.name || "Staff"),
        userRole: String(req.user?.role || ""),
        guardianName: "",
        guardianRelation: "",
      });
      auditConsent(req, "patient_document_consent.withdrawn", tenantId, req.params.id, row.id);
      res.status(201).json({ consent: publicEvent(row), status: consentStatus(tenantId, req.params.id) });
    } catch (err) {
      reportCaughtError(err, "consent.withdraw");
      res.status(500).json({ error: "Failed to record withdrawal" });
    }
  });
}
