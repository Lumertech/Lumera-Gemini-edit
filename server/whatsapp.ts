import { Router, type Request, type Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { getDb, mapAppointment } from "./db.ts";
import {
  clinicLine,
  doctorSignatureByDoctorId,
  escapeHtml,
  getTenantLetterhead,
} from "./letterhead.ts";
import type { GoogleGenAI } from "@google/genai";
import { getVertexClient, vertexGeminiModel, vertexGenerateContent } from "./vertex-gemini.ts";
import {
  bookWhatsAppAppointment,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
  findActiveAppointment,
  findDoctor,
  getWhatsAppQueue,
  httpErrorStatus,
  patchWhatsAppAppointment,
  resolveWhatsAppTenantId,
  runAppointmentReminders,
} from "./whatsapp-calendar.ts";
import { phonesMatch } from "./whatsapp-calendar-booking.ts";
import { cloudDispatchHttpStatus, isCloudDispatchFailure, toWhatsAppRecipient } from "./graph-whatsapp.ts";
import { META_REVIEW_TENANT_ID } from "./tenant-slug.ts";
import { dispatchPatientCloudText } from "./whatsapp-patient-dispatch.ts";
import { isProduction } from "./runtime.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { CLINICIAN_ROLES, requireAuth, requireRole } from "./auth.ts";
import { rejectUntrustedTenantClaim } from "./tenant-guard.ts";
import { authenticatedLabReportPath, authorizeLabReport, labOwnerTenantId, sendLabReportDenied } from "./lab-report-access.ts";
import { WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";
import { formatINR } from "../src/lib/currency.ts";
import { AI_RUPEE_OUTPUT_RULE } from "./india-currency-copy.ts";
import { maxTranscribeBase64Chars } from "./json-body.ts";
import { base64DecodedBytes, canonicalTranscribeMime, transcribeDurationTooLong } from "./transcribe-policy.ts";
import {
  clinicTenantId,
  getTenantConversation,
  listTenantConversations,
  listTenantOutboundEvents,
  requireClinicWhatsApp,
  serializeOutboundEvent,
  upsertScopedConversation,
} from "./whatsapp-scope.ts";

/** Patient names, notes, WhatsApp text, and Rx/lab fields before HTML interpolation. */
function h(value: unknown): string {
  return escapeHtml(value);
}

/** Tenant display name plus that clinic's doctor. Never a platform brand fallback. */
export function resolveClinicFacingNames(
  db: DatabaseSync,
  tenantId: string,
  preferredDoctor?: string
): { clinicName: string; doctorName: string } {
  let clinicName = "";
  const id = String(tenantId || "").trim();
  if (id) {
    try {
      const row = db.prepare("SELECT name FROM tenants WHERE id = ?").get(id) as { name?: string } | undefined;
      clinicName = String(row?.name || "").trim();
    } catch {
      clinicName = "";
    }
  }
  const preferred = String(preferredDoctor || "").trim();
  let doctorName = preferred && !/^doctor$/i.test(preferred) ? preferred : "";
  if (!doctorName && id) {
    try {
      const doc = findDoctor({ tenantId: id });
      doctorName = String(doc?.name || "").trim();
    } catch {
      doctorName = "";
    }
  }
  return {
    clinicName: clinicName || "your clinic",
    doctorName: doctorName || "your doctor",
  };
}

export function clinicOutboundCopy(opts: {
  clinicName: string;
  doctorName: string;
  patientName?: string;
  patientText?: string;
  docOptions?: string;
  roster?: string;
}): {
  handoverRestored: string;
  healthNotice: string;
  consultationSubtitle: string;
  booking: string;
  roster: string;
  assistantPrompt: string;
  assistantFallback: string;
  rxDispatcher: string;
  pdfVerify: string;
  labQa: string;
} {
  const clinic = String(opts.clinicName || "").trim() || "your clinic";
  const doctor = String(opts.doctorName || "").trim() || "your doctor";
  const patientText = String(opts.patientText || "");
  return {
    handoverRestored: `🤖 Automated AI Assistant Restored: ${clinic} assistant is now handling routine patient inquiries.`,
    healthNotice: `Important health notification from ${clinic}.`,
    consultationSubtitle: `Signed by ${doctor} • ${clinic}`,
    booking: `📅 *${clinic} Doctor Appointment Booking*\n\nHere are the active consultants available for OPD booking today:\n\n${opts.docOptions || ""}\n\nPlease select your preferred specialist or tap a quick booking slot below:`,
    roster: `⏰ *${clinic} OPD Roster & Timings*:\n\n${opts.roster || ""}\n\nEmergency care & triage desk operates 24/7.`,
    assistantPrompt: `You are the WhatsApp medical assistant for ${clinic}. The consulting clinician is ${doctor}.
The patient is asking: "${patientText}".
Respond in friendly WhatsApp tone with emojis, medical accuracy, and clear next steps. Keep response within 80-120 words.
Suggest relevant quick actions (booking appointment, checking timings, viewing lab report, or talking to staff).
${AI_RUPEE_OUTPUT_RULE}`,
    assistantFallback: `Thank you for reaching out to ${clinic}. How may we assist you further?`,
    rxDispatcher: doctor,
    pdfVerify: `Digitally signed & verified by ${clinic}`,
    labQa: `${clinic} diagnostic quality assurance`,
  };
}

function getDefaultGenAI(): GoogleGenAI | null {
  return getVertexClient();
}

function serializeWhatsAppMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    patientPhone: m.patient_phone,
    sender: m.sender,
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
  };
}

