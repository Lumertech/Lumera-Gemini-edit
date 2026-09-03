import { Router, type Request, type Response } from "express";
import { getDb } from "./db.ts";
import { GoogleGenAI } from "@google/genai";

let defaultGenAIClient: GoogleGenAI | null = null;
function getDefaultGenAI(): GoogleGenAI | null {
  if (!defaultGenAIClient && process.env.GEMINI_API_KEY) {
    defaultGenAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return defaultGenAIClient;
}

export function createWhatsAppRouter(customGetGenAI?: () => GoogleGenAI | null): Router {
  const getGenAI = customGetGenAI || getDefaultGenAI;
  const router = Router();

  // Helper to format timestamps
  function getDisplayTime(): string {
    return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  // ----------------------------------------------------
  // 1. CONVERSATIONS MANAGEMENT & HUMAN HANDOVER
  // ----------------------------------------------------

  // List all conversations
  router.get("/conversations", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM whatsapp_conversations
        ORDER BY updated_at DESC
      `).all() as Record<string, unknown>[];

      const conversations = rows.map((c) => ({
        id: c.id,
        patientPhone: c.patient_phone,
        patientName: c.patient_name,
        patientId: c.patient_id,
        uhid: c.uhid,
        handoverMode: c.handover_mode, // 'bot' | 'human'
        assignedStaff: c.assigned_staff,
        tags: JSON.parse((c.tags as string) || "[]"),
        preferredLanguage: c.preferred_language || "en",
        unreadCount: Number(c.unread_count || 0),
        lastMessage: c.last_message,
        lastMessageTime: c.last_message_time,
        updatedAt: c.updated_at,
      }));

      res.json({ conversations });
    } catch (err: unknown) {
      console.error("Error fetching whatsapp conversations:", err);
      res.status(500).json({ error: "Failed to load conversations" });
    }
  });

  // Get single conversation
  router.get("/conversations/:id", (req: Request, res: Response) => {
    try {
      const db = getDb();
      const c = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
      if (!c) return res.status(404).json({ error: "Conversation not found" });

      res.json({
        conversation: {
          id: c.id,
          patientPhone: c.patient_phone,
          patientName: c.patient_name,
          patientId: c.patient_id,
          uhid: c.uhid,
          handoverMode: c.handover_mode,
          assignedStaff: c.assigned_staff,
          tags: JSON.parse((c.tags as string) || "[]"),
          preferredLanguage: c.preferred_language || "en",
          unreadCount: Number(c.unread_count || 0),
          lastMessage: c.last_message,
          lastMessageTime: c.last_message_time,
          updatedAt: c.updated_at,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Update Handover Mode (Agent Takeover / Human-in-the-Loop toggle)
  router.post("/conversations/:id/handover", (req: Request, res: Response) => {
    try {
      const { mode, staffName } = req.body; // mode: 'bot' | 'human'
      if (!mode || (mode !== "bot" && mode !== "human")) {
        return res.status(400).json({ error: "Mode must be 'bot' or 'human'" });
      }

      const db = getDb();
      const conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
      if (!conv) return res.status(404).json({ error: "Conversation not found" });

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET handover_mode = ?, updated_at = ?
        WHERE id = ?
      `).run(mode, now, req.params.id);

      // Insert an internal audit / system notification message in chat
      const sysMsgId = `sys-${crypto.randomUUID().slice(0, 8)}`;
      const sysText = mode === "human"
        ? `🔒 Staff Takeover Activated: ${staffName || "Clinic Staff"} has taken control of this conversation. Automated AI bot replies paused.`
        : `🤖 Automated AI Assistant Restored: Lumera Bot is now handling routine patient inquiries.`;

      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, status, created_at)
        VALUES (?, ?, ?, 'system', ?, ?, ?, 'delivered', ?)
      `).run(sysMsgId, req.params.id, String(conv.patient_phone), staffName || "System", sysText, getDisplayTime(), now);

      res.json({
        ok: true,
        mode,
        message: `Handover mode changed to ${mode}`,
      });
    } catch (err: unknown) {
      console.error("Error updating handover mode:", err);
      res.status(500).json({ error: "Failed to update handover mode" });
    }
  });

  // Assign Staff Member
  router.post("/conversations/:id/assign", (req: Request, res: Response) => {
    try {
      const { staffName } = req.body;
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET assigned_staff = ?, updated_at = ?
        WHERE id = ?
      `).run(staffName || "Unassigned", now, req.params.id);

      res.json({ ok: true, assignedStaff: staffName });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to assign staff" });
    }
  });

  // Update Conversation Tags
  router.post("/conversations/:id/tags", (req: Request, res: Response) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) return res.status(400).json({ error: "Tags must be an array" });

      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET tags = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(tags), now, req.params.id);

      res.json({ ok: true, tags });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to update tags" });
    }
  });

  // ----------------------------------------------------
  // 2. MESSAGING & REAL-TIME CHAT SYNC
  // ----------------------------------------------------

  // Get messages for conversation
  router.get("/messages", (req: Request, res: Response) => {
    try {
      const db = getDb();
      const convId = req.query.conversationId as string;
      const phone = req.query.phone as string;

      let rows: Record<string, unknown>[] = [];
      if (convId) {
        rows = db.prepare(`
          SELECT * FROM whatsapp_messages
          WHERE conversation_id = ?
          ORDER BY created_at ASC
        `).all(convId) as Record<string, unknown>[];

        // Mark unread as 0
        db.prepare("UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = ?").run(convId);
      } else if (phone) {
        rows = db.prepare(`
          SELECT * FROM whatsapp_messages
          WHERE patient_phone = ?
          ORDER BY created_at ASC
        `).all(phone) as Record<string, unknown>[];
      } else {
        return res.status(400).json({ error: "Either conversationId or phone is required" });
      }

      const messages = rows.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        patientPhone: m.patient_phone,
        sender: m.sender, // 'bot' | 'user' | 'agent' | 'system'
        staffName: m.staff_name,
        content: m.content,
        translatedContent: m.translated_content,
        detectedLanguage: m.detected_language,
        time: m.time_display,
        buttons: m.buttons ? JSON.parse(m.buttons as string) : null,
        media: m.media ? JSON.parse(m.media as string) : null,
        audioUrl: m.audio_url,
        voiceTranscript: m.voice_transcript,
        status: m.status,
        createdAt: m.created_at,
      }));

      res.json({ messages });
    } catch (err: unknown) {
      console.error("Error fetching whatsapp messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send Message (Patient, Staff, or Bot)
  router.post("/send", async (req: Request, res: Response) => {
    try {
      const {
        conversationId = "conv-rajiv",
        patientPhone = "+91 98234 55667",
        patientName = "Rajiv Saxena",
        sender = "user", // 'user' | 'agent'
        staffName,
        content = "",
        buttons = null,
        media = null,
        targetLanguage, // for staff auto-translation
      } = req.body;

      if (!content && !media && !buttons) {
        return res.status(400).json({ error: "Message content or media required" });
      }

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = getDisplayTime();
      const msgId = `msg-${crypto.randomUUID().slice(0, 8)}`;

      // Check or create conversation
      let conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ? OR patient_phone = ?").get(conversationId, patientPhone) as Record<string, unknown> | undefined;
      if (!conv) {
        db.prepare(`
          INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
          VALUES (?, ?, ?, 'bot', 'Unassigned', '["General"]', 'en', 0, ?, ?, ?)
        `).run(conversationId, patientPhone, patientName, content.slice(0, 80), timeDisplay, now);
        conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(conversationId) as Record<string, unknown>;
      }

      let translatedContent: string | null = null;
      let detectedLanguage: string | null = (conv.preferred_language as string) || "en";

      // If sent by staff and translation requested
      if (sender === "agent" && targetLanguage && targetLanguage !== "en") {
        try {
          translatedContent = await translateWithGeminiOrFallback(content, targetLanguage, getGenAI());
        } catch {
          translatedContent = null;
        }
      }

      // If sent by user, detect language if non-English
      if (sender === "user") {
        detectedLanguage = detectLanguageSimple(content);
        if (detectedLanguage !== "en") {
          try {
            translatedContent = await translateWithGeminiOrFallback(content, "en", getGenAI());
          } catch {
            translatedContent = null;
          }
        }
      }

      // Insert sent message
      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?)
      `).run(
        msgId,
        String(conv.id),
        patientPhone,
        sender,
        staffName || null,
        content,
        translatedContent,
        detectedLanguage,
        timeDisplay,
        buttons ? JSON.stringify(buttons) : null,
        media ? JSON.stringify(media) : null,
        now
      );

      // Update conversation last message
      const isStaffTakeover = conv.handover_mode === "human";
      const newUnread = sender === "user" && isStaffTakeover ? Number(conv.unread_count || 0) + 1 : Number(conv.unread_count || 0);

      db.prepare(`
        UPDATE whatsapp_conversations
        SET last_message = ?, last_message_time = ?, unread_count = ?, updated_at = ?
        WHERE id = ?
      `).run(content.slice(0, 80), timeDisplay, newUnread, now, String(conv.id));

      const responsePayload: {
        sentMessage: Record<string, unknown>;
        botReply?: Record<string, unknown> | null;
      } = {
        sentMessage: {
          id: msgId,
          conversationId: conv.id,
          patientPhone,
          sender,
          staffName,
          content,
          translatedContent,
          detectedLanguage,
          time: timeDisplay,
          buttons,
          media,
          status: "delivered",
          createdAt: now,
        },
      };

      // ----------------------------------------------------
      // AUTOMATED BOT ENGINE (Runs ONLY if sender === 'user' AND handover_mode === 'bot')
      // ----------------------------------------------------
      if (sender === "user" && !isStaffTakeover) {
        const botReply = await processBotActionOrQuery(content, patientPhone, patientName, conv, db, getGenAI);
        if (botReply) {
          const botMsgId = `bot-${crypto.randomUUID().slice(0, 8)}`;
          const botTime = getDisplayTime();
          const botNow = new Date().toISOString();

          db.prepare(`
            INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, buttons, media, status, created_at)
            VALUES (?, ?, ?, 'bot', NULL, ?, ?, ?, ?, 'delivered', ?)
          `).run(
            botMsgId,
            String(conv.id),
            patientPhone,
            botReply.content,
            botTime,
            botReply.buttons ? JSON.stringify(botReply.buttons) : null,
            botReply.media ? JSON.stringify(botReply.media) : null,
            botNow
          );

          db.prepare(`
            UPDATE whatsapp_conversations
            SET last_message = ?, last_message_time = ?, updated_at = ?
            WHERE id = ?
          `).run(botReply.content.slice(0, 80), botTime, botNow, String(conv.id));

          responsePayload.botReply = {
            id: botMsgId,
            conversationId: conv.id,
            patientPhone,
            sender: "bot",
            content: botReply.content,
            time: botTime,
            buttons: botReply.buttons,
            media: botReply.media,
            status: "delivered",
            createdAt: botNow,
          };
        }
      }

      res.status(201).json(responsePayload);
    } catch (err: unknown) {
      console.error("Error in /api/whatsapp/send:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // ----------------------------------------------------
  // 3. DYNAMIC EMR & DATABASE ACTIONS (Live Queries)
  // ----------------------------------------------------
  router.post("/emr-action", (req: Request, res: Response) => {
    try {
      const { action, patientPhone = "+91 98234 55667", payload = {} } = req.body;
      const db = getDb();

      // Find patient
      let patient = db.prepare("SELECT * FROM patients WHERE phone = ?").get(patientPhone) as Record<string, unknown> | undefined;
      if (!patient) {
        patient = db.prepare("SELECT * FROM patients LIMIT 1").get() as Record<string, unknown>;
      }

      const patientId = patient?.id ? String(patient.id) : "pat-6";

      if (action === "get_prescription") {
        const rx = db.prepare(`
          SELECT * FROM prescriptions
          WHERE patient_phone = ? OR patient_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(patientPhone, patientId) as Record<string, unknown> | undefined;

        if (!rx) {
          return res.json({ found: false, message: "No active prescription record found for this patient" });
        }

        return res.json({
          found: true,
          prescription: {
            id: rx.id,
            rxNumber: rx.rx_number,
            patientName: rx.patient_name,
            patientUhid: rx.patient_uhid,
            doctorName: rx.doctor_name,
            doctorSpecialty: rx.doctor_specialty,
            doctorRegNumber: rx.doctor_reg_number,
            date: rx.date,
            diagnosis: rx.diagnosis,
            medicines: JSON.parse((rx.medicines as string) || "[]"),
            labTests: JSON.parse((rx.lab_tests as string) || "[]"),
            advice: JSON.parse((rx.advice as string) || "[]"),
            dietInstructions: rx.diet_instructions,
            followUpDate: rx.follow_up_date,
            pdfUrl: `/api/emr/prescription/${rx.id}/pdf`,
          },
        });
      }

      if (action === "get_lab_reports") {
        const labs = db.prepare(`
          SELECT * FROM lab_reports
          WHERE patient_phone = ? OR patient_id = ?
          ORDER BY created_at DESC
        `).all(patientPhone, patientId) as Record<string, unknown>[];

        return res.json({
          found: labs.length > 0,
          reports: labs.map((l) => ({
            id: l.id,
            patientName: l.patient_name,
            patientUhid: l.patient_uhid,
            date: l.date,
            labName: l.lab_name,
            category: l.category,
            doctorInterpretation: l.doctor_interpretation,
            results: JSON.parse((l.results as string) || "[]"),
            pdfUrl: `/api/emr/lab-report/${l.id}/pdf`,
          })),
        });
      }

      if (action === "get_doctors") {
        const doctors = db.prepare("SELECT * FROM doctors WHERE active = 1").all() as Record<string, unknown>[];
        return res.json({
          doctors: doctors.map((d) => ({
            id: d.id,
            name: d.name,
            qualification: d.qualification,
            specialty: d.specialty,
            consultationFee: d.consultation_fee,
            opdRoom: d.opd_room,
            opdTiming: d.opd_timing,
            availableDays: JSON.parse((d.available_days as string) || "[]"),
          })),
        });
      }

      if (action === "get_queue") {
        const currentAppt = db.prepare(`
          SELECT * FROM appointments
          WHERE (patient_phone = ? OR patient_id = ?)
          ORDER BY created_at DESC LIMIT 1
        `).get(patientPhone, patientId) as Record<string, unknown> | undefined;

        if (!currentAppt) {
          return res.json({ hasAppointment: false, message: "No active OPD booking found for today." });
        }

        // Count how many patients are ahead in 'Waiting' status for same doctor
        const ahead = db.prepare(`
          SELECT COUNT(*) as count FROM appointments
          WHERE doctor_id = ? AND status = 'Waiting' AND token_number < ?
        `).get(String(currentAppt.doctor_id), Number(currentAppt.token_number)) as { count: number };

        return res.json({
          hasAppointment: true,
          appointment: {
            id: currentAppt.id,
            tokenNumber: currentAppt.token_number,
            doctorName: currentAppt.doctor_name,
            specialty: currentAppt.specialty,
            timeSlot: currentAppt.time_slot,
            status: currentAppt.status,
            patientsAhead: ahead.count,
            estimatedWaitMins: ahead.count * 12 + 5,
          },
        });
      }

      if (action === "book_appointment") {
        const doctorId = payload.doctorId || "doc-6";
        const date = payload.date || new Date().toISOString().split("T")[0];
        const timeSlot = payload.timeSlot || "11:30 AM";

        const doc = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId) as Record<string, unknown> | undefined;
        if (!doc) return res.status(404).json({ error: "Doctor not found" });

        // Calculate next token number
        const maxToken = db.prepare(`
          SELECT MAX(token_number) as max_token FROM appointments
          WHERE doctor_id = ? AND date = ?
        `).get(doctorId, date) as { max_token: number | null };

        const nextToken = (maxToken.max_token || 0) + 1;
        const apptId = `apt-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO appointments (id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New Consultation', 'Waiting', 'WhatsApp Bot', ?, 1, ?)
        `).run(
          apptId,
          nextToken,
          String(patient?.id || "pat-6"),
          String(patient?.name || "Rajiv Saxena"),
          patientPhone,
          String(patient?.uhid || "LUM-2026-0106"),
          String(doc.id),
          String(doc.name),
          String(doc.specialty),
          date,
          timeSlot,
          Number(doc.consultation_fee || 600),
          now
        );

        return res.json({
          success: true,
          appointment: {
            id: apptId,
            tokenNumber: nextToken,
            doctorName: doc.name,
            specialty: doc.specialty,
            opdRoom: doc.opd_room,
            date,
            timeSlot,
            consultationFee: doc.consultation_fee,
            patientName: patient?.name || "Rajiv Saxena",
            uhid: patient?.uhid || "LUM-2026-0106",
          },
        });
      }

      res.status(400).json({ error: "Unknown action" });
    } catch (err: unknown) {
      console.error("Error executing EMR action:", err);
      res.status(500).json({ error: "Failed to execute EMR action" });
    }
  });

  // ----------------------------------------------------
  // 4. OUTBOUND AUTOMATED TRIGGER ENGINE
  // ----------------------------------------------------
  router.post("/outbound/trigger", (req: Request, res: Response) => {
    try {
      const {
        eventType, // 'appointment_reminder' | 'post_consultation_dispatch' | 'queue_token_update'
        patientPhone = "+91 98234 55667",
        patientName = "Rajiv Saxena",
        customPayload = {},
      } = req.body;

      if (!eventType) return res.status(400).json({ error: "eventType is required" });

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = getDisplayTime();
      const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;

      let details = "";
      let messageContent = "";
      let buttons: string[] | null = null;
      let media: Record<string, unknown> | null = null;

      if (eventType === "appointment_reminder") {
        details = `Pre-visit alert sent to ${patientName} (${patientPhone}) for scheduled consultation.`;
        messageContent = `⏰ *Appointment Reminder - Lumera Polyclinic*\n\nNamaste ${patientName},\nThis is a confirmation that your consultation with *Dr. Siddharth Varma (PT)* is scheduled for today at *09:00 AM*.\n\n📍 *Room*: Rehab Suite 105\n🎫 *Your Token Number*: *#01*\n\nPlease tap below to confirm your arrival at the front desk or request a reschedule.`;
        buttons = ["✅ Confirm Arrival", "🔄 Reschedule Slot", "📍 Get Clinic Directions"];
      } else if (eventType === "post_consultation_dispatch") {
        details = `Post-consultation digital packet dispatched: Prescription & Diagnostic invoice.`;
        messageContent = `📋 *Consultation Summary & Prescription Signed*\n\nNamaste ${patientName},\nDr. Siddharth Varma has signed your clinical prescription (*RX-2026-0106*).\n\nYour digital consultation receipt (#INV-9921 for ₹700) has been generated. You can preview or download your verified medical documents below.`;
        buttons = ["📄 View Prescription Slip", "📥 Download PDF", "💊 Order Medicine Home Delivery"];
        media = {
          type: "pdf",
          title: "Prescription_RX-2026-0106_Rajiv_Saxena.pdf",
          url: "/api/emr/prescription/rx-101/pdf",
          size: "245 KB",
          subtitle: "Signed by Dr. Siddharth Varma (PT) • Lumera Rehab",
        };
      } else if (eventType === "queue_token_update") {
        details = `Live OPD Queue Alert dispatched: Patient is next in line.`;
        messageContent = `📢 *OPD Queue Alert - You're Almost Up!*\n\nNamaste ${patientName},\nToken *#01* is currently completing consultation. You are *NEXT IN LINE* (Token #02).\n\n📍 Please proceed to *Rehab Suite 105* near Waiting Lounge B.`;
        buttons = ["✅ I am at OPD Room", "🚶 Need 5 Mins", "📞 Reception Call"];
      } else {
        details = `Custom broadcast sent to ${patientName}.`;
        messageContent = customPayload.message || "Important health notification from Lumera Polyclinic.";
      }

      // Record outbound event
      db.prepare(`
        INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
        VALUES (?, ?, ?, ?, 'delivered', ?, ?, ?)
      `).run(eventId, eventType, patientPhone, patientName, details, JSON.stringify(customPayload), now);

      // Also deliver message into the patient's active WhatsApp chat
      let conv = db.prepare("SELECT id FROM whatsapp_conversations WHERE patient_phone = ?").get(patientPhone) as { id: string } | undefined;
      const convId = conv ? conv.id : "conv-rajiv";

      const msgId = `msg-out-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, buttons, media, status, created_at)
        VALUES (?, ?, ?, 'bot', 'Automated Trigger Engine', ?, ?, ?, ?, 'delivered', ?)
      `).run(
        msgId,
        convId,
        patientPhone,
        messageContent,
        timeDisplay,
        buttons ? JSON.stringify(buttons) : null,
        media ? JSON.stringify(media) : null,
        now
      );

      db.prepare(`
        UPDATE whatsapp_conversations
        SET last_message = ?, last_message_time = ?, updated_at = ?
        WHERE id = ?
      `).run(messageContent.slice(0, 80), timeDisplay, now, convId);

      res.status(201).json({
        ok: true,
        eventId,
        eventType,
        details,
        messageDispatched: messageContent,
      });
    } catch (err: unknown) {
      console.error("Error triggering outbound notification:", err);
      res.status(500).json({ error: "Failed to dispatch outbound notification" });
    }
  });

  // Get Outbound Event Logs
  router.get("/outbound/events", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const events = db.prepare(`
        SELECT * FROM whatsapp_outbound_events
        ORDER BY sent_at DESC LIMIT 50
      `).all();

      res.json({ events });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch outbound events" });
    }
  });

  // ----------------------------------------------------
  // 5. AMBIENT VOICE NOTE & MULTILINGUAL AI PROCESSING
  // ----------------------------------------------------

  // Transcribe and analyze patient voice notes with Gemini AI
  router.post("/voice-process", async (req: Request, res: Response) => {
    try {
      const {
        audioBase64,
        mimeType = "audio/webm",
        presetPrompt,
        patientPhone = "+91 98234 55667",
      } = req.body;

      const ai = getGenAI();

      // If preset audio or prompt selected (e.g. testing in Hindi, Marathi, English)
      let transcription = "";
      let detectedLang = "en";
      let clinicalSummary = "";
      let symptoms: string[] = [];

      if (presetPrompt) {
        if (presetPrompt === "hindi_backpain") {
          transcription = "नमस्ते डॉक्टर साहब, मुझे पिछले 3 दिनों से पीठ के निचले हिस्से में तेज दर्द है जो बाईं टांग तक जा रहा है। सुबह उठने पर कमर बहुत जकड़ जाती है और झुकने में बहुत तकलीफ होती है।";
          detectedLang = "hi";
          clinicalSummary = "Patient reports acute lower back pain radiating to left calf for 3 days, accompanied by morning stiffness and difficulty in forward flexion.";
          symptoms = ["Acute lower back pain", "Left S1 radiation / sciatica", "Morning lumbar stiffness", "Aggravated on forward bending"];
        } else if (presetPrompt === "marathi_sugar") {
          transcription = "नमस्कार डॉक्टर, माझी साखर आज सकाळी उपाशीपोटी १८० आली आहे. मला खूप थकवा आणि तहान लागत आहे. मेटफॉर्मिन गोळी सुरू ठेवू का?";
          detectedLang = "mr";
          clinicalSummary = "Patient reports elevated fasting blood sugar of 180 mg/dL with fatigue and polydipsia. Querying regarding Metformin continuation.";
          symptoms = ["Fasting hyperglycemia (180 mg/dL)", "Severe fatigue", "Polydipsia / excessive thirst"];
        } else if (presetPrompt === "kannada_fever") {
          transcription = "ನಮಸ್ಕಾರ ಡಾಕ್ಟರ್, ನನಗೆ ಎರಡು ದಿನಗಳಿಂದ ತೀವ್ರ ಜ್ವರ ಮತ್ತು ಶೀತವಿದೆ. ಪ್ಯಾರಸಿಟಮಾಲ್ ತೆಗೆದುಕೊಂಡರೂ ಜ್ವರ ಕಡಿಮೆಯಾಗುತ್ತಿಲ್ಲ.";
          detectedLang = "kn";
          clinicalSummary = "Patient reports high-grade fever and chills for 2 days refractory to oral Paracetamol.";
          symptoms = ["High-grade fever", "Chills / rigors", "Unresponsive to OTC Paracetamol"];
        } else {
          transcription = presetPrompt;
          detectedLang = detectLanguageSimple(presetPrompt);
        }
      }

      // If audioBase64 provided, pass to Gemini
      if (audioBase64 && ai) {
        try {
          const prompt = `You are Lumera Clinical Audio AI. Transcribe this patient voice note accurately.
Detect the spoken language (e.g. Hindi, Marathi, Kannada, English, Tamil).
Extract the clinical chief complaints, duration, severity, and intent (e.g. appointment booking, prescription inquiry, lab report question).

Output strictly in JSON:
{
  "transcription": "exact transcription in original spoken script",
  "englishTranslation": "accurate English medical translation",
  "detectedLanguage": "hi | mr | kn | ta | en",
  "clinicalSummary": "structured clinical note summary",
  "symptoms": ["symptom 1", "symptom 2"],
  "patientIntent": "appointment | prescription | lab_report | emergency"
}`;

          const cleanBase64 = audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, "");
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
              { text: prompt },
            ],
          });

          const rawText = response.text || "";
          const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(cleanedJson);

          return res.json({
            ok: true,
            transcription: parsed.transcription,
            englishTranslation: parsed.englishTranslation,
            detectedLanguage: parsed.detectedLanguage,
            clinicalSummary: parsed.clinicalSummary,
            symptoms: parsed.symptoms || [],
            patientIntent: parsed.patientIntent || "consultation",
          });
        } catch (geminiErr: unknown) {
          console.warn("Gemini audio transcription fallback:", geminiErr);
        }
      }

      // Fallback structured result
      if (!transcription) {
        transcription = "Doctor, I am experiencing persistent back pain radiating down my left leg and would like to review my latest physiotherapy prescription.";
        detectedLang = "en";
        clinicalSummary = "Patient inquiring regarding radiating back pain and physiotherapy prescription review.";
        symptoms = ["Radiating back pain", "Left leg radicular symptoms"];
      }

      res.json({
        ok: true,
        transcription,
        englishTranslation: detectedLang !== "en" ? clinicalSummary : transcription,
        detectedLanguage: detectedLang,
        clinicalSummary,
        symptoms,
        patientIntent: "prescription",
      });
    } catch (err: unknown) {
      console.error("Error in /api/whatsapp/voice-process:", err);
      res.status(500).json({ error: "Failed to process voice note" });
    }
  });

  // Auto-Translation Endpoint
  router.post("/translate", async (req: Request, res: Response) => {
    try {
      const { text, targetLanguage = "en", sourceLanguage } = req.body;
      if (!text) return res.status(400).json({ error: "Text is required" });

      const translated = await translateWithGeminiOrFallback(text, targetLanguage, getGenAI());
      res.json({
        originalText: text,
        translatedText: translated,
        targetLanguage,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // ----------------------------------------------------
  // 6. CLINICAL DOCUMENTS (HTML/PDF PREVIEW & DOWNLOAD)
  // ----------------------------------------------------
  router.get("/prescription/:id/pdf", (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rx = db.prepare("SELECT * FROM prescriptions WHERE id = ? OR rx_number = ?").get(req.params.id, req.params.id) as Record<string, unknown> | undefined;
      if (!rx) return res.status(404).send("Prescription not found");

      const medicines = JSON.parse((rx.medicines as string) || "[]");
      const labTests = JSON.parse((rx.lab_tests as string) || "[]");
      const advice = JSON.parse((rx.advice as string) || "[]");

      const medsHtml = medicines.map((m: any, idx: number) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 8px; font-weight: 600; color: #1e293b;">${idx + 1}. ${m.drugName}</td>
          <td style="padding: 10px 8px; color: #475569;">${m.composition || '-'}</td>
          <td style="padding: 10px 8px; color: #0f172a; font-weight: 500;">${m.dosage} (${m.form})</td>
          <td style="padding: 10px 8px; font-weight: 700; color: #0369a1;">${m.frequency}</td>
          <td style="padding: 10px 8px; color: #475569;">${m.timing} (${m.durationDays} days)</td>
          <td style="padding: 10px 8px; color: #64748b; font-size: 13px;">${m.instructions || '-'}</td>
        </tr>
      `).join("");

      const testsHtml = labTests.map((t: any) => `<li style="margin-bottom: 4px; color: #334155;"><strong>${t.testName}</strong> (${t.urgency || 'Routine'})</li>`).join("");
      const adviceHtml = advice.map((a: string) => `<li style="margin-bottom: 4px; color: #334155;">${a}</li>`).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Clinical Prescription - ${rx.rx_number}</title>
  <style>
    @media print {
      body { margin: 0; padding: 12mm; }
      .no-print { display: none !important; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; background: #f8fafc; }
    .sheet { max-width: 840px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .clinic-brand { font-size: 24px; font-weight: 800; color: #0369a1; letter-spacing: -0.5px; }
    .clinic-sub { font-size: 13px; color: #64748b; margin-top: 4px; line-height: 1.4; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f1f5f9; padding: 14px; border-radius: 6px; margin-bottom: 24px; font-size: 13px; }
    .meta-grid strong { color: #334155; display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .rx-symbol { font-family: Georgia, serif; font-size: 32px; font-weight: bold; color: #0284c7; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; margin-bottom: 24px; }
    th { background: #f8fafc; padding: 10px 8px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
    .section-title { font-size: 15px; font-weight: 700; color: #0f172a; border-left: 4px solid #0284c7; padding-left: 8px; margin: 20px 0 10px 0; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 36px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #64748b; }
    .qr-box { border: 1px dashed #cbd5e1; padding: 8px; text-align: center; border-radius: 4px; font-size: 11px; }
    .btn { display: inline-flex; align-items: center; padding: 8px 16px; background: #0284c7; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 840px; margin: 0 auto 16px auto; display: flex; justify-content: space-between; align-items: center;">
    <span style="font-size: 14px; color: #64748b;">Authentic EMR Clinical Document</span>
    <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="clinic-brand">LUMERA HEALTHCARE POLYCLINIC</div>
        <div class="clinic-sub">Integrated Multispecialty OPD, Diagnostic Pathology & Rehabilitation<br>100ft Road Indiranagar, Bengaluru • Phone: +91 80 4123 4567 • emr@lumera.health</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${rx.doctor_name}</div>
        <div style="font-size: 13px; color: #475569;">${rx.doctor_specialty}</div>
        <div style="font-size: 12px; color: #64748b;">Reg No: ${rx.doctor_reg_number}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><strong>Patient Name</strong> ${rx.patient_name}</div>
      <div><strong>UHID / ID</strong> ${rx.patient_uhid}</div>
      <div><strong>Phone</strong> ${rx.patient_phone}</div>
      <div><strong>Date of Rx</strong> ${rx.date}</div>
    </div>

    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Provisional Clinical Diagnosis</div>
      <div style="font-size: 17px; font-weight: 700; color: #0f172a; margin-top: 4px;">${rx.diagnosis} ${rx.icd10_code ? `(ICD-10: ${rx.icd10_code})` : ''}</div>
    </div>

    <div class="rx-symbol">℞</div>
    <table>
      <thead>
        <tr>
          <th>Medicine Name</th>
          <th>Composition</th>
          <th>Dosage</th>
          <th>Frequency</th>
          <th>Timing & Duration</th>
          <th>Instructions</th>
        </tr>
      </thead>
      <tbody>
        ${medsHtml}
      </tbody>
    </table>

    ${testsHtml ? `
      <div class="section-title">Advised Laboratory & Diagnostic Investigations</div>
      <ul style="padding-left: 20px; font-size: 14px; margin-top: 6px;">${testsHtml}</ul>
    ` : ''}

    ${adviceHtml ? `
      <div class="section-title">Physiotherapy & Ergonomic Lifestyle Advice</div>
      <ul style="padding-left: 20px; font-size: 14px; margin-top: 6px;">${adviceHtml}</ul>
    ` : ''}

    ${rx.diet_instructions ? `
      <div class="section-title">Dietary Guidance</div>
      <p style="font-size: 14px; color: #334155; margin-top: 4px;">${rx.diet_instructions}</p>
    ` : ''}

    ${rx.follow_up_date ? `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #166534;">
        🗓️ <strong>Review / Follow-up Visit Advised on:</strong> ${rx.follow_up_date}
      </div>
    ` : ''}

    <div class="footer">
      <div class="qr-box">
        <div><strong>Rx No:</strong> ${rx.rx_number}</div>
        <div style="color: #64748b; font-size: 10px; margin-top: 4px;">Digitally signed & verified on Lumera Health Cloud</div>
      </div>
      <div style="text-align: right;">
        <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 26px; color: #0369a1;">${rx.doctor_name}</div>
        <div style="font-weight: 600; color: #1e293b; margin-top: 2px;">${rx.doctor_name}</div>
        <div style="font-size: 11px; color: #64748b;">Authorized Medical Signatory</div>
      </div>
    </div>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: unknown) {
      console.error("Error generating prescription PDF view:", err);
      res.status(500).send("Error rendering prescription document");
    }
  });

  router.get("/lab-report/:id/pdf", (req: Request, res: Response) => {
    try {
      const db = getDb();
      const lab = db.prepare("SELECT * FROM lab_reports WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
      if (!lab) return res.status(404).send("Lab report not found");

      const results = JSON.parse((lab.results as string) || "[]");
      const rowsHtml = results.map((r: any) => {
        const isAbnormal = r.status && r.status !== "Normal";
        const badgeColor = isAbnormal ? "background: #fef2f2; color: #b91c1c; font-weight: 700;" : "background: #f0fdf4; color: #15803d;";
        return `
          <tr style="border-bottom: 1px solid #e2e8f0; ${isAbnormal ? 'background: #fffbfb;' : ''}">
            <td style="padding: 12px 10px; font-weight: 600; color: #1e293b;">${r.param}</td>
            <td style="padding: 12px 10px; font-size: 15px; font-weight: 700; color: ${isAbnormal ? '#b91c1c' : '#0f172a'};">${r.value} ${r.unit}</td>
            <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${r.normalRange} ${r.unit}</td>
            <td style="padding: 12px 10px;"><span style="padding: 3px 8px; border-radius: 4px; font-size: 12px; ${badgeColor}">${r.status}</span></td>
            <td style="padding: 12px 10px; font-size: 12px; color: #64748b;">${r.trendDelta || '-'}</td>
          </tr>
        `;
      }).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Diagnostic Laboratory Report - ${lab.id}</title>
  <style>
    @media print {
      body { margin: 0; padding: 12mm; }
      .no-print { display: none !important; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; background: #f8fafc; }
    .sheet { max-width: 840px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #0f766e; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .lab-brand { font-size: 22px; font-weight: 800; color: #0f766e; letter-spacing: -0.5px; }
    .lab-sub { font-size: 13px; color: #64748b; margin-top: 4px; line-height: 1.4; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f0fdfa; padding: 14px; border-radius: 6px; margin-bottom: 24px; font-size: 13px; border: 1px solid #ccfbf1; }
    .meta-grid strong { color: #0f766e; display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; margin-bottom: 24px; }
    th { background: #f8fafc; padding: 10px; font-size: 12px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
    .interpretation-box { background: #fffbeb; border: 1px solid #fef3c7; padding: 16px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #92400e; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 36px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #64748b; }
    .btn { display: inline-flex; align-items: center; padding: 8px 16px; background: #0f766e; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 840px; margin: 0 auto 16px auto; display: flex; justify-content: space-between; align-items: center;">
    <span style="font-size: 14px; color: #64748b;">NABL-Accredited Diagnostic Report</span>
    <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="lab-brand">${lab.lab_name}</div>
        <div class="lab-sub">Automated Clinical Pathology, Biochemistry & Imaging Services<br>NABL & ICMR Accredited Diagnostic Center • Indiranagar Center</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 14px; font-weight: 700; color: #0f172a;">Sample ID: ${lab.id}</div>
        <div style="font-size: 12px; color: #64748b;">Category: ${lab.category}</div>
        <div style="font-size: 12px; color: #64748b;">Date Collected: ${lab.date}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><strong>Patient Name</strong> ${lab.patient_name}</div>
      <div><strong>UHID</strong> ${lab.patient_uhid}</div>
      <div><strong>Referring Doctor</strong> Dr. Siddharth Varma (PT)</div>
      <div><strong>Report Status</strong> Verified & Released</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Investigation Parameter</th>
          <th>Observed Value</th>
          <th>Biological Reference Range</th>
          <th>Status</th>
          <th>Diagnostic Note / Trend</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="interpretation-box">
      <div style="font-weight: 700; text-transform: uppercase; font-size: 12px; margin-bottom: 4px;">Consultant Pathologist & Clinical Interpretation</div>
      <div>${lab.doctor_interpretation}</div>
    </div>

    <div class="footer">
      <div>
        <div>Verified by: <strong>Dr. Ananya Ray, MD (Pathology)</strong></div>
        <div style="color: #64748b; font-size: 11px;">Lumera Diagnostic Quality Assurance Cell</div>
      </div>
      <div style="text-align: right;">
        <div style="font-family: cursive; font-size: 22px; color: #0f766e;">Dr. A. Ray</div>
        <div style="font-size: 11px; color: #64748b;">End of Report • Verified QR Code Attached</div>
      </div>
    </div>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: unknown) {
      console.error("Error generating lab report PDF:", err);
      res.status(500).send("Error rendering lab report document");
    }
  });

  return router;
}

// ----------------------------------------------------
// BOT INTELLIGENCE & EMR LOGIC HELPERS
// ----------------------------------------------------

async function processBotActionOrQuery(
  text: string,
  phone: string,
  patientName: string,
  conv: Record<string, unknown>,
  db: any,
  getGenAI: () => GoogleGenAI | null
): Promise<{
  content: string;
  buttons?: string[];
  media?: Record<string, unknown>;
} | null> {
  const q = text.toLowerCase().trim();

  // 1. Prescription Request
  if (q.includes("prescription") || q.includes("rx") || q.includes("refill") || q.includes("medicine") || q.includes("दवा") || q.includes("औषध")) {
    const rx = db.prepare(`
      SELECT * FROM prescriptions
      WHERE patient_phone = ? OR patient_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(phone, patientName) as Record<string, unknown> | undefined;

    if (rx) {
      const meds = JSON.parse((rx.medicines as string) || "[]");
      const medList = meds.slice(0, 3).map((m: any) => `• *${m.drugName}* (${m.dosage}) - ${m.frequency} [${m.timing}]`).join("\n");

      return {
        content: `💊 *Prescription Record Found (${rx.rx_number})*\n\n*Consultant*: ${rx.doctor_name}\n*Diagnosis*: ${rx.diagnosis}\n*Date*: ${rx.date}\n\n*Active Medications*:\n${medList}\n\nTap below to view the signed prescription slip or download PDF:`,
        buttons: ["📄 Preview Prescription", "📥 Download PDF", "💊 Request Pharmacy Refill"],
        media: {
          type: "pdf",
          title: `Prescription_${rx.rx_number}.pdf`,
          url: `/api/emr/prescription/${rx.id}/pdf`,
          size: "210 KB",
          previewData: rx,
        },
      };
    }
  }

  // 2. Lab Reports Request
  if (q.includes("lab") || q.includes("report") || q.includes("test") || q.includes("blood") || q.includes("जांच") || q.includes("रिपोर्ट")) {
    const lab = db.prepare(`
      SELECT * FROM lab_reports
      WHERE patient_phone = ? OR patient_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(phone, patientName) as Record<string, unknown> | undefined;

    if (lab) {
      const results = JSON.parse((lab.results as string) || "[]");
      const flagged = results
        .filter((r: any) => r.status !== "Normal")
        .map((r: any) => `• *${r.param}*: ${r.value} ${r.unit} (${r.status})`)
        .join("\n");

      return {
        content: `🔬 *Verified Lab Diagnostic Report*\n\n*Panel*: ${lab.category}\n*Date*: ${lab.date}\n*Facility*: ${lab.lab_name}\n\n*Flagged Out-of-Range Parameters*:\n${flagged || "All tested parameters within normal reference ranges."}\n\n*Doctor's Interpretation*:\n"${lab.doctor_interpretation}"`,
        buttons: ["🔬 Preview Lab Sheet", "📥 Download PDF", "🩺 Consult Doctor"],
        media: {
          type: "pdf",
          title: `Lab_Report_${lab.id}.pdf`,
          url: `/api/emr/lab-report/${lab.id}/pdf`,
          size: "185 KB",
          previewData: lab,
        },
      };
    }
  }

  // 3. Book Doctor Appointment
  if (q.includes("book") || q.includes("appointment") || q.includes("schedule") || q.includes("अपॉइंटमेंट") || q.includes("डॉक्टर")) {
    const doctors = db.prepare("SELECT * FROM doctors WHERE active = 1 LIMIT 4").all() as Record<string, unknown>[];
    const docOptions = doctors.map((d) => `• *${d.name}* (${d.specialty}) - OPD Room ${d.opd_room}, Fee ₹${d.consultation_fee}`).join("\n");

    return {
      content: `📅 *Lumera Doctor Appointment Booking*\n\nHere are the active consultants available for OPD booking today:\n\n${docOptions}\n\nPlease select your preferred specialist or tap a quick booking slot below:`,
      buttons: ["Book Dr. Siddharth (Physio)", "Book Dr. Vikram (Medicine)", "Book Dr. Ananya (Pediatrics)", "View Full OPD Roster"],
    };
  }

  // 4. Check Doctor Timings
  if (q.includes("timing") || q.includes("hours") || q.includes("doctor timing") || q.includes("roster") || q.includes("समय")) {
    const doctors = db.prepare("SELECT * FROM doctors WHERE active = 1 LIMIT 5").all() as Record<string, unknown>[];
    const roster = doctors.map((d) => `👨‍⚕️ *${d.name}* (${d.specialty})\n  🕒 ${d.opd_timing} | 🚪 ${d.opd_room}`).join("\n\n");

    return {
      content: `⏰ *Lumera Polyclinic OPD Roster & Timings*:\n\n${roster}\n\nEmergency care & triage desk operates 24/7.`,
      buttons: ["📅 Book Appointment", "🎫 Check Live Queue", "📍 Clinic Location"],
    };
  }

  // 5. Queue Status
  if (q.includes("queue") || q.includes("token") || q.includes("wait") || q.includes("कतार") || q.includes("नंबर")) {
    const appt = db.prepare(`
      SELECT * FROM appointments
      WHERE patient_phone = ? OR patient_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(phone, patientName) as Record<string, unknown> | undefined;

    if (appt) {
      const ahead = db.prepare(`
        SELECT COUNT(*) as count FROM appointments
        WHERE doctor_id = ? AND status = 'Waiting' AND token_number < ?
      `).get(appt.doctor_id, appt.token_number) as { count: number };

      return {
        content: `🎫 *Live OPD Token & Queue Status*\n\n*Patient*: ${appt.patient_name}\n*Token Number*: *#0${appt.token_number}*\n*Consultant*: ${appt.doctor_name} (${appt.specialty})\n*Status*: ${appt.status}\n\n👥 *Patients Ahead of You*: *${ahead.count}*\n⏳ *Estimated Wait*: *~${ahead.count * 12 + 5} minutes*\n\nPlease remain in Waiting Lounge A. We will notify you on WhatsApp when you are next.`,
        buttons: ["🔄 Refresh Queue", "📍 Room Location", "💬 Message Staff"],
      };
    }
  }

  // 6. Direct quick button clicks
  if (q.includes("book dr. siddharth") || q.includes("dr. siddharth")) {
    // Book into appointments table
    const nextToken = 7;
    const now = new Date().toISOString();
    const apptId = `apt-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO appointments (id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
      VALUES (?, ?, 'pat-6', ?, ?, 'LUM-2026-0106', 'doc-6', 'Dr. Siddharth Varma (PT)', 'Physiotherapy & Rehabilitation', '2026-09-03', '11:30 AM', 'Follow-up', 'Waiting', 'WhatsApp Bot', 700, 1, ?)
    `).run(apptId, nextToken, patientName, phone, now);

    return {
      content: `🎉 *Appointment Confirmed!*\n\n*Token*: *#0${nextToken}*\n*Doctor*: Dr. Siddharth Varma (PT)\n*Specialty*: Physiotherapy & Rehabilitation\n*Slot*: Today at 11:30 AM\n*Room*: Rehab Suite 105\n*UHID*: LUM-2026-0106\n\nYour digital token slip has been generated and saved to your Lumera EMR chart.`,
      buttons: ["🎫 View My Queue", "💊 View Prescription", "📍 Directions to Suite 105"],
    };
  }

  // 7. General Clinical or Query - Use Gemini AI if available
  const ai = getGenAI();
  if (ai) {
    try {
      const prompt = `You are Lumera Health Desk, an empathetic, clinically sound WhatsApp Medical Assistant for Lumera Polyclinic & Rehabilitation Center.
The patient is asking: "${text}".
Patient Name: ${patientName}.
Respond in friendly WhatsApp tone with emojis, medical accuracy, and clear next steps. Keep response within 80-120 words.
Suggest relevant quick actions (booking appointment, checking timings, viewing lab report, or talking to staff).`;

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ text: prompt }],
      });

      return {
        content: res.text || "Thank you for reaching out to Lumera Polyclinic. How may we assist you further?",
        buttons: ["📅 Book Doctor Appointment", "💊 Refill Prescription", "🔬 View Lab Reports", "👤 Speak with Receptionist"],
      };
    } catch {
      /* fallback below */
    }
  }

  // Default Fallback
  return {
    content: `Namaste ${patientName}! 🙏 We have received your query: "${text}".\n\nOur clinic team is available to assist you. You can use the quick actions below to book consultations, view clinical prescriptions, or check diagnostic test reports:`,
    buttons: ["📅 Book Doctor Appointment", "💊 Refill / View Prescription", "🔬 Download Lab Reports", "⏰ Check Doctor Timings"],
  };
}

