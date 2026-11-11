import type { Express, Request, Response } from "express";
import { getDb } from "./db.ts";
import { isProduction } from "./runtime.ts";
import { readStoredPatientDocument } from "./patient-documents.ts";
import {
  PATIENT_VISIT_SCRIPT,
  queueJson,
  renderExpiredVisitPage,
  renderMissingVisitPage,
  renderVisitPage,
} from "./patient-visit-page.ts";
import { loadVisitChart } from "./patient-visit-records.ts";
import { queueSnapshotFromAppointment } from "./patient-queue-status.ts";
import { appendTeleconsultSignal, listTeleconsultSignals } from "./teleconsult.ts";
import {
  issueVisitUnlock,
  readPatientVisitLink,
  readUnlockCookie,
  verifyPatientVisitOtp,
  visitUnlockValid,
} from "./patient-visit-token.ts";

function html(res: Response, status: number, body: string): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.send(body);
}

function setUnlockCookie(res: Response, value: string): void {
  const secure = isProduction() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `pv=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800${secure}`
  );
}

function otpMessage(code: "rejected" | "expired" | "locked"): string {
  if (code === "expired") return "That code has expired. Reply TOKEN on WhatsApp for a new one.";
  if (code === "locked") return "Too many attempts. Reply TOKEN on WhatsApp for a new code.";
  return "That code was not accepted.";
}

function queueForLink(link: { tenant_id: string; patient_id: string; appointment_id: string }) {
  if (!link.appointment_id) return null;
  const row = getDb()
    .prepare("SELECT * FROM appointments WHERE id = ? AND tenant_id = ? AND patient_id = ?")
    .get(link.appointment_id, link.tenant_id, link.patient_id) as Record<string, unknown> | undefined;
  return row ? queueSnapshotFromAppointment(getDb(), row) : null;
}

function unlocked(req: Request, linkId: string): boolean {
  return visitUnlockValid(linkId, readUnlockCookie(req.headers.cookie));
}

