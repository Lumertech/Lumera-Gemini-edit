import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeWhatsAppMessage } from "../src/lib/whatsappInbox.ts";
import { dropWhatsAppMessageAudioUrl } from "./db-migrate.ts";
import type { SqlDatabase } from "./sql-engine.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function productionSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      files.push(full);
    }
  };
  walk(path.join(root, "server"));
  walk(path.join(root, "src"));
  return files;
}

function messageWrites(source: string): string[] {
  const writes: string[] = [];
  const re = /(?:INSERT\s+INTO|UPDATE)\s+whatsapp_messages\b[\s\S]*?`/gi;
  for (const match of source.matchAll(re)) writes.push(match[0]);
  return writes;
}

function scriptedPostgres(columnPresent: boolean): SqlDatabase & { sqls: string[] } {
  const sqls: string[] = [];
  return {
    dialect: "postgres",
    sqls,
    prepare(sql: string) {
      return {
        run() {
          return { changes: 0, lastInsertRowid: 0 };
        },
        get() {
          return /audio_url/.test(sql) && columnPresent ? { name: "audio_url" } : undefined;
        },
        all() {
          return [];
        },
      };
    },
    exec(sql: string) {
      sqls.push(sql);
    },
  };
}

describe("whatsapp_messages does not store voice-note audio", () => {
  it("drops audio_url only when the column is still present", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, content TEXT NOT NULL, audio_url TEXT)");
    dropWhatsAppMessageAudioUrl(sqlite);
    dropWhatsAppMessageAudioUrl(sqlite);
    const names = sqlite
      .prepare("PRAGMA table_info(whatsapp_messages)")
      .all()
      .map((column) => String((column as { name?: string }).name));
    assert.deepEqual(names.includes("audio_url"), false);
    assert.deepEqual(names, ["id", "content"]);

    const fresh = new DatabaseSync(":memory:");
    fresh.exec("CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, content TEXT NOT NULL)");
    dropWhatsAppMessageAudioUrl(fresh);
    const freshNames = fresh
      .prepare("PRAGMA table_info(whatsapp_messages)")
      .all()
      .map((column) => String((column as { name?: string }).name));
    assert.deepEqual(freshNames, ["id", "content"]);

    const present = scriptedPostgres(true);
    dropWhatsAppMessageAudioUrl(present);
    assert.deepEqual(present.sqls, ["ALTER TABLE whatsapp_messages DROP COLUMN audio_url"]);
    const absent = scriptedPostgres(false);
    dropWhatsAppMessageAudioUrl(absent);
    assert.deepEqual(absent.sqls, []);
  });

  it("keeps inserts and updates off audio, media URLs, and file paths, and the inbox omits audio_url", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const rel = path.relative(root, file);
      const source = fs.readFileSync(file, "utf8");
      const writes = messageWrites(source);
      if (/(?:INSERT\s+INTO|UPDATE)\s+whatsapp_messages\b/i.test(source) && writes.length === 0) {
        offenders.push(`${rel} has a whatsapp_messages write the scanner missed`);
      }
      for (const write of writes) {
        if (/audio_url|audioUrl|voice[-_ ]?note|\/uploads\b|file:\/\/|https?:\/\//i.test(write)) {
          offenders.push(`${rel} writes audio or a file location:\n${write}`);
        }
      }
    }
    assert.deepEqual(offenders, []);

    const whatsapp = fs.readFileSync(path.join(root, "server/whatsapp.ts"), "utf8");
    const serializer = whatsapp.slice(
      whatsapp.indexOf("function serializeWhatsAppMessage"),
      whatsapp.indexOf("function requireSessionTenant")
    );
    assert.equal(serializer.includes("audio_url"), false);
    assert.equal(serializer.includes("audioUrl"), false);

    const mapped = normalizeWhatsAppMessage({
      id: "msg-1",
      content: "hello",
      audioUrl: "https://cdn.example/note.ogg",
      audio_url: "/uploads/note.ogg",
    });
    assert.equal("audioUrl" in mapped, false);
    assert.equal("audio_url" in mapped, false);
    assert.equal(JSON.stringify(mapped).includes("note.ogg"), false);
    assert.equal(JSON.stringify(mapped).includes("audio"), false);
  });
});
