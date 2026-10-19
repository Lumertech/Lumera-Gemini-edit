import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { migrate, scrubHistoricalSendRxMessages, SEND_RX_MESSAGE_MARKER } from "./db-migrate.ts";

function tempSqlite(): { db: DatabaseSync; close: () => void } {
  const file = path.join(
    os.tmpdir(),
    `lumera-scrub-rx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  const db = new DatabaseSync(file);
  return {
    db,
    close: () => {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function legacyContent(uhid: string, diagnosis: string, drug: string): string {
  const pdfUrl = "/api/whatsapp/prescription/RX-OLD-1/pdf";
  return (
    `🩺 *North Clinic*\n*Official Digital Prescription*\n\nNamaste *Asha Rao* (UHID: ${uhid}),\n` +
    `Your consultation prescription has been finalized and signed by *Dr North* (General Medicine).\n\n` +
    `📋 *Diagnosis:* ${diagnosis}\n💊 *Prescribed Medications (1):*\n  1. *${drug}* (650 mg - 1-0-1)\n\n` +
    `📄 *Download Official PDF Prescription:*\n${pdfUrl}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`
  );
}

function legacyButtons(): string {
  return JSON.stringify([
    { type: "URL", text: "📥 View / Download PDF Rx", url: "/api/whatsapp/prescription/RX-OLD-1/pdf" },
    { type: "QUICK_REPLY", text: "📅 Book Follow-Up", payload: "book_followup" },
  ]);
}

function legacyMedia(rxNumber: string): string {
  return JSON.stringify({
    type: "document",
    url: `/api/whatsapp/prescription/${rxNumber}/pdf`,
    title: `Prescription-${rxNumber}.pdf`,
  });
}

type MessageRow = {
  id: string;
  tenant_id: string;
  created_at: string;
  time_display: string;
  status: string;
  direction: string;
  wamid: string;
  sender: string;
  conversation_id: string;
  patient_phone: string;
  staff_name: string;
  content: string;
  translated_content: string | null;
  buttons: string | null;
  media: string | null;
  body: string | null;
  metadata: string | null;
  detected_language: string;
};

function insertMessage(
  db: DatabaseSync,
  row: {
    id: string;
    content: string;
    buttons?: string | null;
    media?: string | null;
    translated?: string | null;
    body?: string | null;
    metadata?: string | null;
    status?: string;
    direction?: string;
    wamid?: string;
  }
) {
  db.prepare(
    `INSERT INTO whatsapp_messages (
       id, conversation_id, patient_phone, sender, staff_name, content, translated_content,
       detected_language, time_display, buttons, media, audio_url, voice_transcript, status,
       created_at, tenant_id, body, metadata, direction, wamid
     ) VALUES (?, 'conv-1', '+919800011122', 'agent', 'Dr North', ?, ?, 'en', '4:10 PM', ?, ?, null, null, ?, '2026-01-02T04:10:00.000Z', 'tenant-north', ?, ?, ?, ?)`
  ).run(
    row.id,
    row.content,
    row.translated === undefined ? null : row.translated,
    row.buttons === undefined ? null : row.buttons,
    row.media === undefined ? null : row.media,
    row.status || "delivered",
    row.body === undefined ? null : row.body,
    row.metadata === undefined ? null : row.metadata,
    row.direction || "outbound",
    row.wamid || ""
  );
}

function readRow(db: DatabaseSync, id: string): MessageRow {
  return db.prepare("SELECT * FROM whatsapp_messages WHERE id = ?").get(id) as MessageRow;
}

describe("historical send-rx message scrub", () => {
  it("replaces send-rx PHI with the marker and leaves every other row", () => {
    const { db, close } = tempSqlite();
    try {
      migrate(db);
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN body TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN metadata TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN direction TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN wamid TEXT");

      const diagnosis = "SECRET_DIAGNOSIS";
      const drug = "SECRET_DRUG";
      const uhid = "UHID-SECRET";
      insertMessage(db, {
        id: "msg-rx-old",
        content: legacyContent(uhid, diagnosis, drug),
        translated: legacyContent(uhid, diagnosis, drug),
        buttons: legacyButtons(),
        media: legacyMedia("RX-OLD-1"),
        body: legacyContent(uhid, diagnosis, drug),
        metadata: legacyMedia("RX-OLD-1"),
        status: "delivered",
        direction: "outbound",
        wamid: "wamid.KEEP",
      });
      insertMessage(db, {
        id: "msg-media-only",
        content: "staff note",
        media: legacyMedia("RX-MEDIA"),
        status: "sent",
        direction: "outbound",
        wamid: "wamid.MEDIA",
      });
      insertMessage(db, {
        id: "msg-buttons-only",
        content: "staff note",
        buttons: legacyButtons(),
        status: "read",
        wamid: "wamid.BUTTONS",
      });
      insertMessage(db, {
        id: "msg-chat",
        content: "Namaste (UHID: LUM-1), your appointment is booked.",
        buttons: JSON.stringify(["📅 Book Doctor Appointment", "💊 Refill / View Prescription"]),
        status: "read",
        direction: "inbound",
        wamid: "wamid.CHAT",
      });
      insertMessage(db, {
        id: "msg-lab",
        content: "Your lab report is ready.",
        media: JSON.stringify({
          type: "document",
          url: "/api/whatsapp/lab-report/LAB-1/pdf",
          title: "Lab-LAB-1.pdf",
        }),
        direction: "outbound",
        wamid: "wamid.LAB",
      });
      insertMessage(db, {
        id: "msg-emr-pdf",
        content: "Download from the portal.",
        media: JSON.stringify({
          type: "document",
          url: "/api/emr/prescription/rx-101/pdf",
          title: "Prescription-rx-101.pdf",
        }),
        wamid: "wamid.EMR",
      });

      const changed = scrubHistoricalSendRxMessages(db);
      assert.equal(changed, 3);

      const scrubbed = readRow(db, "msg-rx-old");
      assert.equal(scrubbed.content, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.translated_content, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.buttons, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.media, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.body, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.metadata, SEND_RX_MESSAGE_MARKER);
      assert.equal(scrubbed.id, "msg-rx-old");
      assert.equal(scrubbed.tenant_id, "tenant-north");
      assert.equal(scrubbed.created_at, "2026-01-02T04:10:00.000Z");
      assert.equal(scrubbed.time_display, "4:10 PM");
      assert.equal(scrubbed.status, "delivered");
      assert.equal(scrubbed.direction, "outbound");
      assert.equal(scrubbed.wamid, "wamid.KEEP");
      assert.equal(scrubbed.sender, "agent");
      assert.equal(scrubbed.conversation_id, "conv-1");
      assert.equal(scrubbed.patient_phone, "+919800011122");
      assert.equal(scrubbed.staff_name, "Dr North");
      assert.equal(JSON.stringify(scrubbed).includes(diagnosis), false);
      assert.equal(JSON.stringify(scrubbed).includes(drug), false);
      assert.equal(JSON.stringify(scrubbed).includes(uhid), false);
      assert.equal(JSON.stringify(scrubbed).includes("/api/whatsapp/prescription/"), false);

      const mediaOnly = readRow(db, "msg-media-only");
      assert.equal(mediaOnly.content, SEND_RX_MESSAGE_MARKER);
      assert.equal(mediaOnly.media, SEND_RX_MESSAGE_MARKER);
      assert.equal(mediaOnly.translated_content, null);
      assert.equal(mediaOnly.status, "sent");
      assert.equal(mediaOnly.wamid, "wamid.MEDIA");

      const buttonsOnly = readRow(db, "msg-buttons-only");
      assert.equal(buttonsOnly.content, SEND_RX_MESSAGE_MARKER);
      assert.equal(buttonsOnly.buttons, SEND_RX_MESSAGE_MARKER);
      assert.equal(buttonsOnly.status, "read");
      assert.equal(buttonsOnly.wamid, "wamid.BUTTONS");

      for (const id of ["msg-chat", "msg-lab", "msg-emr-pdf"]) {
        const row = readRow(db, id);
        assert.notEqual(row.content, SEND_RX_MESSAGE_MARKER);
        assert.equal(JSON.stringify(row).includes(SEND_RX_MESSAGE_MARKER), false);
      }
      assert.equal(readRow(db, "msg-chat").wamid, "wamid.CHAT");
      assert.equal(readRow(db, "msg-lab").media.includes("lab-report"), true);
      assert.equal(readRow(db, "msg-emr-pdf").media.includes("/api/emr/prescription/"), true);
    } finally {
      close();
    }
  });

  it("is a no-op on the second migrate", () => {
    const { db, close } = tempSqlite();
    try {
      migrate(db);
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN body TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN metadata TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN direction TEXT");
      db.exec("ALTER TABLE whatsapp_messages ADD COLUMN wamid TEXT");
      insertMessage(db, {
        id: "msg-rx-boot",
        content: legacyContent("UHID-BOOT", "BOOT_DIAGNOSIS", "BOOT_DRUG"),
        buttons: legacyButtons(),
        media: legacyMedia("RX-BOOT"),
        body: "BOOT_DIAGNOSIS",
        metadata: legacyMedia("RX-BOOT"),
        wamid: "wamid.BOOT",
      });
      insertMessage(db, {
        id: "msg-keep",
        content: "Ordinary clinic reply",
        buttons: JSON.stringify([{ type: "QUICK_REPLY", text: "Thanks", payload: "thanks" }]),
        wamid: "wamid.KEEPCHAT",
      });

      migrate(db);
      assert.equal(readRow(db, "msg-rx-boot").content, SEND_RX_MESSAGE_MARKER);
      assert.equal(readRow(db, "msg-rx-boot").wamid, "wamid.BOOT");
      assert.equal(readRow(db, "msg-keep").content, "Ordinary clinic reply");

      const afterFirst = db.prepare("SELECT * FROM whatsapp_messages ORDER BY id").all();
      assert.equal(scrubHistoricalSendRxMessages(db), 0);
      migrate(db);
      assert.deepEqual(db.prepare("SELECT * FROM whatsapp_messages ORDER BY id").all(), afterFirst);
      assert.equal(JSON.stringify(afterFirst).includes("BOOT_DIAGNOSIS"), false);
    } finally {
      close();
    }
  });
});
