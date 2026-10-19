import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { getDb, initDatabase } from "./db.ts";
import {
  applyMessageTemplateStatusUpdate,
  clinicTemplatesToProvision,
  provisionClinicMessageTemplates,
  TEMPLATE_NOT_APPROVED_ERROR,
} from "./clinic-whatsapp-templates.ts";
import { sendAppointmentReminder, sendPaymentReceipt } from "./graph-whatsapp.ts";
import { dispatchSignedRxCloudMessage } from "./whatsapp-rx-bind.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";
import { createMetaRouter } from "./meta.ts";
import { platformAdminActor, upsertWhatsAppNumber } from "./whatsapp-numbers.ts";
import { getTenantConversation, listTenantConversations } from "./whatsapp-scope.ts";

const ENV_TOKEN = "EAAEnvLumeraPlatformTokenWithoutEllipsis0123456789abcdef";
const RUN = `${Date.now()}`.slice(-8);
const ENV_PHONE = `15551${RUN}`;
const A_TOKEN = "EAAClinicAOwnWabaTokenWithoutEllipsis0123456789abcdef";
const A_PHONE = `15552${RUN}`;
const A_WABA = `20481${RUN}`;
const B_WABA = `20482${RUN}`;

function insertTenant(id: string, name: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '', ?, 500, 0, 1, '', ?, ?)`
    )
    .run(id, name, now, now, now);
}

function approve(tenantId: string, name: string, wabaId: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO meta_templates (id, tenant_id, waba_id, name, category, language, status, components, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'UTILITY', 'en', 'APPROVED', '[]', ?, ?)`
    )
    .run(`tpl-${tenantId}-${name}`, tenantId, wabaId, name, now, now);
}

