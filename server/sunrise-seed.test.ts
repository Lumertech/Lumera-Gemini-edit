import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { TPG_2020_FOOTER_DISCLAIMER } from "./letterhead.ts";
import { migrate } from "./db-migrate.ts";
import { seedClinicalAndWhatsAppIfMissing } from "./db-seed.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { createPgShim } from "./pg-shim.ts";
import type { SqlDatabase } from "./sql-engine.ts";
import {
  SUNRISE_ACCOUNTS,
  SUNRISE_LOGIN_EMAILS,
  SUNRISE_TENANT_NAME,
  ensureSunriseClinic,
  sunriseAccountPassword,
} from "./sunrise-seed.ts";
import { startTestServer, type TestHttpServer } from "./test-http.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { SUNRISE_TENANT_ID } from "./tenant-slug.ts";
import { WHATSAPP_QUARANTINE_TENANT_ID } from "./whatsapp-tenant-backfill.ts";

const PASSWORD_ENV_KEYS = [
  "SUNRISE_DOCTOR_PASSWORD",
  "SUNRISE_ANANYA_PASSWORD",
  "SUNRISE_RECEPTION_PASSWORD",
  "SUNRISE_RECEPTIONIST_PASSWORD",
  "SUNRISE_PASSWORD",
  "SUNRISE_DEMO_PASSWORD",
] as const;

const savedEnv = Object.fromEntries(PASSWORD_ENV_KEYS.map((key) => [key, process.env[key]]));

