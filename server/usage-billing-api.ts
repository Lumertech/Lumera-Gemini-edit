import { Router, type Request, type Response, type NextFunction } from "express";
import { getDb, writeAudit } from "./db.ts";
import { requireAuth, requirePlatformAdmin } from "./auth.ts";
import { isCloudDispatchFailure, sendPrescriptionReady } from "./graph-whatsapp.ts";
import { getTenantLetterhead } from "./letterhead.ts";
import { appPublicUrl, isProduction, sandboxSimulatorsEnabled } from "./runtime.ts";
import { WALLET_INSUFFICIENT_ERROR } from "./usage-wallet.ts";
import { resolveWhatsAppTenantId } from "./whatsapp-calendar.ts";
import { dispatchPatientCloudText, walletDispatchStatus } from "./whatsapp-patient-dispatch.ts";
import {
  createRazorpayWalletTopupOrder,
  decideRazorpayWebhookSignature,
  extractRazorpayPaidRefs,
  getRazorpayKeyId,
  getRazorpayWebhookSecret,
} from "./razorpay.ts";
import {
  GEMINI_SCRIBE_RAW_COST_INR,
  GEMINI_SCRIBE_RAW_COST_NOTE,
  META_MESSAGE_RATES,
  META_RATE_CAPTURED_ON,
  META_RATE_SOURCE,
  META_SERVICE_WINDOW_CUTOVER_ISO,
} from "./usage-rates.ts";
import {
  DEFAULT_MARKUP_PERCENT,
  applyWalletTransaction,
  creditWalletFromRazorpayTopup,
  ensureUsageWalletSchema,
  getMarkupPercent,
  isMetaServiceWindowBilled,
  listMarkupConfig,
  listWalletTransactions,
  markupSource,
  platformMarginReport,
  publicWalletStatus,
  seedDemoUsageWallet,
  upsertMarkupConfig,
  usageBreakdown,
  type UsageResource,
} from "./usage-billing.ts";

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function isPlatform(req: Request): boolean {
  const role = String(req.user?.role || "");
  return role === "super_admin" || role === "admin";
}

