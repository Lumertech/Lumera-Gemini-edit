import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationInitial,
  findConversationIdByPhone,
  normalizeWhatsAppConversation,
  normalizeWhatsAppConversations,
  normalizeWhatsAppMessage,
  resolveOutboundPatient,
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

describe("Outbound target follows the selected EMR patient", () => {
  const inbox = [
    { id: "conv-rajiv", patient_phone: "+91 98234 55667", patient_name: "Rajiv Saxena" },
    { id: "conv-a1", patient_phone: "+91 99999 73271", patient_name: "A1 Test Recipient" },
  ];

  it("uses the EMR phone for outbound even when an inbox thread is open", () => {
    const target = resolveOutboundPatient({
      currentPatientName: "A1 Test Recipient",
      currentPatientPhone: "+919999973271",
      conversationName: "Rajiv Saxena",
      conversationPhone: "+91 98234 55667",
    });
    assert.equal(target.name, "A1 Test Recipient");
    assert.equal(target.phone, "+919999973271");
  });

  it("falls back to the open conversation when the EMR phone is blank", () => {
    const target = resolveOutboundPatient({
      currentPatientName: "Unassigned",
      currentPatientPhone: "  ",
      conversationName: "Rajiv Saxena",
      conversationPhone: "+91 98234 55667",
    });
    assert.equal(target.name, "Rajiv Saxena");
    assert.equal(target.phone, "+91 98234 55667");
  });

  it("matches +91, 91, and spaced forms and does not invent a conversation", () => {
    assert.equal(findConversationIdByPhone(inbox, "+919999973271"), "conv-a1");
    assert.equal(findConversationIdByPhone(inbox, "91 99999 73271"), "conv-a1");
    assert.equal(findConversationIdByPhone(inbox, "9999973271"), "conv-a1");
    assert.equal(findConversationIdByPhone(inbox, "+91 90000 00000"), null);
    assert.equal(findConversationIdByPhone(inbox, ""), null);
  });
});
