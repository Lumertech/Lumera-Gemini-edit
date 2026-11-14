import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.ts";
import { getDb, writeAudit } from "./db.ts";
import { phoneMatchKey } from "./clinical.ts";
import { hashOtp } from "./otp-hash.ts";
import { otpEchoPayload } from "./auth.ts";
import { rejectWrongOtp, reserveOtpSend, sendOtpLimited } from "./otp-attempt.ts";
import { dispatchWhatsAppCloudMessage, isCloudDispatchFailure } from "./graph-whatsapp.ts";
import { publicPlansResponse } from "./pricing-catalog.ts";
import { razorpayKeysConfigured } from "./razorpay.ts";
import { createRazorpayPlanOrder } from "./razorpay.ts";
import {
  RAZORPAY_PLAN_ENV,
  REPEAT_TRIAL_ERROR,
  beginVerifiedWhatsAppTrial,
  describeTrialAccess,
  markPhoneOtpVerified,
  recordPlanCheckout,
  TRIAL_DAYS,
} from "./trial-lifecycle.ts";

const TRIAL_PHONE_ROLES = new Set(["doctor", "CLINIC_ADMIN", "polyclinic_admin"]);

function planSelection(body: Record<string, unknown> | undefined): { planCode: "individual" | "polyclinic"; cycle: "monthly" | "annual" } | { error: string } {
  const planCode = String(body?.planCode || body?.plan || "individual").trim().toLowerCase();
  const cycle = String(body?.cycle || "monthly").trim().toLowerCase();
  if (planCode !== "individual" && planCode !== "polyclinic") {
    return { error: "Choose the Individual or Polyclinic plan." };
  }
  if (cycle !== "monthly" && cycle !== "annual") return { error: "Choose monthly or annual billing." };
  const plans = publicPlansResponse();
  if (planCode === "polyclinic" && cycle === "monthly" && !plans.polyclinicMonthlyEnabled) {
    return { error: "Polyclinic monthly billing is not offered. Choose annual or contact ravee@lumer.me." };
  }
  return { planCode, cycle };
}

export function planChargePaise(planCode: "individual" | "polyclinic", cycle: "monthly" | "annual"): number {
  const plans = publicPlansResponse();
  const plan = plans.plans.find((row) => row.code === planCode);
  if (!plan) return 0;
  const base = cycle === "annual" ? plan.annualPaise : plan.monthlyPaise;
  return base + Math.round((base * plans.gstRateBps) / 10000);
}