export function mountPatientVisitRoutes(app: Express): void {
  app.get("/patient-visit.js", (_req, res) => {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(PATIENT_VISIT_SCRIPT);
  });

  app.get("/v/:token", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found) return html(res, 404, renderMissingVisitPage());
    if (found.expired) return html(res, 410, renderExpiredVisitPage());
    const chart = unlocked(req, found.row.id) ? loadVisitChart(getDb(), found.row) : null;
    return html(res, 200, renderVisitPage({ linkId: found.row.id, queue: queueForLink(found.row), chart }));
  });

  app.post("/v/:token", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found) return html(res, 404, renderMissingVisitPage());
    if (found.expired) return html(res, 410, renderExpiredVisitPage());
    const code = String((req.body || {}).otp || "");
    const check = verifyPatientVisitOtp(getDb(), found.row.id, code);
    if (check !== "ok") {
      return html(
        res,
        401,
        renderVisitPage({
          linkId: found.row.id,
          queue: queueForLink(found.row),
          chart: null,
          otpError: otpMessage(check),
        })
      );
    }
    setUnlockCookie(res, issueVisitUnlock(found.row.id));
    const chart = loadVisitChart(getDb(), found.row);
    return html(res, 200, renderVisitPage({ linkId: found.row.id, queue: queueForLink(found.row), chart }));
  });

  app.get("/api/public/visit/:token", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found) return res.status(404).json({ error: "This link is not valid." });
    if (found.expired) return res.status(410).json({ error: "This link has expired." });
    const queue = queueJson(queueForLink(found.row));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      expiresAt: found.row.expires_at,
      needsCode: !unlocked(req, found.row.id),
      queue,
    });
  });

  app.get("/api/public/visit/:token/records", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found) return res.status(404).json({ error: "This link is not valid." });
    if (found.expired) return res.status(410).json({ error: "This link has expired." });
    if (!unlocked(req, found.row.id)) return res.status(401).json({ error: "Enter the WhatsApp code to open records." });
    const chart = loadVisitChart(getDb(), found.row);
    if (!chart) return res.status(404).json({ error: "This link is not valid." });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, chart });
  });

  app.get("/api/public/visit/:token/documents/:documentId", async (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found || found.expired) return res.status(404).json({ error: "This link is not valid." });
    if (!unlocked(req, found.row.id)) return res.status(401).json({ error: "Enter the WhatsApp code to open records." });
    const row = getDb()
      .prepare(
        `SELECT id, title, mime_type, storage_key, storage_backend, deleted_at
         FROM patient_documents
         WHERE id = ? AND tenant_id = ? AND patient_id = ?`
      )
      .get(req.params.documentId, found.row.tenant_id, found.row.patient_id) as
      | {
          mime_type?: string;
          storage_key?: string;
          storage_backend?: string;
          deleted_at?: string | null;
        }
      | undefined;
    if (!row || row.deleted_at) return res.status(404).json({ error: "Report not found." });
    try {
      const bytes = await readStoredPatientDocument(
        found.row.tenant_id,
        String(row.storage_key || ""),
        String(row.storage_backend || "")
      );
      res.setHeader("Content-Type", String(row.mime_type || "application/octet-stream"));
      res.setHeader("Content-Disposition", "attachment; filename=\"report\"");
      res.setHeader("Cache-Control", "no-store");
      res.send(bytes);
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 503;
      res.status(status || 503).json({ error: "Report file is not available." });
    }
  });

  app.delete("/api/public/visit/:token/documents/:documentId", (_req, res) => {
    res.status(405).json({ error: "Reports on a visit link cannot be deleted." });
  });

  app.get("/api/public/visit/:token/certificates/:certificateId", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found || found.expired) return res.status(404).json({ error: "This link is not valid." });
    if (!unlocked(req, found.row.id)) return res.status(401).json({ error: "Enter the WhatsApp code to open records." });
    const row = getDb()
      .prepare("SELECT pdf_base64, title FROM clinic_certificates WHERE id = ? AND tenant_id = ? AND patient_id = ?")
      .get(req.params.certificateId, found.row.tenant_id, found.row.patient_id) as
      | { pdf_base64?: string; title?: string }
      | undefined;
    if (!row?.pdf_base64) return res.status(404).json({ error: "Certificate not found." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(row.pdf_base64, "base64"));
  });

  app.post("/api/public/visit/:token/teleconsult/signal", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found || found.expired) return res.status(404).json({ error: "This link is not valid." });
    if (!unlocked(req, found.row.id)) return res.status(401).json({ error: "Enter the WhatsApp code to join." });
    if (!found.row.appointment_id) return res.status(404).json({ error: "Video visit not found." });
    try {
      const saved = appendTeleconsultSignal(getDb(), {
        tenantId: found.row.tenant_id,
        appointmentId: found.row.appointment_id,
        senderRole: "patient",
        kind: String(req.body?.kind || ""),
        payload: String(req.body?.payload || ""),
      });
      res.status(201).json({ ok: true, signal: saved });
    } catch (err) {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 400;
      res.status(status || 400).json({ error: err instanceof Error ? err.message : "Could not join." });
    }
  });

  app.get("/api/public/visit/:token/teleconsult/signals", (req, res) => {
    const found = readPatientVisitLink(getDb(), String(req.params.token || ""));
    if (!found || found.expired) return res.status(404).json({ error: "This link is not valid." });
    if (!unlocked(req, found.row.id)) return res.status(401).json({ error: "Enter the WhatsApp code to join." });
    if (!found.row.appointment_id) return res.status(404).json({ error: "Video visit not found." });
    res.json({
      ok: true,
      signals: listTeleconsultSignals(getDb(), found.row.tenant_id, found.row.appointment_id, String(req.query.after || "")),
    });
  });
}
