import type { NextFunction, Request, Response } from "express";
import { isPlatformAdminRole } from "./auth.ts";
import { getDb, isDemoWorkspaceUser } from "./db.ts";
import { describeTrialAccess, TRIAL_DAYS } from "./trial-lifecycle.ts";

export const TRIAL_NOT_STARTED_ERROR =
  `Verify your WhatsApp number to start the ${TRIAL_DAYS}-day free trial. Nothing is charged.`;
export const TRIAL_READ_ONLY_ERROR =
  "This clinic is read-only. Records stay available. Upgrade to change them. Manual WhatsApp replies inside Meta's 24-hour window are still allowed.";

function requestPath(req: Request): string {
  const raw = String(req.originalUrl || req.path || "").split("?")[0];
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

const AUTH_AND_UPGRADE = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/oauth",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/whatsapp/send-otp",
  "/api/auth/whatsapp/verify-otp",
  "/api/auth/trial-phone/send",
  "/api/auth/trial-phone/verify",
  "/api/auth/register-practice",
  "/api/auth/register-clinic",
  "/api/billing/plan-checkout",
  "/api/billing/razorpay/webhook",
]);

function writeAllowedWhileRestricted(path: string, pendingVerification: boolean): boolean {
  if (AUTH_AND_UPGRADE.has(path)) return true;
  // Only the staff text reply. send-rx, outbound triggers, and number connect stay locked.
  // The WhatsApp sender still requires a manual in-window reply.
  return !pendingVerification && path === "/api/whatsapp/send";
}

/**
 * Pending clinics cannot write clinical data. A trial that has reached day 31
 * is read-only except the paths the existing lapsed-clinic rules already allow
 * (manual WhatsApp is enforced in graph-whatsapp, not here).
 */
export function trialAccessGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const path = requestPath(req);
  const user = req.user;
  if (!user?.id) return next();
  if (isPlatformAdminRole(user.role) || user.isDemoWorkspace || isDemoWorkspaceUser({ id: user.id, email: user.email, tenant_id: user.tenantId })) {
    return next();
  }
  const tenantId = String(user.tenantId || "").trim();
  if (!tenantId) return next();
  let view;
  try {
    view = describeTrialAccess(getDb(), tenantId);
  } catch {
    return next();
  }
  if (!view.readOnly) return next();
  if (writeAllowedWhileRestricted(path, view.whatsappVerificationRequired)) return next();
  if (view.whatsappVerificationRequired) {
    return res.status(403).json({
      error: TRIAL_NOT_STARTED_ERROR,
      code: "TRIAL_NOT_STARTED",
      upgradeRequired: false,
    });
  }
  return res.status(403).json({
    error: TRIAL_READ_ONLY_ERROR,
    code: "TRIAL_READ_ONLY",
    upgradeRequired: true,
  });
}
