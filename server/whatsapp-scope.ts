import type { RequestHandler } from "express";
import { CLINICIAN_ROLES, requireAuth, requireRole } from "./auth.ts";
import { getDb } from "./db.ts";

/** Dashboard WhatsApp inbox — staff only. Meta webhooks stay on /api/meta. */
export const requireClinicWhatsApp: RequestHandler[] = [requireAuth, requireRole(...CLINICIAN_ROLES)];

export function clinicTenantId(req: { user?: { tenantId?: string } }): string {
  return String(req.user?.tenantId || "").trim();
}

const CONV_TENANT_SQL = `(
  COALESCE(c.tenant_id, '') = ?
  OR EXISTS (
    SELECT 1 FROM patients p
    WHERE p.tenant_id = ?
      AND (
        (c.patient_id IS NOT NULL AND TRIM(CAST(c.patient_id AS TEXT)) != '' AND p.id = c.patient_id)
        OR p.phone = c.patient_phone
      )
  )
)`;

export function getTenantConversation(tenantId: string, id: string) {
  return getDb()
    .prepare(`SELECT c.* FROM whatsapp_conversations c WHERE c.id = ? AND ${CONV_TENANT_SQL}`)
    .get(id, tenantId, tenantId) as Record<string, unknown> | undefined;
}

export function listTenantConversations(tenantId: string) {
  return getDb()
    .prepare(
      `SELECT c.* FROM whatsapp_conversations c WHERE ${CONV_TENANT_SQL} ORDER BY c.updated_at DESC`
    )
    .all(tenantId, tenantId) as Record<string, unknown>[];
}

/** Last-10 digits so "+91 99999 73271" and "+919999973271" compare equal in SQL. */
function phoneLast10Sql(column: string): string {
  const digits = `replace(replace(replace(replace(${column}, '+', ''), ' ', ''), '-', ''), '(', '')`;
  return `substr(${digits}, length(${digits}) - 9, 10)`;
}

export function serializeOutboundEvent(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    eventType: String(row.event_type ?? row.eventType ?? ""),
    patientPhone: String(row.patient_phone ?? row.patientPhone ?? ""),
    patientName: String(row.patient_name ?? row.patientName ?? ""),
    status: String(row.status ?? ""),
    details: String(row.details ?? ""),
    sentAt: String(row.sent_at ?? row.sentAt ?? ""),
  };
}

export function listTenantOutboundEvents(tenantId: string) {
  const patientDigits = phoneLast10Sql("p.phone");
  const eventDigits = phoneLast10Sql("e.patient_phone");
  const rows = getDb()
    .prepare(
      `SELECT e.* FROM whatsapp_outbound_events e
       WHERE COALESCE(e.tenant_id, '') = ?
          OR EXISTS (
            SELECT 1 FROM patients p
            WHERE p.tenant_id = ?
              AND (
                p.phone = e.patient_phone
                OR (
                  length(replace(replace(replace(replace(p.phone, '+', ''), ' ', ''), '-', ''), '(', '')) >= 10
                  AND length(replace(replace(replace(replace(e.patient_phone, '+', ''), ' ', ''), '-', ''), '(', '')) >= 10
                  AND ${patientDigits} = ${eventDigits}
                )
              )
          )
       ORDER BY e.sent_at DESC LIMIT 50`
    )
    .all(tenantId, tenantId) as Record<string, unknown>[];
  return rows.map(serializeOutboundEvent);
}

export function stampWhatsAppTenant(table: "whatsapp_conversations" | "whatsapp_messages" | "whatsapp_outbound_events", id: string, tenantId: string) {
  try {
    getDb()
      .prepare(`UPDATE ${table} SET tenant_id = COALESCE(NULLIF(tenant_id, ''), ?) WHERE id = ?`)
      .run(tenantId, id);
  } catch {
    /* tenant_id column missing on very old DBs until migrate() */
  }
}
