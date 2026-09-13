import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { findDoctor, resolveWhatsAppTenant, resolveWhatsAppTenantId } from "./whatsapp-tenant-resolve.ts";
import { getTenantWabaNumber, upsertWhatsAppNumber, platformAdminActor } from "./whatsapp-numbers.ts";

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

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  const n = `${Date.now()}${phoneSeq}${Math.floor(Math.random() * 900 + 100)}`.replace(/\D/g, "").slice(-10);
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

function seedClinic(label: string, role: "CLINIC_ADMIN" | "doctor" = "CLINIC_ADMIN") {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-waba-${label}-${suffix}`;
  const userId = `user-waba-${label}-${suffix}`;
  const doctorId = `doc-waba-${label}-${suffix}`;
  const email = `${label}.${suffix}@waba-test.example`.toLowerCase();
  const phone = uniquePhone();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', ?, ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `WABA Clinic ${label}`, phone, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'polyclinic', 'General Medicine', ?, ?)`
  ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `User ${label}`, role, phone, `WABA Clinic ${label}`, now, now);
  if (role === "doctor") {
    db.prepare(
      `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active)
       VALUES (?, ?, ?, 'MBBS', ?, 'General Medicine', 8, 500, 'OPD-1', '["Mon"]', '09:00 AM - 01:00 PM', ?, ?, '', '', '', 1)`
    ).run(doctorId, userId, `Dr ${label}`, `REG-${suffix}`, phone, email);
  }
  return { tenantId, userId, doctorId, email, phone };
}

describe("WABA two-tier inbound routing", () => {
  before(() => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-waba-two-tier";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    bootWhatsAppOwnershipSchema();
  });

  it("resolveWhatsAppTenantId routes a single-affiliation doctor number and refuses to guess on multi-affiliation", () => {
    const clinicA = seedClinic("route-a", "doctor");
    const clinicB = seedClinic("route-b");
    const adminPhone = uniquePhone();
    const pracId = `prac-route-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare("INSERT INTO practitioners (id, name, phone, created_at) VALUES (?, ?, ?, ?)")
      .run(pracId, "Dr Route", adminPhone.replace(/\D/g, "").slice(-10), now);
    getDb().prepare("UPDATE doctors SET practitioner_id = ? WHERE id = ?").run(pracId, clinicA.doctorId);

    const phoneNumberId = `phone_route_${pracId.slice(-8)}`;
    upsertWhatsAppNumber(platformAdminActor(), {
      ownerType: "doctor",
      ownerId: pracId,
      wabaId: `waba_route_${pracId.slice(-8)}`,
      phoneNumberId,
      metaWabaName: "Doctor route WABA",
      metaAccessToken: "EAAJ...sandbox",
      status: "connected",
      connectedVia: "master_admin",
    });

    const single = resolveWhatsAppTenant({ phoneNumberId });
    assert.equal(single.status, "resolved");
    if (single.status === "resolved") assert.equal(single.tenantId, clinicA.tenantId);
    assert.equal(resolveWhatsAppTenantId({ phoneNumberId }), clinicA.tenantId);

    const secondUserId = `user-route-b-${Date.now().toString(36)}`;
    const secondDoctorId = `doc-route-b-${Date.now().toString(36)}`;
    getDb()
      .prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
         VALUES (?, ?, ?, ?, 'Dr Route', 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
      )
      .run(
        secondUserId,
        clinicB.tenantId,
        `route.b.${Date.now()}@waba-test.example`,
        hashPassword("Lumera@2026"),
        adminPhone,
        `Clinic B`,
        now,
        now
      );
    getDb()
      .prepare(
        `INSERT INTO doctors (id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee, opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, practitioner_id, active)
         VALUES (?, ?, 'Dr Route', 'MBBS', 'REG-B', 'General Medicine', 8, 500, 'OPD-1', '[]', '', ?, ?, '', '', '', ?, 1)`
      )
      .run(secondDoctorId, secondUserId, adminPhone, `route.b@waba-test.example`, pracId);

    const multi = resolveWhatsAppTenant({ phoneNumberId, patientPhone: uniquePhone() });
    assert.equal(multi.status, "ambiguous_clinic");
    if (multi.status === "ambiguous_clinic") {
      assert.equal(multi.code, "AMBIGUOUS_CLINIC_SELECTION");
      assert.equal(multi.clinics.length >= 2, true);
    }
    assert.equal(resolveWhatsAppTenantId({ phoneNumberId, patientPhone: uniquePhone() }), null);

    const knownPhone = uniquePhone();
    const patientId = `pat-route-${Date.now().toString(36)}`;
    getDb()
      .prepare(
        `INSERT INTO patients (id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions, emergency_contact, created_at)
         VALUES (?, ?, ?, 'Known Patient', 40, 'Female', ?, '', '', '[]', '[]', '', ?)`
      )
      .run(patientId, clinicA.tenantId, `UHID-${patientId.slice(-8)}`, knownPhone, now);
    getDb()
      .prepare(
        `INSERT INTO appointments (id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name, specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at)
         VALUES (?, ?, 1, ?, 'Known Patient', ?, 'UHID', ?, 'Dr Route', 'General Medicine', ?, '10:00 AM', 'Follow-up', 'Completed', 'WhatsApp Bot', 500, 1, ?)`
      )
      .run(`apt-route-${Date.now().toString(36)}`, clinicA.tenantId, patientId, knownPhone, clinicA.doctorId, now.slice(0, 10), now);
    const fromHistory = resolveWhatsAppTenant({ phoneNumberId, patientPhone: knownPhone });
    assert.equal(fromHistory.status, "resolved");
    if (fromHistory.status === "resolved") assert.equal(fromHistory.tenantId, clinicA.tenantId);
  });

  it("findDoctor lookups are scoped to the resolved tenant", () => {
    const a = seedClinic("find-a", "doctor");
    const b = seedClinic("find-b", "doctor");
    getDb().prepare("UPDATE doctors SET name = ? WHERE id = ?").run("Dr Shared Name Rao", a.doctorId);
    getDb().prepare("UPDATE doctors SET name = ? WHERE id = ?").run("Dr Shared Name Rao", b.doctorId);

    const fromA = findDoctor({ tenantId: a.tenantId, doctorName: "Shared Name Rao" });
    assert.equal(String(fromA?.id || ""), a.doctorId);

    const crossId = findDoctor({ tenantId: a.tenantId, doctorId: b.doctorId });
    assert.notEqual(String(crossId?.id || ""), b.doctorId);

    const byBIdInA = findDoctor({ tenantId: a.tenantId, doctorId: b.doctorId, doctorName: "no-such" });
    assert.ok(!byBIdInA || String(byBIdInA.id) === a.doctorId);
  });
});