describe("two-tenant clinic WhatsApp Graph path", () => {
  const saved = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_REMINDER_TEMPLATE_NAME: process.env.META_REMINDER_TEMPLATE_NAME,
    META_RECEIPT_TEMPLATE_NAME: process.env.META_RECEIPT_TEMPLATE_NAME,
    META_UTILITY_TEMPLATE_LANGUAGE: process.env.META_UTILITY_TEMPLATE_LANGUAGE,
    META_APP_SECRET: process.env.META_APP_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  let server: Server | undefined;
  let port = 0;
  const secret = "two-tenant-webhook-secret";
  const tenantA = `tenant-clinic-a-${crypto.randomUUID().slice(0, 8)}`;
  const tenantB = `tenant-demo-b-${crypto.randomUUID().slice(0, 8)}`;

  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    process.env.META_PHONE_NUMBER_ID = ENV_PHONE;
    process.env.META_REMINDER_TEMPLATE_NAME = "lumera_appointment_reminder";
    process.env.META_RECEIPT_TEMPLATE_NAME = "lumera_payment_receipt_v2";
    process.env.META_UTILITY_TEMPLATE_LANGUAGE = "en";
    process.env.META_APP_SECRET = secret;
    try {
      getDb();
    } catch {
      initDatabase();
    }
    insertTenant(tenantA, "Sunrise Clinic");
    insertTenant(tenantB, "Lumera Sandbox Demo");
    upsertWhatsAppNumber(platformAdminActor(), {
      ownerType: "tenant",
      ownerId: tenantA,
      wabaId: A_WABA,
      phoneNumberId: A_PHONE,
      metaAccessToken: A_TOKEN,
      metaWabaName: "Sunrise Clinic",
      status: "connected",
    });
    getDb().prepare(`UPDATE tenants SET phone_number_id = ?, waba_id = ? WHERE id = ?`).run(ENV_PHONE, B_WABA, tenantB);

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as express.Request).rawBody = buf;
        },
      })
    );
    app.use("/api/meta", createMetaRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    port = addr.port;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function sign(body: string): string {
    return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  it("sends on each tenant's line, provisions templates, routes inbound, and gates approval", async () => {
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      if (url.includes("/messages")) calls.push({ url, auth, body });
      if (url.includes("/message_templates") && String(init?.method || "GET").toUpperCase() === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "meta-reminder",
                name: "clinic_appointment_reminder",
                status: "APPROVED",
                language: "en",
                category: "UTILITY",
                rejected_reason: "NONE",
              },
              {
                id: "meta-rx",
                name: "clinic_prescription_ready",
                status: "REJECTED",
                language: "en",
                rejected_reason: "SCAM",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/message_templates")) {
        const created = JSON.parse(String(init?.body || "{}")) as { name?: string };
        return new Response(JSON.stringify({ id: `meta-${created.name}`, status: "PENDING" }), { status: 200 });
      }
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 });
    };

    const provisioned = await provisionClinicMessageTemplates({
      db: getDb(),
      tenantId: tenantA,
      wabaId: A_WABA,
      accessToken: A_TOKEN,
      fetchImpl,
    });
    assert.equal(provisioned.failed.length, 0);
    assert.equal(provisioned.recorded.length, clinicTemplatesToProvision().length);
    const pending = getDb()
      .prepare(`SELECT name, status FROM meta_templates WHERE tenant_id = ?`)
      .all(tenantA) as Array<{ name: string; status: string }>;
    assert.equal(pending.length, clinicTemplatesToProvision().length);
    assert.equal(pending.every((row) => row.status === "PENDING"), true);
    const again = await provisionClinicMessageTemplates({
      db: getDb(),
      tenantId: tenantA,
      wabaId: A_WABA,
      accessToken: A_TOKEN,
      fetchImpl,
    });
    assert.equal(again.recorded.every((row) => row.outcome === "exists" || row.outcome === "created"), true);
    const still = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ?`)
      .get(tenantA) as { c: number };
    assert.equal(still.c, clinicTemplatesToProvision().length);

    getDb()
      .prepare(`UPDATE meta_templates SET status = 'APPROVED' WHERE tenant_id = ? AND name = 'clinic_appointment_reminder'`)
      .run(tenantA);
    const updated = applyMessageTemplateStatusUpdate(getDb(), A_WABA, {
      event: "REJECTED",
      message_template_name: "clinic_booking_confirmation",
      message_template_language: "en",
      message_template_id: "99",
      reason: "INVALID_FORMAT",
    });
    assert.equal(updated > 0, true);
    const rejected = getDb()
      .prepare(`SELECT status, rejection_reason FROM meta_templates WHERE tenant_id = ? AND name = ?`)
      .get(tenantA, "clinic_booking_confirmation") as { status: string; rejection_reason: string };
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.rejection_reason, "INVALID_FORMAT");
    const otherTenant = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ?`)
      .get(tenantB) as { c: number };
    assert.equal(otherTenant.c, 0);

    calls.length = 0;
    recordWhatsAppOptIn(getDb(), { tenantId: tenantA, phone: "+919811100001", optedIn: true, source: "test", actorId: "test" });
    recordWhatsAppOptIn(getDb(), { tenantId: tenantB, phone: "+919811100002", optedIn: true, source: "test", actorId: "test" });
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, 'Bina', 30, 'Female', ?, '', 'O+', '[]', '[]', '', '', ?)`
      )
      .run(`patient-b-${tenantB}`, tenantB, `UH-B-${tenantB.slice(-8)}`, "+919811100002", new Date().toISOString());
    getDb()
      .prepare(
        `INSERT INTO invoices (id, tenant_id, invoice_number, patient_id, date, created_at)
         VALUES (?, ?, 'INV-1042', ?, '2026-10-20', ?)`
      )
      .run(`inv-1042-${tenantB}`, tenantB, `patient-b-${tenantB}`, new Date().toISOString());
    const sentA = await sendAppointmentReminder({
      to: "+919811100001",
      patientName: "Asha",
      doctorName: "Dr Mehta",
      clinicName: "Sunrise Clinic",
      date: "20 Oct 2026",
      timeSlot: "9:30 AM",
      db: getDb(),
      tenantId: tenantA,
      fetchImpl,
    });
    assert.equal(sentA.ok, true, JSON.stringify(sentA));
    assert.match(calls[0].url, new RegExp(`/${A_PHONE}/messages`));
    assert.equal(calls[0].auth, `Bearer ${A_TOKEN}`);
    assert.equal((calls[0].body.template as { name?: string }).name, "clinic_appointment_reminder");
    const aParams = (
      (calls[0].body.template as { components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }> }).components || []
    )
      .find((part) => part.type === "body")
      ?.parameters?.map((parameter) => parameter.text);
    assert.deepEqual(aParams, ["Asha", "Sunrise Clinic", "Dr Mehta", "20 Oct 2026", "9:30 AM"]);

    const sentB = await sendAppointmentReminder({
      to: "+919811100002",
      patientName: "Bina",
      doctorName: "Dr Sen",
      clinicName: "Lumera Sandbox Demo",
      date: "21 Oct 2026",
      timeSlot: "11:00 AM",
      db: getDb(),
      tenantId: tenantB,
      fetchImpl,
    });
    assert.equal(sentB.ok, true, JSON.stringify(sentB));
    assert.match(calls[1].url, new RegExp(`/${ENV_PHONE}/messages`));
    assert.equal(calls[1].auth, `Bearer ${ENV_TOKEN}`);
    assert.equal((calls[1].body.template as { name?: string }).name, "lumera_appointment_reminder");

    const receipt = await sendPaymentReceipt({
      to: "+919811100002",
      patientName: "Bina",
      clinicName: "Lumera Sandbox Demo",
      doctorName: "Dr Sen",
      amount: 700,
      invoiceId: "INV-1042",
      date: "20 Oct 2026",
      textBody: "receipt text",
      db: getDb(),
      tenantId: tenantB,
      fetchImpl,
    });
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.match(calls[2].url, new RegExp(`/${ENV_PHONE}/messages`));
    assert.equal(calls[2].auth, `Bearer ${ENV_TOKEN}`);
    const receiptParams = (
      (calls[2].body.template as { name?: string; components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }> })
        .components || []
    )
      .find((part) => part.type === "body")
      ?.parameters?.map((parameter) => parameter.text);
    assert.equal((calls[2].body.template as { name?: string }).name, "lumera_payment_receipt_v2");
    assert.equal(receiptParams?.[0], "Bina");
    assert.equal(receiptParams?.[1], "INR 700");
    assert.equal(receiptParams?.[2], "Lumera Sandbox Demo");
    assert.equal(receiptParams?.[3], "Dr Sen");
    assert.equal(receiptParams?.[4], "INV-1042");
    assert.match(String(receiptParams?.[5] || ""), /^https:\/\/www\.mylumera\.in\/pay\/v\/[A-Za-z0-9_-]+$/);
    assert.equal(String(receiptParams?.[5] || "").includes("INV-1042"), false);
    assert.equal(receiptParams?.includes("20 Oct 2026"), false);

    getDb().prepare(`DELETE FROM meta_templates WHERE tenant_id = ? AND name = 'clinic_appointment_reminder'`).run(tenantA);
    const gated = await sendAppointmentReminder({
      to: "+919811100003",
      patientName: "Asha",
      doctorName: "Dr Mehta",
      clinicName: "Sunrise Clinic",
      date: "20 Oct 2026",
      timeSlot: "9:30 AM",
      db: getDb(),
      tenantId: tenantA,
      fetchImpl,
    });
    assert.equal(gated.ok, false);
    if (!gated.ok) {
      assert.equal(gated.error, TEMPLATE_NOT_APPROVED_ERROR);
      assert.equal(gated.status, 409);
    }
    const beforeText = calls.length;
    recordWhatsAppOptIn(getDb(), { tenantId: tenantA, phone: "+919811100004", optedIn: true, source: "test", actorId: "test" });
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO whatsapp_conversations (
          id, patient_phone, patient_name, handover_mode, assigned_staff, tags, preferred_language,
          unread_count, last_message, last_message_time, updated_at, tenant_id, last_inbound_at
        ) VALUES (?, '+919811100004', 'Asha', 'bot', 'Clinic', '[]', 'en', 0, 'hi', ?, ?, ?, ?)`
      )
      .run(`conv-open-${tenantA}`, now, now, tenantA, now);
    const textSend = await sendAppointmentReminder({
      to: "+919811100004",
      patientName: "Asha",
      doctorName: "Dr Mehta",
      clinicName: "Sunrise Clinic",
      date: "20 Oct 2026",
      timeSlot: "9:30 AM",
      db: getDb(),
      tenantId: tenantA,
      fetchImpl,
    });
    assert.equal(textSend.ok, true, JSON.stringify(textSend));
    assert.equal(calls.length, beforeText + 1);
    assert.equal(calls.at(-1)?.body.type, "text");
    assert.match(String(calls.at(-1)?.url), new RegExp(`/${A_PHONE}/messages`));

    const fromA = "919800000001";
    const fromB = "919800000002";
    const inboundA = JSON.stringify({
      entry: [
        {
          id: A_WABA,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: A_PHONE },
                messages: [{ from: fromA, text: { body: "Hello clinic A" } }],
              },
            },
          ],
        },
      ],
    });
    const inboundB = JSON.stringify({
      entry: [
        {
          id: B_WABA,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: ENV_PHONE },
                messages: [{ from: fromB, text: { body: "Hello clinic B" } }],
              },
            },
          ],
        },
      ],
    });
    const hookA = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(inboundA) },
      body: inboundA,
    });
    const hookB = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(inboundB) },
      body: inboundB,
    });
    assert.equal(hookA.status, 200);
    assert.equal(hookB.status, 200);
    const inboxA = listTenantConversations(tenantA);
    const inboxB = listTenantConversations(tenantB);
    assert.equal(inboxA.some((row) => String(row.last_message) === "Hello clinic A"), true);
    assert.equal(inboxA.some((row) => String(row.last_message) === "Hello clinic B"), false);
    assert.equal(inboxB.some((row) => String(row.last_message) === "Hello clinic B"), true);
    assert.equal(inboxB.some((row) => String(row.last_message) === "Hello clinic A"), false);
    const convA = inboxA.find((row) => String(row.last_message) === "Hello clinic A");
    assert.equal(getTenantConversation(tenantB, String(convA?.id || "")), undefined);

    const nowIso = new Date().toISOString();
    const wamidA = `wamid.STATUS_A_${RUN}`;
    const wamidB = `wamid.STATUS_B_${RUN}`;
    getDb()
      .prepare(
        `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
         VALUES (?, 'appointment_reminder', '+919811100001', 'Asha', 'sent', '', ?, ?, ?)`
      )
      .run(wamidA, JSON.stringify({ messageId: wamidA }), nowIso, tenantA);
    getDb()
      .prepare(
        `INSERT INTO whatsapp_outbound_events (id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at, tenant_id)
         VALUES (?, 'appointment_reminder', '+919811100002', 'Bina', 'sent', '', ?, ?, ?)`
      )
      .run(wamidB, JSON.stringify({ messageId: wamidB }), nowIso, tenantB);
    const statusBody = JSON.stringify({
      entry: [
        {
          id: A_WABA,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: A_PHONE },
                statuses: [
                  { id: wamidA, status: "delivered", recipient_id: "919811100001" },
                  { id: wamidB, status: "read", recipient_id: "919811100002" },
                ],
              },
            },
          ],
        },
      ],
    });
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(statusBody) },
      body: statusBody,
    });
    assert.equal(statusRes.status, 200);
    const statusA = getDb().prepare(`SELECT status FROM whatsapp_outbound_events WHERE id = ?`).get(wamidA) as {
      status: string;
    };
    const statusB = getDb().prepare(`SELECT status FROM whatsapp_outbound_events WHERE id = ?`).get(wamidB) as {
      status: string;
    };
    assert.equal(statusA.status, "delivered");
    assert.equal(statusB.status, "sent");

    const templateBody = JSON.stringify({
      entry: [
        {
          id: A_WABA,
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: 42,
                message_template_name: "clinic_payment_receipt",
                message_template_language: "en",
                reason: "NONE",
              },
            },
          ],
        },
      ],
    });
    const templateRes = await fetch(`http://127.0.0.1:${port}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(templateBody) },
      body: templateBody,
    });
    assert.equal(templateRes.status, 200);
    const receiptRow = getDb()
      .prepare(`SELECT status, rejection_reason, tenant_id FROM meta_templates WHERE name = 'clinic_payment_receipt' AND tenant_id = ?`)
      .get(tenantA) as { status: string; rejection_reason: string | null; tenant_id: string };
    assert.equal(receiptRow.status, "APPROVED");
    assert.equal(receiptRow.rejection_reason, null);
    const tenantBTemplates = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ?`)
      .get(tenantB) as { c: number };
    assert.equal(tenantBTemplates.c, 0);
  });

  it("uses clinic_prescription_ready outside the 24h window and refuses when it is not approved", async () => {
    getDb()
      .prepare(
        `UPDATE meta_templates SET status = 'APPROVED', rejection_reason = NULL WHERE tenant_id = ? AND name = 'clinic_prescription_ready'`
      )
      .run(tenantA);
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        auth: headers.get("authorization") || "",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.RX_TEMPLATE_A" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    recordWhatsAppOptIn(getDb(), { tenantId: tenantA, phone: "+919811100099", optedIn: true, source: "test", actorId: "test" });
    const sent = await dispatchSignedRxCloudMessage({
      tenantId: tenantA,
      to: "+919811100099",
      textBody: "Prescription from Sunrise Clinic",
      patientName: "Asha",
      clinicName: "Sunrise Clinic",
      doctorName: "Dr Mehta",
      rxNumber: "RX-1001",
      urlSuffix: "opaqueexampletoken",
      fetchImpl,
    });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (sent.ok) assert.equal(sent.messageId, "wamid.RX_TEMPLATE_A");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`/${A_PHONE}/messages`));
    assert.equal(calls[0].auth, `Bearer ${A_TOKEN}`);
    const template = calls[0].body.template as {
      name?: string;
      components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
    };
    assert.equal(template.name, "clinic_prescription_ready");
    const bodyParams = template.components
      ?.find((part) => part.type === "body")
      ?.parameters?.map((parameter) => parameter.text);
    assert.deepEqual(bodyParams, ["Asha", "Sunrise Clinic", "Dr Mehta"]);
    const buttonParams = template.components
      ?.find((part) => part.type === "button")
      ?.parameters?.map((parameter) => parameter.text);
    assert.deepEqual(buttonParams, ["opaqueexampletoken"]);

    getDb()
      .prepare(`UPDATE meta_templates SET status = 'PENDING' WHERE tenant_id = ? AND name = 'clinic_prescription_ready'`)
      .run(tenantA);
    const blocked = await dispatchSignedRxCloudMessage({
      tenantId: tenantA,
      to: "+919811100099",
      textBody: "Prescription from Sunrise Clinic",
      patientName: "Asha",
      clinicName: "Sunrise Clinic",
      doctorName: "Dr Mehta",
      rxNumber: "RX-1001",
      fetchImpl,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.error, TEMPLATE_NOT_APPROVED_ERROR);
      assert.equal(blocked.status, 409);
    }
    assert.equal(calls.length, 1);
  });

  it("does not insert or edit templates for a tenant that only has a stale waba id", () => {
    const stale = `tenant-stale-${crypto.randomUUID().slice(0, 8)}`;
    insertTenant(stale, "Stale WABA Clinic");
    upsertWhatsAppNumber(platformAdminActor(), {
      ownerType: "tenant",
      ownerId: stale,
      wabaId: `30991${Date.now().toString().slice(-8)}`,
      phoneNumberId: `16661${Date.now().toString().slice(-8)}`,
      metaAccessToken: A_TOKEN,
      metaWabaName: "Stale",
      status: "connected",
    });
    getDb().prepare(`UPDATE tenants SET waba_id = ? WHERE id = ?`).run(A_WABA, stale);
    const before = getDb().prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ?`).get(stale) as { c: number };
    const changed = applyMessageTemplateStatusUpdate(getDb(), A_WABA, {
      message_template_name: "clinic_booking_confirmation",
      message_template_language: "en",
      event: "APPROVED",
    });
    const after = getDb().prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ?`).get(stale) as { c: number };
    assert.equal(after.c, before.c);
    assert.equal(after.c, 0);
    getDb().prepare(`DELETE FROM meta_templates WHERE tenant_id = ? AND name = ? AND language = 'en'`).run(tenantA, "clinic_payment_receipt");
    applyMessageTemplateStatusUpdate(getDb(), A_WABA, {
      message_template_name: "clinic_payment_receipt",
      message_template_language: "en",
      event: "APPROVED",
    });
    const missingAfter = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM meta_templates WHERE tenant_id = ? AND name = ? AND language = 'en'`)
      .get(tenantA, "clinic_payment_receipt") as { c: number };
    assert.equal(missingAfter.c, 0);
    assert.ok(changed >= 0);
  });
});
