/**
 * Lumera clinic schema — 1:1 translation of server/db.ts migrate() plus
 * ALTER TABLE steps and server/platform-tenants.ts ensurePlatformTenantSchema().
 *
 * Do not "clean up" types: TEXT stays text (including ISO datetimes and JSON
 * blobs), INTEGER 0/1 flags stay integer, REAL stays real. This file replaces
 * the unused template users/entries model. Runtime still bootstraps via
 * CREATE TABLE IF NOT EXISTS in migrate(); drizzle-kit uses this file for
 * Cloud SQL migrations.
 */
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  phone: text("phone").notNull().default(""),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull(),
  tenantId: text("tenant_id").default(""),
  clinicName: text("clinic_name").default(""),
  avatarUrl: text("avatar_url").default(""),
  whatsappVerified: integer("whatsapp_verified").default(0),
  hprId: text("hpr_id").default(""),
  hfrId: text("hfr_id").default(""),
  onboardingCompleted: integer("onboarding_completed").default(0),
  practiceType: text("practice_type").default("individual"),
  specialty: text("specialty").default(""),
  packId: text("pack_id").default(""),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_users_id_fk",
    }).onDelete("cascade"),
  ]
);
