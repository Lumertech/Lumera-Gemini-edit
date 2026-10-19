/**
 * Public /rx/v/:token and /pay/v/:token pages.
 * The token helper returns only ids. This page sends an OTP to the phone
 * registered for that patient and shows diagnosis, medicines, or receipt
 * amounts only after the code matches.
 *
 * Sends are capped per token at the stricter of 3 / 15 min and 3 / hour
 * (3 / 15 min), plus 10 per lifetime, and per phone and IP through the
 * shared OTP limiter. A resend never clears failed guesses.
 * Ten cumulative failures revoke the link.
 */

import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.ts";
import { dispatchWhatsAppCloudMessage } from "./graph-whatsapp.ts";
import { consumeClientIpAttempt, consumeHashedOtpAttempt, normalizeOtpPhone, requestClientIp } from "./otp-rate-limit.ts";
import { revokePatientLinkToken, resolvePatientLinkToken, type PatientLinkPurpose } from "./patient-link-token.ts";

const OTP_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const SEND_WINDOW_MAX = 3;
const SEND_LIFETIME_MAX = 10;
const FAILURE_REVOKE_AT = 10;

type SendOtp = (opts: { to: string; code: string; tenantId: string }) => Promise<{ ok: boolean }>;

type OtpRow = {
  otp_hash?: string;
  expires_at?: string;
  attempts?: number;
  send_count?: number;
  recent_sends?: string;
};

function ensureOtpSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_link_otps (
      token_hash TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      send_count INTEGER NOT NULL DEFAULT 0,
      recent_sends TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);
  try {
    db.exec("ALTER TABLE patient_link_otps ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE patient_link_otps ADD COLUMN recent_sends TEXT NOT NULL DEFAULT '[]'");
  } catch {
    /* column already exists */
  }
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

class PatientLinkOtpUnavailable extends Error {
  constructor() {
    super("PATIENT_LINK_OTP_SECRET is unset");
    this.name = "PatientLinkOtpUnavailable";
  }
}

function logMissingPatientLinkOtpSecret(): void {
  console.error("PATIENT_LINK_OTP_SECRET is unset. Refusing to issue or verify a patient-link OTP.");
}

/** Dedicated PATIENT_LINK_OTP_SECRET. Token-hash fallback is non-production only. JWT_SECRET is not a key. */
function otpMacKey(tokenHashHex: string): string {
  const secret = String(process.env.PATIENT_LINK_OTP_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    logMissingPatientLinkOtpSecret();
    throw new PatientLinkOtpUnavailable();
  }
  return tokenHashHex;
}

function hashCode(code: string, tokenHashHex: string): string {
  return crypto.createHmac("sha256", otpMacKey(tokenHashHex)).update(String(code || ""), "utf8").digest("hex");
}

/** Atomic failure count. Callers must read attempts from RETURNING, not from a prior row. */
export function incrementPatientLinkOtpAttempts(
  db: { prepare(sql: string): { get(...params: unknown[]): unknown } },
  tokenHashHex: string
): number {
  const updated = db
    .prepare(`UPDATE patient_link_otps SET attempts = attempts + 1 WHERE token_hash = ? RETURNING attempts`)
    .get(tokenHashHex) as { attempts?: number | string } | undefined;
  return Number(updated?.attempts || 0);
}

