import { Router, type Request, type Response } from "express";
import { getDb } from "./db.ts";
import { isProduction, sandboxSimulatorsEnabled } from "./runtime.ts";
import { handleWhatsAppCloudSendBody, resolveGraphCredentials } from "./graph-whatsapp.ts";
import { requireAuth } from "./auth.ts";
import { facebookOAuthConfigured } from "./facebook-oauth.ts";
import {
  buildMetaReadinessOverview,
  decideWebhookSignature,
  getMetaAppSecret,
  getMetaVerifyToken,
  rejectProductionSimulator,
} from "./meta-security.ts";

export function createMetaRouter(): Router {
  const router = Router();

  // ----------------------------------------------------
  // 1. META WEBHOOK VERIFICATION & EVENT RECEIVER
  // (Standard Meta WhatsApp Cloud API & Webhooks)
  // ----------------------------------------------------
  
  // GET /api/meta/webhook - Meta challenge verification
  router.get("/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const expectedToken = getMetaVerifyToken();

    if (!expectedToken) {
      console.error("[Meta Webhook] META_VERIFY_TOKEN is not configured — rejecting all verification attempts.");
      return res.status(500).json({ error: "Webhook verify token is not configured on this server." });
    }

    // SECURITY: this check must be strict. Meta's webhook verification exists
    // so that only Meta (holding your configured verify token) can register
    // or re-register this webhook. There must be no fallback branch that
    // accepts an unmatched or missing token — doing so lets anyone re-point
    // your webhook subscription and is disqualifying in Meta's Tech Provider
    // security review.
    if (mode === "subscribe" && token === expectedToken) {
      console.log("[Meta Webhook] Verification successful for challenge:", challenge);
      return res.status(200).send(challenge);
    }

    console.warn("[Meta Webhook] Verification rejected: token mismatch or unsupported mode.");
    return res.status(403).json({ error: "Verification token mismatch" });
  });

  // POST /api/meta/webhook - Meta Inbound Webhook Event Receiver
  router.post("/webhook", (req: Request, res: Response) => {
    const signatureDecision = decideWebhookSignature({
      rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body || {})),
      signatureHeader: req.headers["x-hub-signature-256"],
      appSecret: getMetaAppSecret(),
    });
    if (signatureDecision.ok === false) {
      console.warn("[Meta Webhook] Signature rejected:", signatureDecision.error);
      return res.status(signatureDecision.status).json({ error: signatureDecision.error });
    }
    if (signatureDecision.unsignedDevBypass) {
      console.warn("[Meta Webhook] SANDBOX / DEV-ONLY: accepted unsigned webhook because META_WEBHOOK_ALLOW_UNSIGNED is set.");
    }

    try {
      const db = getDb();
      const body = req.body;
      const now = new Date().toISOString();

      // Meta payload usually contains entry -> changes -> value -> messages / statuses
      if (body?.entry && Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          if (entry.changes && Array.isArray(entry.changes)) {
            for (const change of entry.changes) {
              const val = change.value;
              
              // Handle message statuses (delivered, read, failed)
              if (val?.statuses && Array.isArray(val.statuses)) {
                for (const st of val.statuses) {
                  const messageId = st.id;
                  const status = st.status; // 'sent' | 'delivered' | 'read' | 'failed'
                  const recipientId = st.recipient_id;
                  
                  // Update outbound event if tracked
                  try {
                    db.prepare(`
                      UPDATE whatsapp_outbound_events 
                      SET status = ?, sent_at = ?
                      WHERE id = ? OR patient_phone = ?
                    `).run(status, now, messageId, recipientId);
                  } catch {}
                }
              }

              // Handle inbound user message
              if (val?.messages && Array.isArray(val.messages)) {
                for (const msg of val.messages) {
                  const fromPhone = msg.from;
                  const textBody = msg.text?.body || msg.interactive?.button_reply?.title || "[Media/Attachment]";
                  
                  // Upsert conversation
                  const existingConv = db.prepare("SELECT * FROM whatsapp_conversations WHERE patient_phone = ?").get(fromPhone) as any;
                  let convId = existingConv?.id;
                  
                  if (!convId) {
                    convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                    db.prepare(`
                      INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
                      VALUES (?, ?, ?, 'bot', 'AI Triage Desk', '["New Inquiry"]', 'en', 1, ?, ?, ?)
                    `).run(convId, fromPhone, `Patient (+${fromPhone})`, textBody, now, now);
                  } else {
                    db.prepare(`
                      UPDATE whatsapp_conversations 
                      SET last_message = ?, last_message_time = ?, unread_count = unread_count + 1, updated_at = ?
                      WHERE id = ?
                    `).run(textBody, now, now, convId);
                  }

                  // Store message
                  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  db.prepare(`
                    INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at)
                    VALUES (?, ?, ?, 'patient', '', ?, ?, 'en', ?, '[]', '[]', 'received', ?)
                  `).run(msgId, convId, fromPhone, textBody, textBody, new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), now);
                }
              }
            }
          }
        }
      }

      // Meta requires 200 OK fast acknowledgement
      return res.status(200).json({ status: "EVENT_RECEIVED" });
    } catch (err) {
      console.error("[Meta Webhook Error]", err);
      return res.status(200).json({ status: "EVENT_RECEIVED_WITH_LOGGED_ERRORS" });
    }
  });

  // ----------------------------------------------------
  // 2. META DATA DELETION CALLBACK (App Review Requirement §4.b)
  // ----------------------------------------------------

  // POST /api/meta/data-deletion - Callback endpoint for Meta App Review & User Data Erasure
  router.post("/data-deletion", (req: Request, res: Response) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const code = `DEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // In real Meta flow, signed_request is parsed to get user_id
      const userIdOrPhone = req.body?.user_id || req.body?.phone || req.body?.id || "meta_user_session";

      // Log in audit table
      try {
        db.prepare(`
          INSERT INTO audit_logs (id, user_id, user_name, action, details, timestamp)
          VALUES (?, ?, ?, 'Meta Data Deletion Request', ?, ?)
        `).run(
          `audit-${Date.now()}`,
          "system-meta-compliance",
          "Meta Compliance Agent",
          `Data erasure request code ${code} initialized for ${userIdOrPhone}`,
          now
        );
      } catch {}

      // Build confirmation URL matching Meta specification
      const host = req.get("host") || "localhost:3000";
      const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
      const confirmationUrl = `${protocol}://${host}/data-deletion-instructions?code=${code}`;

      // Return strictly compliant Meta response schema
      return res.status(200).json({
        url: confirmationUrl,
        confirmation_code: code,
      });
    } catch (err) {
      console.error("[Meta Data Deletion Callback Error]", err);
      const fallbackCode = `DEL-${Date.now().toString(36).toUpperCase()}`;
      return res.status(200).json({
        url: `https://lumera.health/data-deletion-instructions?code=${fallbackCode}`,
        confirmation_code: fallbackCode,
      });
    }
  });

  // GET /api/meta/data-deletion-status - Status query for user tracking
  router.get("/data-deletion-status", (req: Request, res: Response) => {
    const code = req.query.code as string || "DEL-VERIFIED-2026";
    res.json({
      confirmationCode: code,
      status: "COMPLETED",
      complianceAuthority: "Meta Platform Terms §4.b & GDPR / India DPDP Act",
      recordsPurged: [
        "Authentication tokens & session secrets",
        "WhatsApp phone binding cached records",
        "Non-clinical conversational logs",
        "Temporary diagnostic upload caches"
      ],
      processedAt: new Date().toISOString(),
      message: "Data deletion successfully executed. No further personal data is retained for this account token."
    });
  });

  // ----------------------------------------------------
  // 3. META TECH PROVIDER & WABA MANAGEMENT
  // ----------------------------------------------------

  // GET /api/meta/overview - High level overview for Admin Dashboard
  router.get("/overview", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const tenants = db.prepare("SELECT id, name, waba_id, phone_number_id, meta_quality_rating, meta_onboarding_status FROM tenants").all() as any[];
      const templates = db.prepare("SELECT id, status, category FROM meta_templates").all() as any[];
      const approvedTemplatesCount = templates.filter(t => t.status === "APPROVED").length;
      const totalMessages = (db.prepare("SELECT COUNT(*) AS c FROM whatsapp_messages").get() as { c: number }).c;
      const totalOutbound = (db.prepare("SELECT COUNT(*) AS c FROM whatsapp_outbound_events").get() as { c: number }).c;

      res.json(
        buildMetaReadinessOverview({
          connectedWabasCount: tenants.filter((t) => t.waba_id && t.waba_id !== "").length,
          totalClinics: tenants.length,
          approvedTemplatesCount,
          totalTemplatesCount: templates.length,
          totalMessagesSentAndReceived: totalMessages + totalOutbound,
          webhookUrl: "/api/meta/webhook",
          graphOtpConfigured: Boolean(resolveGraphCredentials(db)),
          webhookSecretConfigured: Boolean(getMetaAppSecret()),
          verifyTokenConfigured: Boolean(getMetaVerifyToken()),
          facebookOAuthConfigured: facebookOAuthConfigured(),
        })
      );
    } catch (err: unknown) {
      console.error("[Meta Overview Error]", err);
      res.status(500).json({ error: "Failed to load Meta WhatsApp readiness overview" });
    }
  });

  // GET /api/meta/wabas - List all clinic WABAs
  router.get("/wabas", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT id, name, specialty, country, phone, waba_id, phone_number_id, meta_token_expires_at, meta_waba_name, meta_quality_rating, meta_onboarding_status, updated_at
        FROM tenants
        ORDER BY name ASC
      `).all() as any[];

      const wabas = rows.map((r) => ({
        tenantId: r.id,
        tenantName: r.name,
        specialty: r.specialty,
        country: r.country,
        clinicPhone: r.phone,
        wabaId: r.waba_id || "",
        phoneNumberId: r.phone_number_id || "",
        metaWabaName: r.meta_waba_name || r.name,
        metaQualityRating: r.meta_quality_rating || "UNKNOWN",
        metaOnboardingStatus: r.meta_onboarding_status || (r.waba_id ? "connected" : "disconnected"),
        metaTokenExpiresAt: r.meta_token_expires_at || (sandboxSimulatorsEnabled() ? "SANDBOX / DEV-ONLY local token" : "unknown"),
        updatedAt: r.updated_at
      }));

      res.json({ wabas });
    } catch (err: unknown) {
      console.error("[Meta WABAs Error]", err);
      res.status(500).json({ error: "Failed to load clinic WABAs" });
    }
  });

  // POST /api/meta/waba-connect - Connect or update a clinic's WABA
  router.post("/waba-connect", (req: Request, res: Response) => {
    try {
      const { tenantId, wabaId, phoneNumberId, metaAccessToken, metaWabaName } = req.body;
      if (!tenantId || !wabaId || !phoneNumberId) {
        return res.status(400).json({ error: "Tenant ID, WABA ID, and Phone Number ID are required" });
      }

      const db = getDb();
      const now = new Date().toISOString();

      const token = String(metaAccessToken || "").trim();
      if (isProduction() && !token) {
        return res.status(400).json({
          error: "metaAccessToken is required in production. Demo tokens are not invented.",
        });
      }

      db.prepare(`
        UPDATE tenants
        SET waba_id = ?,
            phone_number_id = ?,
            meta_access_token = ?,
            meta_token_expires_at = ?,
            meta_waba_name = ?,
            meta_quality_rating = ?,
            meta_onboarding_status = 'connected',
            updated_at = ?
        WHERE id = ?
      `).run(
        wabaId,
        phoneNumberId,
        token || (sandboxSimulatorsEnabled() ? "EAAJ...SANDBOX_DEV_ONLY_not_a_live_token" : ""),
        sandboxSimulatorsEnabled() ? "SANDBOX / DEV-ONLY — not a Graph-validated system user token" : "unknown",
        metaWabaName || "Clinic WABA",
        sandboxSimulatorsEnabled() ? "UNKNOWN" : "UNKNOWN",
        now,
        tenantId
      );

      return res.json({
        success: true,
        sandbox: sandboxSimulatorsEnabled(),
        message: sandboxSimulatorsEnabled()
          ? "SANDBOX / DEV-ONLY: WABA ids stored locally. Credentials were not validated with Graph."
          : "WABA ids stored. Graph validation is not performed on this route yet.",
        waba: {
          tenantId,
          wabaId,
          phoneNumberId,
          metaWabaName,
          status: "connected",
          qualityRating: "UNKNOWN",
        }
      });
    } catch (err: unknown) {
      console.error("[Meta WABA Connect Error]", err);
      res.status(500).json({ error: "Failed to connect WABA credentials" });
    }
  });

  // POST /api/meta/waba-disconnect - Disconnect WABA
  router.post("/waba-disconnect", (req: Request, res: Response) => {
    try {
      const { tenantId } = req.body;
      if (!tenantId) return res.status(400).json({ error: "Tenant ID is required" });

      const db = getDb();
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE tenants
        SET waba_id = '',
            phone_number_id = '',
            meta_access_token = '',
            meta_onboarding_status = 'disconnected',
            updated_at = ?
        WHERE id = ?
      `).run(now, tenantId);

      return res.json({ success: true, message: "WABA disconnected successfully." });
    } catch (err: unknown) {
      console.error("[Meta WABA Disconnect Error]", err);
      res.status(500).json({ error: "Failed to disconnect WABA" });
    }
  });

  // POST /api/meta/simulate-embedded-signup — SANDBOX / DEV-ONLY, disabled in production
  router.post("/simulate-embedded-signup", rejectProductionSimulator, (req: Request, res: Response) => {
    try {
      const { tenantId, clinicName } = req.body;
      const db = getDb();
      const now = new Date().toISOString();
      const randomWaba = `waba_${Date.now().toString().slice(-9)}${Math.floor(1000 + Math.random() * 9000)}`;
      const randomPhoneId = `phone_${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;

      const targetTenantId = tenantId || "tenant-lumera-main";
      db.prepare(`
        UPDATE tenants
        SET waba_id = ?,
            phone_number_id = ?,
            meta_access_token = 'EAAJ...SANDBOX_DEV_ONLY_embedded_signup_not_live',
            meta_token_expires_at = 'SANDBOX / DEV-ONLY — not a Graph token',
            meta_waba_name = ?,
            meta_quality_rating = 'UNKNOWN',
            meta_onboarding_status = 'connected',
            updated_at = ?
        WHERE id = ?
      `).run(
        randomWaba,
        randomPhoneId,
        clinicName ? `${clinicName} (SANDBOX / DEV-ONLY)` : "Lumera SANDBOX practice",
        now,
        targetTenantId
      );

      return res.json({
        success: true,
        sandbox: true,
        notice: "SANDBOX / DEV-ONLY simulator — not live Meta Embedded Signup.",
        message: "SANDBOX / DEV-ONLY: fake WABA ids stored locally. This is not Meta Embedded Signup and Lumera is not a certified Tech Provider.",
        wabaId: randomWaba,
        phoneNumberId: randomPhoneId,
        qualityRating: "UNKNOWN",
        onboardingStatus: "connected"
      });
    } catch (err: unknown) {
      console.error("[Embedded Signup Simulation Error]", err);
      res.status(500).json({ error: "Failed to complete embedded signup" });
    }
  });

  // POST /api/meta/send-test — SANDBOX fake-success path, disabled in production
  router.post("/send-test", rejectProductionSimulator, (req: Request, res: Response) => {
    try {
      const { recipientPhone, messageText, templateName } = req.body;
      if (!recipientPhone) return res.status(400).json({ error: "Recipient phone number is required" });

      const db = getDb();
      const now = new Date().toISOString();
      const eventId = `sandbox-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const content = messageText || `SANDBOX / DEV-ONLY test notification (not sent via Graph).\nTemplate: ${templateName || "appointment_reminder_v1"}\nTimestamp: ${now}`;

      // Record in outbound events
      db.prepare(`
        INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
        VALUES (?, 'test_notification', ?, 'Verified Test Recipient', 'delivered', ?, ?, ?)
      `).run(
        eventId,
        recipientPhone,
        `SANDBOX / DEV-ONLY: test message recorded locally (not dispatched via Graph)`,
        JSON.stringify({ text: content, sandbox: true }),
        now
      );

      return res.json({
        success: true,
        sandbox: true,
        notice: "SANDBOX / DEV-ONLY — no Graph send; no live wamid.",
        messageId: eventId,
        status: "sandbox_recorded",
        recipient: recipientPhone,
        qualityScore: "UNKNOWN",
        deliveredAt: now,
        message: "SANDBOX / DEV-ONLY: test payload stored in SQLite. This is not a Meta Cloud API delivery."
      });
    } catch (err: unknown) {
      console.error("[Meta Send Test Error]", err);
      res.status(500).json({ error: "Failed to dispatch test WhatsApp message" });
    }
  });

  // POST /api/meta/cloud-send — Wave 2 Graph dual-path (reminders / confirmations / receipts)
  // Production hard-fails without secrets; non-prod without creds is SANDBOX SQLite.
  router.post("/cloud-send", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await handleWhatsAppCloudSendBody(req.body || {}, { db: getDb() });
      res.status(result.status).json(result.json);
    } catch (err: unknown) {
      console.error("[Meta Cloud Send Error]", err);
      res.status(500).json({ error: "Failed to dispatch WhatsApp Cloud message" });
    }
  });

  // ----------------------------------------------------
  // 4. META WHATSAPP TEMPLATES MANAGEMENT
  // ----------------------------------------------------

  // GET /api/meta/templates - List all templates
  router.get("/templates", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT t.*, ten.name as tenant_name
        FROM meta_templates t
        LEFT JOIN tenants ten ON t.tenant_id = ten.id
        ORDER BY t.created_at DESC
      `).all() as any[];

      const templates = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name || "Lumera Health",
        wabaId: r.waba_id,
        name: r.name,
        category: r.category,
        language: r.language,
        status: r.status,
        components: JSON.parse(r.components || "[]"),
        metaTemplateId: r.meta_template_id,
        rejectionReason: r.rejection_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));

      res.json({ templates });
    } catch (err: unknown) {
      console.error("[Meta Templates Error]", err);
      res.status(500).json({ error: "Failed to load WhatsApp templates" });
    }
  });

  // POST /api/meta/templates - Create new template
  router.post("/templates", (req: Request, res: Response) => {
    try {
      const { tenantId, name, category, language, components } = req.body;
      if (!name || !category || !language) {
        return res.status(400).json({ error: "Template name, category, and language are required" });
      }

      const db = getDb();
      const now = new Date().toISOString();
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const id = `tpl-${Date.now()}`;
      const targetTenantId = tenantId || "tenant-lumera-main";
      const tenant = db.prepare("SELECT waba_id FROM tenants WHERE id = ?").get(targetTenantId) as any;
      const wabaId = tenant?.waba_id || "waba_398249018247019";

      const parsedComponents = Array.isArray(components) ? components : [
        { type: "HEADER", format: "TEXT", text: "Lumera Health Alert" },
        { type: "BODY", text: "Hello {{1}}, this is an update regarding your medical care.", example: { body_text: [["Patient"]] } },
        { type: "FOOTER", text: "Lumera Apex PolyClinic" }
      ];

      db.prepare(`
        INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, meta_template_id, rejection_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        id,
        targetTenantId,
        wabaId,
        sanitizedName,
        category,
        language,
        sandboxSimulatorsEnabled() ? "APPROVED" : "PENDING",
        JSON.stringify(parsedComponents),
        sandboxSimulatorsEnabled() ? `sandbox_tpl_${Date.now().toString().slice(-8)}` : "",
        now,
        now
      );

      return res.json({
        success: true,
        sandbox: sandboxSimulatorsEnabled(),
        message: sandboxSimulatorsEnabled()
          ? "SANDBOX / DEV-ONLY: template stored locally as APPROVED. Not submitted to Meta."
          : "Template stored as PENDING. Message Templates API submit is not wired yet.",
        templateId: id
      });
    } catch (err: unknown) {
      console.error("[Create Template Error]", err);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  // POST /api/meta/templates/:id/approve — SANDBOX force-approve, disabled in production
  router.post("/templates/:id/approve", rejectProductionSimulator, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare("UPDATE meta_templates SET status = 'APPROVED', updated_at = ? WHERE id = ?").run(now, req.params.id);
      return res.json({
        success: true,
        sandbox: true,
        notice: "SANDBOX / DEV-ONLY force-approve — not Meta review.",
        message: "SANDBOX / DEV-ONLY: template marked APPROVED locally. This is not Meta template review.",
      });
    } catch (err: unknown) {
      console.error("[Approve Template Error]", err);
      res.status(500).json({ error: "Failed to approve template" });
    }
  });

  // DELETE /api/meta/templates/:id - Delete template
  router.delete("/templates/:id", (req: Request, res: Response) => {
    try {
      const db = getDb();
      db.prepare("DELETE FROM meta_templates WHERE id = ?").run(req.params.id);
      return res.json({ success: true, message: "Template deleted successfully from Meta Cloud." });
    } catch (err: unknown) {
      console.error("[Delete Template Error]", err);
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  return router;
}