export function createUsageBillingRouter(): Router {
  const api = Router();
  try {
    ensureUsageWalletSchema(getDb());
    seedDemoUsageWallet(getDb());
  } catch {
    /* db may not be initialized in some unit tests */
  }

  // Intercept wallet top-ups on the shared Razorpay webhook path, then next() to invoice collect.
  api.post("/billing/razorpay/webhook", (req, res, next) => {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body || {}));
    const decision = decideRazorpayWebhookSignature({
      rawBody,
      signatureHeader: req.headers["x-razorpay-signature"],
      webhookSecret: getRazorpayWebhookSecret(),
    });
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const refs = extractRazorpayPaidRefs(req.body);
    if (!refs || refs.purpose !== "wallet_topup") {
      return next();
    }
    if (!refs.tenantId) {
      return res.status(400).json({ error: "Wallet top-up payload is missing tenant_id." });
    }
    const tenant = getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(refs.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found for wallet top-up." });
    }
    const amount = refs.amountRupees;
    if (!(amount > 0)) {
      return res.status(400).json({ error: "Wallet top-up amount is missing from the Razorpay payload." });
    }
    const tx = creditWalletFromRazorpayTopup({
      tenantId: refs.tenantId,
      amountRupees: amount,
      razorpayPaymentId: refs.paymentId || refs.orderId,
      note: `Razorpay wallet top-up ${refs.paymentId || refs.orderId}`,
    });
    writeAudit(getDb(), null, "Razorpay webhook", "Wallet top-up", `${refs.tenantId} ₹${amount} ${refs.paymentId}`);
    return res.json({ ok: true, purpose: "wallet_topup", transaction: tx, wallet: publicWalletStatus(refs.tenantId) });
  });

  // AI Scribe gate + meter-after-success lives on the real Gemini call in
  // server/gemini-clinical.ts `/api/gemini/generate-soap` via `server/gemini-scribe-meter.ts`
  // (same choke-point pattern as `meterWhatsAppUsage` in graph-whatsapp.ts).
  // Do not intercept here — a finish-hook would double-count and would meter
  // the clinical-synthesis fallback / failed Gemini calls.

  function walletBlockedJson(res: Response, sent: { error: string; channel: "none" | "graph" }) {
    return res.status(walletDispatchStatus(sent.error)).json({
      error: sent.error,
      code: sent.error === WALLET_INSUFFICIENT_ERROR ? "WALLET_INSUFFICIENT" : undefined,
      channel: sent.channel,
    });
  }

  function requestTenantId(req: Request, patientPhone?: string): string {
    return (
      resolveWhatsAppTenantId({
        tenantId: String((req.body || {}).tenantId || (req.body || {}).tenant_id || req.user?.tenantId || "").trim(),
        sessionTenantId: tenantIdOf(req),
        phoneNumberId: (req.body || {}).phoneNumberId,
        wabaId: (req.body || {}).wabaId,
        patientPhone,
      }) || tenantIdOf(req)
    );
  }

  // Staff/bot/Rx/custom outbound patient sends: meter before the WhatsApp router (same choke point as Gemini SOAP).
  api.post("/whatsapp/send", async (req: Request, res: Response, next: NextFunction) => {
    const sender = String((req.body || {}).sender || "user");
    const patientPhone = String((req.body || {}).patientPhone || "").trim();
    const tenantId = requestTenantId(req, patientPhone);
    const body = req.body || {};
    if (!body.content && !body.media && !body.buttons) return next();
    if (sender === "agent" && patientPhone) {
      const outboundText = String(body.content || "").trim() || "[media]";
      const sent = await dispatchPatientCloudText({
        tenantId: tenantId || undefined,
        to: patientPhone,
        textBody: outboundText,
      });
      if (isCloudDispatchFailure(sent)) return walletBlockedJson(res, sent);
      return next();
    }
    if (sender === "user" && patientPhone) {
      const origJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const payload = (body || {}) as { botReply?: { content?: string } | null };
        const botText = String(payload.botReply?.content || "").trim();
        if (!botText) return origJson(body);
        return dispatchPatientCloudText({
          tenantId: tenantId || undefined,
          to: patientPhone,
          textBody: botText,
        }).then((sent) => {
          if (isCloudDispatchFailure(sent)) {
            return origJson({ ...(payload as object), botReply: null, botReplyError: sent.error });
          }
          return origJson(body);
        });
      }) as Response["json"];
    }
    next();
  });

  api.post("/whatsapp/send-rx", async (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const patientPhone = String(body.patientPhone || "+91 98234 55667").trim();
    const tenantId = requestTenantId(req, patientPhone);
    const clinicName =
      String(body.clinicName || "").trim() ||
      (tenantId ? getTenantLetterhead(tenantId).clinicName : "") ||
      "Lumera Healthcare Polyclinic";
    const patientName = String(body.patientName || "Patient");
    const uhid = String(body.uhid || "LUM-2026-0001");
    const rxNumber = String(body.rxNumber || "RX-2026-0001");
    const doctorName = String(body.doctorName || "Doctor");
    const doctorSpecialty = String(body.doctorSpecialty || "General Medicine");
    const diagnosis = String(body.diagnosis || "Clinical Consultation");
    const medicines = Array.isArray(body.medicines) ? body.medicines : [];
    const medsText = medicines
      .slice(0, 3)
      .map((m: { drugName?: string; dosage?: string; frequency?: string }, i: number) => {
        return `  ${i + 1}. *${m.drugName || "Medicine"}* (${m.dosage || ""} - ${m.frequency || ""})`;
      })
      .join("\n");
    const moreMeds = medicines.length > 3 ? `\n  _...and ${medicines.length - 3} more medications_` : "";
    const pdfUrl = `/api/whatsapp/prescription/${rxNumber}/pdf`;
    const content = `🩺 *${clinicName}*\n*Official Digital Prescription*\n\nNamaste *${patientName}* (UHID: ${uhid}),\nYour consultation prescription has been finalized and signed by *${doctorName}* (${doctorSpecialty}).\n\n📋 *Diagnosis:* ${diagnosis}\n💊 *Prescribed Medications (${medicines.length}):*\n${medsText}${moreMeds}\n\n📄 *Download Official PDF Prescription:*\n${pdfUrl}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`;
    const sent = await sendPrescriptionReady({
      tenantId: tenantId || undefined,
      to: patientPhone,
      patientName,
      clinicName,
      doctorName,
      rxNumber,
      textBody: content,
      previewUrl: true,
      db: getDb(),
    });
    if (isCloudDispatchFailure(sent)) return walletBlockedJson(res, sent);
    next();
  });

  async function meterCustomOutbound(req: Request, res: Response, next: NextFunction) {
    const body = (req.body || {}) as Record<string, unknown>;
    const eventType = String(body.eventType || "");
    const reminderEvent =
      eventType === "appointment_reminder" ||
      eventType === "appointment_reminder_24h" ||
      eventType === "appointment_reminder_2h";
    // Queue-next and prescription-ready dispatch inside the WhatsApp router
    // (sendQueueNext / sendPrescriptionReady), which meters itself. Sending
    // session text here would double-deliver.
    const templateOwnedOutbound =
      eventType === "queue_token_update" ||
      eventType === "queue_next" ||
      eventType === "post_consultation_dispatch" ||
      eventType === "prescription_ready";
    if (reminderEvent || templateOwnedOutbound) return next();
    const patientPhone = String(body.patientPhone || "").trim();
    if (!eventType || !patientPhone) return next();
    const customPayload = (body.customPayload || {}) as { message?: string; tenantId?: string };
    const tenantId = requestTenantId(req, patientPhone) || String(customPayload.tenantId || "").trim();
    const messageContent = customPayload.message || "Important health notification from Lumera Polyclinic.";
    const sent = await dispatchPatientCloudText({
      tenantId: tenantId || undefined,
      to: patientPhone,
      textBody: messageContent,
    });
    if (isCloudDispatchFailure(sent)) return walletBlockedJson(res, sent);
    next();
  }
  api.post("/whatsapp/outbound/trigger", meterCustomOutbound);
  api.post("/whatsapp/outbound-trigger", meterCustomOutbound);

  api.get("/admin/usage-markup", requireAuth, requirePlatformAdmin, (_req, res) => {
    res.json(listMarkupConfig());
  });

  api.put("/admin/usage-markup", requireAuth, requirePlatformAdmin, (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const resource = String(body.resource || "") as UsageResource;
      const row = upsertMarkupConfig({
        scope: String(body.scope || "global") === "tenant" ? "tenant" : "global",
        tenantId: String(body.tenantId || body.tenant_id || ""),
        resource,
        markupPercent: Number(body.markupPercent ?? body.markup_percent),
        updatedBy: req.user?.id || req.user?.email || "super_admin",
      });
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Platform admin",
        "Usage markup updated",
        `${row.scope}/${row.tenantId || "global"} ${row.resource}=${row.markupPercent}%`
      );
      res.json({ markup: row, defaultMarkupPercent: DEFAULT_MARKUP_PERCENT });
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 400;
      res.status(status || 400).json({ error: err instanceof Error ? err.message : "Could not update markup" });
    }
  });

  api.get("/admin/usage-billing/margin", requireAuth, requirePlatformAdmin, (req, res) => {
    res.json(
      platformMarginReport({
        from: String(req.query.from || ""),
        to: String(req.query.to || ""),
      })
    );
  });

  api.get("/admin/usage-billing/rates", requireAuth, requirePlatformAdmin, (_req, res) => {
    res.json({
      capturedOn: META_RATE_CAPTURED_ON,
      source: META_RATE_SOURCE,
      cutoverIso: process.env.META_SERVICE_WINDOW_CUTOVER || META_SERVICE_WINDOW_CUTOVER_ISO,
      serviceWindowBilled: isMetaServiceWindowBilled(),
      geminiRawCost: GEMINI_SCRIBE_RAW_COST_INR,
      geminiNote: GEMINI_SCRIBE_RAW_COST_NOTE,
      defaultMarkupPercent: DEFAULT_MARKUP_PERCENT,
      rates: META_MESSAGE_RATES,
    });
  });

  api.get("/admin/usage-billing/tenants/:id", requireAuth, requirePlatformAdmin, (req, res) => {
    const tenantId = String(req.params.id || "").trim();
    const tenant = getDb().prepare("SELECT id, name FROM tenants WHERE id = ?").get(tenantId) as { id: string; name: string } | undefined;
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    res.json({
      tenant: { id: tenant.id, name: tenant.name },
      wallet: publicWalletStatus(tenantId),
      markup: {
        ai_scribe_minutes: getMarkupPercent(tenantId, "ai_scribe_minutes"),
        whatsapp_message: getMarkupPercent(tenantId, "whatsapp_message"),
        source: {
          ai_scribe_minutes: markupSource(tenantId, "ai_scribe_minutes"),
          whatsapp_message: markupSource(tenantId, "whatsapp_message"),
        },
      },
      usage: usageBreakdown({ tenantId, from, to }),
      transactions: listWalletTransactions(tenantId, Number(req.query.limit || 50)),
    });
  });

  api.post("/admin/usage-billing/tenants/:id/adjust", requireAuth, requirePlatformAdmin, (req, res) => {
    const tenantId = String(req.params.id || "").trim();
    const tenant = getDb().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const amount = Number((req.body || {}).amount);
    const note = String((req.body || {}).note || "").trim();
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: "amount must be a non-zero number (positive credit / negative debit)" });
    }
    try {
      const tx = applyWalletTransaction(tenantId, "adjustment", amount, {
        note,
        createdBy: req.user?.id || "super_admin",
      });
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Platform admin",
        "Wallet adjustment",
        `${tenantId} amount=${amount} note=${note}`
      );
      res.json({ transaction: tx, wallet: publicWalletStatus(tenantId) });
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 400;
      res.status(status || 400).json({ error: err instanceof Error ? err.message : "Adjustment failed" });
    }
  });

  api.get("/wallet", requireAuth, (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const requested = String(req.query.tenantId || req.query.tenant_id || "").trim();
    if (requested && requested !== tenantId && !isPlatform(req)) {
      return res.status(403).json({ error: "Cannot view another tenant's wallet." });
    }
    res.json({
      wallet: publicWalletStatus(tenantId),
      transactions: listWalletTransactions(tenantId, Number(req.query.limit || 50)),
    });
  });

  api.get("/wallet/status", requireAuth, (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    res.json({ wallet: publicWalletStatus(tenantId) });
  });

  api.post("/wallet/topup", requireAuth, async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const amountRupees = Number((req.body || {}).amountRupees ?? (req.body || {}).amount);
    if (!Number.isFinite(amountRupees) || amountRupees < 1) {
      return res.status(400).json({ error: "amountRupees must be at least ₹1." });
    }
    const created = await createRazorpayWalletTopupOrder({
      amountRupees,
      tenantId,
      requestedBy: { name: req.user?.name || "Clinic", phone: (req.user as { phone?: string })?.phone || "" },
      publicUrl: appPublicUrl(req.get("host") || undefined, req.protocol),
    });
    if (created.ok === false) {
      return res.status(isProduction() ? 503 : 502).json({ error: created.error, sandbox: created.sandbox });
    }
    res.json({
      purpose: "wallet_topup",
      tenantId,
      amountRupees,
      payLink: created.payLink,
      orderId: created.orderId,
      paymentLinkId: created.paymentLinkId,
      keyId: created.keyId || getRazorpayKeyId(),
      sandbox: created.sandbox,
      notice: created.sandbox
        ? "SANDBOX / DEV-ONLY wallet top-up link. Razorpay keys are unset. Credit requires a verified webhook or POST /api/wallet/sandbox-topup."
        : "Open the Razorpay pay link. Wallet credits only after a verified webhook with purpose=wallet_topup.",
    });
  });

  api.post("/wallet/sandbox-topup", requireAuth, (req, res) => {
    if (!sandboxSimulatorsEnabled()) {
      return res.status(403).json({ error: "SANDBOX / DEV-ONLY wallet mock is disabled in production.", sandbox: true });
    }
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const amountRupees = Number((req.body || {}).amountRupees ?? (req.body || {}).amount);
    if (!Number.isFinite(amountRupees) || amountRupees < 1) {
      return res.status(400).json({ error: "amountRupees must be at least ₹1." });
    }
    const tx = applyWalletTransaction(tenantId, "topup", amountRupees, {
      razorpayPaymentId: `pay_sandbox_wallet_${tenantId}_${Date.now()}`,
      createdBy: req.user?.id || "clinic",
      note: "SANDBOX / DEV-ONLY wallet top-up. Not a Razorpay settlement.",
    });
    res.json({
      sandbox: true,
      transaction: tx,
      wallet: publicWalletStatus(tenantId),
      notice: "SANDBOX / DEV-ONLY mock credit. Not a Razorpay settlement.",
    });
  });

  return api;
}