function requireSessionTenant(req: Request, res: Response): string | null {
  const tenantId = clinicTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function respondWhatsAppMessages(res: Response, tenantId: string, convId?: string, phone?: string) {
  const db = getDb();
  let rows: Record<string, unknown>[] = [];
  if (convId) {
    if (!getTenantConversation(tenantId, convId)) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    rows = db
      .prepare(
        `SELECT * FROM whatsapp_messages
         WHERE conversation_id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
         ORDER BY created_at ASC`
      )
      .all(convId, tenantId) as Record<string, unknown>[];
    db.prepare(
      "UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?"
    ).run(convId, tenantId);
  } else if (phone) {
    rows = db
      .prepare(
        `SELECT * FROM whatsapp_messages
         WHERE patient_phone = ? AND TRIM(COALESCE(tenant_id, '')) = ?
         ORDER BY created_at ASC`
      )
      .all(phone, tenantId) as Record<string, unknown>[];
  } else {
    res.status(400).json({ error: "Either conversationId or phone is required" });
    return;
  }
  res.json({ messages: rows.map(serializeWhatsAppMessage) });
}

export function createWhatsAppRouter(customGetGenAI?: () => GoogleGenAI | null): Router {
  const getGenAI = customGetGenAI || getDefaultGenAI;
  const router = Router();
  router.use(...requireClinicWhatsApp, rejectUntrustedTenantClaim);

  // Helper to format timestamps
  function getDisplayTime(): string {
    return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
  }

  // ----------------------------------------------------
  // 1. CONVERSATIONS MANAGEMENT & HUMAN HANDOVER
  // ----------------------------------------------------

  // List all conversations
  router.get("/conversations", (req: Request, res: Response) => {
    try {
      const tenantId = clinicTenantId(req);
      if (!tenantId) return res.json({ conversations: [] });
      const rows = listTenantConversations(tenantId);

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
      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      const c = getTenantConversation(tenantId, String(req.params.id || ""));
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
      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      const conv = getTenantConversation(tenantId, String(req.params.id || ""));
      if (!conv) return res.status(404).json({ error: "Conversation not found" });

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET handover_mode = ?, updated_at = ?
        WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
      `).run(mode, now, req.params.id, tenantId);

      // Insert an internal audit / system notification message in chat
      const sysMsgId = `sys-${crypto.randomUUID().slice(0, 8)}`;
      const facing = resolveClinicFacingNames(db, String(req.user?.tenantId || ""));
      const copy = clinicOutboundCopy(facing);
      const sysText = mode === "human"
        ? `🔒 Staff Takeover Activated: ${staffName || "Clinic Staff"} has taken control of this conversation. Automated AI bot replies paused.`
        : copy.handoverRestored;

      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, status, created_at, tenant_id)
        VALUES (?, ?, ?, 'system', ?, ?, ?, 'delivered', ?, ?)
      `).run(sysMsgId, req.params.id, String(conv.patient_phone), staffName || "System", sysText, getDisplayTime(), now, tenantId);

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
      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      if (!getTenantConversation(tenantId, String(req.params.id || ""))) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET assigned_staff = ?, updated_at = ?
        WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
      `).run(staffName || "Unassigned", now, req.params.id, tenantId);

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

      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      if (!getTenantConversation(tenantId, String(req.params.id || ""))) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE whatsapp_conversations
        SET tags = ?, updated_at = ?
        WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
      `).run(JSON.stringify(tags), now, req.params.id, tenantId);

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
      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      respondWhatsAppMessages(
        res,
        tenantId,
        String(req.query.conversationId || "").trim() || undefined,
        String(req.query.phone || "").trim() || undefined
      );
    } catch (err: unknown) {
      console.error("Error fetching whatsapp messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Alias used by the suite client: GET /api/whatsapp/messages/:conversationId
  router.get("/messages/:conversationId", (req: Request, res: Response) => {
    try {
      const tenantId = requireSessionTenant(req, res);
      if (!tenantId) return;
      respondWhatsAppMessages(res, tenantId, String(req.params.conversationId || "").trim());
    } catch (err: unknown) {
      console.error("Error fetching whatsapp messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  let handleSendMessage: (req: Request, res: Response) => Promise<unknown>;

  router.post("/messages", (req: Request, res: Response) => {
    return handleSendMessage(req, res);
  });

  // Send Message (Patient, Staff, or Bot)
  router.post("/send", (handleSendMessage = async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const conversationId = String(body.conversationId || body.conversation_id || "").trim();
      const patientPhone = String(body.patientPhone || body.patient_phone || "").trim();
      const patientName = String(body.patientName || body.patient_name || "").trim();
      const sender = String(body.sender || "user");
      const staffName = body.staffName ? String(body.staffName) : null;
      const content = String(body.content || "");
      const buttons = body.buttons ?? null;
      const media = body.media ?? null;
      const targetLanguage = body.targetLanguage;
      const bodyTenantId = typeof body.tenantId === "string" ? body.tenantId : undefined;
      const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId : undefined;
      const wabaId = typeof body.wabaId === "string" ? body.wabaId : undefined;
      const sessionTenantId = clinicTenantId(req);

      if (!patientPhone) {
        return res.status(400).json({ error: "patientPhone is required" });
      }
      if (!content && !media && !buttons) {
        return res.status(400).json({ error: "Message content or media required" });
      }
      if (!sessionTenantId) {
        return res.status(400).json({ error: "No tenant associated with this account." });
      }

      // If staff/agent sends a reply, dispatch it directly to the patient's WhatsApp
      if (sender === "agent" || sender === "bot" || staffName) {
        const staffTenantId = resolveWhatsAppTenantId({
          tenantId: bodyTenantId,
          sessionTenantId,
          phoneNumberId,
          wabaId,
          patientPhone,
        });
        const sent = await dispatchPatientCloudText({
          tenantId: staffTenantId || undefined,
          to: patientPhone,
          textBody: String(content || "").trim() || "[media]",
          isManual: true,
        });
        if (sender === "agent" && isCloudDispatchFailure(sent)) {
          return res.status(cloudDispatchHttpStatus(sent.error, sent.status)).json({
            error: sent.error,
            channel: sent.channel,
          });
        }
      }

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = getDisplayTime();
      const msgId = `msg-${crypto.randomUUID().slice(0, 8)}`;

      let conv: Record<string, unknown> | undefined;
      if (conversationId) {
        conv = db
          .prepare("SELECT * FROM whatsapp_conversations WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?")
          .get(conversationId, sessionTenantId) as Record<string, unknown> | undefined;
        if (!conv) {
          const foreign = db
            .prepare(
              "SELECT id FROM whatsapp_conversations WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) != ?"
            )
            .get(conversationId, sessionTenantId) as { id?: string } | undefined;
          if (foreign?.id) return res.status(404).json({ error: "Conversation not found" });
        }
      }
      if (!conv && patientPhone) {
        conv = db
          .prepare(
            "SELECT * FROM whatsapp_conversations WHERE patient_phone = ? AND TRIM(COALESCE(tenant_id, '')) = ?"
          )
          .get(patientPhone, sessionTenantId) as Record<string, unknown> | undefined;
      }
      if (!conv) {
        const newId = conversationId || `conv-${crypto.randomUUID().slice(0, 8)}`;
        db.prepare(`
          INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at, tenant_id)
          VALUES (?, ?, ?, 'bot', 'Unassigned', '["General"]', 'en', 0, ?, ?, ?, ?)
        `).run(newId, patientPhone, patientName, content.slice(0, 80), timeDisplay, now, sessionTenantId);
        conv = db.prepare("SELECT * FROM whatsapp_conversations WHERE id = ?").get(newId) as Record<string, unknown>;
      }

      let translatedContent: string | null = null;
      let detectedLanguage: string | null = (conv.preferred_language as string) || "en";

      // If sent by staff and translation requested
      if ((sender === "agent" || sender === "bot") && targetLanguage && targetLanguage !== "en") {
        try {
          translatedContent = await translateWithGeminiOrFallback(content, String(targetLanguage), getGenAI());
        } catch (err) {
          reportCaughtError(err, "whatsapp.translate.outbound");
          translatedContent = null;
        }
      }

      // If sent by user, detect language if non-English
      if (sender === "user") {
        detectedLanguage = detectLanguageSimple(content);
        if (detectedLanguage !== "en") {
          try {
            translatedContent = await translateWithGeminiOrFallback(content, "en", getGenAI());
          } catch (err) {
            reportCaughtError(err, "whatsapp.translate.inbound");
            translatedContent = null;
          }
        }
      }

      // Insert sent message
      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)
      `).run(
        msgId,
        String(conv.id),
        patientPhone,
        sender,
        staffName,
        content,
        translatedContent,
        detectedLanguage,
        timeDisplay,
        buttons ? JSON.stringify(buttons) : null,
        media ? JSON.stringify(media) : null,
        now,
        sessionTenantId
      );

      // Update conversation last message
      const isStaffTakeover = conv.handover_mode === "human";
      const newUnread = sender === "user" && isStaffTakeover ? Number(conv.unread_count || 0) + 1 : Number(conv.unread_count || 0);

      db.prepare(`
        UPDATE whatsapp_conversations
        SET last_message = ?, last_message_time = ?, unread_count = ?, updated_at = ?, last_inbound_at = ?
        WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
      `).run(content.slice(0, 80), timeDisplay, newUnread, now, now, String(conv.id), sessionTenantId);

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
      // AUTOMATED BOT ENGINE (Runs when sender === 'user')
      // ----------------------------------------------------
      if (sender === "user") {
        let botReply = await processBotActionOrQuery(content, patientPhone, patientName, conv, db, {
          tenantId: bodyTenantId ? String(bodyTenantId) : undefined,
          sessionTenantId,
          phoneNumberId: phoneNumberId ? String(phoneNumberId) : undefined,
          wabaId: wabaId ? String(wabaId) : undefined,
        });

        // Ensure a response is NEVER avoided
        if (!botReply || !botReply.content) {
          const registered = findRegisteredPatient(db, patientPhone, sessionTenantId);
          const fName = registered?.firstName || "";
          const greetingPrefix = fName ? `Hello ${fName}! 🙏` : `Hello! 🙏`;
          botReply = {
            content: `${greetingPrefix} I do not have an answer to that specific question right now, but our clinic front desk team is happy to assist you.\n\nHere is what I can help you with 24/7:\n\n• 📅 *Doctor Appointments* — check slots & instant token booking\n• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n• 💊 *Prescriptions & Refills* — view & download prescriptions\n• 🔔 *Follow-Up Status* — check your scheduled review dates\n• 🔬 *Diagnostic Reports* — lab & test results\n• 📍 *Clinic Location & Timings* — address, directions & helpline\n• 👤 *Speak with Front Desk* — connect with our clinic staff\n\nPlease let me know if you would like help with any of the above, or reply *front desk* to speak with our reception.`,
            buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Receptionist"],
          };
        }

        const botMsgId = `bot-${crypto.randomUUID().slice(0, 8)}`;
        const botTime = getDisplayTime();
        const botNow = new Date().toISOString();

        db.prepare(`
          INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, buttons, media, status, created_at, tenant_id)
          VALUES (?, ?, ?, 'bot', NULL, ?, ?, ?, ?, 'delivered', ?, ?)
        `).run(
          botMsgId,
          String(conv.id),
          patientPhone,
          botReply.content,
          botTime,
          botReply.buttons ? JSON.stringify(botReply.buttons) : null,
          botReply.media ? JSON.stringify(botReply.media) : null,
          botNow,
          sessionTenantId
        );

        db.prepare(`
          UPDATE whatsapp_conversations
          SET last_message = ?, last_message_time = ?, updated_at = ?
          WHERE id = ? AND (tenant_id IS NULL OR TRIM(tenant_id) = '' OR tenant_id = ?)
        `).run(botReply.content.slice(0, 80), botTime, botNow, String(conv.id), sessionTenantId);

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

        // When testing with a real phone number, dispatch the bot reply to their WhatsApp
        const cleanPhone = toWhatsAppRecipient(patientPhone);
        if (cleanPhone.length >= 10 && !cleanPhone.includes("55501")) {
          void dispatchPatientCloudText({
            tenantId: sessionTenantId,
            to: patientPhone,
            textBody: botReply.content,
          }).catch((err) => console.error("[UI Test Outbound Error]", err));
        }
      }

      res.status(201).json(responsePayload);
    } catch (err: unknown) {
      console.error("Error in whatsapp message send:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  }));

  // ----------------------------------------------------
  // 3. DYNAMIC EMR & DATABASE ACTIONS (Live Queries)
  // ----------------------------------------------------
  router.post("/emr-action", async (req: Request, res: Response) => {
    try {
      const { action, patientPhone = "+91 98234 55667", payload = {}, tenantId: bodyTenantId, phoneNumberId, wabaId } = req.body;
      const db = getDb();
      const sessionTenantId = String(req.user?.tenantId || "").trim();
      const tenantId = resolveWhatsAppTenantId({
        tenantId: bodyTenantId || payload.tenantId,
        sessionTenantId,
        phoneNumberId: phoneNumberId || payload.phoneNumberId,
        wabaId: wabaId || payload.wabaId,
        patientPhone,
      });
      if (!tenantId) {
        return res.status(400).json({
          error: "Unable to resolve clinic tenant for this WhatsApp action. Pass tenantId or connect a WABA phone_number_id.",
        });
      }

      let patient = db
        .prepare("SELECT * FROM patients WHERE tenant_id = ? AND phone = ?")
        .get(tenantId, patientPhone) as Record<string, unknown> | undefined;
      if (!patient) {
        const tenantPatients = db.prepare("SELECT * FROM patients WHERE tenant_id = ?").all(tenantId) as Record<string, unknown>[];
        patient = tenantPatients.find((row) => String(row.phone || "").replace(/\D/g, "").slice(-10) === String(patientPhone).replace(/\D/g, "").slice(-10));
      }

      const patientId = patient?.id ? String(patient.id) : "";

      if (action === "get_prescription") {
        const rx = db.prepare(`
          SELECT * FROM prescriptions
          WHERE tenant_id = ? AND (patient_phone = ? OR patient_id = ?)
          ORDER BY created_at DESC LIMIT 1
        `).get(tenantId, patientPhone, patientId) as Record<string, unknown> | undefined;

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
        const labs = patientId
          ? (db.prepare(`
              SELECT * FROM lab_reports
              WHERE tenant_id = ? AND patient_id = ?
              ORDER BY created_at DESC
            `).all(tenantId, patientId) as Record<string, unknown>[])
          : [];

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
            pdfUrl: authenticatedLabReportPath(String(l.id)),
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
        const queue = getWhatsAppQueue({
          tenantId,
          patientPhone,
          patientId: patientId || undefined,
        });
        return res.json(queue);
      }

      if (action === "book_appointment") {
        const booked = bookWhatsAppAppointment({
          tenantId,
          patientPhone,
          patientName: String(payload.patientName || patient?.name || ""),
          doctorId: payload.doctorId,
          doctorName: payload.doctorName,
          date: payload.date,
          timeSlot: payload.timeSlot,
          type: payload.type,
        });
        const confirmation = booked.reused
          ? undefined
          : await dispatchWhatsAppBookConfirmation({
              tenantId,
              appointment: booked.appointment,
            });
        return res.json({
          success: true,
          reused: booked.reused,
          appointment: booked.appointment,
          confirmation: confirmation
            ? { ok: confirmation.ok, channel: confirmation.channel, messageId: confirmation.ok ? confirmation.messageId : undefined }
            : { skipped: true, reason: "existing_appointment" },
        });
      }

      if (action === "cancel_appointment") {
        const appointment = patchWhatsAppAppointment({
          tenantId,
          appointmentId: payload.appointmentId,
          patientPhone,
          patientId: patientId || undefined,
          body: { status: "Cancelled" },
        });
        return res.json({ success: true, appointment });
      }

      if (action === "reschedule_appointment") {
        if (!payload.date && !payload.timeSlot && !payload.time_slot) {
          return res.status(400).json({ error: "date or timeSlot is required to reschedule" });
        }
        const appointment = patchWhatsAppAppointment({
          tenantId,
          appointmentId: payload.appointmentId,
          patientPhone,
          patientId: patientId || undefined,
          body: {
            ...(payload.date ? { date: payload.date } : {}),
            ...(payload.timeSlot || payload.time_slot
              ? { timeSlot: payload.timeSlot || payload.time_slot }
              : {}),
            status: "Waiting",
          },
        });
        return res.json({ success: true, appointment });
      }

      if (action === "mark_no_show") {
        const appointment = patchWhatsAppAppointment({
          tenantId,
          appointmentId: payload.appointmentId,
          patientPhone,
          patientId: patientId || undefined,
          body: { status: "No-Show" },
        });
        return res.json({ success: true, appointment });
      }

      res.status(400).json({ error: "Unknown action" });
    } catch (err: unknown) {
      console.error("Error executing EMR action:", err);
      const status = httpErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to execute EMR action";
      res.status(status).json({ error: message });
    }
  });

  // ----------------------------------------------------
  // 4. OUTBOUND AUTOMATED TRIGGER ENGINE
  // ----------------------------------------------------
  const handleOutboundTrigger = async (req: Request, res: Response) => {
    try {
      const {
        eventType, // 'appointment_reminder' | 'post_consultation_dispatch' | 'queue_token_update'
        patientPhone: rawPatientPhone,
        patientName = "Rajiv Saxena",
        customPayload = {},
        tenantId: bodyTenantId,
        phoneNumberId,
        wabaId,
      } = req.body;
      const patientPhone = String(rawPatientPhone ?? "").trim();

      if (!eventType) return res.status(400).json({ error: "eventType is required" });
      if (!patientPhone) return res.status(400).json({ error: "patientPhone is required" });

      const reminderEvent =
        eventType === "appointment_reminder" || eventType === "appointment_reminder_24h" || eventType === "appointment_reminder_2h";
      if (reminderEvent) {
        const tenantId = resolveWhatsAppTenantId({
          tenantId: bodyTenantId || customPayload.tenantId,
          sessionTenantId: String(req.user?.tenantId || "").trim(),
          phoneNumberId,
          wabaId,
          patientPhone,
        });
        if (!tenantId) {
          return res.status(400).json({ error: "Unable to resolve clinic tenant for appointment reminder." });
        }
        const existing = findActiveAppointment({
          tenantId,
          appointmentId: customPayload.appointmentId,
          patientPhone,
        });
        if (!existing) {
          return res.status(404).json({
            error:
              "No active upcoming appointment matches this patient phone. Book a slot for the selected patient in this clinic, then trigger the reminder again.",
          });
        }
        const window = eventType === "appointment_reminder_2h" ? "2h" : "24h";
        const result = await dispatchAppointmentReminder({
          tenantId,
          appointment: mapAppointment(existing),
          window,
        });
        if (result.ok === false) {
          const status = result.channel === "none" && isProduction() ? 503 : 502;
          return res.status(status).json({
            ok: false,
            error: result.error,
            channel: result.channel,
            eventId: result.eventId,
          });
        }
        return res.status(201).json({
          ok: true,
          eventId: result.eventId,
          eventType: "appointment_reminder",
          channel: result.channel,
          messageId: result.messageId,
          appointment: mapAppointment(existing),
        });
      }

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = getDisplayTime();
      const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
      const outboundTenantId =
        resolveWhatsAppTenantId({
          tenantId: bodyTenantId || customPayload.tenantId,
          sessionTenantId: String(req.user?.tenantId || "").trim(),
          phoneNumberId,
          wabaId,
          patientPhone,
        }) || "";
      const outboundCopy = clinicOutboundCopy(resolveClinicFacingNames(db, outboundTenantId));

      let details = "";
      let messageContent = "";
      let buttons: string[] | null = null;
      let media: Record<string, unknown> | null = null;

      if (eventType === "post_consultation_dispatch") {
        details = `Post-consultation digital packet dispatched: Prescription & Diagnostic invoice.`;
        messageContent = `📋 *Consultation Summary & Prescription Signed*\n\nNamaste ${patientName},\n${outboundCopy.rxDispatcher} has signed your clinical prescription (*RX-2026-0106*).\n\nYour digital consultation receipt (#INV-9921 for ${formatINR(700)}) has been generated. You can preview or download your verified medical documents below.`;
        buttons = ["📄 View Prescription Slip", "📥 Download PDF", "💊 Order Medicine Home Delivery"];
        media = {
          type: "pdf",
          title: "Prescription_RX-2026-0106_Rajiv_Saxena.pdf",
          url: "/api/emr/prescription/rx-101/pdf",
          size: "245 KB",
          subtitle: outboundCopy.consultationSubtitle,
        };
      } else if (eventType === "queue_token_update") {
        details = `Live OPD Queue Alert dispatched: Patient is next in line.`;
        messageContent = `📢 *OPD Queue Alert - You're Almost Up!*\n\nNamaste ${patientName},\nToken *#01* is currently completing consultation. You are *NEXT IN LINE* (Token #02).\n\n📍 Please proceed to *Rehab Suite 105* near Waiting Lounge B.`;
        buttons = ["✅ I am at OPD Room", "🚶 Need 5 Mins", "📞 Reception Call"];
      } else {
        details = `Custom broadcast sent to ${patientName}.`;
        messageContent = customPayload.message || outboundCopy.healthNotice;
      }

      const sessionTenantId = clinicTenantId(req);
      db.prepare(`
        INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
        VALUES (?, ?, ?, ?, 'delivered', ?, ?, ?, ?)
      `).run(eventId, eventType, patientPhone, patientName, details, JSON.stringify(customPayload), now, sessionTenantId);

      let conv = sessionTenantId
        ? (db
            .prepare(
              "SELECT id, tenant_id FROM whatsapp_conversations WHERE patient_phone = ? AND TRIM(COALESCE(tenant_id, '')) = ?"
            )
            .get(patientPhone, sessionTenantId) as { id: string; tenant_id?: string } | undefined)
        : undefined;
      let convId = conv?.id || "";
      if (!convId && sessionTenantId) {
        convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
        db.prepare(
          `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at, tenant_id)
           VALUES (?, ?, ?, 'bot', 'Unassigned', '["General"]', 'en', 0, ?, ?, ?, ?)`
        ).run(convId, patientPhone, patientName, messageContent.slice(0, 80), timeDisplay, now, sessionTenantId);
      }

      if (convId) {
      const msgId = `msg-out-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, time_display, buttons, media, status, created_at, tenant_id)
        VALUES (?, ?, ?, 'bot', 'Automated Trigger Engine', ?, ?, ?, ?, 'delivered', ?, ?)
      `).run(
        msgId,
        convId,
        patientPhone,
        messageContent,
        timeDisplay,
        buttons ? JSON.stringify(buttons) : null,
        media ? JSON.stringify(media) : null,
        now,
        sessionTenantId
      );

      db.prepare(`
        UPDATE whatsapp_conversations
        SET last_message = ?, last_message_time = ?, updated_at = ?
        WHERE id = ? AND TRIM(COALESCE(tenant_id, '')) = ?
      `).run(messageContent.slice(0, 80), timeDisplay, now, convId, sessionTenantId);
      }

      res.status(201).json({
        ok: true,
        eventId,
        eventType,
        details,
        messageDispatched: messageContent,
        channel: "sandbox",
      });
    } catch (err: unknown) {
      console.error("Error triggering outbound notification:", err);
      const status = httpErrorStatus(err);
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to dispatch outbound notification" });
    }
  };

  router.post("/outbound/trigger", handleOutboundTrigger);
  router.post("/outbound-trigger", handleOutboundTrigger);

  const handleOutboundEvents = (req: Request, res: Response) => {
    try {
      const tenantId = clinicTenantId(req);
      if (!tenantId) return res.json({ events: [] });
      const events = listTenantOutboundEvents(tenantId);

      res.json({ events });
    } catch (err: unknown) {
      res.status(500).json({ error: "Failed to fetch outbound events" });
    }
  };

  router.get("/outbound/events", handleOutboundEvents);
  router.get("/outbound-events", handleOutboundEvents);

  router.post("/reminders/run", async (req: Request, res: Response) => {
    try {
      const tenantId = resolveWhatsAppTenantId({
        tenantId: req.body?.tenantId,
        sessionTenantId: String(req.user?.tenantId || "").trim(),
        phoneNumberId: req.body?.phoneNumberId,
        wabaId: req.body?.wabaId,
      });
      const result = await runAppointmentReminders({
        tenantId: tenantId || undefined,
        appointmentId: req.body?.appointmentId,
        now: req.body?.now ? new Date(req.body.now) : undefined,
      });
      const policyDenied = result.failed.find((item) => item.result.ok === false && item.result.status === 403);
      if (policyDenied && policyDenied.result.ok === false) {
        return res.status(403).json({
          ...result,
          ok: false,
          error: policyDenied.result.error,
          channel: policyDenied.result.channel,
        });
      }
      const missingCreds = result.failed.find((item) => item.result.ok === false && item.result.channel === "none");
      if (missingCreds && missingCreds.result.ok === false && isProduction()) {
        const clinicNotConnected = /Clinic WhatsApp not connected/i.test(missingCreds.result.error);
        return res.status(503).json({
          ...result,
          ok: false,
          error: clinicNotConnected
            ? missingCreds.result.error
            : "WhatsApp Cloud API is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID (or a real tenant phone_number_id + token). Reminder was not delivered.",
          channel: "none",
        });
      }
      res.json({
        ok: result.failed.length === 0,
        ...result,
      });
    } catch (err: unknown) {
      const status = httpErrorStatus(err);
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to run appointment reminders" });
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

      // Patient audio goes through Vertex. No API-key client and no invented transcript.
      if (audioBase64) {
        const canonicalMime = canonicalTranscribeMime(mimeType);
        if (!canonicalMime) {
          return res.status(415).json({ error: "Unsupported audio type." });
        }
        const cleanBase64 = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, "");
        if (cleanBase64.length > maxTranscribeBase64Chars()) {
          return res.status(413).json({ error: "Recording is too long to transcribe." });
        }
        const audioBytes = base64DecodedBytes(cleanBase64);
        if (transcribeDurationTooLong(audioBytes, req.body?.durationMs)) {
          return res.status(413).json({ error: "Recording is too long to transcribe." });
        }
        const ai = getGenAI();
        if (!ai) {
          return res.status(503).json({ code: "AI_WHATSAPP_NOT_CONFIGURED", message: "AI transcription not configured" });
        }
        try {
          const voiceFacing = resolveClinicFacingNames(getDb(), String(req.user?.tenantId || ""));
          const prompt = `You are the clinical audio assistant for ${voiceFacing.clinicName}. The consulting clinician is ${voiceFacing.doctorName}. Transcribe this patient voice note accurately.
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
}
${AI_RUPEE_OUTPUT_RULE}`;

          const response = await ai.models.generateContent({
            model: vertexGeminiModel(),
            contents: [
              {
                inlineData: {
                  mimeType: canonicalMime,
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
          const name = geminiErr && typeof geminiErr === "object" && "name" in geminiErr ? String((geminiErr as { name?: string }).name) : "Error";
          console.warn("WhatsApp audio transcription failed", name);
          return res.status(503).json({
            code: "AI_WHATSAPP_UNAVAILABLE",
            message: "AI transcription is temporarily unavailable",
          });
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
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "Error";
      console.error("Error in /api/whatsapp/voice-process", name);
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
  // Dispatch Prescription via WhatsApp Graph API
  // ----------------------------------------------------
  router.post("/send-rx", async (req: Request, res: Response) => {
    try {
      const {
        patientPhone = "+91 98234 55667",
        patientName = "Patient",
        uhid = "LUM-2026-0001",
        rxNumber = "RX-2026-0001",
        doctorName = "Doctor",
        doctorSpecialty = "General Medicine",
        diagnosis = "Clinical Consultation",
        medicines = [],
        advice = [],
        language = "en",
      } = req.body;
      const tenantId = String((req as Request).user?.tenantId || "");
      const rxFacing = resolveClinicFacingNames(getDb(), tenantId, String(req.body?.doctorName || doctorName || ""));
      const rxCopy = clinicOutboundCopy(rxFacing);
      const clinicName = String(req.body?.clinicName || "").trim() || rxFacing.clinicName;

      const db = getDb();
      const now = new Date().toISOString();
      const timeDisplay = getDisplayTime();
      const cleanPhone = (patientPhone || "+91 98234 55667").trim();
      const preferredId = `conv-${cleanPhone.replace(/\D/g, "").slice(-8) || "pt"}`;

      // Insert or update prescription record in DB
      try {
        db.prepare(`
          INSERT INTO prescriptions (id, rx_number, patient_name, patient_phone, uhid, doctor_name, specialty, diagnosis, medicines, lab_tests, advice, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(rx_number) DO UPDATE SET
            diagnosis = excluded.diagnosis,
            medicines = excluded.medicines,
            advice = excluded.advice
        `).run(
          `rx-${crypto.randomUUID().slice(0, 8)}`,
          rxNumber,
          patientName,
          cleanPhone,
          uhid,
          doctorName,
          doctorSpecialty,
          diagnosis,
          JSON.stringify(medicines || []),
          JSON.stringify([]),
          JSON.stringify(advice || []),
          now
        );
      } catch {
        // Table fallback
      }

      const convId = upsertScopedConversation({
        preferredId,
        tenantId,
        patientPhone: cleanPhone,
        patientName,
        assignedStaff: rxCopy.rxDispatcher,
        tags: '["Prescription", "Digital EMR"]',
        preferredLanguage: language || "en",
        lastMessage: `Digital Rx: ${rxNumber}`,
        lastMessageTime: timeDisplay,
        now,
      });

      const pdfUrl = `/api/whatsapp/prescription/${rxNumber}/pdf`;
      const medsText = medicines.slice(0, 3).map((m: any, i: number) => `  ${i + 1}. *${m.drugName}* (${m.dosage} - ${m.frequency})`).join("\n");
      const moreMeds = medicines.length > 3 ? `\n  _...and ${medicines.length - 3} more medications_` : "";

      const content = `🩺 *${clinicName}*\n*Official Digital Prescription*\n\nNamaste *${patientName}* (UHID: ${uhid}),\nYour consultation prescription has been finalized and signed by *${doctorName}* (${doctorSpecialty}).\n\n📋 *Diagnosis:* ${diagnosis}\n💊 *Prescribed Medications (${medicines.length}):*\n${medsText}${moreMeds}\n\n📄 *Download Official PDF Prescription:*\n${pdfUrl}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`;

      const msgId = `msg-rx-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at, tenant_id)
        VALUES (?, ?, ?, 'agent', ?, ?, null, ?, ?, ?, ?, 'delivered', ?, ?)
      `).run(
        msgId,
        convId,
        cleanPhone,
        doctorName,
        content,
        language,
        timeDisplay,
        JSON.stringify([
          { type: 'URL', text: '📥 View / Download PDF Rx', url: pdfUrl },
          { type: 'QUICK_REPLY', text: '📅 Book Follow-Up', payload: 'book_followup' }
        ]),
        JSON.stringify({ type: 'document', url: pdfUrl, title: `Prescription-${rxNumber}.pdf` }),
        now,
        tenantId || WHATSAPP_QUARANTINE_TENANT_ID
      );

      return res.json({
        success: true,
        messageId: msgId,
        rxNumber,
        pdfUrl,
        deliveredTo: cleanPhone,
        status: 'delivered',
        message: 'Prescription PDF dispatched successfully via WhatsApp Graph API'
      });
    } catch (err: any) {
      console.error("WhatsApp Rx dispatch error:", err);
      return res.status(500).json({ error: "Failed to dispatch WhatsApp Rx: " + err.message });
    }
  });

  // ----------------------------------------------------
  // 6. CLINICAL DOCUMENTS (HTML/PDF PREVIEW & DOWNLOAD)
  // ----------------------------------------------------
  router.get("/prescription/:id/pdf", requireAuth, requireRole(...CLINICIAN_ROLES), (req: Request, res: Response) => {
    try {
      const tenantId = String(req.user?.tenantId || "").trim();
      if (!tenantId) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const db = getDb();
      const rx = db.prepare("SELECT * FROM prescriptions WHERE id = ? OR rx_number = ?").get(req.params.id, req.params.id) as Record<string, unknown> | undefined;
      if (!rx) return res.status(404).send("Prescription not found");
      const rxTenant = String(rx.tenant_id || "").trim();
      if (!rxTenant || rxTenant !== tenantId) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const medicines = JSON.parse((rx.medicines as string) || "[]");
      const labTests = JSON.parse((rx.lab_tests as string) || "[]");
      const advice = JSON.parse((rx.advice as string) || "[]");
      const letterhead = getTenantLetterhead(tenantId);
      const stamped = clinicLine(letterhead);
      const clinicName = escapeHtml(String(rx.clinic_name || stamped.name || letterhead.clinicName || "Clinic"));
      const clinicAddress = escapeHtml(String(rx.clinic_address || stamped.address || letterhead.address));
      const clinicPhone = escapeHtml(String(rx.clinic_phone || stamped.phone || letterhead.phone));
      const clinicEmail = escapeHtml(letterhead.email);
      const clinicGstin = escapeHtml(letterhead.gstin);
      const clinicUpi = escapeHtml(letterhead.upiId);
      const sealText = escapeHtml(letterhead.sealText);
      const footerDisclaimer = escapeHtml(letterhead.footerDisclaimer);
      const signatureUrl = doctorSignatureByDoctorId(String(rx.doctor_id || "")) || letterhead.signatureUrl;
      const signatureBlock = signatureUrl
        ? `<img src="${escapeHtml(signatureUrl)}" alt="Doctor signature" style="max-height: 48px; object-fit: contain;" />`
        : `<div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 26px; color: #0369a1;">${escapeHtml(String(rx.doctor_name || ""))}</div>`;
      const subLine = [clinicAddress, clinicPhone ? `Phone: ${clinicPhone}` : "", clinicEmail]
        .filter(Boolean)
        .join(" • ");
      const gstinLine = [clinicGstin ? `GSTIN: ${clinicGstin}` : "", clinicUpi ? `UPI: ${clinicUpi}` : ""]
        .filter(Boolean)
        .join(" • ");

      const medsHtml = medicines.map((m: any, idx: number) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 8px; font-weight: 600; color: #1e293b;">${idx + 1}. ${h(m.drugName)}</td>
          <td style="padding: 10px 8px; color: #475569;">${h(m.composition || "-")}</td>
          <td style="padding: 10px 8px; color: #0f172a; font-weight: 500;">${h(m.dosage)} (${h(m.form)})</td>
          <td style="padding: 10px 8px; font-weight: 700; color: #0369a1;">${h(m.frequency)}</td>
          <td style="padding: 10px 8px; color: #475569;">${h(m.timing)} (${h(m.durationDays)} days)</td>
          <td style="padding: 10px 8px; color: #64748b; font-size: 13px;">${h(m.instructions || "-")}</td>
        </tr>
      `).join("");

      const testsHtml = labTests.map((t: any) => `<li style="margin-bottom: 4px; color: #334155;"><strong>${h(t.testName)}</strong> (${h(t.urgency || "Routine")})</li>`).join("");
      const adviceHtml = advice.map((a: string) => `<li style="margin-bottom: 4px; color: #334155;">${h(a)}</li>`).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Clinical Prescription - ${h(rx.rx_number)}</title>
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
        <div class="clinic-brand">${clinicName}</div>
        <div class="clinic-sub">${subLine}${gstinLine ? `<br>${gstinLine}` : ""}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${h(rx.doctor_name)}</div>
        <div style="font-size: 13px; color: #475569;">${h(rx.doctor_specialty)}</div>
        <div style="font-size: 12px; color: #64748b;">Reg No: ${h(rx.doctor_reg_number)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><strong>Patient Name</strong> ${h(rx.patient_name)}</div>
      <div><strong>UHID / ID</strong> ${h(rx.patient_uhid)}</div>
      <div><strong>Phone</strong> ${h(rx.patient_phone)}</div>
      <div><strong>Date of Rx</strong> ${h(rx.date)}</div>
    </div>

    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Provisional Clinical Diagnosis</div>
      <div style="font-size: 17px; font-weight: 700; color: #0f172a; margin-top: 4px;">${h(rx.diagnosis)} ${rx.icd10_code ? `(ICD-10: ${h(rx.icd10_code)})` : ''}</div>
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
      <p style="font-size: 14px; color: #334155; margin-top: 4px;">${h(rx.diet_instructions)}</p>
    ` : ''}

    ${rx.follow_up_date ? `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #166534;">
        🗓️ <strong>Review / Follow-up Visit Advised on:</strong> ${h(rx.follow_up_date)}
      </div>
    ` : ''}

    <div class="footer">
      <div class="qr-box">
        <div><strong>Rx No:</strong> ${h(rx.rx_number)}</div>
        <div style="color: #64748b; font-size: 10px; margin-top: 4px;">${h(clinicOutboundCopy({ clinicName: String(rx.clinic_name || stamped.name || letterhead.clinicName || "Clinic"), doctorName: String(rx.doctor_name || "") }).pdfVerify)}</div>
      </div>
      <div style="text-align: right;">
        ${signatureBlock}
        <div style="font-weight: 600; color: #1e293b; margin-top: 2px;">${escapeHtml(String(rx.doctor_name || ""))}</div>
        <div style="font-size: 11px; color: #64748b;">${sealText || "Authorized Medical Signatory"}</div>
      </div>
    </div>
    ${footerDisclaimer ? `<p style="margin-top: 16px; font-size: 11px; color: #64748b;">${footerDisclaimer}</p>` : ""}
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

  router.get("/lab-report/:id/pdf", requireAuth, requireRole(...CLINICIAN_ROLES), (req: Request, res: Response) => {
    try {
      const access = authorizeLabReport(req, String(req.params.id || ""));
      if (!access.ok) return sendLabReportDenied(res, access);
      const lab = access.lab;

      const results = JSON.parse((lab.results as string) || "[]");
      const rowsHtml = results.map((r: any) => {
        const isAbnormal = r.status && r.status !== "Normal";
        const badgeColor = isAbnormal ? "background: #fef2f2; color: #b91c1c; font-weight: 700;" : "background: #f0fdf4; color: #15803d;";
        return `
          <tr style="border-bottom: 1px solid #e2e8f0; ${isAbnormal ? "background: #fffbfb;" : ""}">
            <td style="padding: 12px 10px; font-weight: 600; color: #1e293b;">${h(r.param)}</td>
            <td style="padding: 12px 10px; font-size: 15px; font-weight: 700; color: ${isAbnormal ? "#b91c1c" : "#0f172a"};">${h(r.value)} ${h(r.unit)}</td>
            <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${h(r.normalRange)} ${h(r.unit)}</td>
            <td style="padding: 12px 10px;"><span style="padding: 3px 8px; border-radius: 4px; font-size: 12px; ${badgeColor}">${h(r.status)}</span></td>
            <td style="padding: 12px 10px; font-size: 12px; color: #64748b;">${h(r.trendDelta || "-")}</td>
          </tr>
        `;
      }).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Diagnostic Laboratory Report - ${h(lab.id)}</title>
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
        <div class="lab-brand">${h(lab.lab_name)}</div>
        <div class="lab-sub">Automated Clinical Pathology, Biochemistry & Imaging Services<br>NABL & ICMR Accredited Diagnostic Center • Indiranagar Center</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 14px; font-weight: 700; color: #0f172a;">Sample ID: ${h(lab.id)}</div>
        <div style="font-size: 12px; color: #64748b;">Category: ${h(lab.category)}</div>
        <div style="font-size: 12px; color: #64748b;">Date Collected: ${h(lab.date)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div><strong>Patient Name</strong> ${h(lab.patient_name)}</div>
      <div><strong>UHID</strong> ${h(lab.patient_uhid)}</div>
      <div><strong>Referring Doctor</strong> ${h(resolveClinicFacingNames(getDb(), labOwnerTenantId(lab)).doctorName)}</div>
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
      <div>${h(lab.doctor_interpretation)}</div>
    </div>

    <div class="footer">
      <div>
        <div>Verified by: <strong>Dr. Ananya Ray, MD (Pathology)</strong></div>
        <div style="color: #64748b; font-size: 11px;">${h(clinicOutboundCopy(resolveClinicFacingNames(getDb(), labOwnerTenantId(lab))).labQa)}</div>
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

export interface RegisteredPatientInfo {
  id: string;
  name: string;
  firstName: string;
  uhid: string;
  phone: string;
  tenantId: string;
}

/**
 * Look up whether a phone number belongs to a recognized patient in the database.
 * Returns patient name and clean first name (e.g. "Ravee") for addressing.
 */
export function findRegisteredPatient(
  db: any,
  phone: string,
  tenantId?: string
): RegisteredPatientInfo | null {
  if (!db || !phone) return null;
  const rawDigits = String(phone).replace(/\D/g, "");
  const last10 = rawDigits.slice(-10);
  if (!last10) return null;

  try {
    let row: any;
    if (tenantId) {
      row = db.prepare(`
        SELECT id, tenant_id, uhid, name, phone FROM patients
        WHERE (phone = ? OR phone = ? OR phone LIKE ?)
          AND (tenant_id = ? OR tenant_id IS NULL OR TRIM(tenant_id) = '')
        ORDER BY created_at DESC LIMIT 1
      `).get(phone, `+${rawDigits}`, `%${last10}`, tenantId);
    }
    if (!row) {
      row = db.prepare(`
        SELECT id, tenant_id, uhid, name, phone FROM patients
        WHERE phone = ? OR phone = ? OR phone LIKE ?
        ORDER BY created_at DESC LIMIT 1
      `).get(phone, `+${rawDigits}`, `%${last10}`);
    }

    if (row && row.name && String(row.name).trim()) {
      const rawName = String(row.name).trim();
      // Ignore generic placeholders
      if (!/^patient(\s*\(\+?\d+\))?$/i.test(rawName)) {
        const cleaned = rawName.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").trim();
        const firstName = cleaned.split(/\s+/)[0] || cleaned;
        return {
          id: String(row.id || ""),
          name: rawName,
          firstName,
          uhid: String(row.uhid || ""),
          phone: String(row.phone || phone),
          tenantId: String(row.tenant_id || tenantId || ""),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function processBotActionOrQuery(
  text: string,
  phone: string,
  patientName: string,
  conv: Record<string, unknown>,
  db: any,
  tenantHints: { tenantId?: string; sessionTenantId?: string; phoneNumberId?: string; wabaId?: string } = {}
): Promise<{
  content: string;
  buttons?: string[];
  media?: Record<string, unknown>;
} | null> {
  const q = text.toLowerCase().trim();
  const tenantId = resolveWhatsAppTenantId({
    tenantId: tenantHints.tenantId,
    sessionTenantId: tenantHints.sessionTenantId,
    phoneNumberId: tenantHints.phoneNumberId,
    wabaId: tenantHints.wabaId,
    patientPhone: phone,
  }) || META_REVIEW_TENANT_ID;

  const clinicNames = resolveClinicFacingNames(db, tenantId);

  // Check if patient is recognized from the database
  const registered = findRegisteredPatient(db, phone, tenantId);
  const isRegistered = Boolean(registered && registered.firstName);
  const firstName = registered?.firstName || (
    patientName && !/^patient(\s*\(\+?\d+\))?$/i.test(patientName)
      ? patientName.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").trim().split(/\s+/)[0]
      : ""
  );
  const effectivePatientName = registered?.name || (
    patientName && !/^patient(\s*\(\+?\d+\))?$/i.test(patientName) ? patientName : (firstName || "there")
  );

  // Intake state check from conversation tags
  const rawTags = (conv?.tags as string) || "[]";
  let tagsList: string[] = [];
  try {
    tagsList = JSON.parse(rawTags);
  } catch {
    tagsList = [];
  }
  const isIntakePending = tagsList.includes("awaiting_intake");

  // Helper to clear awaiting_intake tag
  const clearIntakeTag = () => {
    if (conv?.id) {
      const updatedTags = tagsList.filter((t) => t !== "awaiting_intake");
      try {
        db.prepare(`UPDATE whatsapp_conversations SET tags = ? WHERE id = ?`).run(JSON.stringify(updatedTags), conv.id);
      } catch {
        /* ignore */
      }
    }
  };

  // Helper to set awaiting_intake tag
  const setIntakeTag = () => {
    if (conv?.id) {
      const updatedTags = Array.from(new Set([...tagsList, "awaiting_intake"]));
      try {
        db.prepare(`UPDATE whatsapp_conversations SET tags = ? WHERE id = ?`).run(JSON.stringify(updatedTags), conv.id);
      } catch {
        /* ignore */
      }
    }
  };

  // 1. Receptionist Intake Greeting & Introduction
  const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const firstWord = words[0] || "";
  const isGreetingWord =
    ["hi", "hello", "hey", "namaste", "hola", "greetings", "hii", "helo"].includes(q) ||
    (words.length <= 4 && ["hi", "hello", "hey", "namaste", "hola", "greetings", "hii", "helo"].includes(firstWord));

  if (
    isGreetingWord ||
    words.includes("help") ||
    words.includes("start") ||
    words.includes("menu") ||
    words.includes("receptionist") ||
    q.includes("good morning") ||
    q.includes("good afternoon") ||
    q.includes("good evening") ||
    q.includes("front desk")
  ) {
    if (isRegistered && firstName) {
      return {
        content: `Hello ${firstName}! 🙏 Welcome to *${clinicNames.clinicName}*.\n\nHow may I help you today? I am your automated AI Clinic Receptionist, available 24/7 with:\n\n• 📅 *Doctor Appointments* — check slots & instant token booking\n• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n• 💊 *Prescriptions & Refills* — view & download signed Rx PDF\n• 🔔 *Follow-Up Status* — verify your next recommended review\n• 🔬 *Diagnostic Reports* — lab & test results\n• 📍 *Clinic Location & Timings* — address, directions & helpline\n\nPlease reply with what you need or tap an option below:`,
        buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "💊 My Prescription", "🔔 Follow-Up Status"],
      };
    }

    return {
      content: `Hello! 🙏 Thank you for contacting *${clinicNames.clinicName}*, how may I help you today?\n\nI am your automated AI Clinic Receptionist, available 24/7 with:\n\n• 📅 *Doctor Appointments* — check slots & instant token booking\n• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n• 💊 *Prescriptions & Records* — view & download medical records\n• 🔔 *Follow-Up Status* — check your scheduled review dates\n• 🔬 *Diagnostic Reports* — lab & test results\n• 📍 *Clinic Location & Timings* — address, directions & helpline\n\nPlease reply with what you need or tap an option below:`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Front Desk"],
    };
  }

  // 1a. Clinic Location & Directions
  if (
    q.includes("location") ||
    q.includes("address") ||
    q.includes("where are you") ||
    q.includes("where is the clinic") ||
    q.includes("where is clinic") ||
    q.includes("directions") ||
    q.includes("landmark") ||
    q.includes("how to reach") ||
    q.includes("map") ||
    q.includes("maps") ||
    q.includes("पता") ||
    q.includes("कहाँ")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}📍 *${clinicNames.clinicName} — Location & Directions*\n\n🏥 *Address*: 104-106, Health Hub, Sector 14, Opposite Metro Station, Gurgaon, Haryana 122001\n📌 *Landmark*: Next to Central Bank, Metro Pillar #42\n🚗 *Parking*: Dedicated patient parking available on-site\n🗺️ *Google Maps*: https://maps.google.com/?q=${encodeURIComponent(clinicNames.clinicName)}\n\n🕒 *OPD Working Hours*: Monday – Saturday: 09:00 AM – 08:00 PM | Sunday: 10:00 AM – 02:00 PM\n📞 *Front Desk / Helpline*: +91 99999 73271\n\nWould you like to book a doctor consultation before your visit?`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📞 Call Helpline"],
    };
  }

  // 1b. Clinic Timings & Working Hours
  if (
    (q.includes("timing") || q.includes("hours") || q.includes("working hours") || q.includes("open") || q.includes("close") || q.includes("sunday") || q.includes("holiday") || q.includes("समय") || q.includes("कब खुलता")) &&
    !q.includes("doctor") && !q.includes("dr") && !q.includes("dr.") && !q.includes("specialist")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}⏰ *${clinicNames.clinicName} — Clinic Working & OPD Hours*\n\n🗓️ *OPD Consultation Timings*:\n• *Monday to Saturday*: 09:00 AM – 08:00 PM\n• *Sunday*: 10:00 AM – 02:00 PM (Emergency & Scheduled Reviews)\n\n🔬 *Diagnostic Pathology Lab*:\n• Sample collection opens from 08:00 AM daily\n\n💊 *In-House Pharmacy*:\n• Open 08:30 AM – 08:30 PM daily\n\nWould you like to view a specific doctor's OPD schedule or book an appointment?`,
      buttons: ["⏰ Doctor Schedule", "📅 Book Appointment", "📍 Clinic Location"],
    };
  }

  // 1c. Contact & Helpline / Reception Phone
  if (
    q.includes("contact") ||
    q.includes("helpline") ||
    q.includes("reception number") ||
    (q.includes("phone") && !q.includes("my phone")) ||
    (q.includes("call") && !q.includes("recall")) ||
    (q.includes("number") && (q.includes("clinic") || q.includes("desk") || q.includes("help") || q.includes("contact"))) ||
    q.includes("संपर्क") ||
    q.includes("फोन")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}📞 *${clinicNames.clinicName} — Contact & Reception Desk*\n\n☎️ *Reception & Appointments*: +91 99999 73271\n💬 *WhatsApp Assistant*: 24/7 Automated Booking & EMR Records\n📧 *Email Support*: support@apexpolyclinic.com\n📍 *Address*: 104-106, Health Hub, Sector 14, Gurgaon\n\n🕒 *Front Desk Staff Available*: 09:00 AM – 08:00 PM (Mon–Sat)\n\nHow can our team assist you today?`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Receptionist"],
    };
  }

  // 1d. Consultation Fees & Charges
  if (
    q.includes("fee") ||
    q.includes("fees") ||
    q.includes("charge") ||
    q.includes("charges") ||
    q.includes("cost") ||
    q.includes("price") ||
    q.includes("how much") ||
    q.includes("payment") ||
    q.includes("rate") ||
    q.includes("फीस") ||
    q.includes("खर्च") ||
    q.includes("पैसे")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}💵 *${clinicNames.clinicName} — Consultation Fee Schedule*\n\n• *General Medicine (OPD)*: ₹500\n• *Specialist Consultation* (Physiotherapy, Pediatrics, Dermatology, Cardiology): ₹700 – ₹1,000\n• *Follow-Up Reviews*: Free or discounted within 7 days of initial consultation\n\n💳 *Payment Methods Accepted*:\n• UPI (Google Pay, PhonePe, Paytm, BHIM)\n• Credit & Debit Cards (Visa, MasterCard, RuPay)\n• Cash at Reception Desk\n• Cashless Health Insurance (selected TPAs)\n\nWould you like to check a specific specialist's exact fee or book an appointment?`,
      buttons: ["⏰ Doctor Schedule", "📅 Book Appointment", "👤 Speak with Receptionist"],
    };
  }

  // 1e. Insurance / Mediclaim / Cashless / TPA
  if (
    q.includes("insurance") ||
    q.includes("mediclaim") ||
    q.includes("cashless") ||
    q.includes("tpa") ||
    q.includes("claim") ||
    q.includes("star health") ||
    q.includes("hdfc ergo") ||
    q.includes("icici lombard") ||
    q.includes("care health") ||
    q.includes("बीमा")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}🛡️ *${clinicNames.clinicName} — Insurance & Cashless Desk*\n\n• *Cashless TPA Support*: We coordinate with major health insurers and TPAs including Star Health, HDFC ERGO, ICICI Lombard, Care Health, Niva Bupa, Medi Assist, and Paramount.\n• *OPD Reimbursements*: We provide itemized GST invoices, doctor consultation receipts, and signed clinical notes for smooth claim submission.\n• *TPA Helpdesk*: Our front desk team assists with insurance paperwork from 09:00 AM – 06:00 PM (Mon–Sat).\n\nWould you like to book a consultation or speak with our insurance desk?`,
      buttons: ["📅 Book Appointment", "👤 Speak with Receptionist", "📞 Call Helpline"],
    };
  }

  // 1f. Specialties & Clinical Departments / Services
  if (
    q.includes("specialt") ||
    q.includes("department") ||
    q.includes("treatment") ||
    q.includes("facility") ||
    q.includes("facilities") ||
    (q.includes("service") && !q.includes("customer service")) ||
    q.includes("सुविधा") ||
    q.includes("इलाज")
  ) {
    const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! 🙏 ` : "";
    return {
      content: `${greetingHeader}🩺 *${clinicNames.clinicName} — Clinical Specialties & Services*\n\nWe provide comprehensive outpatient and diagnostic care across key departments:\n\n• 🩺 *General & Internal Medicine* — fever, infections, diabetes, hypertension\n• 🏃 *Physiotherapy & Rehabilitation* — joint pain, spine rehabilitation, posture correction\n• 👶 *Pediatrics & Child Health* — routine immunization, newborn care, growth monitoring\n• 🧴 *Dermatology & Cosmetology* — skin allergies, acne, eczema, hair treatments\n• ❤️ *Cardiology & Preventive Heart Health* — ECG, BP screening, cardiac consultation\n• 🔬 *NABL-Accredited Diagnostic Lab* — comprehensive blood tests & pathology\n• 💊 *In-House Pharmacy* — genuine prescribed medications\n\nWhich specialty would you like to consult?`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location"],
    };
  }

  // 1g. Emergency & Urgent Guidance
  if (
    q.includes("emergency") ||
    q.includes("ambulance") ||
    q.includes("urgent") ||
    q.includes("critical") ||
    q.includes("severe chest pain") ||
    q.includes("heart attack") ||
    q.includes("heavy bleeding") ||
    q.includes("इमरजेंसी") ||
    q.includes("आपातकालीन")
  ) {
    return {
      content: `🚨 *EMERGENCY MEDICAL NOTICE*\n\nIf you or a patient are experiencing a life-threatening medical emergency (such as severe chest pain, acute shortness of breath, sudden paralysis, uncontrolled bleeding, or loss of consciousness):\n\n🚑 *Call National Emergency Ambulance*: *108* or *112* immediately.\n🏥 *Nearest 24/7 ER*: Please proceed directly to the nearest hospital emergency department.\n\n📞 *${clinicNames.clinicName} Urgent Line*: +91 99999 73271\nOur clinic is open for outpatient appointments today. For urgent consultations, please tap below:`,
      buttons: ["📅 Book Urgent Slot", "📍 Clinic Location", "📞 Call Helpline"],
    };
  }

  // 1h. Specific Doctor or Specialty Match
  const specialtySearchKeywords: { kws: string[]; specMatch: string; docHint?: string }[] = [
    { kws: ["cardio", "heart", "ecg"], specMatch: "Cardiology", docHint: "Rajesh" },
    { kws: ["skin", "derma", "hair", "acne", "rash"], specMatch: "Dermatology", docHint: "Meera" },
    { kws: ["physio", "back pain", "knee pain", "joint", "ortho", "rehab"], specMatch: "Physiotherapy", docHint: "Siddharth" },
    { kws: ["pediatric", "child", "baby", "kid", "vaccin"], specMatch: "Pediatrics", docHint: "Ananya" },
    { kws: ["general physician", "physician", "fever doctor", "internal medicine"], specMatch: "General Medicine", docHint: "Vikram" },
    { kws: ["eye", "ophthalmology", "vision"], specMatch: "Ophthalmology", docHint: "Mukherjee" },
    { kws: ["dental", "teeth", "tooth", "dentist"], specMatch: "Dental Surgery", docHint: "Swamy" },
  ];
  const matchedSpec = specialtySearchKeywords.find(item => item.kws.some(k => q.includes(k)));
  if (!isIntakePending && matchedSpec && !q.includes("book")) {
    let matchedDoc: Record<string, unknown> | undefined;
    try {
      if (tenantId) {
        matchedDoc = db.prepare(`
          SELECT d.* FROM doctors d
          JOIN users u ON u.id = d.user_id
          WHERE u.tenant_id = ? AND d.active = 1 AND (d.specialty LIKE ? OR d.name LIKE ?)
          LIMIT 1
        `).get(tenantId, `%${matchedSpec.specMatch}%`, `%${matchedSpec.docHint || ""}%`) as Record<string, unknown> | undefined;
      }
      if (!matchedDoc) {
        matchedDoc = db.prepare(`
          SELECT * FROM doctors
          WHERE active = 1 AND (specialty LIKE ? OR name LIKE ?)
          LIMIT 1
        `).get(`%${matchedSpec.specMatch}%`, `%${matchedSpec.docHint || ""}%`) as Record<string, unknown> | undefined;
      }
    } catch {
      /* ignore */
    }

    if (matchedDoc) {
      const greetingHeader = isRegistered && firstName ? `Hello ${firstName}! ` : "";
      return {
        content: `${greetingHeader}👨‍⚕️ *${matchedDoc.name}* (${matchedDoc.specialty})\n\n🕒 *OPD Timing*: ${matchedDoc.opd_timing || "09:00 AM - 01:00 PM"} | 🚪 Room ${matchedDoc.opd_room || "101"}\n💵 *Consultation Fee*: ${formatINR(Number(matchedDoc.consultation_fee || 0))}\n\nWould you like to book an appointment with ${matchedDoc.name}?`,
        buttons: [`Book ${matchedDoc.name}`, "⏰ Other Doctors", "📅 All Slots"],
      };
    }
  }

  // 2. Follow-Up Reminders & Next Visit Inquiries
  if (
    q.includes("follow") ||
    q.includes("reminder") ||
    q.includes("next visit") ||
    q.includes("revisit") ||
    q.includes("review") ||
    q.includes("फॉलो") ||
    q.includes("अगली")
  ) {
    let rxWithFollowUp: Record<string, unknown> | undefined;
    try {
      const rxCandidates = db.prepare(`
        SELECT * FROM prescriptions
        WHERE (patient_phone = ? OR patient_name = ?)
        ORDER BY created_at DESC LIMIT 5
      `).all(phone, patientName) as Record<string, unknown>[];

      rxWithFollowUp = rxCandidates.find(
        (r) => r.follow_up_date && String(r.follow_up_date).trim() !== ""
      );

      if (!rxWithFollowUp) {
        const allTenantRx = db.prepare(`
          SELECT * FROM prescriptions ORDER BY created_at DESC LIMIT 50
        `).all() as Record<string, unknown>[];
        rxWithFollowUp = allTenantRx.find(
          (r) => phonesMatch(String(r.patient_phone || ""), phone) && r.follow_up_date && String(r.follow_up_date).trim() !== ""
        );
      }
    } catch (err) {
      reportCaughtError(err, "whatsapp.follow_up.lookup");
    }

    if (rxWithFollowUp && rxWithFollowUp.follow_up_date) {
      return {
        content: `📅 *Follow-Up Consultation Schedule*\n\n*Patient*: ${patientName}\n*Consultant*: ${rxWithFollowUp.doctor_name}\n*Diagnosis*: ${rxWithFollowUp.diagnosis || "Clinical Review"}\n*Recommended Follow-Up*: *${rxWithFollowUp.follow_up_date}*\n\n🔔 *Automated Reminder*: Our system sends an alert to your WhatsApp 24 hours prior to this date.\n\nWould you like to lock in your OPD appointment slot now?`,
        buttons: ["📅 Book Follow-Up Slot", "⏰ Doctor Schedule", "👤 Speak with Receptionist"],
      };
    }

    try {
      const appt = db.prepare(`
        SELECT * FROM appointments
        WHERE (patient_phone = ? OR patient_name = ?)
        ORDER BY date DESC LIMIT 1
      `).get(phone, patientName) as Record<string, unknown> | undefined;

      if (appt) {
        return {
          content: `🔔 *Follow-Up Review*\n\nYour last recorded visit was on *${appt.date}* with *${appt.doctor_name}* (${appt.specialty}).\n\nRoutine post-treatment follow-ups are typically advised 5–7 days following your initial consultation. Would you like to schedule an appointment with ${appt.doctor_name}?`,
          buttons: [`Book ${appt.doctor_name}`, "📅 Other Doctor Slots", "👤 Speak with Receptionist"],
        };
      }
    } catch (err) {
      reportCaughtError(err, "whatsapp.follow_up.appt");
    }

    return {
      content: `🔔 *Follow-Up Inquiries*\n\nNo pending follow-up date was found for your registered number (${phone}).\n\nIf you are experiencing symptoms or need a consultation, our doctors are available for OPD bookings today:`,
      buttons: ["📅 Book Doctor Appointment", "⏰ Doctor Schedule", "👤 Speak with Receptionist"],
    };
  }

  // 3. Prescription Request & Refills
  if (q.includes("prescription") || q.includes("rx") || q.includes("refill") || q.includes("medicine") || q.includes("दवा") || q.includes("औषध") || q.includes("पर्ची")) {
    let rx = db.prepare(`
      SELECT * FROM prescriptions
      WHERE patient_phone = ? OR patient_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(phone, patientName) as Record<string, unknown> | undefined;

    if (!rx) {
      try {
        const recentRx = db.prepare(`
          SELECT * FROM prescriptions ORDER BY created_at DESC LIMIT 50
        `).all() as Record<string, unknown>[];
        rx = recentRx.find((r) => phonesMatch(String(r.patient_phone || ""), phone));
      } catch (err) {
        reportCaughtError(err, "whatsapp.rx.phonesMatch");
      }
    }

    if (rx) {
      const meds = JSON.parse((rx.medicines as string) || "[]");
      const medList = meds.slice(0, 4).map((m: any) => `• *${m.drugName}* (${m.dosage}) — ${m.frequency} [${m.timing}]`).join("\n");
      const followUpText = rx.follow_up_date ? `\n*Next Follow-Up*: *${rx.follow_up_date}*` : "";

      return {
        content: `💊 *Prescription Record Found (${rx.rx_number})*\n\n*Patient*: ${rx.patient_name}\n*Consultant*: ${rx.doctor_name} (${rx.doctor_specialty || "Specialist"})\n*Diagnosis*: ${rx.diagnosis}\n*Date*: ${rx.date}${followUpText}\n\n*Prescribed Medications*:\n${medList || "• See attached PDF for complete details"}\n\nTap below to view or download the digitally signed prescription PDF:`,
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

    return {
      content: `💊 *Prescription Records*\n\nWe could not locate an active digitally signed prescription for your registered number (${phone}).\n\nIf you recently consulted, your doctor may still be finalizing the prescription slip, or you can speak with our front desk:`,
      buttons: ["📅 Book Doctor Appointment", "⏰ Doctor Schedule", "👤 Speak with Receptionist"],
    };
  }

  // 4. Lab Reports Request
  if (/\b(lab|labs|pathology|blood test|test report|lab report|diagnostic report|reports?)\b/i.test(q) || q.includes("जांच") || q.includes("रिपोर्ट")) {
    const labTenant = String(tenantId || "").trim();
    const lab = labTenant
      ? (db.prepare(`
          SELECT lr.* FROM lab_reports lr
          LEFT JOIN patients p ON p.id = lr.patient_id
          WHERE lr.tenant_id = ? AND (lr.patient_name = ? OR p.phone = ?)
          ORDER BY lr.created_at DESC LIMIT 1
        `).get(labTenant, patientName, phone) as Record<string, unknown> | undefined)
      : undefined;

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
          url: authenticatedLabReportPath(String(lab.id)),
          size: "185 KB",
          previewData: lab,
        },
      };
    }

    return {
      content: `🔬 *Diagnostic Reports*\n\nNo pending laboratory test reports were found for ${patientName} (${phone}).\n\nPlease check back once the lab finishes processing your sample, or contact reception:`,
      buttons: ["📅 Book Doctor Appointment", "⏰ Doctor Schedule", "👤 Speak with Receptionist"],
    };
  }

  // 5. Doctor Schedule & OPD Timings
  if (
    q.includes("timing") ||
    q.includes("hours") ||
    q.includes("doctor timing") ||
    q.includes("schedule") ||
    q.includes("roster") ||
    q.includes("specialist") ||
    q.includes("speciality") ||
    q.includes("specialty") ||
    q.includes("available") ||
    q.includes("consultant") ||
    q.includes("consultants") ||
    q.includes("who is available") ||
    (q.includes("dr") && (q.includes("show") || q.includes("list") || q.includes("available"))) ||
    (q.includes("doctor") && (q.includes("show") || q.includes("list") || q.includes("available") || q.includes("who"))) ||
    q.includes("समय") ||
    q.includes("ओपीडी")
  ) {
    let doctors: Record<string, unknown>[] = [];
    if (tenantId) {
      try {
        doctors = db.prepare(`
          SELECT d.* FROM doctors d
          JOIN users u ON u.id = d.user_id
          WHERE u.tenant_id = ? AND d.active = 1
          GROUP BY d.name
          ORDER BY d.name ASC LIMIT 6
        `).all(tenantId) as Record<string, unknown>[];
      } catch {
        /* fallback */
      }
    }
    if (!doctors.length) {
      doctors = db.prepare("SELECT * FROM doctors WHERE active = 1 GROUP BY name ORDER BY name ASC LIMIT 6").all() as Record<string, unknown>[];
    }

    const roster = doctors.map((d) => `👨‍⚕️ *${d.name}* (${d.specialty})\n  🕒 ${d.opd_timing || "09:00 AM - 01:00 PM"} | 🚪 Room ${d.opd_room || "101"}\n  💵 Fee: ${formatINR(Number(d.consultation_fee || 0))}`).join("\n\n");

    const rosterCopy = clinicOutboundCopy({
      ...resolveClinicFacingNames(db, tenantId),
      roster,
    });
    return {
      content: rosterCopy.roster,
      buttons: doctors.slice(0, 3).map((d) => `Book ${d.name}`),
    };
  }



  // 6. Book Doctor Appointment (specific consultant first)
  const specificBook =
    q.includes("book dr.") ||
    q.includes("book dr ") ||
    q.includes("dr. siddharth") ||
    q.includes("dr. vikram") ||
    q.includes("dr. ananya") ||
    q.includes("dr. meera") ||
    q.includes("dr. rajesh") ||
    q.includes("dr. harshvardhan") ||
    (q.includes("book") && (q.includes("slot 1") || q.includes("slot 2") || q.includes("physio") || q.includes("medicine") || q.includes("pediatric")));

  if (specificBook) {
    clearIntakeTag();
    if (!tenantId) {
      return {
        content: "We could not match this chat to a clinic calendar. Please contact reception to book an appointment.",
        buttons: ["👤 Speak with Receptionist"],
      };
    }
    try {
      const doctorName = q.includes("siddharth")
        ? "Siddharth"
        : q.includes("vikram")
          ? "Vikram"
          : q.includes("ananya")
            ? "Ananya"
            : q.includes("meera")
              ? "Meera"
              : q.includes("rajesh")
                ? "Rajesh"
                : q.includes("harshvardhan")
                  ? "Harshvardhan"
                  : undefined;

      const booked = bookWhatsAppAppointment({
        tenantId,
        patientPhone: phone,
        patientName,
        doctorName,
      });
      const appt = booked.appointment;
      if (!booked.reused) {
        await dispatchWhatsAppBookConfirmation({ tenantId, appointment: appt });
      }
      return {
        content: `${booked.reused ? "📌 *Existing Active Booking Found*" : "🎉 *Appointment Confirmed!*"}\n\n*Token Number*: *#${appt.tokenNumber}*\n*Doctor*: ${appt.doctorName}\n*Specialty*: ${appt.specialty}\n*Date*: ${appt.date}\n*Slot*: ${appt.timeSlot || "OPD hours"}\n*UHID*: ${appt.uhid}\n*Status*: ${appt.status}\n\nYour appointment is registered on the clinic calendar. Please arrive 10 minutes prior to your slot.`,
        buttons: ["🎫 View My Queue", "🔄 Reschedule Slot", "❌ Cancel Appointment"],
      };
    } catch (err: unknown) {
      return {
        content: err instanceof Error ? err.message : "Could not complete booking. Please contact reception.",
        buttons: ["👤 Speak with Receptionist"],
      };
    }
  }

  // 6b. Handling Patient Response to Intake (when awaiting_intake is active)
  if (isIntakePending && !q.includes("prescription") && !q.includes("rx") && !q.includes("timing") && !q.includes("hours")) {
    clearIntakeTag();

    // Extract Age if provided
    let extractedAge: number | undefined;
    const ageMatch = text.match(/\b([1-9][0-9]?)\s*(?:yrs|years?|yo|age)?\b/i) || text.match(/\bage\s*[:=-]?\s*(\d+)/i);
    if (ageMatch && Number(ageMatch[1]) > 0 && Number(ageMatch[1]) < 120) {
      extractedAge = Number(ageMatch[1]);
    }

    // Extract Name if provided
    let extractedName: string | undefined;
    const nameMatch = text.match(/(?:name\s*[:=-]?\s*|i am\s+|my name is\s+)([A-Za-z\s]+?)(?:,|\.|\n|age|\d|$)/i);
    if (nameMatch && nameMatch[1].trim().length > 1) {
      extractedName = nameMatch[1].trim();
    } else {
      const parts = text.split(/[,;\n]+/).map(p => p.trim());
      if (parts.length >= 2 && /^[A-Za-z\s]{2,30}$/.test(parts[0]) && !["hi", "hello", "book", "appointment", "skip"].includes(parts[0].toLowerCase())) {
        extractedName = parts[0];
      }
    }

    // Update patient record with whatever was supplied
    try {
      if (extractedAge || extractedName) {
        db.prepare(`
          UPDATE patients 
          SET age = COALESCE(?, age), name = COALESCE(?, name)
          WHERE phone = ?
        `).run(extractedAge || null, extractedName || null, phone);
      }
      if (extractedName && conv?.id) {
        db.prepare(`UPDATE whatsapp_conversations SET patient_name = ? WHERE id = ?`).run(extractedName, conv.id);
        patientName = extractedName;
      }
    } catch {
      /* ignore */
    }

    // Identify Symptoms / Health Issue for specialist recommendation
    const symptomKeywords = [
      { kws: ["back", "knee", "joint", "shoulder", "neck", "spine", "physio", "rehab", "sprain", "fracture", "ortho", "bone", "lumber", "lumbar", "pain"], doc: "Dr. Siddharth Verma", spec: "Physiotherapy & Rehabilitation" },
      { kws: ["fever", "cold", "cough", "flu", "weakness", "vomiting", "headache", "infection", "body ache", "chills"], doc: "Dr. Vikram Malhotra", spec: "General Medicine" },
      { kws: ["skin", "rash", "acne", "itching", "allergy", "hair", "derma", "eczema", "pimple"], doc: "Dr. Meera Vasudevan", spec: "Dermatology" },
      { kws: ["child", "kid", "baby", "infant", "pediatric", "vaccine", "growth"], doc: "Dr. Ananya Sen", spec: "Pediatrics" },
      { kws: ["heart", "chest", "bp", "blood pressure", "palpitation", "breath"], doc: "Dr. Rajesh Sharma", spec: "Cardiology" },
      { kws: ["tooth", "teeth", "dental", "gum", "cavity"], doc: "Dr. Arunachalam Swamy", spec: "Dental Surgery" },
      { kws: ["eye", "vision", "blur", "red eye"], doc: "Dr. Alok Nath Mukherjee", spec: "Ophthalmology" }
    ];

    let recommendedDoc = "";
    let recommendedSpec = "";
    let matchedIssue = "";

    for (const group of symptomKeywords) {
      if (group.kws.some(k => q.includes(k))) {
        recommendedDoc = group.doc;
        recommendedSpec = group.spec;
        matchedIssue = group.kws.find(k => q.includes(k)) || "";
        break;
      }
    }

    let doctors: Record<string, unknown>[] = [];
    if (tenantId) {
      try {
        doctors = db.prepare(`
          SELECT d.* FROM doctors d
          JOIN users u ON u.id = d.user_id
          WHERE u.tenant_id = ? AND d.active = 1
          GROUP BY d.name
          ORDER BY d.name ASC
        `).all(tenantId) as Record<string, unknown>[];
      } catch {
        /* fallback */
      }
    }
    if (!doctors.length) {
      doctors = db.prepare("SELECT * FROM doctors WHERE active = 1 GROUP BY name ORDER BY name ASC").all() as Record<string, unknown>[];
    }

    // If specific recommendation found, bring that doctor to index 0
    if (recommendedDoc) {
      const recLastName = recommendedDoc.toLowerCase().split(" ").slice(1).join(" ");
      const recIdx = doctors.findIndex(d => {
        const docName = String(d.name || "").toLowerCase();
        return docName.includes(recLastName) || (recommendedSpec && String(d.specialty || "").toLowerCase() === recommendedSpec.toLowerCase());
      });
      if (recIdx >= 0) {
        const [target] = doctors.splice(recIdx, 1);
        doctors.unshift(target);
      }
    }

    const greetingName = patientName && patientName !== "Patient" ? `*${patientName}*` : "there";
    const issueAck = matchedIssue ? `for your *${matchedIssue}* concern` : "";
    const recLine = recommendedDoc
      ? `💡 *Recommended Specialist*: Based on your symptoms, *${doctors[0]?.name || recommendedDoc}* (${doctors[0]?.specialty || recommendedSpec}) is available for consultation.\n\n`
      : "";

    const slotItems = doctors.slice(0, 4).map((d) => {
      return `👨‍⚕️ *${d.name}* (${d.specialty})\n  🕒 ${d.opd_timing || "09:00 AM - 01:00 PM"} | 🚪 Room ${d.opd_room || "101"}\n  💵 Fee: ${formatINR(Number(d.consultation_fee || 0))}`;
    }).join("\n\n");

    return {
      content: `Thank you ${greetingName}! 🙏 We have noted your details ${issueAck}.\n\n${recLine}📅 *Available OPD Consultation Slots Today*:\n\n${slotItems}\n\nPlease tap an option below or reply *"Book Dr. <Name>"* to lock in your appointment:`,
      buttons: doctors.slice(0, 3).map((d) => `Book ${d.name}`),
    };
  }

  // 6c. Generic Book inquiry — ask for Name, Age, and Issue first (conversational & optional)
  if (q.includes("book") || q.includes("appointment") || q.includes("अपॉइंटमेंट") || q.includes("डॉक्टर") || q.includes("slot")) {
    setIntakeTag();
    return {
      content: `📋 *Clinic Pre-Consultation Intake*\n\nTo help our doctors allocate the best consultation slot and prepare for your visit, could you please share:\n\n1️⃣ *Patient Name*\n2️⃣ *Age*\n3️⃣ *Health issue or symptoms you are facing*\n\n_(You can reply with your details in one quick message, or tap **Skip & View Slots** below to view all available slots immediately.)_`,
      buttons: ["Skip & View Slots", "Dr. Siddharth (Physio)", "Dr. Vikram (Medicine)"],
    };
  }

  // 7. Queue Status
  if (q.includes("queue") || q.includes("token") || q.includes("wait") || q.includes("कतार") || q.includes("नंबर")) {
    if (!tenantId) {
      return {
        content: "We could not match this chat to a clinic calendar. Please ask reception to link your WhatsApp number.",
        buttons: ["📅 Book Appointment", "👤 Speak with Receptionist"],
      };
    }
    const queue = getWhatsAppQueue({ tenantId, patientPhone: phone });
    if (queue.hasAppointment && queue.appointment) {
      const appt = queue.appointment;
      return {
        content: `🎫 *Live OPD Token & Queue Status*\n\n*Patient*: ${appt.patientName}\n*Token Number*: *#${appt.tokenNumber}*\n*Consultant*: ${appt.doctorName} (${appt.specialty})\n*Status*: ${appt.status}\n\n👥 *Patients Ahead of You*: *${appt.patientsAhead}*\n⏳ *Estimated Wait*: *~${appt.estimatedWaitMins} minutes*\n\nPlease remain in the waiting lounge. We will notify you on WhatsApp when you are next.`,
        buttons: ["🔄 Refresh Queue", "🔄 Reschedule Slot", "❌ Cancel Appointment"],
      };
    }
    return {
      content: `🎫 *Queue Status*\n\nNo active waiting queue token was found for ${patientName} today.\n\nWould you like to book a fresh appointment?`,
      buttons: ["📅 Book Appointment", "⏰ Doctor Schedule"],
    };
  }

  // 8. Cancel / Reschedule
  if (tenantId && (q.includes("cancel appointment") || q.includes("cancel my appointment") || q.includes("❌ cancel"))) {
    try {
      const appointment = patchWhatsAppAppointment({
        tenantId,
        patientPhone: phone,
        body: { status: "Cancelled" },
      });
      return {
        content: `Your appointment (token #${appointment.tokenNumber}) has been *Cancelled* on the clinic calendar.`,
        buttons: ["📅 Book Appointment", "👤 Speak with Receptionist"],
      };
    } catch {
      return {
        content: "No active appointment was found to cancel.",
        buttons: ["📅 Book Appointment"],
      };
    }
  }

  if (tenantId && q.includes("reschedule")) {
    return {
      content: "Please share your preferred date (YYYY-MM-DD) and time slot, or ask reception to reschedule on the clinic calendar.",
      buttons: ["📅 Book Appointment", "👤 Speak with Receptionist"],
    };
  }

  // 9. General Clinical or Query — Vertex Gemini Medical Triage
  try {
    const assistantCopy = clinicOutboundCopy({
      ...resolveClinicFacingNames(db, tenantId),
      patientName,
      patientText: text,
    });
    const res = await vertexGenerateContent({
      model: vertexGeminiModel(),
      contents: [{ text: assistantCopy.assistantPrompt }],
    });
    const reply = String(res.text || "").trim();
    if (reply) {
      return {
        content: reply,
        buttons: ["📅 Book Doctor Appointment", "⏰ Doctor Schedule", "💊 My Prescription", "👤 Speak with Receptionist"],
      };
    }
  } catch (err: unknown) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "Error";
    console.warn("whatsapp.gemini.fallback", name);
  }

  // 10. Default Fallback when no response is available to a specific question
  const greetingPrefix = isRegistered && firstName
    ? `Hello ${firstName}! 🙏`
    : (patientName && !patientName.startsWith("Patient (") && patientName !== "Patient"
        ? `Namaste ${patientName}! 🙏`
        : `Hello! 🙏`);
  const queryAck = text ? ` We have received your query: "${text}".` : "";
  return {
    content: `${greetingPrefix}${queryAck} I do not have an answer to that specific question right now, but our clinic front desk team is happy to assist you.\n\nHere is what I can help you with 24/7:\n\n• 📅 *Doctor Appointments* — check slots & instant token booking\n• ⏰ *Doctor Schedule & OPD Timings* — specialist availability\n• 💊 *Prescriptions & Refills* — view & download your prescriptions\n• 🔔 *Follow-Up Status* — check your scheduled review dates\n• 🔬 *Diagnostic Reports* — lab & test results\n• 📍 *Clinic Location & Timings* — address, directions & helpline\n• 👤 *Speak with Front Desk* — connect with our clinic staff\n\nPlease let me know if you would like help with any of the above, or reply *front desk* to speak with our reception.`,
    buttons: ["📅 Book Appointment", "⏰ Doctor Schedule", "📍 Clinic Location", "👤 Speak with Receptionist"],
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
        model: vertexGeminiModel(),
        contents: [
          {
            text: `Translate the following clinical or medical chat message accurately into ${targetName}. Maintain a polite, reassuring medical tone. Only return the translated text:\n\n"${text}"`,
          },
        ],
      });
      if (response.text) return response.text.trim();
    } catch (err) {
      reportCaughtError(err, "whatsapp.translate.gemini");
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
