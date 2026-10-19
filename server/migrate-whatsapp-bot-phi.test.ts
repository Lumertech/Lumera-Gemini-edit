import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.ts";
import {
  scrubWhatsAppBotPhi,
  WHATSAPP_BOT_PHI_SCRUB_ACTION,
  WHATSAPP_BOT_PHI_SCRUB_ACTION_V1,
  WHATSAPP_BOT_PHI_SCRUB_NOTICE,
  WHATSAPP_BOT_PHI_SCRUB_REASON,
} from "./migrate-whatsapp-bot-phi.ts";
import type { SqlDatabase } from "./sql-engine.ts";

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
         VALUES ('msg-xlate', 'conv-xlate', '+919800011331', 'bot', 'See you tomorrow', ?, NULL, NULL, '2026-10-19T00:00:04.000Z', 'tenant-b')`
      ).run(`🔬 *Verified Lab Diagnostic Report*\n${translatedOnly}`);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, buttons, media, created_at, tenant_id)
         VALUES ('msg-agent', 'conv-agent', '+919800011000', 'agent', ?, ?, NULL, NULL, '2026-10-19T00:00:03.000Z', 'tenant-a')`
      ).run(agentContent, agentTranslation);
      const bookingUhid = "🎉 *Appointment Confirmed!*\n*UHID*: LUM-KEEP-UHID\n*Token*: #12";
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-uhid', '+919800011012', 'Hidden Patient', ?, '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run(bookingUhid);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, created_at, tenant_id)
         VALUES ('msg-uhid', 'conv-uhid', '+919800011012', 'bot', ?, ?, '2026-10-19T00:00:05.000Z', 'tenant-a')`
      ).run(bookingUhid, "UHID LUM-KEEP-UHID");
      const orphanPreview = "💊 *Prescription Record Found (RX-ORPHAN)*";
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-orphan', '+919800011099', 'Hidden Patient', ?, '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run(orphanPreview);

      const first = scrubWhatsAppBotPhi(db);
      assert.equal(first.skipped, false);
      assert.equal(first.messages, 3);
      assert.equal(first.conversations, 3);

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
      assert.equal(rx.content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(rx.translated_content, null);
      assert.equal(rx.media, null);
      assert.equal(rx.buttons, null);
      assert.equal(lab.content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(lab.translated_content, null);
      assert.equal(lab.media, null);
      assert.equal(lab.buttons, null);
      assert.equal(translated.content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(translated.translated_content, null);
      assert.equal(translated.media, null);
      assert.equal(agent.content, agentContent);
      assert.equal(agent.translated_content, agentTranslation);
      const uhid = db.prepare("SELECT content, translated_content FROM whatsapp_messages WHERE id = 'msg-uhid'").get() as {
        content: string;
        translated_content: string;
      };
      assert.equal(uhid.content, bookingUhid);
      assert.equal(uhid.translated_content, "UHID LUM-KEEP-UHID");
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-rx'").get() as { last_message: string }).last_message,
        WHATSAPP_BOT_PHI_SCRUB_NOTICE
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-lab'").get() as { last_message: string }).last_message,
        WHATSAPP_BOT_PHI_SCRUB_NOTICE
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-agent'").get() as { last_message: string }).last_message,
        "Official Digital Prescription"
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-xlate'").get() as { last_message: string }).last_message,
        "See you tomorrow"
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-orphan'").get() as { last_message: string }).last_message,
        orphanPreview
      );
      assert.equal(
        (db.prepare("SELECT last_message FROM whatsapp_conversations WHERE id = 'conv-uhid'").get() as { last_message: string }).last_message,
        bookingUhid
      );

      const audits = db.prepare("SELECT action, details, user_name FROM audit_logs").all() as {
        action: string;
        details: string;
        user_name: string;
      }[];
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, WHATSAPP_BOT_PHI_SCRUB_ACTION);
      assert.equal(audits[0].user_name, "System");
      const details = JSON.parse(audits[0].details) as {
        reason: string;
        messageIds: string[];
        conversationIds: string[];
        countsByTenant: Record<string, number>;
      };
      assert.equal(details.reason, WHATSAPP_BOT_PHI_SCRUB_REASON);
      assert.deepEqual(details.messageIds, ["msg-lab", "msg-rx", "msg-xlate"]);
      assert.deepEqual(details.conversationIds, ["conv-lab", "conv-rx", "conv-xlate"]);
      assert.deepEqual(details.countsByTenant, { "tenant-a": 2, "tenant-b": 1 });
      for (const secret of [diagnosis, labNote, translatedOnly, "Hidden Patient", "previewData", "LUM-KEEP-UHID", orphanPreview]) {
        assert.equal(audits[0].details.includes(secret), false, secret);
      }

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
      assert.equal(rx.content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(rx.translated_content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(lab.content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      assert.equal(lab.translated_content, WHATSAPP_BOT_PHI_SCRUB_NOTICE);
      const audit = db.prepare("SELECT action, details FROM audit_logs").get() as { action: string; details: string };
      assert.equal(audit.action, WHATSAPP_BOT_PHI_SCRUB_ACTION);
      const details = JSON.parse(audit.details) as { reason: string; messageIds: string[] };
      assert.equal(details.reason, WHATSAPP_BOT_PHI_SCRUB_REASON);
      assert.deepEqual(details.messageIds, ["msg-lab", "msg-rx"]);
      assert.equal(audit.details.includes(translatedOnly), false);
      const second = scrubWhatsAppBotPhi(db);
      assert.equal(second.skipped, true);
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, 1);
      assert.equal(
        (db.prepare("SELECT translated_content FROM whatsapp_messages WHERE id = 'msg-lab'").get() as { translated_content: string })
          .translated_content,
        WHATSAPP_BOT_PHI_SCRUB_NOTICE
      );
    } finally {
      close();
    }
  });

  it("replaces a dev database's old scrub action with one new audit row", () => {
    const { db, close } = tempSqlite();
    const secret = "SECRET-OLD-ACTION";
    try {
      createScrubTables(db);
      db.prepare(
        `INSERT INTO audit_logs (id, timestamp, user_name, action, details)
         VALUES ('old-audit', '2026-10-01T00:00:00.000Z', 'System', ?, 'botMessages=1; conversations=0')`
      ).run(WHATSAPP_BOT_PHI_SCRUB_ACTION_V1);
      db.prepare(
        `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, last_message, updated_at, tenant_id)
         VALUES ('conv-old', '+919800011001', 'Hidden Patient', 'See you tomorrow', '2026-10-19T00:00:00.000Z', 'tenant-a')`
      ).run();
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, created_at, tenant_id)
         VALUES ('msg-old', 'conv-old', '+919800011001', 'bot', 'See you tomorrow', ?, '2026-10-19T00:00:01.000Z', 'tenant-a')`
      ).run(`Prescription Record Found ${secret}`);

      const first = scrubWhatsAppBotPhi(db);
      assert.equal(first.skipped, false);
      assert.equal(
        (db.prepare("SELECT content, translated_content FROM whatsapp_messages WHERE id = 'msg-old'").get() as { content: string; translated_content: string | null })
          .content,
        WHATSAPP_BOT_PHI_SCRUB_NOTICE
      );
      const audits = db.prepare("SELECT action, details FROM audit_logs").all() as { action: string; details: string }[];
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, WHATSAPP_BOT_PHI_SCRUB_ACTION);
      assert.equal(audits[0].details.includes(secret), false);
      assert.equal(audits[0].details.includes(WHATSAPP_BOT_PHI_SCRUB_ACTION_V1), false);
      const second = scrubWhatsAppBotPhi(db);
      assert.equal(second.skipped, true);
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, 1);
    } finally {
      close();
    }
  });

  it("a forced scrub error rolls back and does not escape migrate()", () => {
    const secret = "SECRET-FORCED-SCRUB";
    const { db, close } = tempSqlite();
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    const failOnMarkerInsert = (inner: DatabaseSync): SqlDatabase => ({
      exec(sql: string) {
        if (sql.includes("INSERT INTO audit_logs") && sql.includes(WHATSAPP_BOT_PHI_SCRUB_ACTION)) {
          const err = new Error(`forced failure ${secret} ${sql}`);
          err.name = "ForcedScrubError";
          throw err;
        }
        inner.exec(sql);
      },
      prepare(sql: string) {
        return inner.prepare(sql);
      },
    });
    try {
      createScrubTables(db);
      db.prepare(
        `INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, content, translated_content, created_at, tenant_id)
         VALUES ('msg-keep', 'conv-keep', '+919800011777', 'bot', ?, NULL, '2026-10-19T00:00:01.000Z', 'tenant-a')`
      ).run(`Prescription Record Found ${secret}`);
      const result = scrubWhatsAppBotPhi(failOnMarkerInsert(db));
      assert.equal(result.skipped, true);
      assert.equal(
        (db.prepare("SELECT content FROM whatsapp_messages WHERE id = 'msg-keep'").get() as { content: string }).content,
        `Prescription Record Found ${secret}`
      );
      assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, 0);

      const boot = tempSqlite();
      try {
        assert.doesNotThrow(() => migrate(failOnMarkerInsert(boot.db)));
        assert.equal(
          (boot.db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get(WHATSAPP_BOT_PHI_SCRUB_ACTION) as { c: number }).c,
          0
        );
      } finally {
        boot.close();
      }
      const blob = JSON.stringify(logs);
      assert.equal(blob.includes(secret), false);
      assert.equal(blob.includes("INSERT INTO audit_logs"), false);
      assert.equal(blob.includes("Prescription Record Found"), false);
      assert.ok(logs.some((entry) => entry.length === 1 && entry[0] === "ForcedScrubError"));
    } finally {
      console.error = original;
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
