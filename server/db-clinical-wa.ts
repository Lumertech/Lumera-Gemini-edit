import type { DatabaseSync } from "node:sqlite";

/** WhatsApp conversation/message/event demo rows.
 *  Extracted from db-clinical-seed.ts so MCP uploads stay under the payload ceiling.
 */
export function seedWhatsAppRowsIfMissing(database: DatabaseSync, now: string) {
  const convCount = database.prepare("SELECT COUNT(*) AS c FROM whatsapp_conversations").get() as { c: number };
  if (convCount.c === 0) {
    const insertConv = database.prepare(`
      INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, patient_id, uhid, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertConv.run(
      "conv-rajiv",
      "+91 98234 55667",
      "Rajiv Saxena",
      "pat-6",
      "LUM-2026-0106",
      "bot",
      "Ramesh Patel (Reception)",
      JSON.stringify(["Appointment", "Prescription"]),
      "en",
      0,
      "Namaste Rajiv Saxena! Welcome to Lumera Health Desk.",
      "10:15 AM",
      now
    );

    insertConv.run(
      "conv-sunita",
      "+91 98301 23456",
      "Sunita Roy",
      "pat-1",
      "LUM-2026-0101",
      "human",
      "Dr. Vikram Malhotra",
      JSON.stringify(["Prescription", "Emergency Triage"]),
      "hi",
      2,
      "\u0928\u092e\u0938\u094d\u0924\u0947 \u0921\u0949\u0915\u094d\u091f\u0930, \u092e\u0947\u0930\u0940 \u0936\u0941\u0917\u0930 \u0930\u093f\u092a\u094b\u0930\u094d\u091f 248 \u0906\u0908 \u0939\u0948, \u0915\u094d\u092f\u093e \u092e\u0941\u091d\u0947 \u0907\u0902\u0938\u0941\u0932\u093f\u0928 \u0936\u0941\u0930\u0942 \u0915\u0930\u0928\u093e \u0939\u094b\u0917\u093e?",
      "09:40 AM",
      now
    );

    insertConv.run(
      "conv-rohan",
      "+91 98200 45678",
      "Rohan Deshmukh",
      "pat-2",
      "LUM-2026-0102",
      "bot",
      "Unassigned",
      JSON.stringify(["Billing"]),
      "mr",
      0,
      "Can I get the UPI receipt for my OPD consultation fee?",
      "Yesterday",
      now
    );

    insertConv.run(
      "conv-priyanka",
      "+91 98311 44556",
      "Priyanka Mukherjee",
      "pat-7",
      "LUM-2026-0107",
      "bot",
      "Sunita Sharma (Nurse)",
      JSON.stringify(["Appointment"]),
      "en",
      1,
      "What time is Dr. Siddharth available for shoulder rehab session?",
      "Yesterday",
      now
    );

    const insertMsg = database.prepare(`
      INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, audio_url, voice_transcript, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMsg.run(
      "msg-1",
      "conv-rajiv",
      "+91 98234 55667",
      "bot",
      null,
      "Namaste Rajiv Saxena! \u{1F64F} Welcome to *Lumera Polyclinic WhatsApp Health Desk*.\n\nHow can we help you today?",
      null,
      "en",
      "10:15 AM",
      JSON.stringify(["\u{1F4C5} Book Doctor Appointment", "\u{1F48A} Refill / View Prescription", "\u{1F52C} Download Lab Reports", "\u23f0 Check Doctor Timings"]),
      null,
      null,
      null,
      "read",
      now
    );

    insertMsg.run(
      "msg-2",
      "conv-sunita",
      "+91 98301 23456",
      "user",
      null,
      "\u0928\u092e\u0938\u094d\u0924\u0947 \u0921\u0949\u0915\u094d\u091f\u0930, \u092e\u0947\u0930\u0940 \u0906\u091c \u0915\u0940 \u092a\u0940\u092a\u0940\u092c\u0940\u090f\u0938 \u0936\u0941\u0917\u0930 248 \u0906\u0908 \u0939\u0948\u0964 \u0925\u094b\u0921\u093c\u093e \u091a\u0915\u094d\u0915\u0930 \u0906 \u0930\u0939\u093e \u0939\u0948\u0964",
      "Hello Doctor, my post-prandial blood sugar today is 248. Feeling mild dizziness.",
      "hi",
      "09:38 AM",
      null,
      null,
      null,
      null,
      "delivered",
      now
    );

    insertMsg.run(
      "msg-3",
      "conv-sunita",
      "+91 98301 23456",
      "agent",
      "Dr. Vikram Malhotra",
      "\u0928\u092e\u0938\u094d\u0924\u0947 \u0938\u0941\u0928\u0940\u0924\u093e \u091c\u0940, \u092e\u0948\u0902\u0928\u0947 \u0906\u092a\u0915\u0940 \u092b\u093e\u0907\u0932 \u0926\u0947\u0916\u0940 \u0939\u0948\u0964 \u0915\u0943\u092a\u092f\u093e \u0918\u092c\u0930\u093e\u090f\u0902 \u0928\u0939\u0940\u0902\u0964 \u0916\u0942\u092c \u092a\u093e\u0928\u0940 \u092a\u093f\u090f\u0902 \u0914\u0930 \u0924\u0941\u0930\u0902\u0924 \u0913\u092a\u0940\u0921\u0940 102 \u092e\u0947\u0902 \u0906\u090f\u0902\u0964 \u0939\u092e\u0928\u0947 \u0906\u092a\u0915\u0940 \u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915\u0924\u093e \u091f\u094b\u0915\u0928 \u0932\u0917\u093e \u0926\u0940 \u0939\u0948\u0964",
      "Namaste Sunita ji, I have reviewed your chart. Please do not panic. Drink plenty of water and report immediately to OPD Room 102. Priority triage token assigned.",
      "hi",
      "09:42 AM",
      null,
      null,
      null,
      null,
      "read",
      now
    );
  }

  const eventCount = database.prepare("SELECT COUNT(*) AS c FROM whatsapp_outbound_events").get() as { c: number };
  if (eventCount.c === 0) {
    const insertEvent = database.prepare(`
      INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(
      "evt-1",
      "appointment_reminder",
      "+91 98234 55667",
      "Rajiv Saxena",
      "delivered",
      "Pre-visit reminder for Dr. Siddharth Varma at 09:00 AM. Token #01.",
      JSON.stringify({ token: 1, doctor: "Dr. Siddharth Varma (PT)", time: "09:00 AM", buttons: ["Confirm Arrival", "Reschedule"] }),
      now
    );

    insertEvent.run(
      "evt-2",
      "post_consultation_dispatch",
      "+91 98234 55667",
      "Rajiv Saxena",
      "read",
      "Digital prescription RX-2026-0106 & diagnostic receipt dispatched with direct PDF link.",
      JSON.stringify({ rxNumber: "RX-2026-0106", pdfUrl: "/api/emr/prescription/rx-101/pdf", amount: 700 }),
      now
    );

    insertEvent.run(
      "evt-3",
      "queue_token_update",
      "+91 98311 44556",
      "Priyanka Mukherjee",
      "delivered",
      "Live OPD queue alert: You are next in line (Token #02). Please proceed to Rehab Suite 105.",
      JSON.stringify({ token: 2, queuePosition: 1, room: "Rehab Suite 105" }),
      now
    );
  }
}
