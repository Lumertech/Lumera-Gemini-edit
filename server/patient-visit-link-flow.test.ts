import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import { saveClinicScheduleSettings } from "./clinic-schedule.ts";
import { clinicCalendarDate } from "../src/lib/clinicDay.ts";
import { describeLiveQueue } from "./patient-queue-status.ts";
import {
  deliverSignedVisitSummary,
  isPatientWhatsAppTestRecipient,
  notifyTurnNearForDoctor,
  patientGraphDeliveryAllowed,
  queueAskMessageForAppointment,
} from "./patient-visit-delivery.ts";
import { choosePatientOutbound } from "./patient-visit-messages.ts";
import { PATIENT_WHATSAPP_TEMPLATES } from "./patient-whatsapp-templates.ts";
import { mintPatientVisitLink, patientLinkUrl } from "./patient-visit-token.ts";
import { mountPatientVisitRoutes } from "./patient-visit-routes.ts";
import { startTestServer } from "./test-http.ts";
import { processBotActionOrQuery } from "./whatsapp.ts";
import { AMBIENT_WALKIN_SOURCE } from "./ambient-walkin.ts";

describe("patient visit link, live queue, and records", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-patient-visit";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      mountPatientVisitRoutes(app);
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  function suffix(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function localPhone(): string {
    const tail = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;
    return `+919${tail.slice(-9)}`;
  }

  function seedClinic(label: string, name: string) {
    const id = `tenant-visit-${label}-${suffix()}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(id, name, now, now, now);
    saveClinicScheduleSettings(getDb(), id, {
      opdStartTime: "12:00 AM",
      opdEndTime: "11:59 PM",
      slotDurationMinutes: 15,
    });
    return id;
  }

  function seedPatient(tenantId: string, name: string, phone: string) {
    const id = `pat-${suffix()}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, ?, 6, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?)`
      )
      .run(id, tenantId, `UHID-${id}`, name, phone, now);
    return id;
  }

  function seedVisit(input: {
    tenantId: string;
    patientId: string;
    name: string;
    phone: string;
    doctorId: string;
    doctorName: string;
    token: number;
    status: string;
    fee?: number;
    source?: string;
    date?: string;
  }) {
    const id = `apt-${suffix()}`;
    const date = input.date || clinicCalendarDate(new Date(), "IST (UTC+5:30)");
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paediatrics', ?, '10:00 AM', 'New Consultation', ?, ?, ?, 1, ?)`
      )
      .run(
        id,
        input.tenantId,
        input.token,
        input.patientId,
        input.name,
        input.phone,
        `UHID-${input.patientId}`,
        input.doctorId,
        input.doctorName,
        date,
        input.status,
        input.source || "Front Desk",
        input.fee ?? 0,
        new Date().toISOString()
      );
    return { id, date };
  }

  it("keeps new patient templates as definitions with clinic and doctor variables", () => {
    assert.equal(PATIENT_WHATSAPP_TEMPLATES.length >= 2, true);
    for (const template of PATIENT_WHATSAPP_TEMPLATES) {
      assert.equal(template.status, "NOT_SUBMITTED");
      assert.equal(template.variables[0], "clinic_name");
      assert.equal(template.variables[1], "doctor_name");
      assert.match(template.body, /\{\{1\}\}/);
      assert.match(template.body, /\{\{2\}\}/);
      assert.equal(/lumera/i.test(template.body + template.footer + template.name), false);
    }
    assert.equal(choosePatientOutbound(true, null), "freeform");
    assert.equal(choosePatientOutbound(false, null), "template_pending");
    assert.equal(choosePatientOutbound(false, "clinic_queue_turn_near"), "template");
  });

  it("counts the live token inside one clinic and skips hidden walk-ins", () => {
    const tenantId = seedClinic("queue", "City Clinic");
    const other = seedClinic("other", "Other Clinic");
    const doctorId = `doc-${suffix()}`;
    const date = clinicCalendarDate(new Date(), "IST (UTC+5:30)");
    const phone = localPhone();
    const patientId = seedPatient(tenantId, "Asha Rao", phone);
    seedVisit({
      tenantId,
      patientId,
      name: "Asha Rao",
      phone,
      doctorId,
      doctorName: "Dr Rao",
      token: 1,
      status: "In Consultation",
      date,
    });
    const meeraPhone = localPhone();
    const waiting = seedVisit({
      tenantId,
      patientId: seedPatient(tenantId, "Meera Rao", meeraPhone),
      name: "Meera Rao",
      phone: meeraPhone,
      doctorId,
      doctorName: "Dr Rao",
      token: 3,
      status: "Waiting",
      date,
    });
    const hiddenPhone = localPhone();
    seedVisit({
      tenantId,
      patientId: seedPatient(tenantId, "Hidden Walk", hiddenPhone),
      name: "Hidden Walk",
      phone: hiddenPhone,
      doctorId,
      doctorName: "Dr Rao",
      token: 2,
      status: "Waiting",
      source: AMBIENT_WALKIN_SOURCE,
      date,
    });
    const otherPhone = localPhone();
    seedVisit({
      tenantId: other,
      patientId: seedPatient(other, "Other Child", otherPhone),
      name: "Other Child",
      phone: otherPhone,
      doctorId,
      doctorName: "Dr Rao",
      token: 1,
      status: "Waiting",
      date,
    });
    const snapshot = describeLiveQueue(getDb(), {
      tenantId,
      doctorId,
      doctorName: "Dr Rao",
      date,
      tokenNumber: 3,
      status: "Waiting",
      appointmentId: waiting.id,
    });
    assert.equal(snapshot.currentToken, 1);
    assert.equal(snapshot.peopleAhead, 1);
    assert.equal(snapshot.clinicOpen, true);
    assert.equal(snapshot.etaMinutes, 15);
    assert.equal(snapshot.clinicName, "City Clinic");
    assert.equal(snapshot.doctorName, "Dr Rao");
  });

  it("shows queue without a login and opens records only after the WhatsApp code", async () => {
    const tenantId = seedClinic("link", "City Clinic");
    const other = seedClinic("link-b", "Other Clinic");
    const doctorId = `doc-${suffix()}`;
    const phone = localPhone();
    const name = "Secret Patient";
    const patientId = seedPatient(tenantId, name, phone);
    const visit = seedVisit({
      tenantId,
      patientId,
      name,
      phone,
      doctorId,
      doctorName: "Dr Rao",
      token: 4,
      status: "Waiting",
      fee: 123456,
    });
    seedVisit({
      tenantId,
      patientId,
      name,
      phone,
      doctorId,
      doctorName: "Dr Rao",
      token: 2,
      status: "In Consultation",
    });
    const rxId = `rx-${suffix()}`;
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, follow_up_date, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Dr Rao', 'Paediatrics', 'REG-1', ?, 'Private diagnosis',
           ?, '[]', '["Rest"]', '', ?)`
      )
      .run(
        rxId,
        tenantId,
        `RX-${suffix()}`,
        patientId,
        name,
        phone,
        `UHID-${patientId}`,
        doctorId,
        visit.date,
        JSON.stringify([{ drugName: "Paracetamol", dosage: "250 mg", frequency: "1-0-1", timing: "After Food", instructions: "with water" }]),
        new Date().toISOString()
      );
    const otherPatient = seedPatient(other, "Other Patient", localPhone());
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
           medicines, lab_tests, advice, created_at
         ) VALUES (?, ?, ?, ?, 'Other Patient', ?, 'UHID-OTHER', ?, 'Dr Other', 'GP', 'REG-2', ?, 'Should not leak', '[]', '[]', '[]', ?)`
      )
      .run(
        `rx-other-${suffix()}`,
        other,
        `RX-OTHER-${suffix()}`,
        otherPatient,
        localPhone(),
        doctorId,
        visit.date,
        new Date().toISOString()
      );
    getDb()
      .prepare(
        `INSERT INTO patient_documents (
           id, tenant_id, patient_id, title, doc_type, document_date, mime_type, storage_key, created_at
         ) VALUES (?, ?, ?, 'CBC report', 'lab_report', ?, 'application/pdf', 'missing-key', ?)`
      )
      .run(`doc-${suffix()}`, tenantId, patientId, visit.date, new Date().toISOString());

    const minted = mintPatientVisitLink(getDb(), {
      tenantId,
      patientId,
      appointmentId: visit.id,
      phone,
    });
    assert.ok(minted);
    const url = patientLinkUrl(minted!.id, { APP_URL: "https://clinic.example" });
    assert.equal(url.includes(name), false);
    assert.equal(url.includes(phone.replace(/\D/g, "")), false);
    assert.equal(url.includes(minted!.otp), false);
    assert.equal(url.includes("diagnosis"), false);
    assert.match(url, /\/v\/[A-Za-z0-9_-]+$/);

    const page = await fetch(`http://127.0.0.1:${port}${minted!.path}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /overflow-x:\s*hidden/);
    assert.match(html, /overflow-y:\s*auto/);
    assert.match(html, /Your token/);
    assert.match(html, /Now serving/);
    assert.match(html, /People ahead/);
    assert.match(html, /City Clinic/);
    assert.match(html, /Dr Rao/);
    assert.equal(html.includes(name), false);
    assert.equal(html.includes("Private diagnosis"), false);
    assert.equal(html.includes(phone), false);

    const live = await fetch(`http://127.0.0.1:${port}/api/public/visit/${minted!.id}`);
    const liveJson = (await live.json()) as { queue: { peopleAhead: number; clinicOpen: boolean; currentToken: number } };
    assert.equal(live.status, 200);
    assert.equal(liveJson.queue.currentToken, 2);
    assert.equal(liveJson.queue.peopleAhead, 1);
    assert.equal(liveJson.queue.clinicOpen, true);
    assert.equal(JSON.stringify(liveJson).includes(name), false);
    assert.equal(JSON.stringify(liveJson).includes("Private diagnosis"), false);

    const locked = await fetch(`http://127.0.0.1:${port}/api/public/visit/${minted!.id}/records`);
    assert.equal(locked.status, 401);

    const bad = await fetch(`http://127.0.0.1:${port}${minted!.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "otp=000000",
    });
    assert.equal(bad.status, 401);
    assert.match(await bad.text(), /not accepted/);

    const opened = await fetch(`http://127.0.0.1:${port}${minted!.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `otp=${minted!.otp}`,
    });
    const openedHtml = await opened.text();
    assert.equal(opened.status, 200);
    assert.match(openedHtml, /Secret Patient/);
    assert.match(openedHtml, /Private diagnosis/);
    assert.match(openedHtml, /Paracetamol/);
    assert.match(openedHtml, /₹1,23,456\.00/);
    assert.equal(openedHtml.includes("Should not leak"), false);
    assert.equal(openedHtml.includes("RX-OTHER-"), false);
    assert.match(openedHtml, /CBC report/);
    const cookie = opened.headers.get("set-cookie") || "";
    assert.match(cookie, /pv=/);

    const records = await fetch(`http://127.0.0.1:${port}/api/public/visit/${minted!.id}/records`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    const chart = (await records.json()) as { chart: { prescriptions: Array<{ diagnosis: string }> } };
    assert.equal(records.status, 200);
    assert.equal(chart.chart.prescriptions.some((rx) => rx.diagnosis === "Private diagnosis"), true);
    assert.equal(chart.chart.prescriptions.some((rx) => rx.diagnosis === "Should not leak"), false);

    const removed = await fetch(`http://127.0.0.1:${port}/api/public/visit/${minted!.id}/documents/doc-x`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 405);
    const stillThere = getDb()
      .prepare("SELECT id FROM patient_documents WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL")
      .get(tenantId, patientId) as { id: string };
    assert.ok(stillThere.id);

    getDb().prepare("UPDATE patient_visit_links SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", minted!.id);
    const expired = await fetch(`http://127.0.0.1:${port}${minted!.path}`);
    assert.equal(expired.status, 410);
    assert.match(await expired.text(), /expired/i);
  });

  it("answers a WhatsApp queue question and sends a turn-near note without calling Graph", async () => {
    const tenantId = seedClinic("wa", "City Clinic");
    const doctorId = `doc-${suffix()}`;
    const date = clinicCalendarDate(new Date(), "IST (UTC+5:30)");
    const phones = [0, 1, 2, 3].map(() => localPhone());
    const statuses = ["In Consultation", "Waiting", "Waiting", "Waiting"] as const;
    phones.forEach((phone, index) => {
      const patientId = seedPatient(tenantId, `Child ${index}`, phone);
      seedVisit({
        tenantId,
        patientId,
        name: `Child ${index}`,
        phone,
        doctorId,
        doctorName: "Dr Rao",
        token: index + 1,
        status: statuses[index],
        date,
      });
    });
    const previousAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://clinic.example";
    let ask: Awaited<ReturnType<typeof processBotActionOrQuery>>;
    try {
      ask = await processBotActionOrQuery("my token", phones[1], "Child 1", {}, getDb(), { tenantId });
    } finally {
      if (previousAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousAppUrl;
    }
    assert.ok(ask);
    assert.match(ask.content, /City Clinic/);
    assert.match(ask.content, /Dr Rao/);
    assert.match(ask.content, /Your token/);
    assert.match(ask.content, /Now serving/);
    assert.match(ask.content, /People ahead/);
    assert.match(ask.content, /Clinic:/);
    assert.match(ask.content, /\/v\//);
    assert.equal(/lumera/i.test(ask.content), false);

    const now = new Date().toISOString();
    for (const phone of [phones[1], phones[2]]) {
      getDb()
        .prepare(
          `INSERT INTO whatsapp_conversations (
             id, tenant_id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
             unread_count, last_message, last_message_time, updated_at, last_inbound_at
           ) VALUES (?, ?, ?, 'Child', 'bot', 'Unassigned', '[]', 'en', 0, 'token', ?, ?, ?)`
        )
        .run(`conv-${suffix()}`, tenantId, phone, now, now, now);
    }
    const calls: string[] = [];
    const notified = await notifyTurnNearForDoctor(
      getDb(),
      { tenantId, doctorId, date },
      process.env,
      async () => {
        calls.push("graph");
        return new Response("{}", { status: 500 });
      }
    );
    assert.equal(calls.length, 0);
    assert.equal(notified.length, 2);
    assert.equal(notified.every((row) => row.status === "recorded" && row.mode === "freeform"), true);
    const again = await notifyTurnNearForDoctor(getDb(), { tenantId, doctorId, date });
    assert.equal(again.length, 0);
  });

  it("holds the visit summary for a template when the 24h window is closed", async () => {
    const tenantId = seedClinic("rx", "City Clinic");
    const phone = localPhone();
    const patientId = seedPatient(tenantId, "Asha Rao", phone);
    const pending = await deliverSignedVisitSummary(getDb(), {
      tenantId,
      patientId,
      patientPhone: phone,
      patientName: "Asha Rao",
      doctorName: "Dr Rao",
      rxNumber: "RX-LOCAL-1",
      rxId: `rx-${suffix()}`,
    });
    assert.equal(pending.status, "template_pending");
    assert.equal(pending.templateName, "clinic_visit_summary");
    const stored = getDb()
      .prepare("SELECT status, details, action_payload FROM whatsapp_outbound_events WHERE id = ?")
      .get(pending.eventId) as { status: string; details: string; action_payload: string };
    assert.equal(stored.status, "template_pending");
    assert.match(stored.details, /City Clinic/);
    assert.match(stored.details, /Dr Rao/);
    assert.equal(/approved/i.test(stored.details), false);
    assert.equal(/lumera/i.test(stored.details), false);

    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO whatsapp_conversations (
           id, tenant_id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
           unread_count, last_message, last_message_time, updated_at, last_inbound_at
         ) VALUES (?, ?, ?, 'Asha Rao', 'bot', 'Unassigned', '[]', 'en', 0, 'token', ?, ?, ?)`
      )
      .run(`conv-${suffix()}`, tenantId, phone, now, now, now);
    const open = await deliverSignedVisitSummary(getDb(), {
      tenantId,
      patientId,
      patientPhone: phone,
      patientName: "Asha Rao",
      doctorName: "Dr Rao",
      rxNumber: "RX-LOCAL-2",
      rxId: `rx-${suffix()}`,
    });
    assert.equal(open.mode, "freeform");
    assert.equal(open.status, "recorded");
  });

  it("allows a live test send only to the designated handset", () => {
    const env = { ...process.env, PATIENT_WA_DELIVER: "1", NODE_ENV: "test" } as NodeJS.ProcessEnv;
    assert.equal(isPatientWhatsAppTestRecipient("+91 99999 73271"), true);
    assert.equal(patientGraphDeliveryAllowed("+919999973271", env), true);
    assert.equal(patientGraphDeliveryAllowed("+919800011122", env), false);
    assert.equal(patientGraphDeliveryAllowed("+919800011122", process.env), false);
  });

  it("builds a queue reply that carries the secure link", () => {
    const tenantId = seedClinic("ask", "City Clinic");
    const phone = localPhone();
    const patientId = seedPatient(tenantId, "Asha Rao", phone);
    const doctorId = `doc-${suffix()}`;
    const visit = seedVisit({
      tenantId,
      patientId,
      name: "Asha Rao",
      phone,
      doctorId,
      doctorName: "Dr Rao",
      token: 8,
      status: "Waiting",
    });
    const text = queueAskMessageForAppointment(
      getDb(),
      tenantId,
      {
        id: visit.id,
        patient_id: patientId,
        doctor_id: doctorId,
        doctor_name: "Dr Rao",
        date: visit.date,
        token_number: 8,
        status: "Waiting",
      },
      phone,
      { ...process.env, APP_URL: "https://clinic.example" }
    );
    assert.ok(text);
    assert.match(text!, /https:\/\/clinic\.example\/v\//);
    assert.match(text!, /Code:/);
    assert.equal(text!.includes(phone), false);
    assert.equal(/lumera/i.test(text!), false);
  });
});
