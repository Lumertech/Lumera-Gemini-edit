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
 * Writes run in one transaction. A failure rolls back and does not write the
 * audit marker, so the next boot retries. The log line is the error name only.
 * Idempotency is the action whatsapp_bot_phi_scrub. A dev database that still
 * has the previous action string is rewritten once and left with this row.
 */
export const WHATSAPP_BOT_PHI_SCRUB_ACTION = "whatsapp_bot_phi_scrub";
export const WHATSAPP_BOT_PHI_SCRUB_ACTION_V1 = "WhatsApp bot PHI scrub";
export const WHATSAPP_BOT_PHI_SCRUB_NOTICE = "[Message details removed for privacy]";
export const WHATSAPP_BOT_PHI_SCRUB_REASON = "cross-tenant PHI copied by pre-#171 bot";

const RX_MARKER = "Prescription Record Found";
const LAB_MARKER = "Verified Lab Diagnostic Report";
const PREVIEW_MARKER = "previewData";
const MARKERS = [PREVIEW_MARKER, RX_MARKER, LAB_MARKER];

function sqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function markerMatch(column: string): string {
  return MARKERS.map((marker) => `COALESCE(${column}, '') LIKE ${sqlString(`%${marker}%`)}`).join(" OR ");
}

const MESSAGE_WHERE = `sender = 'bot' AND (
  ${markerMatch("content")} OR ${markerMatch("media")} OR ${markerMatch("translated_content")}
)`;

function isNotNullViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not[- ]null/i.test(message);
}

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : "Error";
}

type ScrubMessageRow = { id?: string; conversation_id?: string; tenant_id?: string };

function scrubStatements(rows: ScrubMessageRow[], clearTranslation: boolean): string[] {
  const notice = sqlString(WHATSAPP_BOT_PHI_SCRUB_NOTICE);
  const translation = clearTranslation ? "NULL" : notice;
  const messageIds = [...new Set(rows.map((row) => String(row.id || "")).filter(Boolean))].sort();
  const conversationIds = [...new Set(rows.map((row) => String(row.conversation_id || "")).filter(Boolean))].sort();
  const countsByTenant: Record<string, number> = {};
  for (const row of rows) {
    const tenantId = String(row.tenant_id || "");
    countsByTenant[tenantId] = (countsByTenant[tenantId] || 0) + 1;
  }
  const details = JSON.stringify({
    reason: WHATSAPP_BOT_PHI_SCRUB_REASON,
    messageIds,
    conversationIds,
    countsByTenant,
  });
  const statements = [
    `UPDATE whatsapp_messages
     SET content = ${notice},
         translated_content = ${translation},
         media = NULL,
         buttons = NULL
     WHERE ${MESSAGE_WHERE}`,
  ];
  if (conversationIds.length) {
    statements.push(
      `UPDATE whatsapp_conversations
       SET last_message = ${notice}
       WHERE id IN (${conversationIds.map(sqlString).join(", ")})
         AND (${markerMatch("last_message")})`
    );
  }
  statements.push(`DELETE FROM audit_logs WHERE action = ${sqlString(WHATSAPP_BOT_PHI_SCRUB_ACTION_V1)}`);
  statements.push(
    `INSERT INTO audit_logs (
      id, timestamp, user_id, user_name, action, details,
      tenant_id, patient_id, actor_role, entity_type, entity_id
    ) VALUES (
      ${sqlString(crypto.randomUUID())},
      ${sqlString(new Date().toISOString())},
      NULL,
      'System',
      ${sqlString(WHATSAPP_BOT_PHI_SCRUB_ACTION)},
      ${sqlString(details)},
      '', '', '', 'whatsapp_message', ''
    )`
  );
  return statements;
}

function commitStatements(database: SqlDatabase, statements: string[]): void {
  if (database.dialect === "postgres") {
    database.exec(statements.join(";\n"));
    return;
  }
  database.exec("BEGIN");
  try {
    for (const statement of statements) database.exec(statement);
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
  let already: { id?: string } | undefined;
  try {
    already = database
      .prepare("SELECT id FROM audit_logs WHERE action = ? LIMIT 1")
      .get(WHATSAPP_BOT_PHI_SCRUB_ACTION) as { id?: string } | undefined;
  } catch {
    return { messages: 0, conversations: 0, skipped: true };
  }
  if (already?.id) return { messages: 0, conversations: 0, skipped: true };

  let rows: ScrubMessageRow[] = [];
  try {
    rows = database.prepare(`SELECT id, conversation_id, tenant_id FROM whatsapp_messages WHERE ${MESSAGE_WHERE}`).all() as ScrubMessageRow[];
  } catch (err) {
    console.error(errorName(err));
    return { messages: 0, conversations: 0, skipped: true };
  }

  const conversationIds = new Set(rows.map((row) => String(row.conversation_id || "")).filter(Boolean));
  const apply = (clearTranslation: boolean) => commitStatements(database, scrubStatements(rows, clearTranslation));
  try {
    try {
      apply(true);
    } catch (err) {
      if (!isNotNullViolation(err)) throw err;
      apply(false);
    }
  } catch (err) {
    console.error(errorName(err));
    return { messages: 0, conversations: 0, skipped: true };
  }

  return { messages: rows.length, conversations: conversationIds.size, skipped: false };
}
