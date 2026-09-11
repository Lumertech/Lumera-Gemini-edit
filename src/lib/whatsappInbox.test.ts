import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationInitial,
  normalizeWhatsAppConversation,
  normalizeWhatsAppConversations,
  normalizeWhatsAppMessage,
} from "./whatsappInbox.ts";

describe("WhatsApp inbox API → suite UI mapping", () => {
  it("maps production camelCase conversations so patient_name.charAt does not throw", () => {
    const mapped = normalizeWhatsAppConversation({
      id: "conv-rajiv",
      patientPhone: "+91 98234 55667",
      patientName: "Rajiv Saxena",
      patientId: "pat-6",
      uhid: "LUM-2026-0106",
      handoverMode: "bot",
      assignedStaff: "Ramesh Patel (Reception)",
      tags: ["Appointment", "Prescription"],
      unreadCount: 0,
      lastMessage: "Namaste",
      lastMessageTime: "10:15 AM",
    });
    assert.equal(mapped.patient_name, "Rajiv Saxena");
    assert.equal(conversationInitial(mapped.patient_name), "R");
    assert.equal(mapped.patient_phone, "+91 98234 55667");
    assert.equal(mapped.handover_mode, "bot");
    assert.equal(mapped.patient_uhid, "LUM-2026-0106");
    assert.equal(mapped.tag, "Appointment");
    assert.doesNotThrow(() => conversationInitial(undefined));
    assert.equal(conversationInitial(""), "?");
  });

  it("keeps snake_case rows working and drops empty ids", () => {
    const rows = normalizeWhatsAppConversations([
      { id: "c1", patient_name: "Sunita", handover_mode: "human", unread_count: 2 },
      { patientName: "No id" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].handover_mode, "human");
    assert.equal(rows[0].unread_count, 2);
  });

  it("maps camelCase messages (time, conversationId) onto chat bubbles", () => {
    const msg = normalizeWhatsAppMessage({
      id: "m1",
      conversationId: "conv-rajiv",
      patientPhone: "+91 1",
      sender: "bot",
      staffName: "Meera",
      content: "Hello",
      translatedContent: "नमस्ते",
      detectedLanguage: "hi",
      time: "10:16 AM",
      buttons: ["Book"],
      media: null,
      createdAt: "2026-09-11T10:00:00.000Z",
    });
    assert.equal(msg.conversation_id, "conv-rajiv");
    assert.equal(msg.time_display, "10:16 AM");
    assert.equal(msg.staff_name, "Meera");
    assert.equal(msg.translated_content, "नमस्ते");
  });
});
