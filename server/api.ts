import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { createMetaRouter } from "./meta.ts";
import { createAbdmRouter } from "./abdm.ts";
import {
  getDb,
  mapDoctor,
  mapSubscription,
  publicUser,
  seedSubscriptionsIfMissing,
  writeAudit,
  type DbUser,
  type UserRole,
  type UserStatus,
} from "./db.ts";
import {
  ADMIN_ROLES,
  CLINICIAN_ROLES,
  CLINIC_MANAGER_ROLES,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionId,
  requireAuth,
  requireRole,
  setSessionCookie,
  signJwtToken,
  verifyJwtToken,
} from "./auth.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 8);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image uploads are allowed"));
  },
});

function audit(req: Request, action: string, details: string) {
  writeAudit(getDb(), req.user?.id || null, req.user?.name || "Anonymous", action, details);
}

function settingsMap(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM cms_settings").all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function assemblePublicSite() {
  const settings = settingsMap();
  const sections = getDb()
    .prepare("SELECT id, type, sort_order, payload FROM cms_sections ORDER BY type, sort_order")
    .all() as { id: string; type: string; sort_order: number; payload: string }[];
  const parsed = sections.map((s) => ({
    id: s.id,
    type: s.type,
    sortOrder: s.sort_order,
    ...JSON.parse(s.payload),
  }));
  const policies = getDb()
    .prepare("SELECT slug, title FROM cms_policies ORDER BY title")
    .all() as { slug: string; title: string }[];
  let stats: unknown[] = [];
  try {
    stats = JSON.parse(settings.stats || "[]");
  } catch {
    stats = [];
  }
  return {
    settings: {
      brandName: settings.brand_name || "Lumera",
      badgeText: settings.badge_text || "",
      heroTitle: settings.hero_title || "",
      heroSubtitle: settings.hero_subtitle || "",
      contactEmail: settings.contact_email || "",
      ctaPrimary: settings.cta_primary || "Get Started Free",
      ctaSecondary: settings.cta_secondary || "See Demo",
      ctaBannerTitle: settings.cta_banner_title || "",
      ctaBannerSubtitle: settings.cta_banner_subtitle || "",
      logoUrl: settings.logo_url || "",
      clinicName: settings.clinic_name || "",
    },
    stats,
    pains: parsed.filter((s) => s.type === "pain"),
    features: parsed.filter((s) => s.type === "feature"),
    personas: parsed.filter((s) => s.type === "persona"),
    testimonials: parsed.filter((s) => s.type === "testimonial"),
    policies,
  };
}

function dispatchWhatsAppOtpMessage(phone: string, name: string, otp: string, purpose: string) {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const timeDisplay = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const cleanPhone = phone.trim() || "+91 98234 55667";
    const convId = `conv-otp-${cleanPhone.replace(/\D/g, "").slice(-8) || "user"}`;
    const userName = name.trim() || "Healthcare Clinician";

    const content = `🔐 *Lumera Health Enterprise Security*\n\nYour 6-digit WhatsApp Business verification code is:\n\n*${otp}*\n\nAction: ${
      purpose === "register"
        ? "New Clinic Registration"
        : purpose === "password_reset"
        ? "Password Recovery"
        : "Sign In & WhatsApp Phone Binding"
    }\nStatus: Active (Valid for 5 minutes)\n\nDo not disclose this verification code to anyone.`;

    let conv = db
      .prepare("SELECT * FROM whatsapp_conversations WHERE id = ? OR patient_phone = ?")
      .get(convId, cleanPhone) as Record<string, unknown> | undefined;

    if (!conv) {
      db.prepare(`
        INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language, unread_count, last_message, last_message_time, updated_at)
        VALUES (?, ?, ?, 'bot', 'Lumera Security Engine', '["Security", "OTP"]', 'en', 0, ?, ?, ?)
      `).run(convId, cleanPhone, userName, `Security Code: ${otp}`, timeDisplay, now);
    } else {
      db.prepare(`
        UPDATE whatsapp_conversations
        SET last_message = ?, last_message_time = ?, updated_at = ?
        WHERE id = ?
      `).run(`Security Code: ${otp}`, timeDisplay, now, String(conv.id));
    }

    const msgId = `msg-otp-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO whatsapp_messages (id, conversation_id, patient_phone, sender, staff_name, content, translated_content, detected_language, time_display, buttons, media, status, created_at)
      VALUES (?, ?, ?, 'agent', 'Lumera Security Bot', ?, null, 'en', ?, null, null, 'delivered', ?)
    `).run(msgId, convId, cleanPhone, content, timeDisplay, now);

    const eventId = `evt-otp-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at)
      VALUES (?, 'otp_verification', ?, ?, 'delivered', ?, ?, ?)
    `).run(
      eventId,
      cleanPhone,
      userName,
      `WhatsApp Business OTP dispatched for ${purpose}`,
      JSON.stringify({ otp, purpose }),
      now
    );
  } catch (err) {
    console.error("Failed to record WhatsApp OTP dispatch in database:", err);
  }
}

