/**
 * Public /rx/v/:token and /pay/v/:token pages.
 * The token helper returns only ids. This page sends an OTP to the phone
 * registered for that patient and shows diagnosis, medicines, or receipt
 * amounts only after the code matches.
 */

import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.ts";
import { dispatchWhatsAppCloudMessage } from "./graph-whatsapp.ts";
import { resolvePatientLinkToken, type PatientLinkPurpose } from "./patient-link-token.ts";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_ATTEMPT_LIMIT = 5;

type SendOtp = (opts: { to: string; code: string; tenantId: string }) => Promise<{ ok: boolean }>;

function ensureOtpSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_link_otps (
      token_hash TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(opts: { title: string; clinic: string; doctor: string; body: string }): string {
  const clinic = escapeHtml(opts.clinic || "your clinic");
  const doctor = escapeHtml(opts.doctor || "your clinician");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="font-family: Georgia, serif; margin: 2rem auto; max-width: 36rem; color: #1f2937;">
  <h1 style="font-size: 1.25rem;">${clinic}</h1>
  <p>Reviewed and signed by ${doctor}.</p>
  ${opts.body}
</body>
</html>`;
}

function clinicName(db: DatabaseSync, tenantId: string): string {
  try {
    const row = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(tenantId) as { name?: string } | undefined;
    return String(row?.name || "").trim();
  } catch {
    return "";
  }
}

function doctorName(db: DatabaseSync, tenantId: string, purpose: PatientLinkPurpose, resourceId: string): string {
  try {
    if (purpose === "rx") {
      const row = db
        .prepare(`SELECT doctor_name FROM prescriptions WHERE tenant_id = ? AND rx_number = ?`)
        .get(tenantId, resourceId) as { doctor_name?: string } | undefined;
      return String(row?.doctor_name || "").trim();
    }
    if (purpose === "receipt") {
      const row = db
        .prepare(
          `SELECT consulting_doctor_name FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?)`
        )
        .get(tenantId, resourceId, resourceId) as { consulting_doctor_name?: string } | undefined;
      return String(row?.consulting_doctor_name || "").trim();
    }
  } catch {
    return "";
  }
  return "";
}

function patientPhone(db: DatabaseSync, tenantId: string, patientId: string): string {
  try {
    const row = db
      .prepare(`SELECT phone FROM patients WHERE id = ? AND tenant_id = ?`)
      .get(patientId, tenantId) as { phone?: string } | undefined;
    return String(row?.phone || "").trim();
  } catch {
    return "";
  }
}

function reveal(db: DatabaseSync, purpose: PatientLinkPurpose, tenantId: string, resourceId: string): string {
  if (purpose === "receipt") {
    const invoice = db
      .prepare(
        `SELECT invoice_number, total_amount, date, status FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?)`
      )
      .get(tenantId, resourceId, resourceId) as
      | { invoice_number?: string; total_amount?: number; date?: string; status?: string }
      | undefined;
    return `<h2>Payment receipt</h2><p>Reference ${escapeHtml(String(invoice?.invoice_number || ""))}</p><p>Amount ${escapeHtml(String(invoice?.total_amount ?? ""))}</p><p>Date ${escapeHtml(String(invoice?.date || ""))}</p><p>Status ${escapeHtml(String(invoice?.status || ""))}</p>`;
  }
  if (purpose !== "rx") {
    return "<p>Verified.</p>";
  }
  const rx = db
    .prepare(`SELECT diagnosis, medicines FROM prescriptions WHERE tenant_id = ? AND rx_number = ?`)
    .get(tenantId, resourceId) as { diagnosis?: string; medicines?: string } | undefined;
  let lines = "";
  try {
    const meds = JSON.parse(String(rx?.medicines || "[]")) as Array<{ drugName?: string; dosage?: string }>;
    lines = meds
      .map((med) => `<li>${escapeHtml(String(med.drugName || "Medicine"))} ${escapeHtml(String(med.dosage || ""))}</li>`)
      .join("");
  } catch {
    lines = "";
  }
  return `<h2>Prescription</h2><p>${escapeHtml(String(rx?.diagnosis || ""))}</p><ul>${lines}</ul>`;
}

function form(action: "send" | "verify"): string {
  if (action === "send") {
    return `<form method="post">
      <p>We will send a code to the phone number registered at this clinic.</p>
      <button type="submit" name="action" value="send">Send code</button>
    </form>`;
  }
  return `<form method="post">
    <p>Enter the code sent to the phone number registered at this clinic.</p>
    <label>Code <input name="otp" inputmode="numeric" autocomplete="one-time-code" required /></label>
    <button type="submit" name="action" value="verify">Continue</button>
  </form>`;
}

async function defaultSendOtp(opts: { to: string; code: string; tenantId: string }): Promise<{ ok: boolean }> {
  const sent = await dispatchWhatsAppCloudMessage({
    to: opts.to,
    kind: "otp",
    otp: opts.code,
    purpose: "document_access",
    tenantId: opts.tenantId,
    textBody: `Verification code: ${opts.code}\nAction: document access\nValid for 10 minutes. Do not share this code.`,
    db: getDb(),
  });
  return { ok: sent.ok === true };
}

function handle(kind: PatientLinkPurpose, sendOtp: SendOtp) {
  return async (req: Request, res: Response) => {
    const token = String(req.params.token || "").trim();
    const resolved = await resolvePatientLinkToken(token, { purpose: kind });
    if (resolved.ok === false) {
      const status = resolved.reason === "not_found" || resolved.reason === "wrong_purpose" ? 404 : 410;
      res
        .status(status)
        .type("html")
        .send(page({ title: "Link", clinic: "Clinic", doctor: "", body: "<p>This link is not valid.</p>" }));
      return;
    }
    const db = getDb();
    const clinic = clinicName(db, resolved.tenantId);
    const doctor = doctorName(db, resolved.tenantId, kind, resolved.resourceId);
    const shell = (status: number, body: string) => {
      res.status(status).type("html").send(page({ title: clinic || "Clinic", clinic, doctor, body }));
    };
    const action = String((req.body as { action?: string } | undefined)?.action || "");
    const otp = String((req.body as { otp?: string } | undefined)?.otp || "").trim();
    if (req.method === "POST" && action === "verify" && otp) {
      ensureOtpSchema(db);
      const row = db.prepare(`SELECT otp_hash, expires_at, attempts FROM patient_link_otps WHERE token_hash = ?`).get(tokenHash(token)) as
        | { otp_hash?: string; expires_at?: string; attempts?: number }
        | undefined;
      const attempts = Number(row?.attempts || 0);
      const expired = !row?.expires_at || Date.parse(String(row.expires_at)) <= Date.now();
      const digest = hashCode(otp);
      const matches =
        Boolean(row?.otp_hash) &&
        digest.length === String(row?.otp_hash).length &&
        crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(row?.otp_hash)));
      if (!row || expired || attempts >= OTP_ATTEMPT_LIMIT || !matches) {
        if (row && !expired) {
          db.prepare(`UPDATE patient_link_otps SET attempts = attempts + 1 WHERE token_hash = ?`).run(tokenHash(token));
        }
        shell(403, `<p>That code does not match.</p>${form("verify")}`);
        return;
      }
      const consumed = await resolvePatientLinkToken(token, { purpose: kind, consume: true });
      if (consumed.ok === false) {
        shell(410, "<p>This link is not valid.</p>");
        return;
      }
      db.prepare(`DELETE FROM patient_link_otps WHERE token_hash = ?`).run(tokenHash(token));
      shell(200, reveal(db, kind, consumed.tenantId, consumed.resourceId));
      return;
    }
    if (req.method === "POST" && action === "send") {
      const phone = patientPhone(db, resolved.tenantId, resolved.patientId);
      if (!phone) {
        shell(409, "<p>This clinic does not have a phone number that can receive a code.</p>");
        return;
      }
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      ensureOtpSchema(db);
      const now = new Date();
      db.prepare(
        `INSERT INTO patient_link_otps (token_hash, otp_hash, expires_at, attempts, created_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(token_hash) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`
      ).run(tokenHash(token), hashCode(code), new Date(now.getTime() + OTP_TTL_MS).toISOString(), now.toISOString());
      const sent = await sendOtp({ to: phone, code, tenantId: resolved.tenantId });
      if (!sent.ok) {
        db.prepare(`DELETE FROM patient_link_otps WHERE token_hash = ?`).run(tokenHash(token));
        shell(503, "<p>The code could not be sent. Try again later.</p>");
        return;
      }
      shell(200, form("verify"));
      return;
    }
    const intro = kind === "rx" ? "<h2>Prescription</h2>" : kind === "receipt" ? "<h2>Payment receipt</h2>" : "<h2>Document</h2>";
    shell(200, `${intro}${form("send")}`);
  };
}

export function createPatientDocumentLinkRouter(deps?: { sendOtp?: SendOtp }): Router {
  const sendOtp = deps?.sendOtp || defaultSendOtp;
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.get("/rx/v/:token", handle("rx", sendOtp));
  router.post("/rx/v/:token", handle("rx", sendOtp));
  router.get("/pay/v/:token", handle("receipt", sendOtp));
  router.post("/pay/v/:token", handle("receipt", sendOtp));
  router.get("/portal/v/:token", handle("portal", sendOtp));
  router.post("/portal/v/:token", handle("portal", sendOtp));
  router.get("/hep/v/:token", handle("hep", sendOtp));
  router.post("/hep/v/:token", handle("hep", sendOtp));
  return router;
}

export function patientIdForPhone(db: DatabaseSync, tenantId: string, phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const tail = digits.slice(-10);
  try {
    const row = db
      .prepare(
        `SELECT id FROM patients WHERE tenant_id = ? AND REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') LIKE ? LIMIT 1`
      )
      .get(tenantId, `%${tail}`) as { id?: string } | undefined;
    return String(row?.id || "").trim();
  } catch {
    return "";
  }
}
