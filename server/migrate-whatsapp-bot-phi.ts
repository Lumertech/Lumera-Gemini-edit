import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";

/**
 * One-time scrub of bot replies that embedded a prescription or lab preview.
 * The same SQL runs on SQLite and Postgres. It does not query the catalog.
 * History is rewritten to a privacy notice. Live bot replies stay the
 * "ready" sentences in processBotActionOrQuery. send-rx rows stay: they are
 * sender 'agent', not 'bot'. Booking confirmations that only contain UHID
 * are not markers. translated_content is cleared when the column allows it,
 * otherwise it receives the same notice. A marker that exists only in
 * translated_content still matches.
 *
 * Matching ids are selected first. Rewrites use those ids as bound parameters
 * inside one transaction, so the written rows are the audited rows.
 * Audit rows are append-only. A later boot that already has
 * whatsapp_bot_phi_scrub writes nothing. A database that still has the
 * previous action keeps that row; the new row lists its ids in supersedes.
 * Writes roll back on failure and the log line is the error name only.
 */
export const WHATSAPP_BOT_PHI_SCRUB_ACTION = "whatsapp_bot_phi_scrub";
export const WHATSAPP_BOT_PHI_SCRUB_ACTION_V1 = "WhatsApp bot PHI scrub";
export const WHATSAPP_BOT_PHI_SCRUB_NOTICE = "[Message details removed for privacy]";
export const WHATSAPP_BOT_PHI_SCRUB_REASON = "cross-tenant PHI copied by pre-#171 bot";

const RX_READY = "your prescription is ready";
const LAB_READY = "your lab report is ready";
const RX_MARKER = "Prescription Record Found";
const LAB_MARKER = "Verified Lab Diagnostic Report";
const PREVIEW_MARKER = "previewData";
const MARKERS = [PREVIEW_MARKER, RX_MARKER, LAB_MARKER];
const ID_CHUNK = 200;

type Stmt = { sql: string; params: unknown[] };
type MessageRow = { id?: string; conversation_id?: string; tenant_id?: string; created_at?: string };
type IdRow = { id?: string };

function isNotNullViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not[- ]null/i.test(message);
}

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : "Error";
}

function sortedUnique(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || "")).filter(Boolean))].sort();
}

function likeTerms(markers: string[]): string[] {
  return markers.map((marker) => `%${marker}%`);
}

function markerSql(column: string, markers: string[]): string {
  return markers.map(() => `COALESCE(${column}, '') LIKE ?`).join(" OR ");
}

const MESSAGE_WHERE = `sender = 'bot' AND (
  ${markerSql("content", MARKERS)} OR ${markerSql("media", MARKERS)} OR ${markerSql("translated_content", MARKERS)}
)`;

function messageWhereParams(): string[] {
  const terms = likeTerms(MARKERS);
  return [...terms, ...terms, ...terms];
}

