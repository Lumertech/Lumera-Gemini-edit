import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

describe("patient role sees only their own clinical and billing records", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret-patient-purpose";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string): Promise<string> {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(res.status, 200, String(res.json.error || "login"));
    const token = String(res.json.token || "");
    assert.ok(token);
    return token;
  }

  it("blocks the other patient's invoice, visit, prescription, and chart, and blocks billing writes", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-purpose-${suffix}`;
    const slug = `purpose-${suffix}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    const phoneA = `+91 98111${String(Date.now()).slice(-5)}`;
    const phoneB = `+91 98222${String(Date.now() + 1).slice(-5)}`;
    const emailA = `patient.a.${suffix}@purpose-test.example`;
    const emailB = `patient.b.${suffix}@purpose-test.example`;
    const staffEmail = `staff.${suffix}@purpose-test.example`;
    const gstin = "27PURPOSEGSTIN1Z";

    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, email, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id,
           address, city, gstin, upi_id, slug, created_at, updated_at, practice_type
         ) VALUES (
           ?, 'Purpose Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', 'desk@purpose.example', ?,
           500, 0, 1, '', '1 Public Lane', 'Pune', ?, 'purpose@upi', ?, ?, ?, 'individual'
         )`
      )
      .run(tenantId, now, gstin, slug, now, now);

    const insertUser = getDb().prepare(
      `INSERT INTO users (
         id, tenant_id, email, password_hash, name, role, status, phone, clinic_name,
         onboarding_completed, practice_type, specialty, last_login, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'Purpose Clinic', 1, 'individual', 'General Medicine', ?, ?)`
    );
    insertUser.run(`user-a-${suffix}`, tenantId, emailA, passwordHash, "Patient A", "patient", phoneA, now, now);
    insertUser.run(`user-b-${suffix}`, tenantId, emailB, passwordHash, "Patient B", "patient", phoneB, now, now);
    insertUser.run(`user-staff-${suffix}`, tenantId, staffEmail, passwordHash, "Desk Staff", "doctor", "+91 98000 42424", now, now);

    const insertPatient = getDb().prepare(
      `INSERT INTO patients (
         id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
         emergency_contact, address, created_at
       ) VALUES (?, ?, ?, ?, 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
    );
    insertPatient.run(`pat-a-${suffix}`, tenantId, `UHID-A-${suffix}`, "Patient A", phoneA, emailA, now);
    insertPatient.run(`pat-b-${suffix}`, tenantId, `UHID-B-${suffix}`, "Patient B", phoneB, emailB, now);

    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
         ) VALUES (?, ?, 'Dr Treating', '', 'REG-TREAT', 'General Medicine', 1, 0, '', '[]', '09:00-12:00', '', '', '', '', '', 1)`
      )
      .run(`doc-${suffix}`, `user-staff-${suffix}`);

    const insertVisit = getDb().prepare(
      `INSERT INTO appointments (
         id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
         specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Dr Treating', 'General Medicine', '2026-10-16', '10:00', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
    );
    insertVisit.run(`apt-a-${suffix}`, tenantId, 1, `pat-a-${suffix}`, "Patient A", phoneA, `UHID-A-${suffix}`, `doc-${suffix}`, now);
    insertVisit.run(`apt-b-${suffix}`, tenantId, 2, `pat-b-${suffix}`, "Patient B", phoneB, `UHID-B-${suffix}`, `doc-${suffix}`, now);

    const insertRx = getDb().prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
         medicines, lab_tests, advice, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Dr Treating', 'General Medicine', 'REG-TREAT', '2026-10-16', 'Checkup', '[]', '[]', '[]', ?)`
    );
    insertRx.run(`rx-a-${suffix}`, tenantId, `RX-A-${suffix}`, `pat-a-${suffix}`, "Patient A", phoneA, `UHID-A-${suffix}`, `doc-${suffix}`, now);
    insertRx.run(`rx-b-${suffix}`, tenantId, `RX-B-${suffix}`, `pat-b-${suffix}`, "Patient B", phoneB, `UHID-B-${suffix}`, `doc-${suffix}`, now);

    const insertInvoice = getDb().prepare(
      `INSERT INTO invoices (
         id, tenant_id, invoice_number, patient_id, patient_name, date, gstin, upi_id, total_amount, status, created_at,
         razorpay_order_id, razorpay_payment_id, razorpay_payment_link_id, issued_by,
         receipt_whatsapp_status, receipt_whatsapp_channel, receipt_whatsapp_message_id
       ) VALUES (?, ?, ?, ?, ?, '2026-10-16', ?, 'purpose@upi', 500, 'Unpaid', ?, 'order_secret', 'pay_secret', 'plink_secret', 'Desk Staff', 'sent', 'graph', 'wamid_secret')`
    );
    insertInvoice.run(`inv-a-${suffix}`, tenantId, `INV-A-${suffix}`, `pat-a-${suffix}`, "Patient A", gstin, now);
    insertInvoice.run(`inv-b-${suffix}`, tenantId, `INV-B-${suffix}`, `pat-b-${suffix}`, "Patient B", gstin, now);

    const tokenA = await login(emailA);
    const tokenB = await login(emailB);
    const tokenStaff = await login(staffEmail);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authStaff = { Authorization: `Bearer ${tokenStaff}` };

    const otherReads: Array<[string, string]> = [
      ["invoice", `/api/invoices/inv-b-${suffix}`],
      ["appointment", `/api/appointments/apt-b-${suffix}`],
      ["prescription", `/api/prescriptions/rx-b-${suffix}`],
      ["chart", `/api/patients/pat-b-${suffix}/chart`],
      ["patient", `/api/patients/pat-b-${suffix}`],
    ];
    for (const [label, path] of otherReads) {
      const res = await jsonRequest(port, "GET", path, undefined, authA);
      assert.ok(res.status === 403 || res.status === 404, `${label} ${res.status}`);
    }

    const ownInvoice = await jsonRequest(port, "GET", `/api/invoices/inv-a-${suffix}`, undefined, authA);
    assert.equal(ownInvoice.status, 200);
    const invoice = ownInvoice.json.invoice as Record<string, unknown>;
    assert.equal(invoice.gstin, gstin);
    assert.equal(invoice.patientId, `pat-a-${suffix}`);
    for (const key of [
      "razorpayOrderId",
      "razorpayPaymentId",
      "razorpayPaymentLinkId",
      "issuedBy",
      "receiptWhatsAppStatus",
      "receiptWhatsAppChannel",
      "receiptWhatsAppMessageId",
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(invoice, key), false, key);
    }

    const listed = await jsonRequest(port, "GET", "/api/invoices", undefined, authA);
    const ids = ((listed.json.invoices as Array<{ id: string }>) || []).map((row) => row.id);
    assert.deepEqual(ids, [`inv-a-${suffix}`]);

    const visits = await jsonRequest(port, "GET", "/api/appointments?date=2026-10-16", undefined, authA);
    const visitIds = ((visits.json.appointments as Array<{ id: string }>) || []).map((row) => row.id);
    assert.deepEqual(visitIds, [`apt-a-${suffix}`]);
    const ownVisit = await jsonRequest(port, "GET", `/api/appointments/apt-a-${suffix}`, undefined, authA);
    assert.equal((ownVisit.json.tenant as { doctor_name?: string | null }).doctor_name, "Dr Treating");
    assert.equal((ownVisit.json.tenant as { doctor_reg_number?: string | null }).doctor_reg_number, "REG-TREAT");

    const me = await jsonRequest(port, "GET", "/api/auth/me", undefined, authA);
    assert.equal((me.json.tenant as { doctor_name?: string | null }).doctor_name, null);
    assert.equal((me.json.tenant as { doctor_reg_number?: string | null }).doctor_reg_number, null);

    const rxs = await jsonRequest(port, "GET", "/api/prescriptions", undefined, authA);
    const rxIds = ((rxs.json.prescriptions as Array<{ id: string }>) || []).map((row) => row.id);
    assert.deepEqual(rxIds, [`rx-a-${suffix}`]);

    const chart = await jsonRequest(port, "GET", `/api/patients/pat-a-${suffix}/chart`, undefined, authA);
    assert.equal(chart.status, 200);
    assert.equal((chart.json.patient as { id?: string }).id, `pat-a-${suffix}`);

    const blockedGets = ["/api/billing/settings", "/api/billing/day-end", "/api/patients", `/api/w/${slug}/patients`];
    for (const path of blockedGets) {
      const res = await jsonRequest(port, "GET", path, undefined, authA);
      assert.equal(res.status, 403, path);
    }

    const blockedPosts: Array<[string, unknown]> = [
      ["/api/invoices", { patientId: `pat-a-${suffix}`, totalAmount: 10 }],
      [`/api/invoices/inv-a-${suffix}/sandbox-pay`, {}],
      [`/api/invoices/inv-a-${suffix}/desk-collect`, { paymentMode: "Cash" }],
      [`/api/invoices/inv-a-${suffix}/receipt`, {}],
      ["/api/prescriptions", { patientId: `pat-a-${suffix}` }],
      ["/api/appointments", { patientId: `pat-b-${suffix}`, doctorId: `doc-${suffix}`, date: "2026-10-16", timeSlot: "11:00" }],
    ];
    for (const [path, body] of blockedPosts) {
      const res = await jsonRequest(port, "POST", path, body, authA);
      assert.equal(res.status, 403, path);
    }

    const otherPay = await jsonRequest(port, "POST", `/api/invoices/inv-b-${suffix}/pay-order`, {}, authA);
    assert.equal(otherPay.status, 404);
    const ownPay = await jsonRequest(port, "POST", `/api/invoices/inv-a-${suffix}/pay-order`, {}, authA);
    assert.notEqual(ownPay.status, 403);
    assert.notEqual(ownPay.status, 404);

    const staffInvoices = await jsonRequest(port, "GET", "/api/invoices", undefined, authStaff);
    const staffIds = ((staffInvoices.json.invoices as Array<{ id: string; issuedBy?: string; gstin?: string }>) || []).map(
      (row) => row.id
    );
    assert.ok(staffIds.includes(`inv-a-${suffix}`));
    assert.ok(staffIds.includes(`inv-b-${suffix}`));
    const staffRow = (staffInvoices.json.invoices as Array<{ id: string; issuedBy?: string; gstin?: string }>).find(
      (row) => row.id === `inv-b-${suffix}`
    );
    assert.equal(staffRow?.issuedBy, "Desk Staff");
    assert.equal(staffRow?.gstin, gstin);
    const dayEnd = await jsonRequest(port, "GET", "/api/billing/day-end?date=2026-10-16", undefined, authStaff);
    assert.equal(dayEnd.status, 200);
    const roster = await jsonRequest(port, "GET", `/api/w/${slug}/patients`, undefined, authStaff);
    assert.equal(roster.status, 200);
    assert.equal((roster.json.patients as unknown[]).length, 2);
  });
});
