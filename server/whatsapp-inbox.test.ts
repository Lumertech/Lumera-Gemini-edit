import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  conversationInitial,
  normalizeWhatsAppConversations,
  normalizeWhatsAppMessages,
} from "../src/lib/whatsappInbox.ts";

async function jsonRequest(
  port: number,
  urlPath: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("WhatsApp inbox HTTP contract for /app/whatsapp", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-whatsapp-inbox";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns camelCase conversations the suite can render without throwing", async () => {
    const res = await jsonRequest(port, "/api/whatsapp/conversations");
    assert.equal(res.status, 200);
    const conversations = normalizeWhatsAppConversations(res.json.conversations);
    assert.ok(conversations.length > 0);
    for (const conv of conversations) {
      assert.ok(conv.patient_name);
      assert.doesNotThrow(() => conversationInitial(conv.patient_name));
    }
  });

  it("lists messages by query and by /messages/:id alias", async () => {
    const list = await jsonRequest(port, "/api/whatsapp/conversations");
    const first = (list.json.conversations as Array<{ id: string }>)[0];
    const byQuery = await jsonRequest(
      port,
      `/api/whatsapp/messages?conversationId=${encodeURIComponent(first.id)}`
    );
    const byPath = await jsonRequest(port, `/api/whatsapp/messages/${encodeURIComponent(first.id)}`);
    assert.equal(byQuery.status, 200);
    assert.equal(byPath.status, 200);
    const messages = normalizeWhatsAppMessages(byQuery.json.messages);
    const aliased = normalizeWhatsAppMessages(byPath.json.messages);
    assert.equal(aliased.length, messages.length);
    if (messages.length) {
      assert.ok(messages[0].content || messages[0].time_display !== undefined);
    }
  });
});
