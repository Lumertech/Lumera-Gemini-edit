import type { DatabaseSync } from "node:sqlite";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";
import { packIdLabel } from "../src/lib/specialtyPack.ts";
import { hashPassword } from "./password.ts";

const DEMO_TENANT_ID = "tenant-lumera-main";

/**
 * Idempotent sandbox matrix. Creates missing @lumera.me logins and keeps
 * specialty / role / doctor roster aligned. Password reset is non-prod only.
 * Role model (#70): doctor@ = Individual master; reception@ = Individual sub;
 * clinic.admin@ = Polyclinic CLINIC_ADMIN (Branches); admin@ = Super Admin (no Branches).
 * Seed emails already match — this does not invent new personas.
 */
export function ensureDemoPersonaUsers(database: DatabaseSync) {
  const now = new Date().toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const isProd = process.env.NODE_ENV === "production";

  const insertUser = database.prepare(`
    INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, onboarding_completed, practice_type, specialty, pack_id)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, 1, ?, ?, ?)
  `);
  const updateUser = database.prepare(`
    UPDATE users
    SET name = ?, role = ?, phone = ?, tenant_id = COALESCE(NULLIF(tenant_id, ''), ?),
        onboarding_completed = 1, practice_type = ?, specialty = ?, pack_id = ?, status = 'active'
    WHERE id = ? OR email = ?
  `);
  const updatePassword = database.prepare("UPDATE users SET password_hash = ? WHERE email = ?");

  const insertDoc = database.prepare(`
    INSERT OR REPLACE INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const acct of DEMO_ACCOUNTS) {
    const existing = database.prepare("SELECT id FROM users WHERE email = ? OR id = ?").get(acct.email, acct.id) as
      | { id: string }
      | undefined;
    if (!existing) {
      insertUser.run(
        acct.id,
        DEMO_TENANT_ID,
        acct.email,
        passwordHash,
        acct.name,
        acct.role,
        acct.phone,
        now,
        acct.practiceType,
        acct.specialty,
        acct.specialty
      );
    } else {
      updateUser.run(
        acct.name,
        acct.role,
        acct.phone,
        DEMO_TENANT_ID,
        acct.practiceType,
        acct.specialty,
        acct.specialty,
        existing.id,
        acct.email
      );
      if (!isProd) {
        updatePassword.run(passwordHash, acct.email);
      }
    }

    if (acct.doctorId) {
      insertDoc.run(
        acct.doctorId,
        existing?.id || acct.id,
        acct.name,
        acct.qualification || "",
        acct.regNumber || "",
        acct.displaySpecialty || packIdLabel(acct.specialty) || acct.specialty,
        10,
        acct.consultationFee || 0,
        acct.opdRoom || "",
        JSON.stringify(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]),
        "09:00 AM - 05:00 PM",
        acct.phone,
        acct.email,
        "",
        acct.bio || "",
        ""
      );
    }
  }
}
