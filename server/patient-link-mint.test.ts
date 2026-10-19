import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { resolvePatientLinkToken } from "./patient-link-token.ts";
import { PATIENT_LINK_PUBLIC_BASE_URL as serverBase } from "./patient-link-token.ts";
import { PATIENT_LINK_PUBLIC_BASE_URL as clientBase } from "../src/lib/patientLinkPublicBase.ts";
import { sendPaymentReceipt } from "./graph-whatsapp.ts";
import { recordWhatsAppOptIn } from "./whatsapp-opt-in.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

function tokenFrom(url: string): string {
  const parts = String(url || "").split("/v/");
  return parts[1] || "";
}

describe("portal and HEP patient-link mints", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
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

  it("uses one public base URL in the client and the server", () => {
    assert.equal(serverBase, clientBase);
    assert.equal(serverBase, "https://www.mylumera.in");
  });

  it("mints portal and HEP links only for that patient, and a new HEP mint revokes the previous one", async () => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tenantId = `tenant-link-${suffix}`;
    const userId = `user-link-${suffix}`;
    const email = `link.${suffix}@opd-test.example`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
       VALUES (?, 'Link Clinic', 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000099', ?, 500, 0, 1, '', ?, ?)`
    ).run(tenantId, now, now, now);
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
       VALUES (?, ?, ?, ?, 'Dr Link', 'doctor', 'active', '+91 90000 11111', 'Link Clinic', 1, 'individual', 'General Medicine', ?, ?)`
    ).run(userId, tenantId, email, hashPassword("Lumera@2026"), now, now);

    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: "Lumera@2026",
      skipOtp: true,
    });
    assert.equal(login.status, 200, String(login.json.error || ""));
    const auth = { Authorization: `Bearer ${String(login.json.token || "")}` };

    const created = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Asha Rao", phone: `+91 98111 ${suffix.slice(-5).padEnd(5, "1")}`, age: 40, gender: "Female" },
      auth
    );
    assert.equal(created.status, 201, String(created.json.error || ""));
    const patientId = String((created.json.patient as { id?: string }).id || "");
    const other = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Other Patient", phone: `+91 98222 ${suffix.slice(-5).padEnd(5, "2")}`, age: 33, gender: "Male" },
      auth
    );
    assert.equal(other.status, 201, String(other.json.error || ""));
    const otherId = String((other.json.patient as { id?: string }).id || "");

    const portal = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "portal", patientId, resourceId: patientId, ttlHours: 72 },
      auth
    );
    assert.equal(portal.status, 201, String(portal.json.error || ""));
    const portalUrl = String(portal.json.url || "");
    assert.match(portalUrl, new RegExp(`^${serverBase}/portal/v/`));
    const portalToken = tokenFrom(portalUrl);
    const portalResolved = await resolvePatientLinkToken(portalToken, { purpose: "portal" });
    assert.equal(portalResolved.ok, true);
    if (portalResolved.ok) {
      assert.equal(portalResolved.patientId, patientId);
      assert.equal(portalResolved.resourceId, patientId);
    }

    const portalWrong = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "portal", patientId, resourceId: otherId },
      auth
    );
    assert.equal(portalWrong.status, 409);

    const hep = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "hep", patientId, resourceId: patientId, ttlHours: 72 },
      auth
    );
    assert.equal(hep.status, 201, String(hep.json.error || ""));
    const hepUrl = String(hep.json.url || "");
    assert.match(hepUrl, new RegExp(`^${serverBase}/hep/v/`));
    assert.equal(hepUrl.includes(patientId), false);
    const firstHep = tokenFrom(hepUrl);
    assert.equal((await resolvePatientLinkToken(firstHep, { purpose: "hep" })).ok, true);

    const hepWrong = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "hep", patientId, resourceId: otherId },
      auth
    );
    assert.equal(hepWrong.status, 409);
    assert.equal((await resolvePatientLinkToken(firstHep, { purpose: "hep" })).ok, true);

    const hepAgain = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "hep", patientId, resourceId: patientId, ttlHours: 72 },
      auth
    );
    assert.equal(hepAgain.status, 201, String(hepAgain.json.error || ""));
    const secondHep = tokenFrom(String(hepAgain.json.url || ""));
    assert.notEqual(secondHep, firstHep);
    const revoked = await resolvePatientLinkToken(firstHep, { purpose: "hep" });
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, "revoked");
    const current = await resolvePatientLinkToken(secondHep, { purpose: "hep" });
    assert.equal(current.ok, true);

    const invoiceId = `inv-${suffix}`;
    db.prepare(
      `INSERT INTO invoices (id, tenant_id, invoice_number, patient_id, date, created_at)
       VALUES (?, ?, ?, ?, '2026-10-20', ?)`
    ).run(invoiceId, tenantId, `INV-${suffix}`, patientId, now);
    const receiptWrong = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "receipt", patientId: otherId, resourceId: invoiceId },
      auth
    );
    assert.equal(receiptWrong.status, 409);
    const receipt = await jsonRequest(
      port,
      "POST",
      "/api/patient-links",
      { purpose: "receipt", patientId, resourceId: invoiceId },
      auth
    );
    assert.equal(receipt.status, 201, String(receipt.json.error || ""));
    assert.match(String(receipt.json.url || ""), new RegExp(`^${serverBase}/pay/v/`));

    recordWhatsAppOptIn(db, { tenantId, phone: "+919800011122", optedIn: true, source: "test", actorId: userId });
    let threw = false;
    try {
      await sendPaymentReceipt({
        to: "+919800011122",
        patientName: "Asha Rao",
        clinicName: "Link Clinic",
        doctorName: "Dr Link",
        amount: 700,
        invoiceId,
        textBody: "Payment receipt",
        db,
        tenantId,
        fetchImpl: async () => {
          threw = true;
          throw new Error("network down");
        },
      });
    } catch (err) {
      threw = true;
      assert.match(err instanceof Error ? err.message : "", /network down|receipt dispatch/);
    }
    const minted = db
      .prepare(
        `SELECT revoked_at FROM patient_link_tokens
         WHERE tenant_id = ? AND resource_id = ? AND purpose = 'receipt'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(tenantId, invoiceId) as { revoked_at?: string | null } | undefined;
    assert.ok(minted, "a receipt token was minted for the invoice");
    if (threw || minted) assert.ok(minted?.revoked_at, "a failed dispatch revokes the receipt token");
  });
});
