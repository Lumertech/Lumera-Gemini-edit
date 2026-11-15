import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { ensureImmunizationSchema } from "./immunization-schema.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";

function suffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function seedClinic(label: string) {
  const tag = suffix();
  const tenantId = `tenant-${label}-${tag}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  const user = (role: string, key: string) => {
    const userId = `user-${key}-${tag}`;
    const email = `${key}.${tag}@imm-test.example`.toLowerCase();
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 'individual', 'gp', ?, ?)`
    ).run(userId, tenantId, email, hashPassword("Lumera@2026"), `${key} ${label}`, role, `+91 90000 ${tag.slice(0, 5)}`, `Clinic ${label}`, now, now);
    return { userId, email, role };
  };
  return {
    tenantId,
    admin: user("CLINIC_ADMIN", "admin"),
    desk: user("receptionist", "desk"),
    doctor: user("doctor", "doc"),
  };
}

describe("immunization charts", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-immunization";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    ensureImmunizationSchema(getDb());
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<Record<string, string>> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || res.status));
    return { Authorization: `Bearer ${String(res.json.token)}` };
  }

  async function createChild(auth: Record<string, string>, extra: Record<string, unknown> = {}) {
    const res = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Child One",
        phone: `+91 98${Math.floor(10000000 + Math.random() * 89999999)}`,
        age: 0,
        gender: "Female",
        dateOfBirth: "2024-01-01",
        ...extra,
      },
      auth
    );
    assert.equal(res.status, 201, String(res.json.error || ""));
    return res.json.patient as { id: string; species?: string; breed?: string; ownerName?: string; dateOfBirth?: string };
  }

  it("rejects anonymous reads and a receptionist recording a dose", async () => {
    const anon = await jsonRequest(port, "GET", "/api/immunization/catalog");
    assert.equal(anon.status, 401);
    const clinic = seedClinic("guard");
    const desk = await login(clinic.desk.email);
    const doctor = await login(clinic.doctor.email);
    const child = await createChild(doctor);
    const chart = await jsonRequest(
      port,
      "GET",
      `/api/patients/${child.id}/immunization-chart?audience=pediatric&today=2024-01-01`,
      undefined,
      desk
    );
    assert.equal(chart.status, 200, String(chart.json.error || ""));
    const body = chart.json.chart as { doses: Array<{ code: string; status: string }>; safetyNotice: string; reminder: { enabled: boolean; sent: boolean } };
    assert.equal(body.doses.find((item) => item.code === "bcg")?.status, "due");
    assert.match(body.safetyNotice, /reminders only/i);
    assert.equal(body.reminder.enabled, false);
    assert.equal(body.reminder.sent, false);
    const denied = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      { occurrenceKey: "bcg", status: "given", givenOn: "2024-01-01", doctorConfirmed: true, audience: "pediatric" },
      desk
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, "ROLE_DENIED");
  });

  it("isolates tenants, requires a doctor confirmation, and audits the dose", async () => {
    const clinic = seedClinic("record");
    const other = seedClinic("other");
    const doctor = await login(clinic.doctor.email);
    const outsider = await login(other.doctor.email);
    const child = await createChild(doctor);
    const hidden = await jsonRequest(
      port,
      "GET",
      `/api/patients/${child.id}/immunization-chart?audience=pediatric`,
      undefined,
      outsider
    );
    assert.equal(hidden.status, 404);

    const unconfirmed = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      { occurrenceKey: "bcg", status: "given", givenOn: "2024-01-01", brand: "Serum", audience: "pediatric" },
      doctor
    );
    assert.equal(unconfirmed.status, 400);
    assert.match(String(unconfirmed.json.error), /confirm/i);

    const given = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      {
        occurrenceKey: "bcg",
        status: "given",
        givenOn: "2024-01-01",
        brand: "Serum BCG",
        batchNo: "HAND-1",
        givenByName: "Nurse Rao",
        doctorConfirmed: true,
        audience: "pediatric",
      },
      doctor
    );
    assert.equal(given.status, 201, String(given.json.error || ""));
    const dose = given.json.dose as { brand: string; batchNo: string; givenByName: string };
    assert.equal(dose.brand, "Serum BCG");
    assert.equal(dose.batchNo, "HAND-1");
    assert.equal(dose.givenByName, "Nurse Rao");

    const edited = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      {
        occurrenceKey: "bcg",
        status: "given",
        givenOn: "2024-01-02",
        brand: "Serum BCG",
        batchNo: "HAND-2",
        doctorConfirmed: true,
        audience: "pediatric",
      },
      doctor
    );
    assert.equal(edited.status, 201, String(edited.json.error || ""));
    const audits = getDb()
      .prepare(
        `SELECT action FROM audit_logs WHERE tenant_id = ? AND patient_id = ? AND action LIKE 'Immunization dose%' ORDER BY timestamp ASC`
      )
      .all(clinic.tenantId, child.id) as { action: string }[];
    assert.deepEqual(
      audits.map((row) => row.action),
      ["Immunization dose recorded", "Immunization dose edited"]
    );

    const skipped = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      { occurrenceKey: "opv-0", status: "skipped", doctorConfirmed: true, audience: "pediatric" },
      doctor
    );
    assert.equal(skipped.status, 400);
    const withReason = await jsonRequest(
      port,
      "POST",
      `/api/patients/${child.id}/immunization-doses`,
      {
        occurrenceKey: "opv-0",
        status: "contraindicated",
        reason: "Immunodeficiency",
        doctorConfirmed: true,
        audience: "pediatric",
      },
      doctor
    );
    assert.equal(withReason.status, 201, String(withReason.json.error || ""));

    const chart = await jsonRequest(
      port,
      "GET",
      `/api/patients/${child.id}/immunization-chart?audience=pediatric&today=2024-06-01`,
      undefined,
      doctor
    );
    const doses = (chart.json.chart as { doses: Array<{ code: string; status: string; batchNo: string; reason: string }> }).doses;
    assert.equal(doses.find((item) => item.code === "bcg")?.status, "given");
    assert.equal(doses.find((item) => item.code === "bcg")?.batchNo, "HAND-2");
    assert.equal(doses.find((item) => item.code === "opv-0")?.status, "contraindicated");
    assert.equal(doses.find((item) => item.code === "opv-0")?.reason, "Immunodeficiency");

    const timeline = await jsonRequest(port, "GET", `/api/patients/${child.id}/chart`, undefined, doctor);
    const items = (timeline.json.timeline || []) as Array<{ type: string; title: string; summary: string }>;
    const shot = items.find((item) => item.type === "immunization" && item.title.includes("BCG"));
    assert.ok(shot, JSON.stringify(items.map((item) => item.title)));
    assert.match(shot.summary, /HAND-2/);
  });

  it("lets the doctor switch to UIP and mark JE endemic without leaving the tenant", async () => {
    const clinic = seedClinic("uip");
    const doctor = await login(clinic.doctor.email);
    const desk = await login(clinic.desk.email);
    const child = await createChild(doctor);
    const denied = await jsonRequest(
      port,
      "PUT",
      "/api/immunization/settings",
      { pediatricScheduleId: "pediatric_uip", endemicJe: true, includeOptional: true, edits: [] },
      desk
    );
    assert.equal(denied.status, 403);
    const saved = await jsonRequest(
      port,
      "PUT",
      "/api/immunization/settings",
      {
        pediatricScheduleId: "pediatric_uip",
        endemicJe: true,
        includeOptional: true,
        edits: [{ scheduleId: "pediatric_uip", code: "bcg", dueAgeDays: 2 }],
      },
      doctor
    );
    assert.equal(saved.status, 200, String(saved.json.error || ""));
    const settings = saved.json.settings as { pediatricScheduleId: string; endemicJe: boolean };
    assert.equal(settings.pediatricScheduleId, "pediatric_uip");
    assert.equal(settings.endemicJe, true);
    const audit = getDb()
      .prepare("SELECT action FROM audit_logs WHERE tenant_id = ? AND action = ?")
      .get(clinic.tenantId, "Immunization schedule edited") as { action: string } | undefined;
    assert.equal(audit?.action, "Immunization schedule edited");

    const chart = await jsonRequest(
      port,
      "GET",
      `/api/patients/${child.id}/immunization-chart?audience=pediatric&today=2024-01-01`,
      undefined,
      doctor
    );
    const payload = chart.json.chart as {
      schedule: { id: string };
      doses: Array<{ code: string; antigen: string; status: string; dueOn: string }>;
    };
    assert.equal(payload.schedule.id, "pediatric_uip");
    assert.equal(payload.doses.some((item) => item.antigen.startsWith("Pentavalent")), true);
    assert.equal(payload.doses.some((item) => item.antigen === "HPV"), false);
    assert.equal(payload.doses.some((item) => item.code === "je-1"), true);
    assert.equal(payload.doses.find((item) => item.code === "bcg")?.status, "upcoming");
    assert.equal(payload.doses.find((item) => item.code === "bcg")?.dueOn, "2024-01-03");

    const other = seedClinic("uip-other");
    const outsider = await login(other.doctor.email);
    const foreign = await jsonRequest(port, "GET", "/api/immunization/settings", undefined, outsider);
    const foreignSettings = foreign.json.settings as { pediatricScheduleId: string };
    assert.equal(foreignSettings.pediatricScheduleId, "pediatric_iap");
  });

  it("charts a dog from date of birth and links a stock dose so inventory decrements once", async () => {
    const clinic = seedClinic("vet");
    const admin = await login(clinic.admin.email);
    const doctor = await login(clinic.doctor.email);
    const pet = await createChild(doctor, {
      name: "Moti",
      species: "Dog",
      breed: "Indie",
      ownerName: "Ravi Shah",
      gender: "Male",
    });
    assert.equal(pet.species, "dog");
    assert.equal(pet.breed, "Indie");
    assert.equal(pet.ownerName, "Ravi Shah");
    assert.equal(pet.dateOfBirth, "2024-01-01");

    const chart = await jsonRequest(
      port,
      "GET",
      `/api/patients/${pet.id}/immunization-chart?audience=auto&today=2024-04-01`,
      undefined,
      doctor
    );
    const body = chart.json.chart as { schedule: { id: string }; doses: Array<{ code: string; status: string }> };
    assert.equal(body.schedule.id, "canine");
    assert.equal(body.doses.find((item) => item.code === "dhppil-1")?.status, "overdue");
    assert.equal(body.doses.find((item) => item.code === "rabies-1")?.status, "due");
    assert.equal(body.doses.some((item) => item.code === "deworm-puppy"), true);

    const vendor = await jsonRequest(port, "POST", "/api/accounts/vendors", { name: "Vet Biologicals" }, admin);
    assert.equal(vendor.status, 201, String(vendor.json.error || ""));
    const vendorId = (vendor.json.vendor as { id: string }).id;
    const itemRes = await jsonRequest(
      port,
      "POST",
      "/api/accounts/items",
      { name: "Anti-rabies", kind: "vaccine", gstPercent: 5, reorderLevel: 1, sellPrice: 200, unit: "vial" },
      admin
    );
    assert.equal(itemRes.status, 201, String(itemRes.json.error || ""));
    const itemId = (itemRes.json.item as { id: string }).id;
    const lock = await jsonRequest(
      port,
      "POST",
      "/api/accounts/price-locks",
      { vendorId, itemId, agreedRate: 100 },
      admin
    );
    assert.equal(lock.status, 201, String(lock.json.error || ""));
    const today = clinicCalendarDate(new Date(), "IST (UTC+5:30)");
    const expiry = shiftIsoDate(today, 200);
    const stocked = await jsonRequest(
      port,
      "POST",
      "/api/accounts/stock-in",
      { itemId, vendorId, batchNo: "ARV-9", expiryDate: expiry, qty: 2, unitCost: 100 },
      admin
    );
    assert.equal(stocked.status, 201, String(stocked.json.error || ""));
    const batchId = (stocked.json.batch as { id: string }).id;

    const linked = await jsonRequest(
      port,
      "POST",
      `/api/patients/${pet.id}/immunization-doses`,
      {
        occurrenceKey: "rabies-1",
        status: "given",
        givenOn: "2024-03-25",
        doctorConfirmed: true,
        audience: "veterinary",
        stockItemId: itemId,
        stockBatchId: batchId,
      },
      doctor
    );
    assert.equal(linked.status, 201, String(linked.json.error || ""));
    const recorded = linked.json.dose as { batchNo: string; stockAdministrationId: string; brand: string };
    assert.equal(recorded.batchNo, "ARV-9");
    assert.equal(recorded.brand, "Anti-rabies");
    assert.ok(recorded.stockAdministrationId);

    const stock = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, admin);
    const batches = stock.json.batches as { id: string; qty: number }[];
    assert.equal(batches.find((batch) => batch.id === batchId)?.qty, 1);

    const corrected = await jsonRequest(
      port,
      "POST",
      `/api/patients/${pet.id}/immunization-doses`,
      {
        occurrenceKey: "rabies-1",
        status: "given",
        givenOn: "2024-03-26",
        brand: "Anti-rabies",
        batchNo: "ARV-9",
        doctorConfirmed: true,
        audience: "veterinary",
      },
      doctor
    );
    assert.equal(corrected.status, 201, String(corrected.json.error || ""));
    const kept = corrected.json.dose as { stockAdministrationId: string; givenOn: string };
    assert.equal(kept.stockAdministrationId, recorded.stockAdministrationId);
    assert.equal(kept.givenOn, "2024-03-26");

    const secondVial = await jsonRequest(
      port,
      "POST",
      `/api/patients/${pet.id}/immunization-doses`,
      {
        occurrenceKey: "rabies-1",
        status: "given",
        givenOn: "2024-03-26",
        doctorConfirmed: true,
        audience: "veterinary",
        stockItemId: itemId,
        stockBatchId: batchId,
      },
      doctor
    );
    assert.equal(secondVial.status, 400);
    assert.match(String(secondVial.json.error), /already linked/i);
    const stockHeld = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, admin);
    const held = (stockHeld.json.batches as { id: string; qty: number }[]).find((batch) => batch.id === batchId);
    assert.equal(held?.qty, 1);

    const again = await jsonRequest(
      port,
      "POST",
      `/api/patients/${pet.id}/immunization-doses`,
      {
        occurrenceKey: "rabies-2",
        status: "given",
        givenOn: "2024-04-01",
        doctorConfirmed: true,
        audience: "veterinary",
        stockAdministrationId: recorded.stockAdministrationId,
      },
      doctor
    );
    assert.equal(again.status, 201, String(again.json.error || ""));
    const stockAfter = await jsonRequest(port, "GET", "/api/accounts/stock", undefined, admin);
    const after = (stockAfter.json.batches as { id: string; qty: number }[]).find((batch) => batch.id === batchId);
    assert.equal(after?.qty, 1);

    const catless = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${pet.id}`,
      { species: "rabbit" },
      doctor
    );
    assert.equal(catless.status, 200, String(catless.json.error || ""));
    const otherSpecies = await jsonRequest(
      port,
      "GET",
      `/api/patients/${pet.id}/immunization-chart?audience=veterinary`,
      undefined,
      doctor
    );
    const empty = otherSpecies.json.chart as { applicable: boolean; message: string };
    assert.equal(empty.applicable, false);
    assert.match(empty.message, /No published schedule/);
  });
});
