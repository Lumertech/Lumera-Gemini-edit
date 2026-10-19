import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";

/**
 * One-time scrub of bot replies that embedded a prescription or lab preview.
 * The same SQL runs on SQLite and Postgres. It does not query the catalog.
 * A second boot sees the audit row and does not write again.
 *
 * Neutral sentences match processBotActionOrQuery. send-rx rows stay: they
 * are sender 'agent', not 'bot'.
 */
export const WHATSAPP_BOT_PHI_SCRUB_ACTION = "WhatsApp bot PHI scrub";

const RX_READY = "your prescription is ready";
const LAB_READY = "your lab report is ready";
const RX_MARKER = "Prescription Record Found";
const LAB_MARKER = "Verified Lab Diagnostic Report";
const PREVIEW_MARKER = "previewData";

const MESSAGE_MATCH = `sender = 'bot' AND (
  COALESCE(content, '') LIKE ? OR COALESCE(media, '') LIKE ?
  OR COALESCE(content, '') LIKE ? OR COALESCE(media, '') LIKE ?
  OR COALESCE(content, '') LIKE ? OR COALESCE(media, '') LIKE ?
)`;

function likeTerm(marker: string): string {
  return `%${marker}%`;
}

function markerPairs(): string[] {
  return [PREVIEW_MARKER, PREVIEW_MARKER, RX_MARKER, RX_MARKER, LAB_MARKER, LAB_MARKER].map(likeTerm);
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

  const messageCount = database
    .prepare(`SELECT COUNT(*) AS c FROM whatsapp_messages WHERE ${MESSAGE_MATCH}`)
    .get(...markerPairs()) as { c?: number };
  const messages = Number(messageCount?.c || 0);

  database
    .prepare(
      `UPDATE whatsapp_messages
       SET content = CASE
         WHEN COALESCE(content, '') LIKE ? OR COALESCE(media, '') LIKE ? THEN ?
         ELSE ?
       END,
       media = NULL,
       buttons = NULL
       WHERE ${MESSAGE_MATCH}`
    )
    .run(likeTerm(LAB_MARKER), likeTerm(LAB_MARKER), LAB_READY, RX_READY, ...markerPairs());

  const conversationCount = database
    .prepare(
      `SELECT COUNT(*) AS c FROM whatsapp_conversations
       WHERE COALESCE(last_message, '') LIKE ?
          OR COALESCE(last_message, '') LIKE ?
          OR COALESCE(last_message, '') LIKE ?`
    )
    .get(likeTerm(LAB_MARKER), likeTerm(RX_MARKER), likeTerm(PREVIEW_MARKER)) as { c?: number };
  const conversations = Number(conversationCount?.c || 0);

  database
    .prepare(
      `UPDATE whatsapp_conversations
       SET last_message = COALESCE(
         (
           SELECT m.content FROM whatsapp_messages m
           WHERE m.conversation_id = whatsapp_conversations.id
             AND m.sender = 'bot'
             AND m.content IN (?, ?)
           ORDER BY m.created_at DESC
           LIMIT 1
         ),
         CASE WHEN COALESCE(last_message, '') LIKE ? THEN ? ELSE ? END
       )
       WHERE COALESCE(last_message, '') LIKE ?
          OR COALESCE(last_message, '') LIKE ?
          OR COALESCE(last_message, '') LIKE ?`
    )
    .run(
      RX_READY,
      LAB_READY,
      likeTerm(LAB_MARKER),
      LAB_READY,
      RX_READY,
      likeTerm(LAB_MARKER),
      likeTerm(RX_MARKER),
      likeTerm(PREVIEW_MARKER)
    );

  const details = `botMessages=${messages}; conversations=${conversations}`;
  database
    .prepare(
      `INSERT INTO audit_logs (
        id, timestamp, user_id, user_name, action, details,
        tenant_id, patient_id, actor_role, entity_type, entity_id
      ) VALUES (?, ?, NULL, 'System', ?, ?, '', '', '', 'whatsapp_message', '')`
    )
    .run(crypto.randomUUID(), new Date().toISOString(), WHATSAPP_BOT_PHI_SCRUB_ACTION, details);

  return { messages, conversations, skipped: false };
}
