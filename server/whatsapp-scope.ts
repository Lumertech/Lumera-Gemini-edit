import type { RequestHandler } from "express";
import { CLINICIAN_ROLES, requireAuth, requireRole } from "./auth.ts";
import { getDb } from "./db.ts";
import { WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";

/** Dashboard WhatsApp inbox — staff only. Meta webhooks stay on /api/meta. */
export const requireClinicWhatsApp: RequestHandler[] = [requireAuth, requireRole(...CLINICIAN_ROLES)];

export function clinicTenantId(req: { user?: { tenantId?: string } }): string {
  return String(req.user?.tenantId || "").trim();
}

/** Assigned rows only. The quarantine tenant is not a clinic session, so those rows match nobody. */
const CONV_TENANT_SQL = `TRIM(COALESCE(c.tenant_id, '')) = ?`;

export function getTenantConversation(tenantId: string, id: string) {
  if (!tenantId || !id) return undefined;
  return getDb()
    .prepare(`SELECT c.* FROM whatsapp_conversations c WHERE c.id = ? AND ${CONV_TENANT_SQL}`)
    .get(id, tenantId) as Record<string, unknown> | undefined;
}

export function listTenantConversations(tenantId: string) {
  if (!tenantId) return [];
  return getDb()
    .prepare(
      `SELECT c.* FROM whatsapp_conversations c WHERE ${CONV_TENANT_SQL} ORDER BY c.updated_at DESC`
    )
    .all(tenantId) as Record<string, unknown>[];
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

/**
 * Update or insert one clinic's thread. A phone match never selects another tenant's row,
 * and a preferred id owned by another clinic is not overwritten.
 */
export function upsertScopedConversation(opts: {
  preferredId: string;
  tenantId: string;
  patientPhone: string;
  patientName: string;
  assignedStaff: string;
  tags: string;
  preferredLanguage: string;
  lastMessage: string;
  lastMessageTime: string;
  now: string;
}): string {
  const tenantId = String(opts.tenantId || "").trim() || WHATSAPP_QUARANTINE_TENANT_ID;
  const phone = String(opts.patientPhone || "").trim();
  const db = getDb();
  const byPhone = db
    .prepare(
      `SELECT id FROM whatsapp_conversations
       WHERE patient_phone = ? AND TRIM(COALESCE(tenant_id, '')) = ?`
    )
    .get(phone, tenantId) as { id?: string } | undefined;
  if (byPhone?.id) {
    db.prepare(
      `UPDATE whatsapp_conversations
       SET last_message = ?, last_message_time = ?, updated_at = ?, patient_name = ?
       WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?`
    ).run(opts.lastMessage, opts.lastMessageTime, opts.now, opts.patientName, byPhone.id, tenantId);
    return String(byPhone.id);
  }

  let id = String(opts.preferredId || "").trim() || `conv-${tenantId}-${Date.now()}`;
  const taken = db.prepare("SELECT id FROM whatsapp_conversations WHERE id = ?").get(id) as { id?: string } | undefined;
  if (taken?.id) {
    const suffix = tenantId.replace(/[^a-z0-9]/gi, "").slice(-8) || "tenant";
    id = `${id}-${suffix}`;
    const stillTaken = db.prepare("SELECT id FROM whatsapp_conversations WHERE id = ?").get(id) as { id?: string } | undefined;
    if (stillTaken?.id) id = `${id}-${Date.now().toString(36)}`;
  }
  db.prepare(
    `INSERT INTO whatsapp_conversations (
       id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
       unread_count, last_message, last_message_time, updated_at, tenant_id
     ) VALUES (?, ?, ?, 'bot', ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(
    id,
    phone,
    opts.patientName,
    opts.assignedStaff,
    opts.tags,
    opts.preferredLanguage,
    opts.lastMessage,
    opts.lastMessageTime,
    opts.now,
    tenantId
  );
  return id;
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