function detectLanguageSimple(text: string): string {
  // Check for Devanagari script (Hindi/Marathi)
  if (/[\u0900-\u097F]/.test(text)) {
    if (text.includes("आहे") || text.includes("नाही") || text.includes("झाले") || text.includes("मला") || text.includes("कंबरदुखी")) {
      return "mr";
    }
    return "hi";
  }
  // Kannada script
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  // Bengali script
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  // Tamil script
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  return "en";
}

async function translateWithGeminiOrFallback(text: string, targetLang: string, ai: GoogleGenAI | null): Promise<string> {
  const langNames: Record<string, string> = {
    en: "English",
    hi: "Hindi",
    mr: "Marathi",
    kn: "Kannada",
    ta: "Tamil",
    bn: "Bengali",
  };
  const targetName = langNames[targetLang] || targetLang;

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            text: `Translate the following clinical or medical chat message accurately into ${targetName}. Maintain a polite, reassuring medical tone. Only return the translated text:\n\n"${text}"`,
          },
        ],
      });
      if (response.text) return response.text.trim();
    } catch {
      /* fallback */
    }
  }

  // Common clinical translations dictionary fallback
  if (targetLang === "hi") {
    if (text.includes("Appointment confirmed")) return `अपॉइंटमेंट की पुष्टि हो गई है! कृपया समय पर ओपीडी में आएं।`;
    if (text.includes("Prescription")) return `आपकी मेडिकल पर्ची तैयार है और आपके व्हाट्सएप पर भेज दी गई है।`;
    if (text.includes("Doctor")) return `डॉक्टर आपकी फाइल देख रहे हैं। कृपया रिसेप्शन पर संपर्क करें।`;
    return `नमस्ते, आपकी पूछताछ दर्ज कर ली गई है। हमारा स्टाफ जल्द ही आपसे संपर्क करेगा।`;
  }
  if (targetLang === "mr") {
    if (text.includes("Appointment")) return `तुमची अपॉइंटमेंट निश्चित झाली आहे!`;
    return `नमस्कार, तुमची विचारणा नोंदवली गेली आहे. आमचे कर्मचारी लवकरच संपर्क साधतील.`;
  }
  if (targetLang === "en") {
    if (text.includes("नमस्ते") || text.includes("दर्द")) return `Namaste Doctor, I am experiencing pain and would like medical advice.`;
    if (text.includes("साखर") || text.includes("शुगर")) return `Hello Doctor, my blood sugar report is elevated. Please advise on treatment.`;
    return text;
  }

  return text;
}
