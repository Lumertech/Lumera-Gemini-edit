import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { initDatabase, getDb } from "./db.ts";
import { runGeminiVoiceReceptionist, mountGeminiVoiceRoutes } from "./gemini-voice.ts";
import { getNextAvailableDoctorSlot, bookWhatsAppAppointment } from "./whatsapp-calendar-booking.ts";
import { ensureMetaTechProviderAndPolicies } from "./db-seed.ts";
import { createMetaRouter } from "./meta.ts";

describe("Gemini Voicebot & Inbound WhatsApp Voice Call Receptionist", () => {
  let server: Server;
  let port: number;

  before(async () => {
    const db = initDatabase();
    ensureMetaTechProviderAndPolicies(db);

    const app = express();
    app.use(express.json());
    mountGeminiVoiceRoutes(app, () => null); // Null GoogleGenAI triggers resilient clinical receptionist
    app.use("/api/meta", createMetaRouter());

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("1. Voicebot handles end-to-end appointment booking for knee pain with Dr. Siddharth Varma", async () => {
    const res = await runGeminiVoiceReceptionist({
      message: "I have severe knee pain after running, can I book an appointment with a physiotherapist?",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      language: "English",
      tenantId: "tenant-lumera-main",
    });

    assert.equal(res.intent, "BOOKING");
    assert.equal(res.isEmergency, false);
    assert.ok(res.appointment, "Expected appointment object in voicebot result");
    assert.match(res.appointment.doctorName, /Siddharth/i);
    assert.ok(res.appointment.tokenNumber >= 1);
    assert.match(res.speechText, /booked/i);
    assert.match(res.speechText, /Siddharth/i);
    assert.match(res.speechText, /token/i);
    assert.ok(res.buttons && res.buttons.length > 0);
  });

  it("2. Voicebot escalates life-threatening emergencies immediately to 108 / ER", async () => {
    const res = await runGeminiVoiceReceptionist({
      message: "My father is having severe chest pain and breathlessness since 10 minutes",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      language: "English",
      tenantId: "tenant-lumera-main",
    });

    assert.equal(res.intent, "EMERGENCY");
    assert.equal(res.isEmergency, true);
    assert.match(res.speechText, /108/i);
    assert.match(res.speechText, /Emergency Room/i);
    assert.ok(res.buttons && res.buttons.includes("🚨 Call 108 Ambulance"));
  });

  it("3. Voicebot answers in Hindi when patient speaks in Hindi", async () => {
    const res = await runGeminiVoiceReceptionist({
      message: "मुझे बुखार और सिरदर्द है, डॉक्टर को दिखाना है",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      language: "Hindi",
      tenantId: "tenant-lumera-main",
    });

    assert.equal(res.intent, "BOOKING");
    assert.ok(res.appointment);
    assert.match(res.speechText, /अपॉइंटमेंट/);
    assert.match(res.speechText, /टोकन/);
  });

  it("4. Dynamic time slot allocator increments 15-minute intervals based on token count", async () => {
    const testDate = "2027-12-01";
    getDb().prepare("DELETE FROM appointments WHERE date = ?").run(testDate);

    const slot1 = getNextAvailableDoctorSlot({
      tenantId: "tenant-lumera-main",
      doctorName: "Dr. Siddharth Varma (PT)",
      date: testDate,
    });

    // Book one appointment on that future date
    bookWhatsAppAppointment({
      tenantId: "tenant-lumera-main",
      patientPhone: "+919876543210",
      patientName: "Slot Tester 1",
      doctorName: "Dr. Siddharth Varma (PT)",
      date: testDate,
    });

    const slot2 = getNextAvailableDoctorSlot({
      tenantId: "tenant-lumera-main",
      doctorName: "Dr. Siddharth Varma (PT)",
      date: testDate,
    });

    assert.equal(slot1, "08:30 AM", "First slot should be the start time of the doctor OPD");
    assert.equal(slot2, "08:45 AM", "Second slot should be 15 minutes after first slot");
    assert.notEqual(slot1, slot2, "Next slot should advance after previous booking");
  });

  it("5. POST /api/whatsapp/voice-call records voice call and responds with receptionist audio text", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/whatsapp/voice-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "+919999973271",
        callerName: "Ravee",
        message: "Where is the clinic located?",
        tenantId: "tenant-lumera-main",
        language: "English",
      }),
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.intent, "LOCATION");
    assert.match(data.speechText, /Health Hub/i);
    assert.match(data.speechText, /Gurgaon/i);

    // Verify written to database
    const db = getDb();
    const recorded = db.prepare(`
      SELECT * FROM whatsapp_messages
      WHERE patient_phone = '+919999973271' AND sender = 'bot' AND staff_name = 'Maya (AI Receptionist)'
      ORDER BY created_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;

    assert.ok(recorded, "Voice call bot response should be saved in whatsapp_messages");
    assert.match(String(recorded.content), /Health Hub/i);
  });

  it("6. Resilient offline voicebot never crashes with 503 when model API fails", async () => {
    // Calling runGeminiVoiceReceptionist with a failing getGenAI stub
    const failingGenAI = () => ({
      models: {
        generateContent: async () => {
          throw new Error("UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-medium");
        },
      },
    }) as any;

    const res = await runGeminiVoiceReceptionist({
      message: "What are your OPD timings?",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      language: "English",
      tenantId: "tenant-lumera-main",
      getGenAI: failingGenAI,
    });

    assert.equal(res.intent, "TIMINGS");
    assert.match(res.speechText, /09:00 AM/i);
    assert.match(res.speechText, /08:00 PM/i);
  });

  it("7. Bengali language voicebot support: emergency escalation and booking", async () => {
    // Emergency in Bengali
    const emer = await runGeminiVoiceReceptionist({
      message: "আমার বুকে খুব ব্যথা এবং শ্বাসকষ্ট হচ্ছে",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(emer.intent, "EMERGENCY");
    assert.equal(emer.isEmergency, true);
    assert.match(emer.speechText, /জরুরি/);
    assert.match(emer.speechText, /১০৮/);

    // Booking in Bengali
    const book = await runGeminiVoiceReceptionist({
      message: "আমার হাঁটুর ব্যথা, ডাক্তার দেখাতে চাই",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(book.intent, "BOOKING");
    assert.ok(book.appointment);
    assert.match(book.speechText, /অ্যাপয়েন্টমেন্ট/);
    assert.match(book.speechText, /টোকেন/);
  });

  it("8. Telugu language voicebot support: emergency escalation and doctor booking", async () => {
    // Emergency in Telugu
    const emer = await runGeminiVoiceReceptionist({
      message: "నాకు ఛాతీ నొప్పిగా ఉంది మరియు శ్వాస ఆడట్లేదు",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(emer.intent, "EMERGENCY");
    assert.equal(emer.isEmergency, true);
    assert.match(emer.speechText, /అత్యవసర/);
    assert.match(emer.speechText, /108/);

    // Booking in Telugu
    const book = await runGeminiVoiceReceptionist({
      message: "నాకు మోకాలి నొప్పిగా ఉంది, డాక్టర్ అపాయింట్‌మెంట్ కావాలి",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(book.intent, "BOOKING");
    assert.ok(book.appointment);
    assert.match(book.speechText, /అపాయింట్‌మెంట్/);
    assert.match(book.speechText, /టోకెన్/);
  });

  it("9. Tamil language voicebot support: booking and greetings", async () => {
    const book = await runGeminiVoiceReceptionist({
      message: "எனக்கு மூட்டு வலி உள்ளது, மருத்துவரை பார்க்க வேண்டும்",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(book.intent, "BOOKING");
    assert.ok(book.appointment);
    assert.match(book.speechText, /வணக்கம்/);
    assert.match(book.speechText, /டோக்கன்/);
  });

  it("10. Kannada and Marathi language voicebot support", async () => {
    // Kannada
    const kn = await runGeminiVoiceReceptionist({
      message: "ನನಗೆ ಬೆನ್ನು ನೋವು ಇದೆ, ವೈದ್ಯರನ್ನು ನೋಡಬೇಕು",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(kn.intent, "BOOKING");
    assert.ok(kn.appointment);
    assert.match(kn.speechText, /ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್/);
    assert.match(kn.speechText, /ಟೋಕನ್/);

    // Marathi
    const mr = await runGeminiVoiceReceptionist({
      message: "माझे डोके खूप दुखत आहे, डॉक्टरांची अपॉइंटमेंट हवी आहे",
      callerName: "Ravee",
      callerPhone: "+919999973271",
      tenantId: "tenant-lumera-main",
    });
    assert.equal(mr.intent, "BOOKING");
    assert.ok(mr.appointment);
    assert.match(mr.speechText, /अपॉइंटमेंट/);
    assert.match(mr.speechText, /टोकन/);
  });

  it("11. Inbound WhatsApp Voice Call Webhook triggers AI receptionist Maya auto-answer", async () => {
    const callWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-entry-test",
          changes: [
            {
              field: "calls",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  phone_number_id: "1294483843748285",
                  display_phone_number: "+91 98233 73271",
                },
                contacts: [
                  {
                    profile: { name: "Ravee" },
                    wa_id: "919999973271",
                  },
                ],
                calls: [
                  {
                    id: `wacid.test.${Date.now()}`,
                    from: "919999973271",
                    to: "919823373271",
                    direction: "USER_INITIATED",
                    event: "connect",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callWebhookPayload),
    });

    assert.equal(response.status, 200);

    // Wait a brief moment for async dispatch
    await new Promise((r) => setTimeout(r, 200));

    const db = getDb();
    const inbound = db.prepare(`
      SELECT * FROM whatsapp_messages
      WHERE patient_phone LIKE '%73271' AND sender = 'patient' AND content LIKE '%Inbound Voice Call%'
      ORDER BY created_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;

    assert.ok(inbound, "Inbound call should be recorded in whatsapp_messages");

    const reply = db.prepare(`
      SELECT * FROM whatsapp_messages
      WHERE patient_phone LIKE '%73271' AND sender = 'bot' AND staff_name = 'Receptionist AI'
      ORDER BY created_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;

    assert.ok(reply, "Maya receptionist auto-answer should be recorded in whatsapp_messages");
    assert.match(String(reply.content), /Maya/i);
    assert.match(String(reply.content), /call/i);
  });
});
