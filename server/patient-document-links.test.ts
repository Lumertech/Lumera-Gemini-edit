import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { getDb, initDatabase } from "./db.ts";
import { createPatientDocumentLinkRouter } from "./patient-document-links.ts";
import { mintPatientLinkToken } from "./patient-link-token.ts";

describe("patient document link page", () => {
  before(() => {
    try {
      getDb();
    } catch {
      initDatabase();
    }
  });

  it("hides diagnosis, medicines, and UHID until the OTP matches", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-doc-${suffix}`;
    const patientId = `patient-doc-${suffix}`;
    const rxNumber = `RX-DOC-${suffix}`;
    const diagnosis = `SecretDiagnosis${suffix}`;
    const drug = `SecretDrug${suffix}`;
    const uhid = `UHID${suffix}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, created_at, updated_at)
       VALUES (?, 'North Clinic', 'GP', 'IN', 'Asia/Kolkata', ?, ?, ?, ?)`
    ).run(tenantId, `+9198${suffix.slice(-8)}`, now, now, now);
    db.prepare(
      `INSERT INTO patients (id, tenant_id, uhid, name, phone, created_at)
       VALUES (?, ?, ?, 'Asha', ?, ?)`
    ).run(patientId, tenantId, uhid, `+9187${suffix.slice(-8)}`, now);
    db.prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, created_at
       ) VALUES (?, ?, ?, ?, 'Asha', ?, ?, 'doc-1', 'Dr Mehta', 'GP', 'REG1', '2026-10-19', ?, ?, ?)`
    ).run(
      `rx-${suffix}`,
      tenantId,
      rxNumber,
      patientId,
      `+9187${suffix.slice(-8)}`,
      uhid,
      diagnosis,
      JSON.stringify([{ drugName: drug, dosage: "1 tab" }]),
      now
    );
    const minted = await mintPatientLinkToken({
      tenantId,
      patientId,
      purpose: "rx",
      resourceId: rxNumber,
    });
    let sentCode = "";
    const app = express();
    app.use(
      createPatientDocumentLinkRouter({
        sendOtp: async ({ code }) => {
          sentCode = code;
          return { ok: true };
        },
      })
    );
    const server: Server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}/rx/v/${minted.token}`;
    try {
      const beforeOtp = await fetch(url);
      const hidden = await beforeOtp.text();
      assert.equal(beforeOtp.status, 200);
      assert.equal(hidden.includes(diagnosis), false);
      assert.equal(hidden.includes(drug), false);
      assert.equal(hidden.includes(uhid), false);
      assert.match(hidden, /North Clinic/);
      assert.match(hidden, /Dr Mehta/);
      const sent = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=send",
      });
      const pending = await sent.text();
      assert.equal(sent.status, 200);
      assert.equal(pending.includes(diagnosis), false);
      assert.match(sentCode, /^\d{6}$/);
      const revealed = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `action=verify&otp=${sentCode}`,
      });
      const shown = await revealed.text();
      assert.equal(revealed.status, 200);
      assert.equal(shown.includes(diagnosis), true);
      assert.equal(shown.includes(drug), true);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });
});
