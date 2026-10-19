import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.ts";
import { scrubWhatsAppBotPhi, WHATSAPP_BOT_PHI_SCRUB_ACTION } from "./migrate-whatsapp-bot-phi.ts";

function tempSqlite(): { db: DatabaseSync; close: () => void } {
  const file = path.join(os.tmpdir(), `lumera-wa-phi-scrub-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = new DatabaseSync(file);
  return {
    db,
    close: () => {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function createScrubTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE whatsapp_conversations (
      id TEXT PRIMARY KEY,
      patient_phone TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      last_message TEXT NOT NULL DEFAULT '',
      last_message_time TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE whatsapp_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      translated_content TEXT,
      buttons TEXT,
      media TEXT,
      created_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      tenant_id TEXT NOT NULL DEFAULT '',
      patient_id TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

describe("WhatsApp bot PHI scrub", () => {
  it("scrubs bot previews, writes one audit row without PHI, and a second run is a no-op", () => {
    const { db, close } = tempSqlite();
    const diagnosis = "SECRET-DIAG-991";
    const labNote = "SECRET-LAB-774";
    const translatedOnly = "SECRET-XLATE-331";
    const rxContent = `💊 *Prescription Record Found (RX-991)*\n*Diagnosis*: ${diagnosis}`;
    const labContent = `🔬 *Verified Lab Diagnostic Report*\n*Doctor's Interpretation*:\n"${labNote}"`;
    const agentContent = `Official Digital Prescription\nUHID: LUM-KEEP-1\nDiagnosis: ${diagnosis}`;
    const agentTranslation = `Agent translation ${diagnosis}`;
    try {
      createScrubTables(db);
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-rx', '+919800011991', 'Hidden Patient', ?, '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run("💊 *Prescription Record Found (RX-991)*");
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-lab', '+919800011774', 'Hidden Patient', ?, '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run("🔬 *Verified Lab Diagnostic Report*");
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-agent', '+919800011000', 'Hidden Patient', ?, '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run("Official Digital Prescription");
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-xlate', '+919800011331', 'Hidden Patient', 'See you tomorrow', '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run();
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, buttons, media, created_at, tenant_id)
         VALUES ('msg-rx', 'conv-rx', '+919800011991', 'bot', ?, ?, '["Preview"]', ?, '2026-10-19T00:00:01.000Z', 'tenant-a')`
      ).run(rxContent, `अनुवाद ${diagnosis}`, JSON.stringify({ type: "pdf", previewData: { diagnosis, rx_number: "RX-991" } }));
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, buttons, media, created_at, tenant_id)
         VALUES ('msg-lab', 'conv-lab', '+919800011774', 'bot', ?, ?, '["Preview"]', ?, '2026-10-19T00:00:02.000Z', 'tenant-a')`
      ).run(labContent, `अनुवाद ${labNote}`, JSON.stringify({ type: "pdf", previewData: { doctor_interpretation: labNote } }));
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, buttons, media, created_at, tenant_id)
         VALUES ('msg-xlate', 'conv-xlate', '+919800011331', 'bot', 'See you tomorrow', ?, NULL, NULL, '2026-10-19T00:00:04.000Z', 'tenant-a')`
      ).run(`🔬 *Verified Lab Diagnostic Report*\n${translatedOnly}`);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, buttons, media, created_at, tenant_id)
         VALUES ('msg-agent', 'conv-agent', '+919800011000', 'agent', ?, ?, NULL, NULL, '2026-10-19T00:00:03.000Z', 'tenant-a')`
      ).run(agentContent, agentTranslation);

      const first = scrubWhatsAppBotPhi(db);
      assert.equal(first.skipped, false);
      assert.equal(first.messages, 3);
      assert.equal(first.conversations, 2);

      const rx = db.prepare("SELECT content, translated_content, media, buttons FROM whatsapp_messages WHERE id = 'msg-rx'").get() as {
        content: string;
        translated_content: string | null;
        media: string | null;
        buttons: string | null;
      };
      const lab = db.prepare("SELECT content, translated_content, media, buttons FROM whatsapp_messages WHERE id = 'msg-lab'").get() as {
        content: string;
        translated_content: string | null;
        media: string | null;
        buttons: string | null;
      };
      const translated = db.prepare("SELECT content, translated_content, media, buttons FROM whatsapp_messages WHERE id = 'msg-xlate'").get() as {
        content: string;
        translated_content: string | null;
        media: string | null;
        buttons: string | null;
      };
      const agent = db.prepare("SELECT content, translated_content, media, buttons FROM whatsapp_messages WHERE id = 'msg-agent'").get() as {
        content: string;
        translated_content: string | null;
        media: string | null;
        buttons: string | null;
      };
      assert.equal(rx.content, "your prescription is ready");
      assert.equal(rx.translated_content, null);
      assert.equal(rx.media, null);
      assert.equal(rx.buttons, null);
      assert.equal(lab.content, "your lab report is ready");
      assert.equal(lab.translated_content, null);
      assert.equal(lab.media, null);
      assert.equal(lab.buttons, null);
      assert.equal(translated.content, "your lab report is ready");
      assert.equal(translated.translated_content, null);
      assert.equal(translated.media, null);
      assert.equal(agent.content, agentContent);
      assert.equal(agent.translated_content, agentTranslation);
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-rx'").get() as { last_message: string }).last_message,
        "your prescription is ready"
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-lab'").get() as { last_message: string }).last_message,
        "your lab report is ready"
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-agent'").get() as { last_message: string }).last_message,
        "Official Digital Prescription"
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-xlate'").get() as { last_message: string }).last_message,
        "See you tomorrow"
      );

      const audits = db.prepare("SELECT action, details, user_name FROM audit_logs").all() as {
        action: string;
        details: string;
        user_name: string;
      }[];
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, WHATSAPP_BOT_PHI_SCRUB_ACTION);
      assert.equal(audits[0].details, "botMessages=3; conversations=2");
      assert.equal(audits[0].details.includes(diagnosis), false);
      assert.equal(audits[0].details.includes(labNote), false);
      assert.equal(audits[0].details.includes(translatedOnly), false);
      assert.equal(audits[0].details.includes("Hidden Patient"), false);
      assert.equal(audits[0].details.includes("previewData"), false);

      const snapshot = db.prepare("SELECT id, content, translated_content, media, buttons FROM whatsapp_messages ORDER BY id").all();
      const lastMessages = db.prepare("SELECT id, last_message FROM whatsapp_conversations ORDER BY id").all();
      const second = scrubWhatsAppBotPhi(db);
      assert.equal(second.skipped, true);
      assert.deepEqual(db.prepare("SELECT id, content, translated_content, media, buttons FROM whatsapp_messages ORDER BY id").all(), snapshot);
      assert.deepEqual(db.prepare("SELECT id, last_message FROM whatsapp_conversations ORDER BY id").all(), lastMessages);
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, 1);
    } finally {
      close();
    }
  });

  it("writes the neutral sentence into translated_content when that column is NOT NULL", () => {
    const { db, close } = tempSqlite();
    const translatedOnly = "SECRET-XLATE-NOTNULL";
    try {
      db.exec(`
        CREATE TABLE whatsapp_conversations (
          id TEXT PRIMARY KEY,
          patient_phone TEXT NOT NULL,
          patient_name TEXT NOT NULL,
          last_message TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE whatsapp_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          patient_phone TEXT NOT NULL,
          sender TEXT NOT NULL,
          content TEXT NOT NULL,
          translated_content TEXT NOT NULL,
          buttons TEXT,
          media TEXT,
          created_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE audit_logs (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          user_id TEXT,
          user_name TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          tenant_id TEXT NOT NULL DEFAULT '',
          patient_id TEXT NOT NULL DEFAULT '',
          actor_role TEXT NOT NULL DEFAULT '',
          entity_type TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT ''
        );
      `);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, created_at, tenant_id)
         VALUES ('msg-rx', 'conv-rx', '+919800011991', 'bot', ?, ?, '2026-10-19T00:00:01.000Z', 'tenant-a')`
      ).run("Prescription Record Found", `अनुवाद ${translatedOnly}`);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, created_at, tenant_id)
         VALUES ('msg-lab', 'conv-lab', '+919800011774', 'bot', 'See you tomorrow', ?, '2026-10-19T00:00:02.000Z', 'tenant-a')`
      ).run(`Verified Lab Diagnostic Report ${translatedOnly}`);

      const first = scrubWhatsAppBotPhi(db);
      assert.equal(first.skipped, false);
      assert.equal(first.messages, 2);
      const rx = db.prepare("SELECT content, translated_content FROM whatsapp_messages WHERE id = 'msg-rx'").get() as {
        content: string;
        translated_content: string;
      };
      const lab = db.prepare("SELECT content, translated_content FROM whatsapp_messages WHERE id = 'msg-lab'").get() as {
        content: string;
        translated_content: string;
      };
      assert.equal(rx.content, "your prescription is ready");
      assert.equal(rx.translated_content, "your prescription is ready");
      assert.equal(lab.content, "your lab report is ready");
      assert.equal(lab.translated_content, "your lab report is ready");
      const audit = db.prepare("SELECT details FROM audit_logs").get() as { details: string };
      assert.equal(audit.details, "botMessages=2; conversations=0");
      assert.equal(audit.details.includes(translatedOnly), false);
      const second = scrubWhatsAppBotPhi(db);
      assert.equal(second.skipped, true);
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, 1);
      assert.equal(
        (db.prepare("SELECT translated_content FROM whatsapp_messages WHERE id = 'msg-lab'").get() as { translated_content: string })
          .translated_content,
        "your lab report is ready"
      );
    } finally {
      close();
    }
  });

  it("stays idempotent across two sqlite migrate boots and does not use sqlite-only catalog queries", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("./migrate-whatsapp-bot-phi.ts", import.meta.url)), "utf8");
    assert.equal(/sqlite_master|\bPRAGMA\b|\bINSTR\s*\(/i.test(source), false);
    const { db, close } = tempSqlite();
    try {
      migrate(db);
      migrate(db);
      const count = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get(WHATSAPP_BOT_PHI_SCRUB_ACTION) as {
        c: number;
      };
      assert.equal(Number(count.c), 1);
    } finally {
      close();
    }
  });
});
