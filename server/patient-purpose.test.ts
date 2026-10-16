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
         onboarding_completed, practice_type, specialty, last_login, created_at, patient_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'Purpose Clinic', 1, 'individual', 'General Medicine', ?, ?, ?)`
    );
    insertUser.run(`user-a-${suffix}`, tenantId, emailA, passwordHash, "Patient A", "patient", phoneA, now, now, `pat-a-${suffix}`);
    insertUser.run(`user-b-${suffix}`, tenantId, emailB, passwordHash, "Patient B", "patient", phoneB, now, now, `pat-b-${suffix}`);
    insertUser.run(`user-staff-${suffix}`, tenantId, staffEmail, passwordHash, "Desk Staff", "doctor", "+91 98000 42424", now, now, "");

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
      assert.equal(res.json.code, "ROLE_DENIED", path);
    }

    const patchOwn = await jsonRequest(port, "PATCH", `/api/patients/pat-a-${suffix}`, { name: "Renamed" }, authA);
    assert.equal(patchOwn.status, 403);
    assert.equal(patchOwn.json.code, "ROLE_DENIED");
    const patchOther = await jsonRequest(port, "PATCH", `/api/patients/pat-b-${suffix}`, { name: "Renamed" }, authA);
    assert.equal(patchOther.status, 403);
    assert.equal(patchOther.json.code, "ROLE_DENIED");

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

  it("keeps patient A on their own chart after a phone change to patient B", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-takeover-${suffix}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    const phoneA = `+91 97111${String(Date.now()).slice(-5)}`;
    const phoneB = `+91 97222${String(Date.now() + 3).slice(-5)}`;
    const emailA = `takeover.a.${suffix}@purpose-test.example`;
    const emailB = `takeover.b.${suffix}@purpose-test.example`;
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Takeover Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Patient A', 'patient', 'active', ?, ?, ?, ?)`
      )
      .run(`user-ta-${suffix}`, tenantId, emailA, passwordHash, phoneA, now, now, `pat-ta-${suffix}`);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Patient B', 'patient', 'active', ?, ?, ?, ?)`
      )
      .run(`user-tb-${suffix}`, tenantId, emailB, passwordHash, phoneB, now, now, `pat-tb-${suffix}`);
    const insertPatient = getDb().prepare(
      `INSERT INTO patients (
         id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
         emergency_contact, address, created_at
       ) VALUES (?, ?, ?, ?, 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
    );
    insertPatient.run(`pat-ta-${suffix}`, tenantId, `UHID-TA-${suffix}`, "Patient A", phoneA, emailA, now);
    insertPatient.run(`pat-tb-${suffix}`, tenantId, `UHID-TB-${suffix}`, "Patient B", phoneB, emailB, now);
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 1, ?, 'Patient B', ?, ?, '', 'Dr', 'General Medicine', '2026-10-16', '10:00', 'New Consultation', 'Waiting', 'Desk', 0, 0, ?)`
      )
      .run(`apt-tb-${suffix}`, tenantId, `pat-tb-${suffix}`, phoneB, `UHID-TB-${suffix}`, now);
    getDb()
      .prepare(
        `INSERT INTO prescriptions (
           id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
           doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, lab_tests, advice, created_at
         ) VALUES (?, ?, ?, ?, 'Patient B', ?, ?, '', 'Dr', 'General Medicine', 'REG', '2026-10-16', 'Checkup', '[]', '[]', '[]', ?)`
      )
      .run(`rx-tb-${suffix}`, tenantId, `RX-TB-${suffix}`, `pat-tb-${suffix}`, phoneB, `UHID-TB-${suffix}`, now);
    getDb()
      .prepare(
        `INSERT INTO invoices (
           id, tenant_id, invoice_number, patient_id, patient_name, date, total_amount, status, created_at
         ) VALUES (?, ?, ?, ?, 'Patient B', '2026-10-16', 100, 'Unpaid', ?)`
      )
      .run(`inv-tb-${suffix}`, tenantId, `INV-TB-${suffix}`, `pat-tb-${suffix}`, now);

    const tokenA = await login(emailA);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const patched = await jsonRequest(port, "PATCH", "/api/auth/me", { phone: phoneB, email: emailB }, authA);
    assert.equal(patched.status, 403);
    assert.equal(patched.json.code, "PATIENT_CONTACT_LOCKED");
    const stored = getDb().prepare("SELECT phone, email, patient_id FROM users WHERE id = ?").get(`user-ta-${suffix}`) as {
      phone: string;
      email: string;
      patient_id: string;
    };
    assert.equal(stored.phone, phoneA);
    assert.equal(stored.email, emailA);
    assert.equal(stored.patient_id, `pat-ta-${suffix}`);

    getDb().prepare("UPDATE users SET phone = ? WHERE id = ?").run(phoneB, `user-ta-${suffix}`);
    const stolen = [
      `/api/patients/pat-tb-${suffix}/chart`,
      `/api/prescriptions/rx-tb-${suffix}`,
      `/api/appointments/apt-tb-${suffix}`,
      `/api/invoices/inv-tb-${suffix}`,
    ];
    for (const path of stolen) {
      const res = await jsonRequest(port, "GET", path, undefined, authA);
      assert.equal(res.status, 404, path);
    }
    const own = await jsonRequest(port, "GET", `/api/patients/pat-ta-${suffix}`, undefined, authA);
    assert.equal(own.status, 200);
    assert.equal((own.json.patient as { id?: string }).id, `pat-ta-${suffix}`);
  });

  it("lets a patient reschedule or cancel only, and books with the doctor's fee", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-book-${suffix}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    const email = `book.${suffix}@purpose-test.example`;
    const staffEmail = `book.staff.${suffix}@purpose-test.example`;
    const phone = `+91 97333${String(Date.now()).slice(-5)}`;
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Booking Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, ?, 'patient', 'active', ?, ?, ?, ?)`
      )
      .run(`user-book-${suffix}`, tenantId, email, passwordHash, "Booker", phone, now, now, `pat-book-${suffix}`);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at
         ) VALUES (?, ?, ?, ?, 'Dr Fee', 'doctor', 'active', '+91 98000 11111', ?, ?)`
      )
      .run(`user-fee-${suffix}`, tenantId, staffEmail, passwordHash, now, now);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, 'Booker', 30, 'Female', ?, ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(`pat-book-${suffix}`, tenantId, `UHID-BOOK-${suffix}`, phone, email, now);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, 'Neighbour', 31, 'Male', '+91 90000 00002', 'neighbour@example', 'A+', '[]', '[]', '', '', ?)`
      )
      .run(`pat-other-${suffix}`, tenantId, `UHID-OTHER-${suffix}`, now);
    getDb()
      .prepare(
        `INSERT INTO doctors (
           id, user_id, name, qualification, reg_number, specialty, experience_years, consultation_fee,
           opd_room, available_days, opd_timing, phone, email, avatar_url, bio, hpr_id, active
         ) VALUES (?, ?, 'Dr Fee', '', 'REG-FEE', 'General Medicine', 2, 750, '', '[]', '', '', '', '', '', '', 1)`
      )
      .run(`doc-fee-${suffix}`, `user-fee-${suffix}`);
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 4, ?, 'Booker', ?, ?, ?, 'Dr Fee', 'General Medicine', '2026-10-20', '09:00', 'New Consultation', 'Waiting', 'Desk', 750, 0, ?)`
      )
      .run(
        `apt-book-${suffix}`,
        tenantId,
        `pat-book-${suffix}`,
        phone,
        `UHID-BOOK-${suffix}`,
        `doc-fee-${suffix}`,
        now
      );
    getDb()
      .prepare(
        `INSERT INTO appointments (
           id, tenant_id, token_number, patient_id, patient_name, patient_phone, uhid, doctor_id, doctor_name,
           specialty, date, time_slot, type, status, source, consultation_fee, is_paid, created_at
         ) VALUES (?, ?, 5, ?, 'Neighbour', '+91 90000 00002', ?, ?, 'Dr Fee', 'General Medicine', '2026-10-20', '09:30', 'New Consultation', 'Waiting', 'Desk', 750, 0, ?)`
      )
      .run(`apt-other-${suffix}`, tenantId, `pat-other-${suffix}`, `UHID-OTHER-${suffix}`, `doc-fee-${suffix}`, now);

    const auth = { Authorization: `Bearer ${await login(email)}` };
    const booked = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      {
        doctorId: `doc-fee-${suffix}`,
        date: "2026-10-21",
        timeSlot: "11:15",
        type: "Follow-up",
        status: "Completed",
        isPaid: true,
        is_paid: 1,
        source: "Desk",
        consultationFee: 1,
        doctorName: "Spoofed",
      },
      auth
    );
    assert.equal(booked.status, 201, String(booked.json.error || ""));
    const created = booked.json.appointment as {
      patientId: string;
      status: string;
      isPaid: boolean;
      source: string;
      consultationFee: number;
      type: string;
      doctorName: string;
      timeSlot: string;
    };
    assert.equal(created.patientId, `pat-book-${suffix}`);
    assert.equal(created.status, "Waiting");
    assert.equal(created.isPaid, false);
    assert.equal(created.source, "Portal");
    assert.equal(created.consultationFee, 750);
    assert.equal(created.type, "Follow-up");
    assert.equal(created.doctorName, "Dr Fee");
    assert.equal(created.timeSlot, "11:15");

    const otherBook = await jsonRequest(
      port,
      "POST",
      "/api/appointments",
      { patientId: `pat-other-${suffix}`, doctorId: `doc-fee-${suffix}`, date: "2026-10-21", timeSlot: "12:00" },
      auth
    );
    assert.equal(otherBook.status, 403);

    const moved = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-book-${suffix}`,
      { date: "2026-10-22", timeSlot: "15:00" },
      auth
    );
    assert.equal(moved.status, 200, String(moved.json.error || ""));
    const rescheduled = moved.json.appointment as { date: string; timeSlot: string; status: string; isPaid: boolean };
    assert.equal(rescheduled.date, "2026-10-22");
    assert.equal(rescheduled.timeSlot, "15:00");
    assert.equal(rescheduled.status, "Waiting");

    const paid = await jsonRequest(port, "PATCH", `/api/appointments/apt-book-${suffix}`, { isPaid: true }, auth);
    assert.equal(paid.status, 400);
    const completed = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-book-${suffix}`,
      { status: "Completed" },
      auth
    );
    assert.equal(completed.status, 400);
    const doctorSwap = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-book-${suffix}`,
      { doctorId: "doc-other" },
      auth
    );
    assert.equal(doctorSwap.status, 400);
    const fee = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-book-${suffix}`,
      { consultationFee: 1 },
      auth
    );
    assert.equal(fee.status, 400);

    const cancelled = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-book-${suffix}`,
      { status: "Cancelled" },
      auth
    );
    assert.equal(cancelled.status, 200, String(cancelled.json.error || ""));
    assert.equal((cancelled.json.appointment as { status: string }).status, "Cancelled");
    assert.equal((cancelled.json.appointment as { isPaid: boolean }).isPaid, false);

    const neighbour = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-other-${suffix}`,
      { status: "Cancelled" },
      auth
    );
    assert.equal(neighbour.status, 404);

    const staff = { Authorization: `Bearer ${await login(staffEmail)}` };
    const staffStatus = await jsonRequest(
      port,
      "PATCH",
      `/api/appointments/apt-other-${suffix}`,
      { status: "Completed", isPaid: true },
      staff
    );
    assert.equal(staffStatus.status, 200, String(staffStatus.json.error || ""));
    assert.equal((staffStatus.json.appointment as { status: string }).status, "Completed");
    assert.equal((staffStatus.json.appointment as { isPaid: boolean }).isPaid, true);
  });

  it("returns 403 when a patient opens drafts, pharmacy, diagnostics, or PM-JAY", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-dispatch-${suffix}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword("Lumera@2026");
    const email = `dispatch.${suffix}@purpose-test.example`;
    getDb()
      .prepare(
        `INSERT INTO tenants (
           id, name, specialty, country, timezone, phone, trial_ends_at,
           ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at
         ) VALUES (?, 'Dispatch Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+91 20 4000 1000', ?, 500, 0, 1, '', ?, ?)`
      )
      .run(tenantId, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO users (
           id, tenant_id, email, password_hash, name, role, status, phone, last_login, created_at, patient_id
         ) VALUES (?, ?, ?, ?, 'Dispatcher', 'patient', 'active', '+91 97444 00001', ?, ?, ?)`
      )
      .run(`user-dispatch-${suffix}`, tenantId, email, passwordHash, now, now, `pat-dispatch-${suffix}`);
    getDb()
      .prepare(
        `INSERT INTO patients (
           id, tenant_id, uhid, name, age, gender, phone, email, blood_group, allergies, chronic_conditions,
           emergency_contact, address, created_at
         ) VALUES (?, ?, ?, 'Dispatcher', 30, 'Female', '+91 97444 00001', ?, 'O+', '[]', '[]', '', '', ?)`
      )
      .run(`pat-dispatch-${suffix}`, tenantId, `UHID-D-${suffix}`, email, now);
    const auth = { Authorization: `Bearer ${await login(email)}` };
    const draft = await jsonRequest(port, "GET", `/api/prescriptions/draft/pat-dispatch-${suffix}`, undefined, auth);
    assert.equal(draft.status, 403);
    assert.equal(draft.json.code, "ROLE_DENIED");
    const posts = ["/api/pharmacy/dispatch-order", "/api/diagnostics/dispatch-order", "/api/insurance/pmjay-precheck"];
    for (const path of posts) {
      const res = await jsonRequest(port, "POST", path, { patientId: `pat-dispatch-${suffix}` }, auth);
      assert.equal(res.status, 403, path);
      assert.equal(res.json.code, "ROLE_DENIED", path);
    }
  });
});
