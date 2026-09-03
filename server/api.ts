import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
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
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionId,
  requireAuth,
  requireRole,
  setSessionCookie,
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

export function createApiRouter(): Router {
  const api = Router();

  api.post("/auth/login", (req: Request, res: Response) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
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
    const sid = createSession(user.id);
    setSessionCookie(res, sid);
    getDb()
      .prepare("UPDATE users SET last_login = ? WHERE id = ?")
      .run(new Date().toISOString(), user.id);
    writeAudit(getDb(), user.id, user.name, "Login", `${user.email} signed in`);
    return res.json({ user: publicUser(user) });
  });

  api.post("/auth/logout", (req: Request, res: Response) => {
    const sid = getSessionId(req);
    if (sid) destroySession(sid);
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  api.get("/auth/me", (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in" });
    return res.json({ user: req.user });
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

  api.get("/doctors", requireAuth, requireRole(...CLINICIAN_ROLES, "patient"), (_req, res) => {
    const rows = getDb().prepare("SELECT * FROM doctors ORDER BY name").all() as Record<string, unknown>[];
    res.json({ doctors: rows.map(mapDoctor) });
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
    let sql = "SELECT * FROM users WHERE 1=1";
    const args: unknown[] = [];
    if (q) {
      sql += " AND (lower(name) LIKE ? OR lower(email) LIKE ?)";
      args.push(`%${q}%`, `%${q}%`);
    }
    if (role) {
      sql += " AND role = ?";
      args.push(role);
    }
    if (status) {
      sql += " AND status = ?";
      args.push(status);
    }
    sql += " ORDER BY created_at DESC";
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

  api.post("/doctors", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.specialty) return res.status(400).json({ error: "name and specialty are required" });
    const id = b.id || `doc-${crypto.randomUUID().slice(0, 8)}`;
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        b.active === false ? 0 : 1
      );
    audit(req, "Doctor created", b.name);
    const row = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json({ doctor: mapDoctor(row) });
  });

  api.patch("/doctors/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    const existing = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Doctor not found" });
    const mapped = mapDoctor(existing);
    const next = { ...mapped, ...req.body };
    getDb()
      .prepare(
        `UPDATE doctors SET user_id = ?, name = ?, qualification = ?, reg_number = ?, specialty = ?, experience_years = ?, consultation_fee = ?, opd_room = ?, available_days = ?, opd_timing = ?, phone = ?, email = ?, active = ? WHERE id = ?`
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
        next.active === false ? 0 : 1,
        req.params.id
      );
    audit(req, "Doctor updated", next.name);
    const row = getDb().prepare("SELECT * FROM doctors WHERE id = ?").get(req.params.id) as Record<string, unknown>;
    res.json({ doctor: mapDoctor(row) });
  });

  api.delete("/doctors/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    getDb().prepare("DELETE FROM doctors WHERE id = ?").run(req.params.id);
    audit(req, "Doctor deleted", req.params.id);
    res.json({ ok: true });
  });

  api.get("/staff", requireAuth, requireRole(...CLINICIAN_ROLES), (_req, res) => {
    res.json({ staff: getDb().prepare("SELECT * FROM staff ORDER BY name").all() });
  });

  api.post("/staff", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
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

  api.patch("/staff/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
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

  api.delete("/staff/:id", requireAuth, requireRole(...ADMIN_ROLES), (req, res) => {
    getDb().prepare("DELETE FROM staff WHERE id = ?").run(req.params.id);
    audit(req, "Staff deleted", req.params.id);
    res.json({ ok: true });
  });

  api.get("/branches", requireAuth, (_req, res) => {
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

  return api;
}
