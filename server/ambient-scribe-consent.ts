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

export function cleanVisitId(value: unknown): string {
  const id = String(value || "").trim();
  if (id.length < 1 || id.length > 120) return "";
  if (/[\s\u0000-\u001f]/.test(id)) return "";
  return id;
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
    const appointmentId = cleanVisitId(req.query.appointmentId);
    if (!appointmentId) return res.status(400).json({ error: "appointmentId is required" });
    const row = consentRow(tenantId, appointmentId);
    return res.json({
      confirmed: Boolean(row),
      appointmentId,
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
      const body = (req.body || {}) as Record<string, unknown>;
      const appointmentId = cleanVisitId(body.appointmentId);
      const patientId = cleanVisitId(body.patientId);
      if (!appointmentId) return res.status(400).json({ error: "appointmentId is required" });
      if (!patientId) return res.status(400).json({ error: "patientId is required" });
      if (body.attested !== true || body.statement !== AMBIENT_SCRIBE_CONSENT_TEXT) {
        return res.status(400).json({ error: "Confirm the patient agreement before recording." });
      }
      if (!patientInTenant(tenantId, patientId)) {
        return res.status(404).json({ error: "Patient not found" });
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