export function createTrialRouter(): Router {
  const api = Router();

  api.get("/billing/trial", requireAuth, (req: Request, res: Response) => {
    const tenantId = String(req.user?.tenantId || "");
    const trial = describeTrialAccess(getDb(), tenantId);
    res.json({ trial, razorpayConfigured: razorpayKeysConfigured(), requiredEnv: razorpayKeysConfigured() ? [] : [...RAZORPAY_PLAN_ENV] });
  });

  api.post("/billing/plan-checkout", requireAuth, async (req: Request, res: Response) => {
    if (!TRIAL_PHONE_ROLES.has(String(req.user?.role || ""))) {
      return res.status(403).json({ error: "Only the clinic account can start a plan payment.", paid: false });
    }
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) return res.status(400).json({ error: "This account is not attached to a clinic." });
    const selection = planSelection(req.body as Record<string, unknown>);
    if ("error" in selection) return res.status(400).json({ error: selection.error });
    const amountPaise = planChargePaise(selection.planCode, selection.cycle);
    if (amountPaise < 100) return res.status(400).json({ error: "That plan has no price." });

    if (!razorpayKeysConfigured()) {
      return res.status(503).json({
        configured: false,
        paid: false,
        error: `Razorpay is not configured. Set ${RAZORPAY_PLAN_ENV.join(", ")}. The clinic was not charged.`,
        requiredEnv: [...RAZORPAY_PLAN_ENV],
        planCode: selection.planCode,
        cycle: selection.cycle,
        amountPaise,
        gstExclusive: true,
        contact: "ravee@lumer.me",
      });
    }

    const created = await createRazorpayPlanOrder({
      amountPaise,
      tenantId,
      planCode: selection.planCode,
      cycle: selection.cycle,
    });
    if (created.ok === false) return res.status(502).json({ error: created.error, configured: true, paid: false });
    recordPlanCheckout(getDb(), {
      orderId: created.orderId,
      tenantId,
      planCode: selection.planCode,
      cycle: selection.cycle,
      amountPaise,
    });
    writeAudit(getDb(), req.user?.id || null, "Clinic account", "Plan checkout started", `tenant=${tenantId} plan=${selection.planCode}`);
    return res.json({
      configured: true,
      paid: false,
      sandbox: created.sandbox,
      orderId: created.orderId,
      keyId: created.keyId,
      amountPaise,
      planCode: selection.planCode,
      cycle: selection.cycle,
      message: created.sandbox
        ? "SANDBOX / DEV-ONLY: Razorpay order was not sent. The subscription stays unpaid until a verified webhook."
        : "Razorpay order created. The subscription stays unpaid until the verified webhook.",
    });
  });

  api.post("/auth/trial-phone/send", requireAuth, async (req: Request, res: Response) => {
    if (!TRIAL_PHONE_ROLES.has(String(req.user?.role || ""))) {
      return res.status(403).json({ error: "Only the clinic account can verify the trial phone." });
    }
    const phone = String(req.body?.phone || req.user?.phone || "").trim();
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!phoneMatchKey(phone)) return res.status(400).json({ error: "Enter a WhatsApp mobile number." });
    const slot = reserveOtpSend(req, phone, "trial_phone", { userId: req.user?.id, email }, false);
    if (slot.limited === true) return sendOtpLimited(res, slot.retryAfterSec);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'trial_phone', ?, ?, ?)`
      )
      .run(
        verificationId,
        phone,
        email,
        hashOtp(otp),
        JSON.stringify({ userId: req.user?.id, tenantId: req.user?.tenantId, phone }),
        now,
        expiresAt
      );
    const sent = await dispatchWhatsAppCloudMessage({
      to: phone,
      kind: "otp",
      textBody: `Lumera verification code: ${otp}\nAction: trial\nValid for 5 minutes. Do not share this code.`,
      otp,
      purpose: "register",
      db: getDb(),
      tenantId: String(req.user?.tenantId || ""),
      platformSend: true,
    });
    if (isCloudDispatchFailure(sent)) {
      return res.status(503).json({ error: sent.error, otpDelivered: false });
    }
    writeAudit(getDb(), req.user?.id || null, "Clinic account", "Trial phone code sent", `tenant=${req.user?.tenantId || ""}`);
    return res.json({
      requiresOtp: true,
      verificationId,
      phone,
      ...otpEchoPayload(otp),
      message: sent.ok && sent.channel === "graph" ? "6-digit OTP sent via WhatsApp Cloud API." : "SANDBOX / DEV-ONLY: OTP recorded locally (not sent via Graph).",
    });
  });

  api.post("/auth/trial-phone/verify", requireAuth, (req: Request, res: Response) => {
    if (!TRIAL_PHONE_ROLES.has(String(req.user?.role || ""))) {
      return res.status(403).json({ error: "Only the clinic account can verify the trial phone." });
    }
    const verificationId = String(req.body?.verificationId || "").trim();
    const inputOtp = String(req.body?.otp || "").trim();
    if (!verificationId || !inputOtp) {
      return res.status(400).json({ error: "Verification ID and 6-digit OTP are required" });
    }
    const record = getDb().prepare("SELECT * FROM otp_verifications WHERE id = ?").get(verificationId) as
      | { id: string; phone: string; email: string; otp: string; purpose: string; payload: string; expires_at: string; verified_at: string | null; failed_attempts?: number }
      | undefined;
    if (!record || record.purpose !== "trial_phone") {
      return res.status(400).json({ error: "Invalid or expired verification session. Please request a new OTP." });
    }
    if (record.verified_at || new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired verification session. Please request a new OTP." });
    }
    const verdict = rejectWrongOtp(record, inputOtp, "Incorrect 6-digit verification code. Please check your WhatsApp and retry.");
    if (verdict.ok === false) return res.status(verdict.status).json({ error: verdict.error });
    let payload: { userId?: string; tenantId?: string } = {};
    try {
      payload = JSON.parse(record.payload || "{}");
    } catch {
      payload = {};
    }
    if (payload.userId && payload.userId !== req.user?.id) {
      return res.status(400).json({ error: "Invalid or expired verification session. Please request a new OTP." });
    }
    const tenantId = String(req.user?.tenantId || "");
    const now = new Date().toISOString();
    getDb().prepare("UPDATE otp_verifications SET verified_at = ? WHERE id = ?").run(now, verificationId);
    getDb().prepare("UPDATE users SET phone = ?, whatsapp_verified = 1 WHERE id = ?").run(record.phone, req.user?.id);
    markPhoneOtpVerified(getDb(), String(req.user?.id || ""), now);
    const started = beginVerifiedWhatsAppTrial(getDb(), {
      tenantId,
      email: String(req.user?.email || record.email || ""),
      phone: record.phone,
      userId: req.user?.id,
    });
    if (started.ok === false) {
      const status = started.code === "not_pending" ? 403 : 409;
      return res.status(status).json({ error: started.error, code: started.code, trialStarted: false });
    }
    return res.json({
      ok: true,
      trialStarted: true,
      trialEndsAt: started.trialEndsAt,
      message: `WhatsApp number verified. Your ${TRIAL_DAYS}-day free trial has started.`,
    });
  });

  return api;
}