function macEquals(stored: string, digest: string): boolean {
  const left = Buffer.from(stored, "utf8");
  const right = Buffer.from(digest, "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function protect(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
}

function page(opts: { title: string; clinic: string; doctor: string; body: string; purpose?: PatientLinkPurpose }): string {
  const clinic = escapeHtml(opts.clinic || "your clinic");
  const doctorName = String(opts.doctor || "").trim();
  const doctor = escapeHtml(doctorName);
  let byline = "";
  if (opts.purpose === "rx") {
    byline = `<p>Reviewed and signed by ${doctor || "your clinician"}.</p>`;
  } else if (opts.purpose === "receipt") {
    byline = doctor ? `<p>Issued by ${clinic}. ${doctor}.</p>` : `<p>Issued by ${clinic}.</p>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="font-family: Georgia, serif; margin: 2rem auto; max-width: 36rem; color: #1f2937;">
  <h1 style="font-size: 1.25rem;">${clinic}</h1>
  ${byline}
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

function doctorName(
  db: DatabaseSync,
  tenantId: string,
  purpose: PatientLinkPurpose,
  resourceId: string,
  patientId: string
): string {
  try {
    if (purpose === "rx") {
      const row = db
        .prepare(`SELECT doctor_name FROM prescriptions WHERE tenant_id = ? AND rx_number = ? AND patient_id = ?`)
        .get(tenantId, resourceId, patientId) as { doctor_name?: string } | undefined;
      return String(row?.doctor_name || "").trim();
    }
    if (purpose === "receipt") {
      const row = db
        .prepare(
          `SELECT consulting_doctor_name FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?) AND patient_id = ?`
        )
        .get(tenantId, resourceId, resourceId, patientId) as { consulting_doctor_name?: string } | undefined;
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

function rxSignedForPatient(db: DatabaseSync, tenantId: string, resourceId: string, patientId: string): boolean {
  const rx = db
    .prepare(`SELECT patient_id, doctor_id, specialty_modules FROM prescriptions WHERE tenant_id = ? AND rx_number = ?`)
    .get(tenantId, resourceId) as { patient_id?: string; doctor_id?: string; specialty_modules?: string } | undefined;
  if (!rx || String(rx.patient_id || "") !== patientId) return false;
  const doctorId = String(rx.doctor_id || "").trim();
  if (!doctorId) return false;
  try {
    const modules = JSON.parse(String(rx.specialty_modules || "{}")) as { reviewedBy?: unknown };
    return String(modules.reviewedBy || "").trim() === doctorId;
  } catch {
    return false;
  }
}

function reveal(db: DatabaseSync, purpose: PatientLinkPurpose, tenantId: string, resourceId: string, patientId: string): string | null {
  if (purpose === "receipt") {
    const invoice = db
      .prepare(
        `SELECT invoice_number, total_amount, date, status FROM invoices WHERE tenant_id = ? AND (id = ? OR invoice_number = ?) AND patient_id = ?`
      )
      .get(tenantId, resourceId, resourceId, patientId) as
      | { invoice_number?: string; total_amount?: number; date?: string; status?: string }
      | undefined;
    if (!invoice) return null;
    return `<h2>Payment receipt</h2><p>Reference ${escapeHtml(String(invoice.invoice_number || ""))}</p><p>Amount ${escapeHtml(String(invoice.total_amount ?? ""))}</p><p>Date ${escapeHtml(String(invoice.date || ""))}</p><p>Status ${escapeHtml(String(invoice.status || ""))}</p>`;
  }
  if (purpose !== "rx") {
    return "<p>Verified.</p>";
  }
  if (!rxSignedForPatient(db, tenantId, resourceId, patientId)) return null;
  const rx = db
    .prepare(`SELECT diagnosis, medicines, patient_id FROM prescriptions WHERE tenant_id = ? AND rx_number = ? AND patient_id = ?`)
    .get(tenantId, resourceId, patientId) as { diagnosis?: string; medicines?: string; patient_id?: string } | undefined;
  if (!rx) return null;
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

function otpRow(db: DatabaseSync, hash: string): OtpRow | undefined {
  ensureOtpSchema(db);
  return db
    .prepare(`SELECT otp_hash, expires_at, attempts, send_count, recent_sends FROM patient_link_otps WHERE token_hash = ?`)
    .get(hash) as OtpRow | undefined;
}

function recentSendTimes(raw: string | undefined, now: number): number[] {
  try {
    const parsed = JSON.parse(String(raw || "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value) && now - value < SEND_WINDOW_MS);
  } catch {
    return [];
  }
}

function tokenSendBlock(row: OtpRow | undefined, now: number): "lifetime" | "window" | "locked" | null {
  if (Number(row?.attempts || 0) >= FAILURE_REVOKE_AT) return "locked";
  if (Number(row?.send_count || 0) >= SEND_LIFETIME_MAX) return "lifetime";
  if (recentSendTimes(row?.recent_sends, now).length >= SEND_WINDOW_MAX) return "window";
  return null;
}

function rememberSend(db: DatabaseSync, hash: string, code: string, now: Date) {
  const existing = otpRow(db, hash);
  const recent = recentSendTimes(existing?.recent_sends, now.getTime());
  recent.push(now.getTime());
  const expires = new Date(now.getTime() + OTP_TTL_MS).toISOString();
  if (!existing) {
    db.prepare(
      `INSERT INTO patient_link_otps (token_hash, otp_hash, expires_at, attempts, send_count, recent_sends, created_at)
       VALUES (?, ?, ?, 0, 1, ?, ?)`
    ).run(hash, hashCode(code, hash), expires, JSON.stringify(recent), now.toISOString());
    return;
  }
  db.prepare(
    `UPDATE patient_link_otps
     SET otp_hash = ?, expires_at = ?, send_count = send_count + 1, recent_sends = ?, created_at = ?
     WHERE token_hash = ?`
  ).run(hashCode(code, hash), expires, JSON.stringify(recent), now.toISOString(), hash);
}

function undoSend(db: DatabaseSync, hash: string, previous: OtpRow | undefined) {
  if (!previous) {
    db.prepare(`DELETE FROM patient_link_otps WHERE token_hash = ? AND attempts = 0`).run(hash);
    return;
  }
  db.prepare(
    `UPDATE patient_link_otps
     SET otp_hash = ?, expires_at = ?, send_count = ?, recent_sends = ?
     WHERE token_hash = ?`
  ).run(
    String(previous.otp_hash || ""),
    String(previous.expires_at || new Date(0).toISOString()),
    Number(previous.send_count || 0),
    String(previous.recent_sends || "[]"),
    hash
  );
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
    protect(res);
    const token = String(req.params.token || "").trim();
    const db = getDb();
    const action = String((req.body as { action?: string } | undefined)?.action || "");
    if (req.method === "POST" && action === "verify") {
      const ipLimit = consumeClientIpAttempt(requestClientIp(req));
      if (ipLimit.ok === false) {
        res.setHeader("Retry-After", String(ipLimit.retryAfterSec));
        res
          .status(429)
          .type("html")
          .send(page({ title: "Link", clinic: "Clinic", doctor: "", purpose: kind, body: "<p>Too many attempts. Try again later.</p>" }));
        return;
      }
    }
    const resolved = await resolvePatientLinkToken(token, { purpose: kind });
    if (resolved.ok === false) {
      const status = resolved.reason === "not_found" || resolved.reason === "wrong_purpose" ? 404 : 410;
      res
        .status(status)
        .type("html")
        .send(page({ title: "Link", clinic: "Clinic", doctor: "", purpose: kind, body: "<p>This link is not valid.</p>" }));
      return;
    }
    const clinic = clinicName(db, resolved.tenantId);
    const doctor = doctorName(db, resolved.tenantId, kind, resolved.resourceId, resolved.patientId);
    const shell = (status: number, body: string) => {
      res.status(status).type("html").send(page({ title: clinic || "Clinic", clinic, doctor, purpose: kind, body }));
    };
    const otp = String((req.body as { otp?: string } | undefined)?.otp || "").trim();
    const hash = tokenHash(token);
    if (req.method === "POST" && action === "verify" && otp) {
      const row = otpRow(db, hash);
      const attempts = Number(row?.attempts || 0);
      if (attempts >= FAILURE_REVOKE_AT) {
        await revokePatientLinkToken(token);
        shell(410, "<p>This link is not valid.</p>");
        return;
      }
      const expired = !row?.expires_at || Date.parse(String(row.expires_at)) <= Date.now();
      let digest = "";
      try {
        digest = hashCode(otp, hash);
      } catch (err) {
        if (err instanceof PatientLinkOtpUnavailable) {
          shell(503, "<p>The code could not be checked. Try again later.</p>");
          return;
        }
        throw err;
      }
      const stored = String(row?.otp_hash || "");
      const matches = macEquals(stored, digest);
      if (!row || expired || !matches) {
        if (row && !expired) {
          const next = incrementPatientLinkOtpAttempts(db, hash);
          if (next >= FAILURE_REVOKE_AT) {
            await revokePatientLinkToken(token);
            shell(410, "<p>This link is not valid.</p>");
            return;
          }
        }
        shell(403, `<p>That code does not match.</p>${form("verify")}`);
        return;
      }
      const consumed = await resolvePatientLinkToken(token, { purpose: kind, consume: true });
      if (consumed.ok === false) {
        shell(410, "<p>This link is not valid.</p>");
        return;
      }
      db.prepare(`DELETE FROM patient_link_otps WHERE token_hash = ?`).run(hash);
      const shown = reveal(db, kind, consumed.tenantId, consumed.resourceId, consumed.patientId);
      if (shown == null) {
        shell(410, "<p>This link is not valid.</p>");
        return;
      }
      shell(200, shown);
      return;
    }
    if (req.method === "POST" && action === "send") {
      const phone = patientPhone(db, resolved.tenantId, resolved.patientId);
      if (!phone) {
        shell(409, "<p>This clinic does not have a phone number that can receive a code.</p>");
        return;
      }
      const now = new Date();
      const existing = otpRow(db, hash);
      const blocked = tokenSendBlock(existing, now.getTime());
      if (blocked === "locked") {
        await revokePatientLinkToken(token);
        shell(410, "<p>This link is not valid.</p>");
        return;
      }
      if (blocked) {
        shell(429, "<p>Too many codes for this link. Try again later.</p>");
        return;
      }
      const phoneKey = normalizeOtpPhone(phone) || phone;
      const decision = consumeHashedOtpAttempt(phoneKey, requestClientIp(req), `patient-link:${phoneKey}`);
      if (!decision.ok) {
        res.setHeader("Retry-After", String(decision.retryAfterSec));
        shell(429, "<p>Too many OTP requests. Try again later.</p>");
        return;
      }
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        rememberSend(db, hash, code, now);
      } catch (err) {
        if (err instanceof PatientLinkOtpUnavailable) {
          shell(503, "<p>The code could not be sent. Try again later.</p>");
          return;
        }
        throw err;
      }
      const sent = await sendOtp({ to: phone, code, tenantId: resolved.tenantId });
      if (!sent.ok) {
        undoSend(db, hash, existing);
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
