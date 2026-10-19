import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before, describe, it } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { getDb, initDatabase } from "./db.ts";
import { corsAllowlistMiddleware, csrfProtectionMiddleware } from "./http-security.ts";
import { createPatientDocumentLinkRouter } from "./patient-document-links.ts";
import { mintPatientLinkToken, resolvePatientLinkToken } from "./patient-link-token.ts";
import { resetSendOtpRateLimits } from "./otp-rate-limit.ts";

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
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, specialty_modules, created_at
       ) VALUES (?, ?, ?, ?, 'Asha', ?, ?, 'doc-1', 'Dr Mehta', 'GP', 'REG1', '2026-10-19', ?, ?, ?, ?)`
    ).run(
      `rx-${suffix}`,
      tenantId,
      rxNumber,
      patientId,
      `+9187${suffix.slice(-8)}`,
      uhid,
      diagnosis,
      JSON.stringify([{ drugName: drug, dosage: "1 tab" }]),
      JSON.stringify({ reviewedBy: "doc-1" }),
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
      assert.equal(beforeOtp.headers.get("cache-control"), "no-store");
      assert.equal(beforeOtp.headers.get("x-robots-tag"), "noindex");
      assert.equal(beforeOtp.headers.get("referrer-policy"), "no-referrer");
      assert.match(String(beforeOtp.headers.get("content-security-policy") || ""), /frame-ancestors 'none'/);
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
      assert.match(String(revealed.headers.get("content-security-policy") || ""), /frame-ancestors 'none'/);
      assert.equal(revealed.headers.get("cache-control"), "no-store");
      assert.equal(shown.includes(diagnosis), true);
      assert.equal(shown.includes(drug), true);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });

  async function planted(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-${label}-${suffix}`;
    const patientId = `patient-${label}-${suffix}`;
    const rxNumber = `RX-${label}-${suffix}`;
    const now = new Date().toISOString();
    const phone = `+9176${String(Date.now()).slice(-8)}`;
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, created_at, updated_at)
       VALUES (?, 'North Clinic', 'GP', 'IN', 'Asia/Kolkata', ?, ?, ?, ?)`
    ).run(tenantId, `+9199${suffix.slice(-8)}`, now, now, now);
    db.prepare(`INSERT INTO patients (id, tenant_id, uhid, name, phone, created_at) VALUES (?, ?, ?, 'Asha', ?, ?)`).run(
      patientId,
      tenantId,
      `UH${suffix}`,
      phone,
      now
    );
    db.prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, created_at
       ) VALUES (?, ?, ?, ?, 'Asha', ?, ?, 'doc-1', 'Dr Mehta', 'GP', 'REG1', '2026-10-19', 'cough', '[]', ?)`
    ).run(`rx-${suffix}`, tenantId, rxNumber, patientId, phone, `UH${suffix}`, now);
    const minted = await mintPatientLinkToken({ tenantId, patientId, purpose: "rx", resourceId: rxNumber });
    return { minted, phone, tenantId, patientId };
  }

  async function listen(app: express.Express): Promise<{ server: Server; port: number }> {
    const server: Server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, port };
  }

  it("does not reset failed attempts when the code is sent again", async () => {
    resetSendOtpRateLimits();
    const { minted } = await planted("resend");
    const app = express();
    app.use(createPatientDocumentLinkRouter({ sendOtp: async () => ({ ok: true }) }));
    const { server, port } = await listen(app);
    const url = `http://127.0.0.1:${port}/rx/v/${minted.token}`;
    const hash = crypto.createHash("sha256").update(minted.token, "utf8").digest("hex");
    try {
      assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "action=send" })).status, 200);
      const wrong = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=verify&otp=000000",
      });
      assert.equal(wrong.status, 403);
      const again = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=send",
      });
      assert.equal(again.status, 200);
      const row = getDb().prepare(`SELECT attempts FROM patient_link_otps WHERE token_hash = ?`).get(hash) as { attempts: number };
      assert.equal(row.attempts, 1);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });

  it("caps sends for one token and for one phone", async () => {
    resetSendOtpRateLimits();
    const { minted } = await planted("cap");
    const app = express();
    app.use(createPatientDocumentLinkRouter({ sendOtp: async () => ({ ok: true }) }));
    const { server, port } = await listen(app);
    const url = `http://127.0.0.1:${port}/rx/v/${minted.token}`;
    const post = () =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "action=send" });
    try {
      for (let i = 0; i < 3; i += 1) {
        const sent = await post();
        assert.equal(sent.status, 200, `send ${i}`);
      }
      const blocked = await post();
      assert.equal(blocked.status, 429);
      assert.match(await blocked.text(), /Too many codes for this link/);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }

    resetSendOtpRateLimits();
    const shared = await planted("phone");
    const links = [shared.minted];
    for (let i = 1; i < 4; i += 1) {
      links.push(
        await mintPatientLinkToken({
          tenantId: shared.tenantId,
          patientId: shared.patientId,
          purpose: "rx",
          resourceId: `extra-${i}-${shared.patientId}`,
        })
      );
    }
    const phoneApp = express();
    phoneApp.use(createPatientDocumentLinkRouter({ sendOtp: async () => ({ ok: true }) }));
    const phoneServer = await listen(phoneApp);
    try {
      for (let i = 0; i < 3; i += 1) {
        const sent = await fetch(`http://127.0.0.1:${phoneServer.port}/rx/v/${links[i].token}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "action=send",
        });
        assert.equal(sent.status, 200, `phone send ${i}`);
      }
      const fourth = await fetch(`http://127.0.0.1:${phoneServer.port}/rx/v/${links[3].token}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=send",
      });
      assert.equal(fourth.status, 429);
      assert.match(await fourth.text(), /Too many OTP requests/);
    } finally {
      await new Promise((resolve) => phoneServer.server.close(() => resolve(undefined)));
    }
  });

  it("revokes the token after 10 failed codes", async () => {
    resetSendOtpRateLimits();
    const { minted } = await planted("fail");
    const app = express();
    app.use(createPatientDocumentLinkRouter({ sendOtp: async () => ({ ok: true }) }));
    const { server, port } = await listen(app);
    const url = `http://127.0.0.1:${port}/rx/v/${minted.token}`;
    try {
      assert.equal(
        (await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "action=send" })).status,
        200
      );
      for (let i = 0; i < 9; i += 1) {
        const wrong = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "action=verify&otp=111111",
        });
        assert.equal(wrong.status, 403, `guess ${i}`);
      }
      const last = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=verify&otp=111111",
      });
      assert.equal(last.status, 410);
      const resolved = await resolvePatientLinkToken(minted.token, { purpose: "rx" });
      assert.equal(resolved.ok, false);
      if (resolved.ok === false) assert.equal(resolved.reason, "revoked");
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });

  it("accepts the OTP form with and without a session cookie when Origin is allowlisted", async () => {
    resetSendOtpRateLimits();
    const { minted } = await planted("csrf");
    const app = express();
    app.use(corsAllowlistMiddleware());
    app.use(csrfProtectionMiddleware());
    app.use(createPatientDocumentLinkRouter({ sendOtp: async () => ({ ok: true }) }));
    const { server, port } = await listen(app);
    const url = `http://127.0.0.1:${port}/rx/v/${minted.token}`;
    const prevOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = `http://127.0.0.1:${port}`;
    try {
      const open = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=send",
      });
      assert.equal(open.status, 200, await open.clone().text());
      assert.match(await open.text(), /Enter the code/);

      const cookied = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: `http://127.0.0.1:${port}`,
          Cookie: "__session=patient-session-cookie",
        },
        body: "action=send",
      });
      const cookiedBody = await cookied.text();
      assert.equal(cookied.status, 200, cookiedBody);
      assert.equal(cookiedBody.includes("CSRF"), false);

      const blocked = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "__session=patient-session-cookie",
        },
        body: "action=send",
      });
      const blockedBody = await blocked.text();
      assert.equal(blocked.status, 403);
      assert.match(blockedBody, /CSRF/);
    } finally {
      if (prevOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = prevOrigins;
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });

  async function revealAfterOtp(token: string): Promise<{ status: number; body: string }> {
    const app = express();
    let sentCode = "";
    app.use(
      createPatientDocumentLinkRouter({
        sendOtp: async ({ code }) => {
          sentCode = code;
          return { ok: true };
        },
      })
    );
    const { server, port } = await listen(app);
    const url = `http://127.0.0.1:${port}/rx/v/${token}`;
    try {
      assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "action=send" })).status, 200);
      const revealed = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `action=verify&otp=${sentCode}`,
      });
      return { status: revealed.status, body: await revealed.text() };
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  }

  it("does not reveal an unsigned prescription or a token for a different patient", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-bind-${suffix}`;
    const patientA = `patient-a-${suffix}`;
    const patientB = `patient-b-${suffix}`;
    const rxNumber = `RX-BIND-${suffix}`;
    const diagnosis = `BoundDiagnosis${suffix}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, created_at, updated_at)
       VALUES (?, 'North Clinic', 'GP', 'IN', 'Asia/Kolkata', ?, ?, ?, ?)`
    ).run(tenantId, `+9191${suffix.slice(-8)}`, now, now, now);
    db.prepare(`INSERT INTO patients (id, tenant_id, uhid, name, phone, created_at) VALUES (?, ?, ?, 'Asha', ?, ?)`).run(
      patientA,
      tenantId,
      `UHA${suffix}`,
      `+9181${suffix.slice(-8)}`,
      now
    );
    db.prepare(`INSERT INTO patients (id, tenant_id, uhid, name, phone, created_at) VALUES (?, ?, ?, 'Other', ?, ?)`).run(
      patientB,
      tenantId,
      `UHB${suffix}`,
      `+9182${suffix.slice(-8)}`,
      now
    );
    db.prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, specialty_modules, created_at
       ) VALUES (?, ?, ?, ?, 'Asha', ?, ?, 'doc-1', 'Dr Mehta', 'GP', 'REG1', '2026-10-19', ?, '[]', ?, ?)`
    ).run(
      `rx-signed-${suffix}`,
      tenantId,
      rxNumber,
      patientA,
      `+9181${suffix.slice(-8)}`,
      `UHA${suffix}`,
      diagnosis,
      JSON.stringify({ reviewedBy: "doc-1" }),
      now
    );
    const mismatched = await mintPatientLinkToken({ tenantId, patientId: patientB, purpose: "rx", resourceId: rxNumber });
    const wrongPatient = await revealAfterOtp(mismatched.token);
    assert.equal(wrongPatient.status, 410);
    assert.equal(wrongPatient.body.includes(diagnosis), false);

    const unsignedNumber = `RX-UNSIGNED-${suffix}`;
    db.prepare(
      `INSERT INTO prescriptions (
         id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
         doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis, medicines, specialty_modules, created_at
       ) VALUES (?, ?, ?, ?, 'Asha', ?, ?, 'doc-1', 'Dr Mehta', 'GP', 'REG1', '2026-10-19', ?, '[]', '{}', ?)`
    ).run(
      `rx-unsigned-${suffix}`,
      tenantId,
      unsignedNumber,
      patientA,
      `+9181${suffix.slice(-8)}`,
      `UHA${suffix}`,
      diagnosis,
      now
    );
    const unsigned = await mintPatientLinkToken({ tenantId, patientId: patientA, purpose: "rx", resourceId: unsignedNumber });
    const hidden = await revealAfterOtp(unsigned.token);
    assert.equal(hidden.status, 410);
    assert.equal(hidden.body.includes(diagnosis), false);
  });
});
