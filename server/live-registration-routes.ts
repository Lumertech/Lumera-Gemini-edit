import { Router, type NextFunction, type Request, type Response } from "express";
import { persistSpecialtyPackId } from "../src/lib/specialtyPack.ts";
import { assignedRoleForPracticeType, getDb, normalizePracticeType } from "./db.ts";
import { otpEchoPayload } from "./auth.ts";
import { liveRegistrationPasswordHash } from "./live-registration-password.ts";
import { readOauthOnboardingFromRequest } from "./oauth-onboarding.ts";
import { ensureTenantSubscription } from "./platform-tenants.ts";
import { dispatchWhatsAppCloudMessage, isCloudDispatchFailure } from "./graph-whatsapp.ts";

/**
 * Production-safe live clinic registration. Mounted in server.ts before
 * createApiRouter() so the GitHub api.ts live-registration fallbacks
 * (hashPassword of the shared demo seed at L828 / L1027) never run —
 * including inside the esbuild bundle dist/server.cjs
 * (`node dist/server.cjs` / Cloud Run). DEMO_PASSWORD seed paths are unchanged.
 */
async function dispatchRegisterOtp(phone: string, name: string, otp: string, purpose: string) {
  return dispatchWhatsAppCloudMessage({
    to: phone,
    kind: "otp",
    textBody: `Lumera verification code: ${otp}\nAction: ${purpose}\nValid for 5 minutes. Do not share this code.`,
    otp,
    purpose,
    db: getDb(),
  });
}

function otpDispatchFailure(res: Response, result: Awaited<ReturnType<typeof dispatchWhatsAppCloudMessage>>): boolean {
  if (isCloudDispatchFailure(result)) {
    res.status(503).json({ error: result.error, otpDelivered: false, channel: result.channel });
    return true;
  }
  return false;
}

