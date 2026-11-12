import type { NextFunction, Request, Response } from "express";
import { isPlatformAdminRole } from "./auth.ts";
import { getDb, isDemoWorkspaceUser } from "./db.ts";
import { describeTrialAccess } from "./trial-lifecycle.ts";

export const TRIAL_NOT_STARTED_ERROR =
  "Verify your WhatsApp number to start the 7-day free trial. Nothing is charged.";
export const TRIAL_READ_ONLY_ERROR =
  "This clinic is read-only. Records stay available. Upgrade to change them. Manual WhatsApp replies inside Meta's 24-hour window are still allowed.";

function requestPath(req: Request): string {
  return `${req.originalUrl || ""} ${req.path || ""}`.split("?")[0];
}

function writeAllowedWhileRestricted(path: string, pendingVerification: boolean): boolean {
  if (
    path.includes("/auth/") ||
    path.includes("/admin/") ||
    path.includes("/billing/plan-checkout") ||
    path.includes("/billing/trial") ||
    path.includes("/billing/razorpay/webhook") ||
    path.includes("/public/") ||
    path.includes("/meta/")
  ) {
    return true;
  }
  // Day-8 manual replies stay on the WhatsApp router, which still enforces the
  // 24-hour window. A clinic that has not verified WhatsApp cannot send at all.
  return !pendingVerification && path.includes("/whatsapp");
}

/**
 * Pending clinics cannot write clinical data. A trial that has reached day 8
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