function updatesById(table: string, assignment: string, leading: unknown[], ids: string[]): Stmt[] {
  const unique = sortedUnique(ids);
  const statements: Stmt[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    statements.push({
      sql: `UPDATE ${table} SET ${assignment} WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      params: [...leading, ...chunk],
    });
  }
  return statements;
}

function commitWrites(database: SqlDatabase, statements: Stmt[]): void {
  if (!statements.length) return;
  if (typeof database.transaction === "function") {
    database.transaction(statements);
    return;
  }
  database.exec("BEGIN");
  try {
    for (const statement of statements) database.prepare(statement.sql).run(...statement.params);
    database.exec("COMMIT");
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  }
}

export function scrubWhatsAppBotPhi(database: SqlDatabase): { messages: number; conversations: number; skipped: boolean } {
  let already: IdRow | undefined;
  try {
    already = database.prepare("SELECT id FROM audit_logs WHERE action = ? LIMIT 1").get(WHATSAPP_BOT_PHI_SCRUB_ACTION) as IdRow | undefined;
  } catch {
    return { messages: 0, conversations: 0, skipped: true };
  }
  if (already?.id) return { messages: 0, conversations: 0, skipped: true };

  let markerRows: MessageRow[] = [];
  let previous: { id?: string; timestamp?: string }[] = [];
  try {
    markerRows = database
      .prepare(`SELECT id, conversation_id, tenant_id FROM whatsapp_messages WHERE ${MESSAGE_WHERE}`)
      .all(...messageWhereParams()) as MessageRow[];
    previous = database
      .prepare("SELECT id, timestamp FROM audit_logs WHERE action = ?")
      .all(WHATSAPP_BOT_PHI_SCRUB_ACTION_V1) as { id?: string; timestamp?: string }[];
  } catch (err) {
    console.error(errorName(err));
    return { messages: 0, conversations: 0, skipped: true };
  }

  const markerIds = sortedUnique(markerRows.map((row) => String(row.id || "")));
  const markerConversationIds = sortedUnique(markerRows.map((row) => String(row.conversation_id || "")));
  const supersededIds = sortedUnique(previous.map((row) => String(row.id || "")));
  const cutoff = previous
    .map((row) => String(row.timestamp || ""))
    .filter(Boolean)
    .sort()[0];

  let relabeledRows: MessageRow[] = [];
  let laterLiveConversationIds = new Set<string>();
  if (cutoff) {
    try {
      relabeledRows = database
        .prepare(
          `SELECT id, conversation_id, tenant_id FROM whatsapp_messages
           WHERE sender = 'bot'
             AND content IN (?, ?)
             AND (media IS NULL OR media = '')
             AND created_at < ?`
        )
        .all(RX_READY, LAB_READY, cutoff) as MessageRow[];
      const later = database
        .prepare(
          `SELECT conversation_id FROM whatsapp_messages
           WHERE sender = 'bot' AND content IN (?, ?) AND created_at >= ?`
        )
        .all(RX_READY, LAB_READY, cutoff) as { conversation_id?: string }[];
      laterLiveConversationIds = new Set(later.map((row) => String(row.conversation_id || "")).filter(Boolean));
    } catch (err) {
      console.error(errorName(err));
      return { messages: 0, conversations: 0, skipped: true };
    }
  }

  const relabeledIds = sortedUnique(relabeledRows.map((row) => String(row.id || ""))).filter((id) => !markerIds.includes(id));
  const relabeledConversationIds = sortedUnique(relabeledRows.map((row) => String(row.conversation_id || ""))).filter(
    (id) => !laterLiveConversationIds.has(id)
  );

  let markerPreviewIds: string[] = [];
  let orphanIds: string[] = [];
  try {
    const touched = new Set(markerConversationIds);
    const previews = database
      .prepare(`SELECT id FROM whatsapp_conversations WHERE ${markerSql("last_message", MARKERS)}`)
      .all(...likeTerms(MARKERS)) as IdRow[];
    markerPreviewIds = sortedUnique(previews.map((row) => String(row.id || ""))).filter((id) => touched.has(id));
    const orphans = database
      .prepare(
        `SELECT id FROM whatsapp_conversations
         WHERE COALESCE(last_message, '') LIKE ? OR COALESCE(last_message, '') LIKE ?`
      )
      .all(`%${RX_MARKER}%`, `%${LAB_MARKER}%`) as IdRow[];
    orphanIds = sortedUnique(orphans.map((row) => String(row.id || ""))).filter((id) => !touched.has(id));
  } catch (err) {
    console.error(errorName(err));
    return { messages: 0, conversations: 0, skipped: true };
  }

  let readyPreviewIds: string[] = [];
  if (relabeledConversationIds.length) {
    try {
      const ready = database
        .prepare("SELECT id FROM whatsapp_conversations WHERE last_message IN (?, ?)")
        .all(RX_READY, LAB_READY) as IdRow[];
      const relabeledSet = new Set(relabeledConversationIds);
      readyPreviewIds = sortedUnique(ready.map((row) => String(row.id || ""))).filter(
        (id) => relabeledSet.has(id) && !laterLiveConversationIds.has(id)
      );
    } catch (err) {
      console.error(errorName(err));
      return { messages: 0, conversations: 0, skipped: true };
    }
  }

  const messageIds = sortedUnique([...markerIds, ...relabeledIds]);
  const counted = new Set<string>();
  const countsByTenant: Record<string, number> = {};
  for (const row of [...markerRows, ...relabeledRows]) {
    const id = String(row.id || "");
    if (!id || counted.has(id) || !messageIds.includes(id)) continue;
    counted.add(id);
    const tenantId = String(row.tenant_id || "");
    countsByTenant[tenantId] = (countsByTenant[tenantId] || 0) + 1;
  }

  const details = JSON.stringify({
    reason: WHATSAPP_BOT_PHI_SCRUB_REASON,
    messageIds,
    conversationIds: markerConversationIds,
    orphanConversationIds: orphanIds,
    relabeledMessageIds: relabeledIds,
    relabeledConversationIds: readyPreviewIds,
    countsByTenant,
    supersedes: supersededIds,
  });

  const conversationUpdateIds = sortedUnique([...markerPreviewIds, ...orphanIds, ...readyPreviewIds]);
  const write = (clearTranslation: boolean): Stmt[] => {
    const assignment = clearTranslation
      ? "content = ?, translated_content = NULL, media = NULL, buttons = NULL"
      : "content = ?, translated_content = ?, media = NULL, buttons = NULL";
    const leading = clearTranslation ? [WHATSAPP_BOT_PHI_SCRUB_NOTICE] : [WHATSAPP_BOT_PHI_SCRUB_NOTICE, WHATSAPP_BOT_PHI_SCRUB_NOTICE];
    return [
      ...updatesById("whatsapp_messages", assignment, leading, messageIds),
      ...updatesById("whatsapp_conversations", "last_message = ?", [WHATSAPP_BOT_PHI_SCRUB_NOTICE], conversationUpdateIds),
      {
        sql: `INSERT INTO audit_logs (
          id, timestamp, user_id, user_name, action, details,
          tenant_id, patient_id, actor_role, entity_type, entity_id
        ) VALUES (?, ?, NULL, 'System', ?, ?, '', '', '', 'whatsapp_message', '')`,
        params: [crypto.randomUUID(), new Date().toISOString(), WHATSAPP_BOT_PHI_SCRUB_ACTION, details],
      },
    ];
  };

  try {
    try {
      commitWrites(database, write(true));
    } catch (err) {
      if (!isNotNullViolation(err)) throw err;
      commitWrites(database, write(false));
    }
  } catch (err) {
    console.error(errorName(err));
    return { messages: 0, conversations: 0, skipped: true };
  }

  return { messages: messageIds.length, conversations: markerConversationIds.length + orphanIds.length, skipped: false };
}