after(() => {
  for (const key of PASSWORD_ENV_KEYS) {
    const previous = savedEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

function clearPasswordEnv() {
  for (const key of PASSWORD_ENV_KEYS) delete process.env[key];
}

function freshPasswords(): { doctor: string; reception: string } {
  return {
    doctor: `doc-${randomBytes(18).toString("hex")}`,
    reception: `desk-${randomBytes(18).toString("hex")}`,
  };
}

function passwordEnv(passwords: { doctor: string; reception: string }): NodeJS.ProcessEnv {
  return {
    DEMO_LOGIN_ENABLED: "true",
    SUNRISE_DOCTOR_PASSWORD: passwords.doctor,
    SUNRISE_RECEPTION_PASSWORD: passwords.reception,
  };
}

function openSqlite(): { db: DatabaseSync; close: () => void } {
  const file = path.join(os.tmpdir(), `lumera-sunrise-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.db`);
  const db = new DatabaseSync(file);
  return {
    db,
    close: () => {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function insertUser(
  db: SqlDatabase,
  row: { id: string; email: string; tenantId: string; role: string; passwordHash: string; name: string }
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', '+91 90000 00099', ?)`
  ).run(row.id, row.tenantId, row.email, row.passwordHash, row.name, row.role, now);
}

function insertTenant(db: SqlDatabase, id: string, name: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tenants (
       id, name, specialty, country, timezone, phone, trial_ends_at,
       ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
     ) VALUES (?, ?, 'General Medicine', 'India', 'UTC', '+91 90000 11111', ?, 10, 0, 1, '', ?, ?)`
  ).run(id, name, now, now, now);
}

type SunriseSnapshot = {
  users: Array<{
    id: string;
    email: string;
    role: string;
    tenant_id: string;
    password_hash: string;
    name: string;
    phone: string;
    status: string;
    clinic_name: string;
  }>;
  tenant: { id: string; name: string; phone: string; active_status: number };
  unrelatedUser: { id: string; email: string; tenant_id: string; role: string; password_hash: string; name: string };
  unrelatedTenant: { id: string; name: string; phone: string };
  quarantine: { id: string; name: string };
  conversation: { id: string; tenant_id: string };
};

function snapshot(db: SqlDatabase): SunriseSnapshot {
  return {
    users: db
      .prepare(
        `SELECT id, email, role, tenant_id, password_hash, name, phone, status, clinic_name
         FROM users WHERE lower(email) IN (?, ?) ORDER BY email`
      )
      .all(SUNRISE_LOGIN_EMAILS[0], SUNRISE_LOGIN_EMAILS[1]) as SunriseSnapshot["users"],
    tenant: db.prepare("SELECT id, name, phone, active_status FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as SunriseSnapshot["tenant"],
    unrelatedUser: db
      .prepare("SELECT id, email, tenant_id, role, password_hash, name FROM users WHERE id = ?")
      .get("user-unrelated") as SunriseSnapshot["unrelatedUser"],
    unrelatedTenant: db.prepare("SELECT id, name, phone FROM tenants WHERE id = ?").get("tenant-unrelated") as SunriseSnapshot["unrelatedTenant"],
    quarantine: db.prepare("SELECT id, name FROM tenants WHERE id = ?").get(WHATSAPP_QUARANTINE_TENANT_ID) as SunriseSnapshot["quarantine"],
    conversation: db
      .prepare("SELECT id, tenant_id FROM whatsapp_conversations WHERE id = ?")
      .get("conv-quarantine") as SunriseSnapshot["conversation"],
  };
}

function seedUnrelated(db: SqlDatabase) {
  insertTenant(db, "tenant-unrelated", "Unrelated Clinic");
  insertUser(db, {
    id: "user-unrelated",
    email: "unrelated.clinic@example.com",
    tenantId: "tenant-unrelated",
    role: "doctor",
    passwordHash: hashPassword(`unrelated-${randomBytes(8).toString("hex")}`),
    name: "Unrelated Doctor",
  });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO whatsapp_conversations (id, patient_phone, patient_name, updated_at, tenant_id)
     VALUES ('conv-quarantine', '+910000009999', 'Quarantine Only', ?, ?)`
  ).run(now, WHATSAPP_QUARANTINE_TENANT_ID);
}

function assertPasswords(db: SqlDatabase, passwords: { doctor: string; reception: string }) {
  for (const account of SUNRISE_ACCOUNTS) {
    const row = db.prepare("SELECT password_hash, role, tenant_id, email FROM users WHERE email = ?").get(account.email) as {
      password_hash: string;
      role: string;
      tenant_id: string;
      email: string;
    };
    const expected = account.role === "doctor" ? passwords.doctor : passwords.reception;
    assert.equal(verifyPassword(expected, row.password_hash), true, account.email);
    assert.equal(row.role, account.role, account.email);
    assert.equal(row.tenant_id, SUNRISE_TENANT_ID, account.email);
    assert.equal(row.email, account.email, account.email);
  }
}

describe("Sunrise clinic seed", () => {
  it("does not hardcode a password or log secret material", () => {
    const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "sunrise-seed.ts"), "utf8");
    assert.equal(src.includes("Lumera@2026"), false);
    assert.equal(/console\.(log|info|debug|warn|error)\([^)]*password/i.test(src), false);
    const doctor = SUNRISE_ACCOUNTS[0];
    assert.equal(sunriseAccountPassword(doctor, { SUNRISE_DOCTOR_PASSWORD: "replace-with-sunrise" }).length, 0);
    assert.equal(sunriseAccountPassword(doctor, { SUNRISE_PASSWORD: "change-me" }).length, 0);
    const specific = `specific-${randomBytes(8).toString("hex")}`;
    const shared = `shared-${randomBytes(8).toString("hex")}`;
    assert.equal(
      sunriseAccountPassword(doctor, { SUNRISE_DOCTOR_PASSWORD: specific, SUNRISE_PASSWORD: shared }) === specific,
      true
    );
    assert.equal(sunriseAccountPassword(doctor, { SUNRISE_PASSWORD: shared }) === shared, true);
    const reception = SUNRISE_ACCOUNTS[1];
    assert.equal(sunriseAccountPassword(reception, { SUNRISE_RECEPTIONIST_PASSWORD: specific }) === specific, true);
  });

  it("keeps Sunrise emails off tenant-lumera-main when migrate inserted only the quarantine tenant", () => {
    const { db, close } = openSqlite();
    try {
      migrate(db);
      const wrong = hashPassword(`wrong-${randomBytes(6).toString("hex")}`);
      insertUser(db, {
        id: "user-sunrise-ananya",
        email: "ananya.sunrise@lumera.me",
        tenantId: "",
        role: "receptionist",
        passwordHash: wrong,
        name: "Moved Doctor",
      });
      insertUser(db, {
        id: "user-blank-other",
        email: "blank.other@example.com",
        tenantId: "",
        role: "doctor",
        passwordHash: wrong,
        name: "Blank Other",
      });
      seedClinicalAndWhatsAppIfMissing(db);
      const demo = db.prepare("SELECT id FROM tenants WHERE id = ?").get(DEMO_TENANT_ID) as { id?: string } | undefined;
      assert.equal(demo?.id, DEMO_TENANT_ID);
      const sunrise = db.prepare("SELECT tenant_id, role FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as {
        tenant_id: string;
        role: string;
      };
      assert.equal(sunrise.tenant_id, "");
      assert.notEqual(sunrise.tenant_id, DEMO_TENANT_ID);
      const other = db.prepare("SELECT tenant_id FROM users WHERE email = ?").get("blank.other@example.com") as { tenant_id: string };
      assert.equal(other.tenant_id, DEMO_TENANT_ID);
    } finally {
      close();
    }
  });

  it("repairs Sunrise rows onto tenant-543feff7 and a second seed matches the first", () => {
    const passwords = freshPasswords();
    const env = passwordEnv(passwords);
    const { db, close } = openSqlite();
    try {
      migrate(db);
      seedUnrelated(db);
      insertTenant(db, DEMO_TENANT_ID, "Lumera Apex PolyClinic");
      const wrong = hashPassword(`wrong-${randomBytes(6).toString("hex")}`);
      insertUser(db, {
        id: "user-sunrise-ananya",
        email: "Ananya.Sunrise@lumera.me",
        tenantId: DEMO_TENANT_ID,
        role: "receptionist",
        passwordHash: wrong,
        name: "Custom Ananya",
      });
      insertUser(db, {
        id: "user-taken",
        email: "someone.else@example.com",
        tenantId: "tenant-unrelated",
        role: "doctor",
        passwordHash: wrong,
        name: "Id Collision",
      });
      db.prepare("UPDATE users SET id = ? WHERE email = ?").run("user-sunrise-reception", "someone.else@example.com");

      ensureSunriseClinic(db, env);
      assertPasswords(db, passwords);
      const doctor = db.prepare("SELECT id, name, clinic_name FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as {
        id: string;
        name: string;
        clinic_name: string;
      };
      assert.equal(doctor.id, "user-sunrise-ananya");
      assert.equal(doctor.name, "Custom Ananya");
      const reception = db.prepare("SELECT id FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as { id: string };
      assert.equal(reception.id, "user-sunrise-reception-clinic");
      const collided = db.prepare("SELECT email, tenant_id, role FROM users WHERE id = ?").get("user-sunrise-reception") as {
        email: string;
        tenant_id: string;
        role: string;
      };
      assert.equal(collided.email, "someone.else@example.com");
      assert.equal(collided.tenant_id, "tenant-unrelated");
      assert.equal(collided.role, "doctor");

      const first = snapshot(db);
      ensureSunriseClinic(db, env);
      const second = snapshot(db);
      assert.deepEqual(second, first);
      assert.equal(second.quarantine.name, "Unassigned WhatsApp");
      assert.equal(second.conversation.tenant_id, WHATSAPP_QUARANTINE_TENANT_ID);
      assert.equal(second.unrelatedUser.tenant_id, "tenant-unrelated");
      assert.equal(second.unrelatedTenant.name, "Unrelated Clinic");
      assert.equal(second.users.length, 2);

      db.prepare("UPDATE tenants SET name = ?, phone = ? WHERE id = ?").run("Sunrise Pune Custom", "+91 20 1111 2222", SUNRISE_TENANT_ID);
      ensureSunriseClinic(db, env);
      const kept = db.prepare("SELECT name, phone FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { name: string; phone: string };
      assert.equal(kept.name, "Sunrise Pune Custom");
      assert.equal(kept.phone, "+91 20 1111 2222");
      assert.equal(second.tenant.name, SUNRISE_TENANT_NAME);
    } finally {
      close();
    }
  });

  it("does not invent a password when the secret is unset", () => {
    const { db, close } = openSqlite();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message ?? ""));
    };
    try {
      migrate(db);
      const existingHash = hashPassword(`kept-${randomBytes(6).toString("hex")}`);
      insertTenant(db, DEMO_TENANT_ID, "Lumera Apex PolyClinic");
      insertUser(db, {
        id: "user-sunrise-ananya",
        email: "ananya.sunrise@lumera.me",
        tenantId: DEMO_TENANT_ID,
        role: "doctor",
        passwordHash: existingHash,
        name: "Dr. Ananya Sunrise",
      });
      ensureSunriseClinic(db, { NODE_ENV: "production", DEMO_LOGIN_ENABLED: "true" });
      const row = db.prepare("SELECT tenant_id, role, password_hash FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as {
        tenant_id: string;
        role: string;
        password_hash: string;
      };
      assert.equal(row.tenant_id, SUNRISE_TENANT_ID);
      assert.equal(row.role, "doctor");
      assert.equal(row.password_hash, existingHash);
      const missing = db.prepare("SELECT id FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as { id?: string } | undefined;
      assert.equal(missing, undefined);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /reception\.sunrise@lumera\.me/);
      assert.match(warnings[0], /SUNRISE_RECEPTION_PASSWORD/);
      assert.equal(warnings[0].includes("kept-"), false);
      assert.equal(warnings[0].includes(existingHash), false);
    } finally {
      console.warn = originalWarn;
      close();
    }
  });

  it("is a no-op when demo login is off, including production with secrets set", () => {
    const passwords = freshPasswords();
    const existingHash = hashPassword(`kept-${randomBytes(6).toString("hex")}`);
    const flags: Array<string | undefined> = [undefined, "", "false", "0", "no", "off"];
    for (const flag of flags) {
      const { db, close } = openSqlite();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (message?: unknown) => {
        warnings.push(String(message ?? ""));
      };
      try {
        migrate(db);
        seedUnrelated(db);
        insertTenant(db, DEMO_TENANT_ID, "Lumera Apex PolyClinic");
        insertUser(db, {
          id: "user-sunrise-ananya",
          email: "ananya.sunrise@lumera.me",
          tenantId: DEMO_TENANT_ID,
          role: "receptionist",
          passwordHash: existingHash,
          name: "Dr. Ananya Sunrise",
        });
        const before = snapshot(db);
        const env: NodeJS.ProcessEnv = {
          NODE_ENV: "production",
          SUNRISE_DOCTOR_PASSWORD: passwords.doctor,
          SUNRISE_RECEPTION_PASSWORD: passwords.reception,
          SUNRISE_PASSWORD: passwords.doctor,
        };
        if (flag !== undefined) env.DEMO_LOGIN_ENABLED = flag;
        ensureSunriseClinic(db, env);
        ensureSunriseClinic(db, { ...env, NODE_ENV: "test" });
        const after = snapshot(db);
        assert.deepEqual(after, before, `flag ${JSON.stringify(flag)}`);
        assert.equal(after.users.length, 1, `flag ${JSON.stringify(flag)}`);
        assert.equal(after.users[0].tenant_id, DEMO_TENANT_ID);
        assert.equal(after.users[0].role, "receptionist");
        assert.equal(after.users[0].password_hash, existingHash);
        assert.equal(after.tenant, undefined);
        const reception = db.prepare("SELECT id FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as { id?: string } | undefined;
        assert.equal(reception, undefined);
        assert.equal(warnings.length, 0);
        assert.equal(after.unrelatedUser.password_hash, before.unrelatedUser.password_hash);
        assert.equal(after.quarantine.id, WHATSAPP_QUARANTINE_TENANT_ID);
      } finally {
        console.warn = originalWarn;
        close();
      }
    }
  });

  it("writes a password hash only for a new user or a hash that does not verify", () => {
    const passwords = freshPasswords();
    const env = passwordEnv(passwords);
    const { db, close } = openSqlite();
    try {
      migrate(db);
      const verifying = hashPassword(passwords.doctor);
      insertUser(db, {
        id: "user-sunrise-ananya",
        email: "ananya.sunrise@lumera.me",
        tenantId: SUNRISE_TENANT_ID,
        role: "doctor",
        passwordHash: verifying,
        name: "Dr. Ananya Sunrise",
      });
      insertTenant(db, SUNRISE_TENANT_ID, SUNRISE_TENANT_NAME);
      ensureSunriseClinic(db, env);
      const doctor = db.prepare("SELECT password_hash, tenant_id, role FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as {
        password_hash: string;
        tenant_id: string;
        role: string;
      };
      assert.equal(doctor.password_hash, verifying);
      assert.equal(doctor.tenant_id, SUNRISE_TENANT_ID);
      assert.equal(doctor.role, "doctor");
      const created = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as {
        password_hash: string;
      };
      assert.equal(verifyPassword(passwords.reception, created.password_hash), true);
      const createdHash = created.password_hash;
      ensureSunriseClinic(db, env);
      const createdAgain = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as {
        password_hash: string;
      };
      assert.equal(createdAgain.password_hash, createdHash);
      const stale = hashPassword(`stale-${randomBytes(6).toString("hex")}`);
      db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(stale, "reception.sunrise@lumera.me");
      ensureSunriseClinic(db, env);
      const repaired = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("reception.sunrise@lumera.me") as {
        password_hash: string;
      };
      assert.notEqual(repaired.password_hash, stale);
      assert.equal(verifyPassword(passwords.reception, repaired.password_hash), true);
      const doctorAfter = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as {
        password_hash: string;
      };
      assert.equal(doctorAfter.password_hash, verifying);
    } finally {
      close();
    }
  });

  it("logs in after the quarantine seed path moved Sunrise onto the demo tenant", async () => {
    clearPasswordEnv();
    const prevDemo = process.env.DEMO_LOGIN_ENABLED;
    process.env.DEMO_LOGIN_ENABLED = "true";
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-sunrise-seed";
    const passwords = freshPasswords();
    process.env.SUNRISE_DOCTOR_PASSWORD = passwords.doctor;
    process.env.SUNRISE_RECEPTION_PASSWORD = passwords.reception;
    const prevNodeEnv = process.env.NODE_ENV;
    initDatabase();
    const db = getDb();
    const wrong = hashPassword(`wrong-${randomBytes(6).toString("hex")}`);
    for (const account of SUNRISE_ACCOUNTS) {
      db.prepare("UPDATE users SET tenant_id = ?, role = ?, password_hash = ? WHERE email = ?").run(
        DEMO_TENANT_ID,
        account.role === "doctor" ? "receptionist" : "doctor",
        wrong,
        account.email
      );
    }
    const quarantineBefore = db.prepare("SELECT name FROM tenants WHERE id = ?").get(WHATSAPP_QUARANTINE_TENANT_ID) as { name: string };
    const unrelatedBefore = db.prepare("SELECT tenant_id, password_hash FROM users WHERE email = ?").get("doctor@lumera.me") as {
      tenant_id: string;
      password_hash: string;
    };

    const server: TestHttpServer = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    process.env.NODE_ENV = "production";
    try {
      const denied = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ananya.sunrise@lumera.me", password: passwords.doctor }),
      });
      const deniedJson = (await denied.json()) as { error?: string };
      assert.equal(denied.status, 401);
      assert.equal(deniedJson.error, "Invalid email or password");

      ensureSunriseClinic(db);
      for (const account of SUNRISE_ACCOUNTS) {
        const expected = account.role === "doctor" ? passwords.doctor : passwords.reception;
        const res = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: account.email, password: expected }),
        });
        const json = (await res.json()) as {
          error?: string;
          requiresOtp?: boolean;
          token?: string;
          user?: { email?: string; role?: string; tenantId?: string; isDemoWorkspace?: boolean };
        };
        assert.equal(res.status, 200, json.error || account.email);
        assert.equal(json.requiresOtp, false, account.email);
        assert.equal(typeof json.token, "string");
        assert.equal(json.user?.email, account.email);
        assert.equal(json.user?.role, account.role);
        assert.equal(json.user?.tenantId, SUNRISE_TENANT_ID);
        assert.equal(json.user?.isDemoWorkspace, false);
        assert.equal(JSON.stringify(json).includes(expected), false);
      }

      const hashes = SUNRISE_ACCOUNTS.map(
        (account) => (db.prepare("SELECT password_hash FROM users WHERE email = ?").get(account.email) as { password_hash: string }).password_hash
      );
      ensureSunriseClinic(db);
      const hashesAgain = SUNRISE_ACCOUNTS.map(
        (account) => (db.prepare("SELECT password_hash FROM users WHERE email = ?").get(account.email) as { password_hash: string }).password_hash
      );
      assert.deepEqual(hashesAgain, hashes);

      const unrelatedAfter = db.prepare("SELECT tenant_id, password_hash FROM users WHERE email = ?").get("doctor@lumera.me") as {
        tenant_id: string;
        password_hash: string;
      };
      assert.equal(unrelatedAfter.tenant_id, unrelatedBefore.tenant_id);
      assert.equal(unrelatedAfter.password_hash, unrelatedBefore.password_hash);
      assert.notEqual(unrelatedAfter.tenant_id, SUNRISE_TENANT_ID);
      const quarantineAfter = db.prepare("SELECT name FROM tenants WHERE id = ?").get(WHATSAPP_QUARANTINE_TENANT_ID) as { name: string };
      assert.equal(quarantineAfter.name, quarantineBefore.name);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevDemo === undefined) delete process.env.DEMO_LOGIN_ENABLED;
      else process.env.DEMO_LOGIN_ENABLED = prevDemo;
      clearPasswordEnv();
      await server.close();
    }
  });

  it("cleans only Sunrise demo drafts and past in-consultation visits", () => {
    const { db, close } = openSqlite();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };
    try {
      migrate(db);
      const now = new Date();
      const today = clinicCalendarDate(now);
      const yesterday = "2000-01-01";
      const stale = "2000-01-01T00:00:00.000Z";
      const fresh = now.toISOString();
      const otherTenant = "tenant-other-clinic";
      const insertAppointment = db.prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid,
           doctor_id, doctor_name, specialty, date, time_slot, status, created_at
         ) VALUES (?, ?, ?, 'pat', 'Pat', '+91 90000 00000', 'UH', 'doc', 'Doc', 'General Medicine', ?, '10:00', ?, ?)`
      );
      const insertDraft = db.prepare(
        `INSERT INTO prescription_drafts (tenant_id, patient_id, appointment_id, doctor_id, draft_json, updated_at)
         VALUES (?, ?, ?, 'doc', ?, ?)`
      );
      insertAppointment.run("apt-other-past", otherTenant, 1, yesterday, "In Consultation", fresh);
      insertAppointment.run("apt-other-open", otherTenant, 1, today, "Waiting", fresh);
      insertDraft.run(otherTenant, "pat-other", "apt-other-open", '{"diagnosis":"KEEP"}', stale);
      insertDraft.run(otherTenant, "pat-other-2", "", '{"diagnosis":"KEEP-BLANK"}', fresh);

      insertAppointment.run("apt-sun-open", SUNRISE_TENANT_ID, 1, today, "Waiting", fresh);
      insertAppointment.run("apt-sun-done", SUNRISE_TENANT_ID, 2, today, "Completed", fresh);
      insertAppointment.run("apt-sun-past", SUNRISE_TENANT_ID, 1, yesterday, "In Consultation", fresh);
      insertAppointment.run("apt-sun-today", SUNRISE_TENANT_ID, 3, today, "In Consultation", fresh);
      insertDraft.run(SUNRISE_TENANT_ID, "pat-keep", "apt-sun-open", '{"diagnosis":"KEEP-SUN"}', fresh);
      insertDraft.run(SUNRISE_TENANT_ID, "pat-old", "apt-sun-open", '{"diagnosis":"OLD"}', stale);
      insertDraft.run(SUNRISE_TENANT_ID, "pat-done", "apt-sun-done", '{"diagnosis":"DONE"}', fresh);
      insertDraft.run(SUNRISE_TENANT_ID, "pat-missing", "apt-missing", '{"diagnosis":"MISSING"}', fresh);

      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "false" });
      const before = db.prepare("SELECT COUNT(*) AS c FROM prescription_drafts WHERE tenant_id = ?").get(SUNRISE_TENANT_ID) as {
        c: number;
      };
      assert.equal(Number(before.c), 4);

      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "true" });
      const sunriseDrafts = db
        .prepare("SELECT patient_id, appointment_id FROM prescription_drafts WHERE tenant_id = ? ORDER BY patient_id")
        .all(SUNRISE_TENANT_ID) as Array<{ patient_id: string; appointment_id: string }>;
      assert.equal(sunriseDrafts.length, 1);
      assert.equal(sunriseDrafts[0].patient_id, "pat-keep");
      assert.equal(sunriseDrafts[0].appointment_id, "apt-sun-open");
      const past = db.prepare("SELECT status FROM appointments WHERE id = ?").get("apt-sun-past") as { status: string };
      const todayVisit = db.prepare("SELECT status FROM appointments WHERE id = ?").get("apt-sun-today") as { status: string };
      assert.equal(past.status, "Completed");
      assert.equal(todayVisit.status, "In Consultation");

      const otherDrafts = db.prepare("SELECT COUNT(*) AS c FROM prescription_drafts WHERE tenant_id = ?").get(otherTenant) as {
        c: number;
      };
      assert.equal(Number(otherDrafts.c), 2);
      const otherPast = db.prepare("SELECT status FROM appointments WHERE id = ?").get("apt-other-past") as { status: string };
      assert.equal(otherPast.status, "In Consultation");

      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "true" });
      const sunriseAgain = db.prepare("SELECT COUNT(*) AS c FROM prescription_drafts WHERE tenant_id = ?").get(SUNRISE_TENANT_ID) as {
        c: number;
      };
      assert.equal(Number(sunriseAgain.c), 1);
      const otherAgain = db.prepare("SELECT status FROM appointments WHERE id = ?").get("apt-other-past") as { status: string };
      assert.equal(otherAgain.status, "In Consultation");
      assert.ok(logs.some((line) => /demo cleanup removed \d+ prescription drafts and completed \d+ past in-consultation visits/.test(line)));
    } finally {
      console.log = originalLog;
      close();
    }
  });

  it("sets only the Sunrise letterhead footer to the TPG 2020 default", () => {
    const { db, close } = openSqlite();
    try {
      migrate(db);
      const otherFooter = "GSTIN and UPI shown here are placeholders for another clinic.";
      const sentinel = "2001-01-01T00:00:00.000Z";
      insertTenant(db, "tenant-unrelated", "Unrelated Clinic");
      db.prepare("UPDATE tenants SET footer_disclaimer = ?, updated_at = ? WHERE id = ?").run(otherFooter, sentinel, "tenant-unrelated");
      const demoFooter = "Demo clinic footer stays put.";
      const demoRow = db.prepare("SELECT id FROM tenants WHERE id = ?").get(DEMO_TENANT_ID) as { id?: string } | undefined;
      if (!demoRow?.id) insertTenant(db, DEMO_TENANT_ID, "Demo Clinic");
      db.prepare("UPDATE tenants SET footer_disclaimer = ? WHERE id = ?").run(demoFooter, DEMO_TENANT_ID);

      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "false" });
      assert.equal(
        (db.prepare("SELECT id FROM tenants WHERE id = ?").get(SUNRISE_TENANT_ID) as { id?: string } | undefined)?.id,
        undefined
      );

      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "true" });
      const footerOf = (id: string) =>
        db.prepare("SELECT footer_disclaimer AS v, updated_at AS u FROM tenants WHERE id = ?").get(id) as {
          v: string | null;
          u: string;
        };
      assert.equal(footerOf(SUNRISE_TENANT_ID).v, TPG_2020_FOOTER_DISCLAIMER);
      assert.equal(footerOf("tenant-unrelated").v, otherFooter);
      assert.equal(footerOf("tenant-unrelated").u, sentinel);
      assert.equal(footerOf(DEMO_TENANT_ID).v, demoFooter);

      const now = "2026-10-16T00:00:00.000Z";
      db.prepare(
        `INSERT INTO invoices (id, tenant_id, invoice_number, date, created_at, gstin, upi_id, total_amount, status)
         VALUES ('inv-sun-footer', ?, 'INV-SUN-FOOTER', '2026-10-01', ?, '19PLACEHOLDER1Z5', 'placeholder@upi', 500, 'Unpaid')`
      ).run(SUNRISE_TENANT_ID, now);
      db.prepare(
        `INSERT INTO invoices (id, tenant_id, invoice_number, date, created_at, gstin, upi_id, total_amount, status)
         VALUES ('inv-other-footer', ?, 'INV-OTHER-FOOTER', '2026-10-01', ?, '27OTHERGSTIN1Z5', 'other@upi', 800, 'Paid')`
      ).run("tenant-unrelated", now);
      const invoiceOf = (id: string) =>
        db.prepare("SELECT tenant_id, gstin, upi_id, total_amount, status FROM invoices WHERE id = ?").get(id) as {
          tenant_id: string;
          gstin: string;
          upi_id: string;
          total_amount: number;
          status: string;
        };
      const sunInvoice = invoiceOf("inv-sun-footer");
      const otherInvoice = invoiceOf("inv-other-footer");

      db.prepare("UPDATE tenants SET updated_at = ? WHERE id = ?").run(sentinel, SUNRISE_TENANT_ID);
      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "true" });
      assert.equal(footerOf(SUNRISE_TENANT_ID).v, TPG_2020_FOOTER_DISCLAIMER);
      assert.equal(footerOf(SUNRISE_TENANT_ID).u, sentinel);
      assert.equal(footerOf("tenant-unrelated").v, otherFooter);
      assert.deepEqual(invoiceOf("inv-sun-footer"), sunInvoice);
      assert.deepEqual(invoiceOf("inv-other-footer"), otherInvoice);

      const replaced = "Placeholder GSTIN/UPI disclosure that used to live on the Sunrise footer.";
      db.prepare("UPDATE tenants SET footer_disclaimer = ? WHERE id = ?").run(replaced, SUNRISE_TENANT_ID);
      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "true" });
      assert.equal(footerOf(SUNRISE_TENANT_ID).v, TPG_2020_FOOTER_DISCLAIMER);
      assert.equal(footerOf(SUNRISE_TENANT_ID).u, sentinel);
      assert.equal(footerOf("tenant-unrelated").v, otherFooter);
      assert.equal(footerOf(DEMO_TENANT_ID).v, demoFooter);
      assert.deepEqual(invoiceOf("inv-sun-footer"), sunInvoice);

      db.prepare("UPDATE tenants SET footer_disclaimer = ? WHERE id = ?").run("Clinic edited this footer.", SUNRISE_TENANT_ID);
      ensureSunriseClinic(db, { DEMO_LOGIN_ENABLED: "false" });
      assert.equal(footerOf(SUNRISE_TENANT_ID).v, "Clinic edited this footer.");
      assert.equal(footerOf("tenant-unrelated").v, otherFooter);
    } finally {
      close();
    }
  });
});

function postgresTestUrl(): string | null {
  const fromEnv = String(process.env.SUNRISE_TEST_DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    return "postgres://ubuntu@/lumera_sunrise_test?host=/var/run/postgresql";
  }
  return null;
}

describe("Sunrise clinic seed on Postgres", () => {
  it("matches the sqlite repair after migrate inserts the quarantine tenant", { timeout: 180_000 }, async () => {
    const url = postgresTestUrl();
    if (!url) {
      return;
    }
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
      await pool.query("CREATE SCHEMA public");
    } finally {
      await pool.end();
    }
    const prevDbUrl = process.env.DATABASE_URL;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = url;
    if (prevNodeEnv === "production") process.env.NODE_ENV = "test";
    const db = createPgShim(url);
    try {
      migrate(db);
      const passwords = freshPasswords();
      const wrong = hashPassword(`wrong-${randomBytes(6).toString("hex")}`);
      seedUnrelated(db);
      insertTenant(db, DEMO_TENANT_ID, "Lumera Apex PolyClinic");
      insertUser(db, {
        id: "user-sunrise-ananya",
        email: "ananya.sunrise@lumera.me",
        tenantId: DEMO_TENANT_ID,
        role: "patient",
        passwordHash: wrong,
        name: "Postgres Ananya",
      });
      insertUser(db, {
        id: "user-sunrise-reception",
        email: "reception.sunrise@lumera.me",
        tenantId: "",
        role: "doctor",
        passwordHash: wrong,
        name: "Postgres Desk",
      });
      const quarantineBefore = db.prepare("SELECT name FROM tenants WHERE id = ?").get(WHATSAPP_QUARANTINE_TENANT_ID) as { name: string };
      const otherFooter = "Other clinic footer stays put.";
      const demoFooter = "Demo clinic footer stays put.";
      db.prepare("UPDATE tenants SET footer_disclaimer = ? WHERE id = ?").run(otherFooter, "tenant-unrelated");
      db.prepare("UPDATE tenants SET footer_disclaimer = ? WHERE id = ?").run(demoFooter, DEMO_TENANT_ID);
      ensureSunriseClinic(db, passwordEnv(passwords));
      assertPasswords(db, passwords);
      const first = snapshot(db);
      ensureSunriseClinic(db, passwordEnv(passwords));
      assert.deepEqual(snapshot(db), first);
      assert.equal(first.quarantine.name, quarantineBefore.name);
      assert.equal(first.unrelatedUser.email, "unrelated.clinic@example.com");
      assert.equal(first.conversation.tenant_id, WHATSAPP_QUARANTINE_TENANT_ID);
      const names = db.prepare("SELECT name FROM users WHERE email = ?").get("ananya.sunrise@lumera.me") as { name: string };
      assert.equal(names.name, "Postgres Ananya");
      const footerOf = (id: string) =>
        (db.prepare("SELECT footer_disclaimer AS v FROM tenants WHERE id = ?").get(id) as { v: string }).v;
      assert.equal(footerOf(SUNRISE_TENANT_ID), TPG_2020_FOOTER_DISCLAIMER);
      assert.equal(footerOf("tenant-unrelated"), otherFooter);
      assert.equal(footerOf(DEMO_TENANT_ID), demoFooter);
    } finally {
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
