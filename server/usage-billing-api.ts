import { Router, type Request } from "express";
import { getDb, writeAudit } from "./db.ts";
import { requireAuth, requirePlatformAdmin } from "./auth.ts";
import { appPublicUrl, isProduction, sandboxSimulatorsEnabled } from "./runtime.ts";
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
  assertWalletAllowsAiScribe,
  creditWalletFromRazorpayTopup,
  ensureUsageWalletSchema,
  getMarkupPercent,
  isMetaServiceWindowBilled,
  listMarkupConfig,
  listWalletTransactions,
  markupSource,
  platformMarginReport,
  publicWalletStatus,
  recordAiScribeUsage,
  scribeQuantityMinutes,
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

  // Gate AI Scribe before server.ts's /api/gemini/generate-soap; meter only when Gemini is configured.
  api.post("/gemini/generate-soap", (req, res, next) => {
    const tenantId = tenantIdOf(req);
    if (tenantId) {
      const gate = assertWalletAllowsAiScribe(tenantId);
      if (!gate.ok) {
        return res.status(gate.status).json({
          error: gate.error,
          code: gate.code,
          wallet: gate.wallet,
        });
      }
      res.on("finish", () => {
        if (!process.env.GEMINI_API_KEY || res.statusCode >= 400) return;
        try {
          recordAiScribeUsage({
            tenantId,
            quantityMinutes: scribeQuantityMinutes({
              durationMinutes: (req.body || {}).durationMinutes,
              transcript: String((req.body || {}).transcript || ""),
            }),
            metadata: { source: "gemini-3.7-flash", endpoint: "generate-soap" },
          });
        } catch (meterErr) {
          console.error("Failed to record AI Scribe usage:", meterErr);
        }
      });
    }
    next();
  });

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