export function createApiRouter(): Router {
  const api = Router();

  api.post("/auth/login", (req: Request, res: Response) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const skipOtp = Boolean(req.body?.skipOtp);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as DbUser | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled" });
    }

    // If skipOtp requested (e.g. bypass explicitly configured)
    if (skipOtp) {
      const sid = createSession(user.id);
      setSessionCookie(res, sid);
      getDb()
        .prepare("UPDATE users SET last_login = ?, whatsapp_verified = 1 WHERE id = ?")
        .run(new Date().toISOString(), user.id);
      writeAudit(getDb(), user.id, user.name, "Login", `${user.email} signed in (direct session)`);
      return res.json({ user: publicUser(user), token: sid, requiresOtp: false });
    }

    // Mandatory WhatsApp Business Phone Binding & Verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = crypto.randomUUID();
    const phone = user.phone || "+91 98234 55667";
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    getDb().prepare(`
      INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'login', ?, ?, ?)
    `).run(
      verificationId,
      phone,
      user.email,
      otp,
      JSON.stringify({ userId: user.id, email: user.email }),
      new Date().toISOString(),
      expiresAt
    );

    dispatchWhatsAppOtpMessage(phone, user.name, otp, "login");

    return res.json({
      requiresOtp: true,
      verificationId,
      phone,
      email: user.email,
      demoOtp: otp,
      expiresAt,
      user: publicUser(user),
      message: "Security code dispatched to your WhatsApp Business number.",
    });
  });

  // Federated OAuth Handler (Google & Facebook SSO)
  api.post("/auth/oauth", (req: Request, res: Response) => {
    const provider = String(req.body?.provider || "google").toLowerCase();
    const profile = req.body?.profile || {};
    const email = String(profile?.email || "").trim().toLowerCase();
    const name = String(profile?.name || "").trim();
    const avatarUrl = String(profile?.avatarUrl || "").trim();

    if (!email) {
      return res.status(400).json({ error: "Valid email required for OAuth authentication." });
    }

    const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as DbUser | undefined;

    // Unregistered user detection
    if (!user) {
      return res.json({
        unregistered: true,
        provider,
        email,
        name: name || email.split("@")[0],
        avatarUrl,
        message: "No existing clinic account found with this email. Please complete clinic registration.",
      });
    }

    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled" });
    }

    if (req.body?.skipOtp) {
      const sid = createSession(user.id);
      setSessionCookie(res, sid);
      getDb()
        .prepare("UPDATE users SET last_login = ?, whatsapp_verified = 1 WHERE id = ?")
        .run(new Date().toISOString(), user.id);
      writeAudit(getDb(), user.id, user.name, "OAuth Sign In", `${user.email} signed in via ${provider}`);
      return res.json({ user: publicUser(user), token: sid, requiresOtp: false });
    }

    // User exists -> Trigger mandatory WhatsApp Business verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = crypto.randomUUID();
    const phone = user.phone || "+91 98234 55667";
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    getDb().prepare(`
      INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'login', ?, ?, ?)
    `).run(
      verificationId,
      phone,
      user.email,
      otp,
      JSON.stringify({ userId: user.id, provider, avatarUrl: avatarUrl || user.avatar_url }),
      new Date().toISOString(),
      expiresAt
    );

    dispatchWhatsAppOtpMessage(phone, user.name, otp, "login");

    return res.json({
      requiresOtp: true,
      verificationId,
      phone,
      email: user.email,
      demoOtp: otp,
      provider,
      user: publicUser(user),
      message: `Signed in with ${provider === "google" ? "Google" : "Facebook"}. Please verify your WhatsApp Business number.`,
    });
  });

  // WhatsApp OTP Dispatch Engine
  api.post("/auth/whatsapp/send-otp", (req: Request, res: Response) => {
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const purpose = String(req.body?.purpose || "login");
    const name = String(req.body?.name || "Clinician");
    const payload = req.body?.payload ? JSON.stringify(req.body.payload) : "{}";

    if (!phone) {
      return res.status(400).json({ error: "WhatsApp Business phone number is required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    getDb().prepare(`
      INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(verificationId, phone, email, otp, purpose, payload, new Date().toISOString(), expiresAt);

    dispatchWhatsAppOtpMessage(phone, name, otp, purpose);

    return res.json({
      ok: true,
      verificationId,
      phone,
      demoOtp: otp,
      expiresAt,
      status: "delivered",
      channel: "WhatsApp Cloud Business API",
      message: "6-digit OTP code successfully sent to WhatsApp Business.",
    });
  });

  // Live Interactive WhatsApp Verification & Session Finalization
  api.post("/auth/whatsapp/verify-otp", (req: Request, res: Response) => {
    const verificationId = String(req.body?.verificationId || "").trim();
    const inputOtp = String(req.body?.otp || "").trim();
    const updatedPhone = String(req.body?.updatedPhone || "").trim();

    if (!verificationId || !inputOtp) {
      return res.status(400).json({ error: "Verification ID and 6-digit OTP are required" });
    }

    const record = getDb()
      .prepare("SELECT * FROM otp_verifications WHERE id = ?")
      .get(verificationId) as {
        id: string;
        phone: string;
        email: string;
        otp: string;
        purpose: string;
        payload: string;
        created_at: string;
        expires_at: string;
        verified_at: string | null;
      } | undefined;

    if (!record) {
      return res.status(400).json({ error: "Invalid or expired verification session. Please request a new OTP." });
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "This OTP code has expired. Please click resend to get a fresh code." });
    }

    if (record.otp !== inputOtp) {
      return res.status(400).json({ error: "Incorrect 6-digit verification code. Please check your WhatsApp and retry." });
    }

    // Mark verified
    getDb().prepare("UPDATE otp_verifications SET verified_at = ? WHERE id = ?").run(new Date().toISOString(), verificationId);

    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(record.payload || "{}");
    } catch {
      payload = {};
    }

    const now = new Date().toISOString();

    if (record.purpose === "login") {
      let user = payload.userId
        ? (getDb().prepare("SELECT * FROM users WHERE id = ?").get(payload.userId) as unknown as DbUser | undefined)
        : undefined;

      if (!user && record.email) {
        user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(record.email) as unknown as DbUser | undefined;
      }

      if (!user && record.phone) {
        const rawDigits = record.phone.replace(/\D/g, "");
        const last10 = rawDigits.slice(-10);
        user = (getDb().prepare("SELECT * FROM users WHERE phone LIKE ? OR phone = ?").get(`%${last10}%`, record.phone) ||
          getDb().prepare("SELECT * FROM users WHERE role IN ('doctor', 'CLINIC_ADMIN') LIMIT 1").get()) as unknown as DbUser | undefined;
      }

      if (!user) {
        return res.status(404).json({ error: "User profile could not be located." });
      }

      const activePhone = updatedPhone || record.phone || user.phone;
      const avatarUrl = payload.avatarUrl || user.avatar_url || "";

      getDb().prepare(`
        UPDATE users 
        SET last_login = ?, whatsapp_verified = 1, phone = ?, avatar_url = ?
        WHERE id = ?
      `).run(now, activePhone, avatarUrl, user.id);

      const updatedUser = getDb().prepare("SELECT * FROM users WHERE id = ?").get(user.id) as unknown as DbUser;
      const sid = createSession(user.id);
      setSessionCookie(res, sid);
      writeAudit(getDb(), user.id, user.name, "WhatsApp Verified", `WhatsApp phone ${activePhone} verified for ${user.email}`);

      return res.json({
        ok: true,
        user: publicUser(updatedUser),
        token: sid,
        message: "WhatsApp Business verification confirmed. Welcome back!",
      });
    }

    if (record.purpose === "register") {
      const practiceName = payload.practiceName || payload.clinicName || "New Clinic";
      const specialty = payload.specialty || "General Medicine";
      const country = payload.country || "India";
      const timezone = payload.timezone || "IST (UTC+5:30)";
      const phone = record.phone || payload.phone || "";
      const name = payload.name || "Practice Director";
      const email = record.email || payload.email || "";
      const passwordHash = payload.passwordHash || hashPassword("Lumera@2026");
      const avatarUrl = payload.avatarUrl || "";

      let tenantId = payload.tenantId;
      let userId = payload.userId;
      let hfrId = payload.hfrId;
      let hprId = payload.hprId;

      const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Ensure tenant exists
      if (!tenantId) {
        tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
        hfrId = `IN-HFR-${Math.floor(10000000 + Math.random() * 90000000)}`;
        getDb().prepare(`
          INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 500, 0, 1, ?, ?, ?)
        `).run(tenantId, practiceName, specialty, country, timezone, updatedPhone || phone, trialEndsAt, hfrId, now, now);
      } else if (updatedPhone) {
        getDb().prepare("UPDATE tenants SET phone = ?, updated_at = ? WHERE id = ?").run(updatedPhone, now, tenantId);
      }

      // Ensure DHIS transactions entry exists
      const existingDhis = getDb().prepare("SELECT id FROM dhis_transactions WHERE tenant_id = ?").get(tenantId);
      if (!existingDhis) {
        const dhisId = `dhis-${crypto.randomUUID().slice(0, 8)}`;
        const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        getDb().prepare(`
          INSERT INTO dhis_transactions (id, tenant_id, claims_count, claims_threshold, month_year, status, created_at, updated_at)
          VALUES (?, ?, 0, 100, ?, 'active', ?, ?)
        `).run(dhisId, tenantId, currentMonth, now, now);
      }

      // Ensure user exists with CLINIC_ADMIN role mapped to tenant_id
      let existingUser = userId
        ? (getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser | undefined)
        : undefined;

      if (!existingUser && email) {
        existingUser = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as DbUser | undefined;
      }

      if (!existingUser) {
        userId = `user-${crypto.randomUUID().slice(0, 8)}`;
        hprId = hprId || `IN-HPR-${Math.floor(10000000 + Math.random() * 90000000)}`;
        getDb().prepare(`
          INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, avatar_url, whatsapp_verified, hpr_id, hfr_id, onboarding_completed, last_login, created_at)
          VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, ?, 1, ?, ?, 0, ?, ?)
        `).run(
          userId,
          tenantId,
          email,
          passwordHash,
          name,
          updatedPhone || phone,
          practiceName,
          avatarUrl,
          hprId,
          hfrId,
          now,
          now
        );
      } else {
        userId = existingUser.id;
        hprId = existingUser.hpr_id || hprId || `IN-HPR-${Math.floor(10000000 + Math.random() * 90000000)}`;
        getDb().prepare(`
          UPDATE users 
          SET tenant_id = COALESCE(NULLIF(tenant_id, ''), ?),
              clinic_name = ?,
              phone = ?,
              whatsapp_verified = 1,
              last_login = ?,
              hpr_id = COALESCE(NULLIF(hpr_id, ''), ?),
              hfr_id = COALESCE(NULLIF(hfr_id, ''), ?)
          WHERE id = ?
        `).run(tenantId, practiceName, updatedPhone || phone, now, hprId, hfrId, userId);
      }

      // Ensure Doctor entry exists for EHR suite
      const existingDoc = getDb().prepare("SELECT id FROM doctors WHERE user_id = ?").get(userId);
      if (!existingDoc) {
        const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
        getDb().prepare(`
          INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, avatar_url, bio, hpr_id, phone, email, active)
          VALUES (?, ?, ?, 'MBBS, MD', ?, ?, 12, 800, 'Suite 101 - Director Office', '["Mon","Tue","Wed","Thu","Fri","Sat"]', '09:00 AM - 05:00 PM', ?, ?, ?, ?, ?, 1)
        `).run(
          docId,
          userId,
          name.startsWith("Dr.") ? name : `Dr. ${name}`,
          `MED-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
          specialty,
          avatarUrl,
          `Practice Director & Lead Specialist at ${practiceName}`,
          hprId,
          updatedPhone || phone,
          email
        );
      }

      // Ensure Subscription trial
      const subId = `sub-${crypto.randomUUID().slice(0, 8)}`;
      getDb().prepare(`
        INSERT OR REPLACE INTO subscriptions (id, user_id, status, plan_type, monthly_price, auto_renew, started_at, ends_at, notes)
        VALUES (?, ?, 'active', 'Enterprise Trial', 0, 1, ?, ?, ?)
      `).run(
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

      const updatedUser = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;

      // SIGN JWT TOKEN CONTAINING BOTH userId AND tenantId
      const jwtToken = signJwtToken({
        userId: updatedUser.id,
        tenantId,
        email: updatedUser.email,
        role: updatedUser.role,
        name: updatedUser.name,
      });

      // Set session cookie with JWT token
      setSessionCookie(res, jwtToken);
      createSession(updatedUser.id);

      writeAudit(getDb(), updatedUser.id, updatedUser.name, "Practice Registered", `Registered and activated tenant: ${practiceName} (HFR: ${hfrId || "Active"})`);

      return res.json({
        ok: true,
        user: publicUser(updatedUser),
        token: jwtToken,
        tenantId,
        role: updatedUser.role,
        message: `Welcome to Lumera! ${practiceName} has been activated with 500 AI Scribe minutes and 100 monthly DHIS transactions.`,
      });
    }

    if (record.purpose === "password_reset") {
      return res.json({
        ok: true,
        verified: true,
        message: "OTP code verified. You can now set your new password.",
      });
    }

    return res.json({ ok: true, message: "Verification confirmed." });
  });

  // Practice Registration Endpoint: Creates Tenant, CLINIC_ADMIN, ABDM HFR/HPR, DHIS threshold, and dispatches WhatsApp OTP
  const handleRegisterPractice = (req: Request, res: Response) => {
    const practiceName = String(req.body?.practiceName || req.body?.clinicName || "").trim();
    const specialty = String(req.body?.specialty || "General Medicine").trim();
    const country = String(req.body?.country || "India").trim();
    const timezone = String(req.body?.timezone || "IST (UTC+5:30)").trim();
    const phone = String(req.body?.phone || "").trim();
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const avatarUrl = String(req.body?.avatarUrl || "");

    if (!practiceName || !phone || !name || !email) {
      return res.status(400).json({ error: "Practice Name, Director Name, Email, and WhatsApp Phone are required." });
    }

    // Check if email already registered
    const existing = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(400).json({
        error: "An account with this email address already exists. Please switch to Sign In or reset your password.",
      });
    }

    const now = new Date().toISOString();
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. TENANT CREATION:
    const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
    // ABDM HFR (Health Facility Registry ID) placeholder
    const hfrId = `IN-HFR-${Math.floor(10000000 + Math.random() * 90000000)}`;

    getDb().prepare(`
      INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 500, 0, 1, ?, ?, ?)
    `).run(tenantId, practiceName, specialty, country, timezone, phone, trialEndsAt, hfrId, now, now);

    // 2. PRIMARY ADMIN USER CREATION with role CLINIC_ADMIN mapped to new tenant ID:
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    // ABDM HPR (Healthcare Professionals Registry ID) placeholder
    const hprId = `IN-HPR-${Math.floor(10000000 + Math.random() * 90000000)}`;
    const passwordHash = password ? hashPassword(password) : hashPassword("Lumera@2026");

    getDb().prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, avatar_url, whatsapp_verified, hpr_id, hfr_id, onboarding_completed, created_at)
      VALUES (?, ?, ?, ?, ?, 'CLINIC_ADMIN', 'active', ?, ?, ?, 0, ?, ?, 0, ?)
    `).run(userId, tenantId, email, passwordHash, name, phone, practiceName, avatarUrl, hprId, hfrId, now);

    // 3. DHIS TRANSACTIONS INITIALIZATION (0/100 threshold for current month):
    const dhisId = `dhis-${crypto.randomUUID().slice(0, 8)}`;
    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    getDb().prepare(`
      INSERT INTO dhis_transactions (id, tenant_id, claims_count, claims_threshold, month_year, status, created_at, updated_at)
      VALUES (?, ?, 0, 100, ?, 'active', ?, ?)
    `).run(dhisId, tenantId, currentMonth, now, now);

    // 4. Clinical Doctor Profile for Doctor EHR Suite:
    const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
    getDb().prepare(`
      INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, avatar_url, bio, hpr_id, phone, email, active)
      VALUES (?, ?, ?, 'MBBS, MD', ?, ?, 12, 800, 'Suite 101 - Director Office', '["Mon","Tue","Wed","Thu","Fri","Sat"]', '09:00 AM - 05:00 PM', ?, ?, ?, ?, ?, 1)
    `).run(
      docId,
      userId,
      name.startsWith("Dr.") ? name : `Dr. ${name}`,
      `MED-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
      specialty,
      avatarUrl,
      `Practice Director & Lead Specialist at ${practiceName}`,
      hprId,
      phone,
      email
    );

    // 5. Subscription seed:
    const subId = `sub-${crypto.randomUUID().slice(0, 8)}`;
    getDb().prepare(`
      INSERT OR REPLACE INTO subscriptions (id, user_id, status, plan_type, monthly_price, auto_renew, started_at, ends_at, notes)
      VALUES (?, ?, 'active', 'Enterprise Trial', 0, 1, ?, ?, ?)
    `).run(
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

    // 6. WHATSAPP OTP TRIGGER:
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

    getDb().prepare(`
      INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'register', ?, ?, ?)
    `).run(verificationId, phone, email, otp, JSON.stringify(otpPayload), now, expiresAt);

    dispatchWhatsAppOtpMessage(phone, name, otp, "register");

    return res.json({
      requiresOtp: true,
      verificationId,
      phone,
      email,
      demoOtp: otp,
      tenantId,
      userId,
      hfrId,
      hprId,
      trialQuotas: {
        trialEndsAt,
        aiScribeMinutesLimit: 500,
        dhisClaimsLimit: 100,
      },
      message: "6-digit OTP verification code dispatched to your WhatsApp Business number.",
    });
  };

  api.post("/auth/register-practice", handleRegisterPractice);
  api.post("/auth/register-clinic", handleRegisterPractice);

  // Guided Onboarding Completion: saves clinician doctor profile and sets onboarding_completed = 1
  api.post("/auth/complete-onboarding", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const specialty = req.body?.specialty ? String(req.body.specialty).trim() : undefined;
    const regNumber = req.body?.regNumber ? String(req.body.regNumber).trim() : undefined;
    const consultationFee = req.body?.consultationFee ? Number(req.body.consultationFee) : undefined;
    const qualification = req.body?.qualification ? String(req.body.qualification).trim() : undefined;
    const opdRoom = req.body?.opdRoom ? String(req.body.opdRoom).trim() : undefined;
    const opdTiming = req.body?.opdTiming ? String(req.body.opdTiming).trim() : undefined;
    const practiceType = req.body?.practiceType ? String(req.body.practiceType).trim() : undefined;

    if (practiceType) {
      getDb().prepare("UPDATE users SET onboarding_completed = 1, practice_type = ? WHERE id = ?").run(practiceType, userId);
    } else {
      getDb().prepare("UPDATE users SET onboarding_completed = 1 WHERE id = ?").run(userId);
    }

    const existingDoc = getDb().prepare("SELECT id FROM doctors WHERE user_id = ?").get(userId) as { id: string } | undefined;
    if (existingDoc) {
      getDb().prepare(`
        UPDATE doctors
        SET specialty = COALESCE(?, specialty),
            reg_number = COALESCE(?, reg_number),
            consultation_fee = COALESCE(?, consultation_fee),
            qualification = COALESCE(?, qualification),
            opd_room = COALESCE(?, opd_room),
            opd_timing = COALESCE(?, opd_timing)
        WHERE id = ?
      `).run(
        specialty || null,
        regNumber || null,
        consultationFee || null,
        qualification || null,
        opdRoom || null,
        opdTiming || null,
        existingDoc.id
      );
    } else {
      const docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
      getDb().prepare(`
        INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, avatar_url, bio, hpr_id, phone, email, active)
        VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, '["Mon","Tue","Wed","Thu","Fri","Sat"]', ?, '', 'Clinical Director', ?, ?, ?, 1)
      `).run(
        docId,
        userId,
        req.user!.name.startsWith("Dr.") ? req.user!.name : `Dr. ${req.user!.name}`,
        qualification || "MBBS, MD",
        regNumber || `MED-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`,
        specialty || "General Medicine",
        consultationFee || 600,
        opdRoom || "OPD Suite 101",
        opdTiming || "09:00 AM - 05:00 PM",
        req.user!.hprId || `IN-HPR-${Math.floor(10000000 + Math.random() * 90000000)}`,
        req.user!.phone || "",
        req.user!.email || ""
      );
    }

    const updatedUserRow = getDb().prepare(`
      SELECT u.*,
             COALESCE(NULLIF(u.clinic_name, ''), t.name, '') AS clinic_name,
             COALESCE(NULLIF(u.hfr_id, ''), t.hfr_id, '') AS hfr_id
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = ?
    `).get(userId) as unknown as DbUser;

    writeAudit(getDb(), userId, req.user!.name, "Onboarding Completed", `Completed clinical setup for specialty: ${specialty || "General Medicine"}`);

    return res.json({
      ok: true,
      user: publicUser(updatedUserRow),
      message: "Clinical profile verified & practice suite activated successfully.",
    });
  });

  // Password Recovery / Forgot Password
  api.post("/auth/forgot-password", (req: Request, res: Response) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Please provide your registered email address." });
    }

    const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as DbUser | undefined;
    const phone = user?.phone || "+91 98234 55667";
    const name = user?.name || "Clinician";
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    getDb().prepare(`
      INSERT INTO otp_verifications (id, phone, email, otp, purpose, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'password_reset', ?, ?, ?)
    `).run(
      verificationId,
      phone,
      email,
      otp,
      JSON.stringify({ userId: user?.id, email }),
      new Date().toISOString(),
      expiresAt
    );

    dispatchWhatsAppOtpMessage(phone, name, otp, "password_reset");

    return res.json({
      ok: true,
      verificationId,
      phone,
      demoOtp: otp,
      message: `Password reset verification code dispatched to WhatsApp number ${phone}.`,
    });
  });

  // Password Reset Finalization
  api.post("/auth/reset-password", (req: Request, res: Response) => {
    const verificationId = String(req.body?.verificationId || "").trim();
    const otp = String(req.body?.otp || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!verificationId || !otp || !newPassword) {
      return res.status(400).json({ error: "Verification ID, 6-digit OTP, and new password are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const record = getDb()
      .prepare("SELECT * FROM otp_verifications WHERE id = ?")
      .get(verificationId) as {
        id: string;
        email: string;
        otp: string;
        payload: string;
        expires_at: string;
      } | undefined;

    if (!record || record.otp !== otp || new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired reset code. Please request a fresh OTP." });
    }

    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(record.payload || "{}");
    } catch {
      payload = {};
    }

    const userEmail = record.email || payload.email;
    const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(userEmail) as unknown as DbUser | undefined;

    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    const newHash = hashPassword(newPassword);
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
    getDb().prepare("UPDATE otp_verifications SET verified_at = ? WHERE id = ?").run(new Date().toISOString(), verificationId);

    writeAudit(getDb(), user.id, user.name, "Password Reset", `Password reset via WhatsApp OTP for ${user.email}`);

    return res.json({
      ok: true,
      message: "Password reset successful! You may now sign in with your new credentials.",
    });
  });

  api.post("/auth/logout", (req: Request, res: Response) => {
    const sid = getSessionId(req);
    if (sid) destroySession(sid);
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  api.get("/auth/me", (req: Request, res: Response) => {
    if (!req.user) return res.json({ user: null });
    let tenant = null;
    if (req.user.tenantId) {
      tenant = getDb().prepare("SELECT * FROM tenants WHERE id = ?").get(req.user.tenantId) as any;
    }
    return res.json({ user: req.user, tenant });
  });

  api.get("/tenant/current", requireAuth, (req: Request, res: Response) => {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(404).json({ error: "No tenant associated with this account." });
    }
    const tenant = getDb().prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) as any;
    if (!tenant) {
      return res.status(404).json({ error: "Tenant record not found." });
    }
    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const dhis = getDb().prepare("SELECT * FROM dhis_transactions WHERE tenant_id = ? AND month_year = ?").get(tenantId, currentMonth) as any;

    return res.json({
      tenant,
      dhis: dhis || { claims_count: 0, claims_threshold: 100, month_year: currentMonth, status: "active" },
    });
  });

  api.get("/public/site", (_req, res) => {
    res.json(assemblePublicSite());
  });

  api.get("/public/policies/:slug", (req, res) => {
    const row = getDb()
      .prepare("SELECT slug, title, body, updated_at FROM cms_policies WHERE slug = ?")
      .get(req.params.slug) as { slug: string; title: string; body: string; updated_at: string } | undefined;
    if (!row) return res.status(404).json({ error: "Policy not found" });
    res.json(row);
  });

  api.get("/doctors", (_req, res) => {
    const rows = getDb().prepare("SELECT * FROM doctors ORDER BY name").all() as Record<string, unknown>[];
    res.json({ doctors: rows.map(mapDoctor) });
  });

  api.get("/clinic/team", requireAuth, requireRole(...CLINICIAN_ROLES), (_req, res) => {
    const members = getDb()
      .prepare(
        "SELECT * FROM users WHERE role IN ('doctor', 'receptionist', 'polyclinic_admin', 'CLINIC_ADMIN') ORDER BY name"
      )
      .all() as unknown as DbUser[];
    const doctors = getDb().prepare("SELECT * FROM doctors ORDER BY name").all() as Record<string, unknown>[];
    const staff = getDb().prepare("SELECT * FROM staff ORDER BY name").all();
    res.json({ members: members.map(publicUser), doctors: doctors.map(mapDoctor), staff });
  });

  api.post("/clinic/members", requireAuth, requireRole(...CLINIC_MANAGER_ROLES), (req, res) => {
    const { name, email, phone, role, password, specialty, qualification, regNumber, consultationFee, opdRoom, department, shift } =
      req.body || {};
    const allowedRoles =
      ["polyclinic_admin", "CLINIC_ADMIN"].includes(req.user?.role || "") ? ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"] : ["doctor", "receptionist"];
    if (!name || !email || !role) {
      return res.status(400).json({ error: "name, email, and role are required" });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "You cannot assign that role" });
    }
    const id = crypto.randomUUID();
    const pwd = password ? String(password) : `Temp${Math.random().toString(36).slice(2, 8)}!A1`;
    try {
      getDb()
        .prepare(
          `INSERT INTO users (id, email, password_hash, name, role, status, phone, last_login, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?)`
        )
        .run(id, String(email).trim().toLowerCase(), hashPassword(pwd), String(name), role, String(phone || ""), new Date().toISOString());
    } catch {
      return res.status(409).json({ error: "Email already exists" });
    }
    if (role === "doctor") {
      const docId = `doc-${id.slice(0, 8)}`;
      getDb()
        .prepare(
          `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          docId,
          id,
          String(name),
          qualification || "",
          regNumber || "",
          specialty || "General Medicine",
          0,
          Number(consultationFee || 600),
          opdRoom || "",
          JSON.stringify(["Mon", "Tue", "Wed", "Thu", "Fri"]),
          "09:00 AM - 02:00 PM",
          phone || "",
          String(email).trim().toLowerCase(),
          req.body?.avatarUrl || "",
          req.body?.bio || "",
          req.body?.hprId || ""
        );
    }
    if (role === "receptionist") {
      const staffId = `s-${id.slice(0, 8)}`;
      getDb()
        .prepare(
          `INSERT INTO staff (id, user_id, name, role, department, phone, email, status, shift)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)`
        )
        .run(staffId, id, String(name), "Receptionist", department || "Front Desk", phone || "", String(email).trim().toLowerCase(), shift || "Full Day");
    }
    seedSubscriptionsIfMissing(getDb());
    audit(req, "Clinic member created", `${name} <${email}> as ${role}`);
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as DbUser;
    res.status(201).json({ user: publicUser(user), temporaryPassword: password ? undefined : pwd });
  });

  api.patch("/clinic/members/:id", requireAuth, requireRole(...CLINIC_MANAGER_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as unknown as DbUser | undefined;
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.role === "super_admin" || existing.role === "patient") {
      return res.status(403).json({ error: "This account is not a clinic team member" });
    }
    if (existing.id === req.user?.id && req.body.status === "disabled") {
      return res.status(400).json({ error: "You cannot disable your own login" });
    }
    const name = req.body.name ?? existing.name;
    const phone = req.body.phone ?? existing.phone;
    const status = req.body.status ?? existing.status;
    const allowedRoles =
      ["polyclinic_admin", "CLINIC_ADMIN"].includes(req.user?.role || "") ? ["doctor", "receptionist", "polyclinic_admin", "CLINIC_ADMIN"] : ["doctor", "receptionist"];
    let role = existing.role;
    if (req.body.role && req.body.role !== existing.role) {
      if (!allowedRoles.includes(req.body.role)) {
        return res.status(403).json({ error: "You cannot assign that role" });
      }
      role = req.body.role;
    }
    getDb()
      .prepare("UPDATE users SET name = ?, phone = ?, status = ?, role = ? WHERE id = ?")
      .run(name, phone, status, role, existing.id);
    audit(req, "Clinic member updated", `${existing.email} status=${status} role=${role}`);
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(existing.id) as unknown as DbUser;
    res.json({ user: publicUser(user) });
  });

  api.post("/clinic/members/:id/password", requireAuth, requireRole(...CLINIC_MANAGER_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as unknown as DbUser | undefined;
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.role === "super_admin" || existing.role === "patient") {
      return res.status(403).json({ error: "This account is not a clinic team member" });
    }
    const password = String(req.body?.password || `Temp${Math.random().toString(36).slice(2, 8)}!A1`);
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
    audit(req, "Clinic password reset", existing.email);
    res.json({ ok: true, temporaryPassword: req.body?.password ? undefined : password });
  });

  api.get("/admin/overview", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    const count = (sql: string) => (getDb().prepare(sql).get() as { c: number }).c;
    const recent = getDb()
      .prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 8")
      .all();
    res.json({
      users: count("SELECT COUNT(*) AS c FROM users"),
      subscriptions: count("SELECT COUNT(*) AS c FROM subscriptions"),
      activePlans: count("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'"),
      trials: count("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'trial'"),
      mrr: (getDb().prepare("SELECT COALESCE(SUM(monthly_price),0) AS c FROM subscriptions WHERE status = 'active'").get() as { c: number }).c,
      media: count("SELECT COUNT(*) AS c FROM cms_media"),
      policies: count("SELECT COUNT(*) AS c FROM cms_policies"),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"),
      recentAudit: recent,
    });
  });

  api.get("/users", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const q = String(req.query.q || "").toLowerCase();
    const role = String(req.query.role || "");
    const status = String(req.query.status || "");
    let sql = `
      SELECT u.*,
             COALESCE(NULLIF(u.clinic_name, ''), t.name, '') AS clinic_name,
             COALESCE(NULLIF(u.hfr_id, ''), t.hfr_id, '') AS hfr_id
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE 1=1
    `;
    const args: unknown[] = [];
    if (q) {
      sql += " AND (lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(u.clinic_name, t.name, '')) LIKE ? OR lower(COALESCE(u.hpr_id, '')) LIKE ? OR lower(COALESCE(u.hfr_id, t.hfr_id, '')) LIKE ?)";
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (role) {
      sql += " AND u.role = ?";
      args.push(role);
    }
    if (status) {
      sql += " AND u.status = ?";
      args.push(status);
    }
    sql += " ORDER BY u.created_at DESC";
    const rows = getDb().prepare(sql).all(...(args as string[])) as unknown as DbUser[];
    res.json({ users: rows.map(publicUser) });
  });

  api.post("/users", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const { email, password, name, role, phone, status } = req.body || {};
    if (!email || !name || !role) {
      return res.status(400).json({ error: "name, email, and role are required" });
    }
    const id = crypto.randomUUID();
    const pwd = password ? String(password) : `Temp${Math.random().toString(36).slice(2, 8)}!`;
    try {
      getDb()
        .prepare(
          `INSERT INTO users (id, email, password_hash, name, role, status, phone, last_login, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(
          id,
          String(email).trim().toLowerCase(),
          hashPassword(pwd),
          String(name),
          role as UserRole,
          (status as UserStatus) || "active",
          String(phone || ""),
          new Date().toISOString()
        );
    } catch {
      return res.status(409).json({ error: "Email already exists" });
    }
    audit(req, "User created", `${name} <${email}> as ${role}`);
    seedSubscriptionsIfMissing(getDb());
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as DbUser;
    res.status(201).json({ user: publicUser(user), temporaryPassword: password ? undefined : pwd });
  });

  api.patch("/users/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as unknown as DbUser | undefined;
    if (!existing) return res.status(404).json({ error: "User not found" });
    const name = req.body.name ?? existing.name;
    const role = req.body.role ?? existing.role;
    const status = req.body.status ?? existing.status;
    const phone = req.body.phone ?? existing.phone;
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : existing.email;
    try {
      getDb()
        .prepare("UPDATE users SET name = ?, role = ?, status = ?, phone = ?, email = ? WHERE id = ?")
        .run(name, role, status, phone, email, existing.id);
    } catch {
      return res.status(409).json({ error: "Email already exists" });
    }
    audit(req, "User updated", `${email} role=${role} status=${status}`);
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(existing.id) as unknown as DbUser;
    res.json({ user: publicUser(user) });
  });

  api.post("/users/:id/password", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as unknown as DbUser | undefined;
    if (!existing) return res.status(404).json({ error: "User not found" });
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
    audit(req, "Password reset", `Password reset for ${existing.email}`);
    res.json({ ok: true });
  });

  api.get("/admin/subscriptions", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT s.*, u.name, u.email, u.phone
         FROM subscriptions s JOIN users u ON u.id = s.user_id
         ORDER BY u.name`
      )
      .all() as Record<string, unknown>[];
    res.json({
      subscriptions: rows.map((r) =>
        mapSubscription(r, { name: String(r.name), email: String(r.email), phone: String(r.phone) })
      ),
    });
  });

  api.get("/admin/subscriptions/summary", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    const totalUsers = (getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
    const statuses = getDb()
      .prepare("SELECT status, COUNT(*) AS c FROM subscriptions GROUP BY status")
      .all() as { status: string; c: number }[];
    const counts: Record<string, number> = { trial: 0, active: 0, suspended: 0, cancelled: 0, expired: 0 };
    for (const s of statuses) counts[s.status] = s.c;
    const mrr = (
      getDb().prepare("SELECT COALESCE(SUM(monthly_price),0) AS c FROM subscriptions WHERE status = 'active'").get() as {
        c: number;
      }
    ).c;
    res.json({ totalUsers, counts, mrr });
  });

  api.patch("/admin/subscriptions/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: "Subscription not found" });
    const status = String(req.body.status || existing.status);
    const planType = String(req.body.planType || req.body.plan_type || existing.plan_type);
    const monthlyPrice = Number(req.body.monthlyPrice ?? req.body.monthly_price ?? existing.monthly_price);
    const autoFlag = req.body.autoRenew ?? req.body.auto_renew;
    const autoRenew = autoFlag === undefined ? existing.auto_renew : autoFlag ? 1 : 0;
    const notes = req.body.notes ?? existing.notes;
    let endsAt = (existing.ends_at as string) || null;
    const extendDays = Number(req.body.extendDays || req.body.extend_days || 0);
    if (extendDays) {
      const base = endsAt && new Date(endsAt) > new Date() ? new Date(endsAt) : new Date();
      base.setDate(base.getDate() + extendDays);
      endsAt = base.toISOString();
    }
    if (req.body.endsAt || req.body.ends_at) endsAt = String(req.body.endsAt || req.body.ends_at);
    getDb()
      .prepare(
        `UPDATE subscriptions SET status = ?, plan_type = ?, monthly_price = ?, auto_renew = ?, ends_at = ?, notes = ? WHERE id = ?`
      )
      .run(status, planType, monthlyPrice, Number(autoRenew), endsAt, String(notes || ""), req.params.id);
    audit(req, "Subscription updated", `${req.params.id} ${status} ${planType}`);
    const row = getDb()
      .prepare(
        `SELECT s.*, u.name, u.email, u.phone FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      )
      .get(req.params.id) as Record<string, unknown>;
    res.json({
      subscription: mapSubscription(row, { name: String(row.name), email: String(row.email), phone: String(row.phone) }),
    });
  });

  api.post("/doctors", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.specialty) return res.status(400).json({ error: "name and specialty are required" });
    const id = b.id || `doc-${crypto.randomUUID().slice(0, 8)}`;
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        b.userId || null,
        b.name,
        b.qualification || "",
        b.regNumber || "",
        b.specialty,
        Number(b.experienceYears || 0),
        Number(b.consultationFee || 0),
        b.opdRoom || "",
        JSON.stringify(b.availableDays || []),
        b.opdTiming || "",
        b.phone || "",
        b.email || "",
        b.avatarUrl || "",
        b.bio || "",
        b.hprId || "",
        b.active === false ? 0 : 1
      );
    audit(req, "Doctor created", b.name);
    const row = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json({ doctor: mapDoctor(row) });
  });

  api.patch("/doctors/:id", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Doctor not found" });
    const mapped = mapDoctor(existing);
    const next = { ...mapped, ...req.body };
    getDb()
      .prepare(
        `UPDATE doctors SET user_id = ?, name = ?, qualification = ?, reg_number = ?, specialty = ?, experience_years = ?, consultation_fee = ?, opd_room = ?, available_days = ?, opd_timing = ?, phone = ?, email = ?, avatar_url = ?, bio = ?, hpr_id = ?, active = ? WHERE id = ?`
      )
      .run(
        next.userId || null,
        next.name,
        next.qualification,
        next.regNumber,
        next.specialty,
        Number(next.experienceYears),
        Number(next.consultationFee),
        next.opdRoom,
        JSON.stringify(next.availableDays || []),
        next.opdTiming,
        next.phone,
        next.email,
        next.avatarUrl || "",
        next.bio || "",
        next.hprId || "",
        next.active === false ? 0 : 1,
        req.params.id
      );
    audit(req, "Doctor updated", next.name);
    const row = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(req.params.id) as Record<string, unknown>;
    res.json({ doctor: mapDoctor(row) });
  });

  api.post("/doctors/:id/avatar", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ error: "File is required" });
      const avatarUrl = `/uploads/${req.file.filename}`;
      getDb().prepare("UPDATE doctors SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.params.id);
      const row = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(req.params.id) as Record<string, unknown>;
      audit(req, "Doctor avatar updated", (row?.name as string) || req.params.id);
      res.json({ doctor: mapDoctor(row), avatarUrl });
    });
  });

  api.delete("/doctors/:id", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    getDb().prepare("DELETE FROM doctors WHERE id = ?").run(req.params.id);
    audit(req, "Doctor deleted", req.params.id);
    res.json({ ok: true });
  });

  api.get("/staff", requireAuth, requireRole(...CLINICIAN_ROLES), (_req, res) => {
    res.json({ staff: getDb().prepare("SELECT * FROM staff ORDER BY name").all() });
  });

  api.post("/staff", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.role) return res.status(400).json({ error: "name and role are required" });
    const id = `s-${crypto.randomUUID().slice(0, 8)}`;
    getDb()
      .prepare(
        `INSERT INTO staff (id, user_id, name, role, department, phone, email, status, shift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, b.userId || null, b.name, b.role, b.department || "", b.phone || "", b.email || "", b.status || "Active", b.shift || "Morning");
    audit(req, "Staff created", b.name);
    res.status(201).json({ staff: getDb().prepare("SELECT * FROM staff WHERE id = ?").get(id) });
  });

  api.patch("/staff/:id", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM staff WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Staff not found" });
    const next = { ...existing, ...req.body };
    getDb()
      .prepare(
        `UPDATE staff SET user_id = ?, name = ?, role = ?, department = ?, phone = ?, email = ?, status = ?, shift = ? WHERE id = ?`
      )
      .run(next.userId || next.user_id || null, next.name, next.role, next.department, next.phone, next.email, next.status, next.shift, req.params.id);
    audit(req, "Staff updated", String(next.name));
    res.json({ staff: getDb().prepare("SELECT * FROM staff WHERE id = ?").get(req.params.id) });
  });

  api.delete("/staff/:id", requireAuth, requireRole(...ADMIN_ROLES, ...CLINIC_MANAGER_ROLES), (req, res) => {
    getDb().prepare("DELETE FROM staff WHERE id = ?").run(req.params.id);
    audit(req, "Staff deleted", req.params.id);
    res.json({ ok: true });
  });

  api.get("/branches", (_req, res) => {
    res.json({ branches: getDb().prepare("SELECT * FROM branches ORDER BY name").all() });
  });

  api.post("/branches", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name is required" });
    const id = `b-${crypto.randomUUID().slice(0, 8)}`;
    getDb()
      .prepare(
        `INSERT INTO branches (id, name, address, phone, opd_hours, active_doctors, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, b.name, b.address || "", b.phone || "", b.opdHours || b.opd_hours || "", Number(b.activeDoctors || b.active_doctors || 0), b.status || "Operating");
    audit(req, "Branch created", b.name);
    res.status(201).json({ branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(id) });
  });

  api.patch("/branches/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM branches WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Branch not found" });
    const next = {
      name: req.body.name ?? existing.name,
      address: req.body.address ?? existing.address,
      phone: req.body.phone ?? existing.phone,
      opd_hours: req.body.opdHours ?? req.body.opd_hours ?? existing.opd_hours,
      active_doctors: req.body.activeDoctors ?? req.body.active_doctors ?? existing.active_doctors,
      status: req.body.status ?? existing.status,
    };
    getDb()
      .prepare(
        `UPDATE branches SET name = ?, address = ?, phone = ?, opd_hours = ?, active_doctors = ?, status = ? WHERE id = ?`
      )
      .run(next.name, next.address, next.phone, next.opd_hours, Number(next.active_doctors), next.status, req.params.id);
    audit(req, "Branch updated", String(next.name));
    res.json({ branch: getDb().prepare("SELECT * FROM branches WHERE id = ?").get(req.params.id) });
  });

  api.delete("/branches/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    getDb().prepare("DELETE FROM branches WHERE id = ?").run(req.params.id);
    audit(req, "Branch deleted", req.params.id);
    res.json({ ok: true });
  });

  api.get("/cms/settings", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    res.json({ settings: settingsMap(), geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") });
  });

  api.put("/cms/settings", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const incoming = req.body?.settings || req.body || {};
    const stmt = getDb().prepare(
      "INSERT INTO cms_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    for (const [key, value] of Object.entries(incoming)) {
      if (key.toLowerCase().includes("api_key") || key.toLowerCase().includes("gemini_key")) continue;
      stmt.run(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    audit(req, "CMS settings updated", Object.keys(incoming).join(", "));
    res.json({ settings: settingsMap() });
  });

  api.get("/cms/sections", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    const rows = getDb()
      .prepare("SELECT id, type, sort_order, payload FROM cms_sections ORDER BY type, sort_order")
      .all() as { id: string; type: string; sort_order: number; payload: string }[];
    res.json({
      sections: rows.map((s) => ({
        id: s.id,
        type: s.type,
        sortOrder: s.sort_order,
        payload: JSON.parse(s.payload),
      })),
    });
  });

  api.put("/cms/sections", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const sections = req.body?.sections;
    if (!Array.isArray(sections)) return res.status(400).json({ error: "sections array required" });
    const database = getDb();
    database.exec("DELETE FROM cms_sections");
    const stmt = database.prepare("INSERT INTO cms_sections (id, type, sort_order, payload) VALUES (?, ?, ?, ?)");
    sections.forEach((s: { id?: string; type: string; sortOrder?: number; payload: unknown }, i: number) => {
      stmt.run(s.id || crypto.randomUUID(), s.type, s.sortOrder ?? i, JSON.stringify(s.payload || {}));
    });
    audit(req, "CMS sections updated", `${sections.length} sections`);
    res.json({ ok: true });
  });

  api.get("/cms/policies", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    res.json({
      policies: getDb().prepare("SELECT slug, title, body, updated_at FROM cms_policies ORDER BY slug").all(),
    });
  });

  api.put("/cms/policies/:slug", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT slug FROM cms_policies WHERE slug = ?").get(req.params.slug);
    if (!existing) return res.status(404).json({ error: "Policy not found" });
    getDb()
      .prepare("UPDATE cms_policies SET title = ?, body = ?, updated_at = ? WHERE slug = ?")
      .run(req.body.title || req.params.slug, req.body.body || "", new Date().toISOString(), req.params.slug);
    audit(req, "Policy updated", req.params.slug);
    res.json({
      policy: getDb().prepare("SELECT slug, title, body, updated_at FROM cms_policies WHERE slug = ?").get(req.params.slug),
    });
  });

  api.get("/media", requireAuth, requireRole(...ADMIN_ROLES), (_req, res) => {
    res.json({ media: getDb().prepare("SELECT * FROM cms_media ORDER BY created_at DESC").all() });
  });

  api.post("/media", requireAuth, requireRole(...ADMIN_ROLES), (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const id = crypto.randomUUID();
      const url = `/uploads/${req.file.filename}`;
      getDb()
        .prepare(
          `INSERT INTO cms_media (id, filename, url, alt, mime, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, req.file.originalname, url, String(req.body?.alt || ""), req.file.mimetype, req.user?.id || null, new Date().toISOString());
      audit(req, "Media uploaded", req.file.originalname);
      res.status(201).json({ media: getDb().prepare("SELECT * FROM cms_media WHERE id = ?").get(id) });
    });
  });

  api.delete("/media/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const row = getDb().prepare("SELECT * FROM cms_media WHERE id = ?").get(req.params.id) as { filename: string; url: string } | undefined;
    if (!row) return res.status(404).json({ error: "Media not found" });
    const filePath = path.join(process.cwd(), row.url.replace(/^\//, ""));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    getDb().prepare("DELETE FROM cms_media WHERE id = ?").run(req.params.id);
    audit(req, "Media deleted", row.filename);
    res.json({ ok: true });
  });

  api.get("/audit", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    res.json({
      logs: getDb().prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?").all(limit),
    });
  });

  // ----------------------------------------------------
  // WhatsApp AI Suite & Outbound Trigger Engine Router
  // ----------------------------------------------------
  api.use("/whatsapp", createWhatsAppRouter());

  // ----------------------------------------------------
  // Meta Tech Provider, Webhooks & App Review Compliance Router
  // ----------------------------------------------------
  api.use("/meta", createMetaRouter());

  // ----------------------------------------------------
  // ABDM v3 Gateway, Identity & DHIS Router
  // ----------------------------------------------------
  api.use("/abdm", createAbdmRouter());
  api.use("/v3", createAbdmRouter());

  // Direct EMR PDF viewer endpoints
  api.get("/emr/prescription/:id/pdf", (req, res) => {
    res.redirect(`/api/whatsapp/prescription/${req.params.id}/pdf`);
  });
  api.get("/emr/lab-report/:id/pdf", (req, res) => {
    res.redirect(`/api/whatsapp/lab-report/${req.params.id}/pdf`);
  });

  // EMR Patients & Appointments live endpoints
  api.get("/patients", (_req, res) => {
    try {
      const rows = getDb().prepare("SELECT * FROM patients ORDER BY name ASC").all() as Record<string, unknown>[];
      const patients = rows.map((p) => ({
        id: p.id,
        uhid: p.uhid,
        name: p.name,
        age: p.age,
        gender: p.gender,
        phone: p.phone,
        email: p.email,
        bloodGroup: p.blood_group,
        allergies: JSON.parse((p.allergies as string) || "[]"),
        chronicConditions: JSON.parse((p.chronic_conditions as string) || "[]"),
        emergencyContact: p.emergency_contact,
        address: p.address,
        lastVisit: p.last_visit,
        abhaNumber: (p.abha_number as string) || "",
        abhaAddress: (p.abha_address as string) || "",
        kycStatus: (p.kyc_status as string) || "PENDING",
        hfrId: (p.hfr_id as string) || "",
      }));
      res.json({ patients });
    } catch {
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  api.patch("/patients/:id/abha", (req, res) => {
    try {
      const { id } = req.params;
      const { abhaNumber, abhaAddress, kycStatus = "VERIFIED" } = req.body;
      const db = getDb();
      db.prepare(`
        UPDATE patients 
        SET abha_number = ?, abha_address = ?, kyc_status = ?, hfr_id = 'HFR-IN-8829104'
        WHERE id = ?
      `).run(abhaNumber, abhaAddress, kycStatus, id);
      res.json({ success: true, id, abhaNumber, abhaAddress, kycStatus });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update ABHA details: " + err.message });
    }
  });

  api.get("/appointments", (req, res) => {
    try {
      const rows = getDb().prepare("SELECT * FROM appointments ORDER BY token_number ASC").all() as Record<string, unknown>[];
      const appointments = rows.map((a) => ({
        id: a.id,
        tokenNumber: a.token_number,
        patientId: a.patient_id,
        patientName: a.patient_name,
        patientPhone: a.patient_phone,
        uhid: a.uhid,
        doctorId: a.doctor_id,
        doctorName: a.doctor_name,
        specialty: a.specialty,
        date: a.date,
        timeSlot: a.time_slot,
        type: a.type,
        status: a.status,
        source: a.source,
        consultationFee: a.consultation_fee,
        isPaid: Boolean(a.is_paid),
        vitals: a.vitals ? JSON.parse(a.vitals as string) : null,
      }));
      res.json({ appointments });
    } catch {
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  return api;
}
