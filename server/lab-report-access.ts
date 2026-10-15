import type { Request, Response } from "express";
import { getDb } from "./db.ts";
import { clinicTenantId } from "./whatsapp-scope.ts";

export function labOwnerTenantId(lab: Record<string, unknown>): string {
  const direct = String(lab.tenant_id || "").trim();
  if (direct) return direct;
  const patientId = String(lab.patient_id || "").trim();
  if (!patientId) return "";
  const patient = getDb()
    .prepare("SELECT tenant_id FROM patients WHERE id = ?")
    .get(patientId) as { tenant_id?: string } | undefined;
  return String(patient?.tenant_id || "").trim();
}

export type LabReportAccess =
  | { ok: true; lab: Record<string, unknown> }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Caller must already be authenticated.
 * Ownership is the session tenant from clinicTenantId: the patient row must
 * belong to that tenant, and a stamped lab tenant_id must match it too.
 * A miss is 404 with no chart text, including a forged or empty session tenant.
 */
export function authorizeLabReport(req: Request, id: string): LabReportAccess {
  const tenantId = clinicTenantId(req);
  if (!tenantId) return { ok: false, status: 404, error: "Lab report not found" };
  const lab = getDb()
    .prepare(
      `SELECT l.* FROM lab_reports l
       INNER JOIN patients p ON p.id = l.patient_id
       WHERE l.id = ? AND p.tenant_id = ?`
    )
    .get(id, tenantId) as Record<string, unknown> | undefined;
  if (!lab) return { ok: false, status: 404, error: "Lab report not found" };
  const owner = labOwnerTenantId(lab);
  if (owner !== tenantId) return { ok: false, status: 404, error: "Lab report not found" };
  return { ok: true, lab };
}

export function sendLabReportDenied(res: Response, access: LabReportAccess) {
  if (access.ok === true) return;
  if (access.status === 404) return res.status(404).send(access.error);
  return res.status(access.status).json({ error: access.error });
}

/** Authenticated document route. Callers must not echo a stored public file URL. */
export function authenticatedLabReportPath(id: string): string {
  return `/api/emr/lab-report/${encodeURIComponent(id)}/pdf`;
}