async function handleRegisterPractice(req: Request, res: Response) {
  const practiceName = String(req.body?.practiceName || req.body?.clinicName || "").trim();
  const mappedSpecialty = persistSpecialtyPackId(req.body?.specialty || "General Medicine", { required: true });
  if (!mappedSpecialty.ok) {
    return res.status(400).json({ error: mappedSpecialty.error });
  }
  const specialty = mappedSpecialty.id;
  const country = String(req.body?.country || "India").trim();
  const timezone = String(req.body?.timezone || "IST (UTC+5:30)").trim();
  const phone = String(req.body?.phone || "").trim();
  let name = String(req.body?.name || "").trim();
  let email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  let avatarUrl = String(req.body?.avatarUrl || "");
  const practiceType = normalizePracticeType(req.body?.practiceType);
  const assignedRole = assignedRoleForPracticeType(practiceType);

  const oauthOnboard = readOauthOnboardingFromRequest(req);
  if (oauthOnboard.present && !oauthOnboard.ok) {
    return res.status(401).json({ error: oauthOnboard.error });
  }
  if (oauthOnboard.present && oauthOnboard.ok) {
    email = oauthOnboard.identity.email;
    name = oauthOnboard.identity.name;
    if (oauthOnboard.identity.avatarUrl) avatarUrl = oauthOnboard.identity.avatarUrl;
  }

  if (!practiceName || !phone || !name || !email) {
    return res.status(400).json({ error: "Practice Name, Director Name, Email, and WhatsApp Phone are required." });
  }

  const existing = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(400).json({
      error: "An account with this email address already exists. Please switch to Sign In or reset your password.",
    });
  }

  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
  const hfrId = `IN-HFR-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
  const hprId = `IN-HPR-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const { passwordHash, generatedPassword } = liveRegistrationPasswordHash(password);

  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at, practice_type, lifecycle_status, owner_name, owner_email, owner_phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, 500, 0, 1, ?, ?, ?, ?, 'trial', ?, ?, ?, ?)`
    )
    .run(tenantId, practiceName, specialty, country, timezone, phone, trialEndsAt, hfrId, now, now, practiceType, name, email, phone, email);

  getDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, avatar_url, whatsapp_verified, hpr_id, hfr_id, onboarding_completed, practice_type, specialty, pack_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(userId, tenantId, email, passwordHash, name, assignedRole, phone, practiceName, avatarUrl, hprId, hfrId, practiceType, specialty, specialty, now);

  const dhisId = `dhis-${crypto.randomUUID().slice(0, 8)}`;
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  getDb()
    .prepare(
      `INSERT INTO dhis_transactions (id, tenant_id, claims_count, claims_threshold, month_year, status, created_at, updated_at)
       VALUES (?, ?, 0, 100, ?, 'active', ?, ?)`
    )
    .run(dhisId, tenantId, currentMonth, now, now);

  const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
  getDb()
    .prepare(
      `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, avatar_url, bio, hpr_id, phone, email, signature_url, slot_duration_minutes, rx_template, active)
       VALUES (?, ?, ?, '', '', ?, 0, 0, '', '["Mon","Tue","Wed","Thu","Fri","Sat"]', '', ?, '', ?, ?, ?, '', 15, 'classic', 1)`
    )
    .run(docId, userId, name.startsWith("Dr.") ? name : `Dr. ${name}`, specialty, avatarUrl, hprId, phone, email);

  const subId = `sub-${crypto.randomUUID().slice(0, 8)}`;
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO subscriptions (id, user_id, status, plan_type, monthly_price, auto_renew, started_at, ends_at, notes)
       VALUES (?, ?, 'active', 'Enterprise Trial', 0, 1, ?, ?, ?)`
    )
    .run(
      subId,
      userId,
      now,
      trialEndsAt,
      JSON.stringify({
        tenantId,
        practiceName,
        specialty,
        country,
        timezone,
        hfrId,
        hprId,
        aiScribeMinutesLimit: 500,
        dhisTransactionsLimit: 100,
        trialDays: 30,
        activeStatus: true,
      })
    );
  ensureTenantSubscription(getDb(), tenantId, { planCode: "trial", status: "trial", billingSource: "sandbox" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const verificationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const otpPayload = {
    tenantId,
    userId,
    practiceName,
    clinicName: practiceName,
    specialty,
    country,
    timezone,
    phone,
    name,
    email,
    passwordHash,
    avatarUrl,
    hfrId,
    hprId,
  };
  getDb()
    .prepare(
      `INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'register', ?, ?, ?)`
    )
    .run(verificationId, phone, email, otp, JSON.stringify(otpPayload), now, expiresAt);

  const sent = await dispatchRegisterOtp(phone, name, otp, "register");
  if (otpDispatchFailure(res, sent)) return;

  return res.json({
    requiresOtp: true,
    verificationId,
    phone,
    email,
    ...otpEchoPayload(otp),
    tenantId,
    userId,
    hfrId,
    hprId,
    ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
    trialQuotas: {
      trialEndsAt,
      aiScribeMinutesLimit: 500,
      dhisClaimsLimit: 100,
    },
    otpChannel: sent.ok ? sent.channel : undefined,
    message:
      sent.ok && sent.channel === "graph"
        ? "6-digit OTP sent via WhatsApp Cloud API."
        : "SANDBOX / DEV-ONLY: OTP recorded locally (not sent via Graph).",
  });
}

/**
 * Own /auth/whatsapp/verify-otp when purpose=register so api.ts L828
 * short-circuits on a real hash instead of hashing the shared demo seed.
 * Other OTP purposes fall through to createApiRouter().
 */
function interceptRegisterVerifyOtp(req: Request, res: Response, next: NextFunction) {
  const verificationId = String(req.body?.verificationId || "").trim();
  if (!verificationId) return next();

  const record = getDb()
    .prepare("SELECT purpose, payload FROM otp_verifications WHERE id = ?")
    .get(verificationId) as { purpose?: string; payload?: string } | undefined;
  if (!record || record.purpose !== "register") return next();

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(record.payload || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const existingHash = typeof payload.passwordHash === "string" ? payload.passwordHash : "";
  const provided = typeof payload.password === "string" ? payload.password : "";
  const { passwordHash, generatedPassword } = liveRegistrationPasswordHash(provided, existingHash);
  if (passwordHash !== existingHash) {
    payload.passwordHash = passwordHash;
    getDb().prepare("UPDATE otp_verifications SET payload = ? WHERE id = ?").run(JSON.stringify(payload), verificationId);
  }

  if (generatedPassword) {
    const send = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return send({ ...(body as Record<string, unknown>), temporaryPassword: generatedPassword });
      }
      return send(body);
    }) as typeof res.json;
  }

  return next();
}

export function createLiveRegistrationRouter(): Router {
  const api = Router();
  api.post("/auth/register-practice", handleRegisterPractice);
  api.post("/auth/register-clinic", handleRegisterPractice);
  api.post("/auth/whatsapp/verify-otp", interceptRegisterVerifyOtp);
  return api;
}
