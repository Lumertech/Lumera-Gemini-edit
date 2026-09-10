import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { assignedRoleForPracticeType, getDb, initDatabase, normalizePracticeType } from "./db.ts";
import { hashPassword } from "./password.ts";

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function seedOnboardingUser(label: string, practiceType: "individual" | "polyclinic") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-ob-${label}-${suffix}`;
  const userId = `user-ob-${label}-${suffix}`;
  const email = `${label}.${suffix}@onboard-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  const role = assignedRoleForPracticeType(practiceType);
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    role,
    `+91 91100 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    practiceType,
    now,
    now
  );
  db.prepare(
    `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
     VALUES (?, ?, ?, '', '', 'General Medicine', 0, 0, '', '[]', '', ?, ?, '', '', '', 1)`
  ).run(`doc-ob-${label}-${suffix}`, userId, `Dr ${label}`, `+91 91100 ${label.slice(0, 5).padEnd(5, "0")}`, email);
  return { tenantId, userId, email };
}

describe("practice type onboarding", () => {
  let port = 0;
  let server: Server | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-onboarding-tracks";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    app.use("/api", createApiRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("normalizes missing and alias practice types to the founder lock", () => {
    assert.equal(normalizePracticeType(undefined), "individual");
    assert.equal(normalizePracticeType("individual"), "individual");
    assert.equal(normalizePracticeType("multispecialty"), "polyclinic");
    assert.equal(assignedRoleForPracticeType("individual"), "doctor");
    assert.equal(assignedRoleForPracticeType("polyclinic"), "CLINIC_ADMIN");
    assert.equal(assignedRoleForPracticeType("polyclinic", "receptionist"), "receptionist");
  });

  it("register-practice without practiceType creates an individual doctor, not a polyclinic admin", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `solo.${stamp}@onboard-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "Mehta Clinic",
      specialty: "Cardiology",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 98000 ${stamp.slice(0, 5)}`,
      name: "Asha Mehta",
      email,
      password: "Lumera@2026",
    });
    assert.equal(res.status, 200, String(res.json.error || "register failed"));
    const row = getDb().prepare("SELECT role, practice_type, onboarding_completed, specialty, pack_id FROM users WHERE email = ?").get(email) as {
      role: string;
      practice_type: string;
      onboarding_completed: number;
      specialty: string;
      pack_id: string;
    };
    assert.equal(normalizePracticeType(row.practice_type), "individual");
    assert.equal(row.role, "doctor");
    assert.equal(row.onboarding_completed, 0);
    assert.equal(row.specialty, "gp");
    assert.equal(row.pack_id, "gp");
  });

  it("register-practice with multispecialty is an explicit polyclinic admin opt-in", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `poly.${stamp}@onboard-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "City Care Multispecialty",
      specialty: "General Medicine",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 98100 ${stamp.slice(0, 5)}`,
      name: "Ravi Nair",
      email,
      password: "Lumera@2026",
      practiceType: "multispecialty",
    });
    assert.equal(res.status, 200, String(res.json.error || "register failed"));
    const row = getDb().prepare("SELECT role, practice_type, specialty, pack_id FROM users WHERE email = ?").get(email) as {
      role: string;
      practice_type: string;
      specialty: string;
      pack_id: string;
    };
    assert.equal(normalizePracticeType(row.practice_type), "polyclinic");
    assert.equal(row.specialty, "gp");
    assert.equal(row.pack_id, "gp");
    assert.equal(row.role, "CLINIC_ADMIN");
  });

  it("individual complete-onboarding stays a doctor and does not create a roster", async () => {
    const seeded = seedOnboardingUser("solo", "individual");
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email: seeded.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    const done = await jsonRequest(
      port,
      "POST",
      "/api/auth/complete-onboarding",
      {
        doctorName: "Dr Asha Rao",
        clinicName: "Asha Heart Clinic",
        specialty: "Cardiology",
        regNumber: "KMC-1001",
        qualification: "MD DM",
        consultationFee: 800,
        opdTiming: "10:00 AM - 01:00 PM",
        practiceType: "individual",
        slotDurationMinutes: 20,
        rxTemplate: "classic",
        facilityCity: "Kochi",
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(done.status, 200, String(done.json.error || "complete failed"));
    assert.equal(done.json.homeView, "queue");
    const user = done.json.user as { role: string; practiceType: string; onboardingCompleted: boolean };
    assert.equal(user.practiceType, "individual");
    assert.equal(user.role, "doctor");
    assert.equal(user.onboardingCompleted, true);
    const doctors = getDb().prepare("SELECT id FROM doctors WHERE user_id = ? OR name LIKE ?").all(seeded.userId, "%Asha Rao%") as { id: string }[];
    assert.ok(doctors.length >= 1);
    const extras = getDb()
      .prepare("SELECT COUNT(*) AS c FROM doctors WHERE user_id IS NULL AND name LIKE ?")
      .get("%Roster Extra%") as { c: number };
    assert.equal(extras.c, 0);
  });

  it("polyclinic complete-onboarding promotes to CLINIC_ADMIN and persists roster doctors", async () => {
    const seeded = seedOnboardingUser("poly", "individual");
    const loginRes = await jsonRequest(port, "POST", "/api/auth/login", {
      email: seeded.email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(loginRes.status, 200, String(loginRes.json.error || "login failed"));
    const token = String(loginRes.json.token || "");
    const done = await jsonRequest(
      port,
      "POST",
      "/api/auth/complete-onboarding",
      {
        doctorName: "Dr Facility Admin",
        clinicName: "City Care Polyclinic",
        specialty: "General Medicine",
        qualification: "MBBS",
        consultationFee: 500,
        opdTiming: "09:00 AM - 06:00 PM",
        practiceType: "polyclinic",
        departments: ["General Medicine", "Pediatrics"],
        facilityCity: "Pune",
        frontDesk: { walkInEnabled: true, sharedQueue: true, tokenPrefix: "CC" },
        rosterDoctors: [
          { name: "Ananya Sen", specialty: "Pediatrics", qualification: "MD", consultationFee: 700 },
        ],
      },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(done.status, 200, String(done.json.error || "complete failed"));
    assert.equal(done.json.homeView, "welcome");
    const user = done.json.user as { role: string; practiceType: string };
    assert.equal(user.practiceType, "polyclinic");
    assert.equal(user.role, "CLINIC_ADMIN");
    const roster = getDb().prepare("SELECT name, specialty FROM doctors WHERE name LIKE ?").get("%Ananya Sen%") as {
      name: string;
      specialty: string;
    };
    assert.equal(roster.specialty, "Pediatrics");
    const tenant = getDb().prepare("SELECT specialty, practice_settings, city FROM tenants WHERE id = ?").get(seeded.tenantId) as {
      specialty: string;
      practice_settings: string;
      city: string;
    };
    assert.match(tenant.specialty, /Pediatrics/);
    assert.equal(tenant.city, "Pune");
    const settings = JSON.parse(tenant.practice_settings || "{}") as { tokenPrefix?: string; sharedQueue?: boolean };
    assert.equal(settings.tokenPrefix, "CC");
    assert.equal(settings.sharedQueue, true);
  });
});
