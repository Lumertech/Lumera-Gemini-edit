import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getDb, writeAudit } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { denyUnlessPatientRecordRole, denyUnlessPrescriber, isReceptionRole } from "./patient-access.ts";
import { requestIsPatient, sessionPatientId } from "./patient-tenant.ts";
import { readStoredPatientDocument } from "./patient-documents.ts";
import {
  AI_TRANSCRIPTION_NOT_CONFIGURED,
  vertexGeminiModel,
  vertexGenerateContent,
} from "./vertex-gemini.ts";

export type LabValueStatus = "Normal" | "Low" | "High" | "Critical" | "Unknown";

export type LabDraftValue = {
  param: string;
  value: string;
  unit: string;
  normalRange: string;
  status: LabValueStatus;
};

const STATUSES = new Set<LabValueStatus>(["Normal", "Low", "High", "Critical", "Unknown"]);
const READING_PROMPT = [
  "Read this laboratory report.",
  "Return JSON only, with no markdown, in this shape:",
  '{"results":[{"param":"Hemoglobin","value":"11.2","unit":"g/dL","normalRange":"12.0-15.0","status":"Low"}]}',
  "status is one of Normal, Low, High, Critical, or Unknown.",
  "Copy the reference range printed on the report.",
  "If a value or range is not printed, use an empty string and status Unknown.",
  "Do not invent results. Do not add a diagnosis or advice.",
].join(" ");

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000\r\n]/g, " ")
    .trim()
    .slice(0, max);
}

export function flagAgainstRange(value: string, range: string): LabValueStatus {
  const num = Number(value.replace(/,/g, ""));
  const match = range.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (!Number.isFinite(num) || !match) return "Unknown";
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (num < low) return "Low";
  if (num > high) return "High";
  return "Normal";
}

export function parseLabDraft(text: string): LabDraftValue[] {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw httpError(422, "No structured values could be read from this report.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw httpError(422, "No structured values could be read from this report.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : null;
  if (!rows) throw httpError(422, "No structured values could be read from this report.");
  const values: LabDraftValue[] = [];
  for (const row of rows.slice(0, 80)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const param = clip(item.param ?? item.name ?? item.test, 120);
    if (!param) continue;
    const value = clip(item.value, 40);
    const unit = clip(item.unit, 40);
    const normalRange = clip(item.normalRange ?? item.normal_range ?? item.range, 80);
    const given = clip(item.status, 20);
    const status = STATUSES.has(given as LabValueStatus)
      ? (given as LabValueStatus)
      : flagAgainstRange(value, normalRange);
    values.push({ param, value, unit, normalRange, status });
  }
  if (!values.length) throw httpError(422, "No structured values could be read from this report.");
  return values;
}

function parseStored(raw: unknown): LabDraftValue[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (Array.isArray(parsed)) return parseLabDraft(JSON.stringify({ results: parsed }));
    return parseLabDraft(JSON.stringify(parsed ?? {}));
  } catch {
    return [];
  }
}

type LabRow = Record<string, unknown>;

function presentReport(row: LabRow, role: string) {
  const status = String(row.status || "confirmed");
  const draft = status === "draft";
  const hideValues = isReceptionRole(role) || (draft && role === "patient");
  const source = draft ? row.draft_results : row.results;
  return {
    id: String(row.id || ""),
    date: String(row.date || ""),
    labName: String(row.lab_name || ""),
    category: String(row.category || ""),
    status,
    draft,
    documentId: String(row.document_id || ""),
    appointmentId: String(row.appointment_id || ""),
    results: hideValues ? [] : parseStored(source),
  };
}

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function patientMayRead(req: Request, patientId: string): boolean {
  if (!requestIsPatient(req)) return true;
  const own = sessionPatientId(req);
  return Boolean(own) && own === patientId;
}

function loadPatient(tenantId: string, patientId: string): Record<string, unknown> | undefined {
  return getDb()
    .prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as Record<string, unknown> | undefined;
}

function auditReading(req: Request, action: string, tenantId: string, patientId: string, entityId: string) {
  writeAudit(getDb(), req.user?.id || null, req.user?.name || "Doctor", action, "recorded", {
    tenantId,
    patientId,
    actorRole: String(req.user?.role || ""),
    entityType: "lab_report",
    entityId,
  });
}

export function registerLabReadingRoutes(api: Router) {
  api.get("/patients/:id/lab-reports", requireAuth, (req, res) => {
    if (!requestIsPatient(req) && !denyUnlessPatientRecordRole(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    if (!patientMayRead(req, req.params.id) || !loadPatient(tenantId, req.params.id)) {
      return res.status(404).json({ error: "Patient not found" });
    }
    const rows = getDb()
      .prepare(
        `SELECT * FROM lab_reports WHERE tenant_id = ? AND patient_id = ? ORDER BY date DESC, created_at DESC`
      )
      .all(tenantId, req.params.id) as LabRow[];
    const role = String(req.user?.role || "");
    const reports = rows
      .map((row) => presentReport(row, role))
      .filter((row) => (role === "patient" ? !row.draft : true));
    res.json({ reports });
  });

  api.post("/patients/:id/documents/:documentId/extract", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    void extractReport(req, res, tenantId);
  });

  api.patch("/patients/:id/lab-reports/:reportId", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    try {
      const row = loadOwnReport(tenantId, req.params.id, req.params.reportId);
      if (!row) return res.status(404).json({ error: "Lab report not found" });
      if (String(row.status || "") !== "draft") {
        return res.status(409).json({ error: "A confirmed reading cannot be edited here." });
      }
      const results = parseLabDraft(JSON.stringify({ results: (req.body || {}).results }));
      getDb()
        .prepare("UPDATE lab_reports SET draft_results = ? WHERE id = ? AND tenant_id = ? AND patient_id = ?")
        .run(JSON.stringify(results), String(row.id || ""), tenantId, req.params.id);
      auditReading(req, "lab_reading.draft_edited", tenantId, req.params.id, String(row.id));
      const next = loadOwnReport(tenantId, req.params.id, String(row.id));
      res.json({ report: next ? presentReport(next, String(req.user?.role || "")) : { id: row.id } });
    } catch (err) {
      sendErr(res, err);
    }
  });

  api.post("/patients/:id/lab-reports/:reportId/confirm", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = tenantIdOf(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      if (body.doctorConfirmed !== true && body.doctor_confirmed !== true) {
        return res.status(400).json({ error: "A doctor must confirm this draft before it is saved." });
      }
      const row = loadOwnReport(tenantId, req.params.id, req.params.reportId);
      if (!row) return res.status(404).json({ error: "Lab report not found" });
      if (String(row.status || "") !== "draft") {
        return res.status(409).json({ error: "This reading is already confirmed." });
      }
      const incoming = body.results;
      const results = Array.isArray(incoming)
        ? parseLabDraft(JSON.stringify({ results: incoming }))
        : parseStored(row.draft_results);
      if (!results.length) return res.status(400).json({ error: "There are no draft values to confirm." });
      const now = new Date().toISOString();
      getDb()
        .prepare(
          `UPDATE lab_reports
           SET results = ?, status = 'confirmed', confirmed_by_id = ?, confirmed_at = ?, draft_results = '[]'
           WHERE id = ? AND tenant_id = ? AND patient_id = ?`
        )
        .run(JSON.stringify(results), String(req.user?.id || ""), now, String(row.id || ""), tenantId, req.params.id);
      auditReading(req, "lab_reading.confirmed", tenantId, req.params.id, String(row.id));
      const next = loadOwnReport(tenantId, req.params.id, String(row.id));
      res.json({ report: next ? presentReport(next, String(req.user?.role || "")) : { id: row.id } });
    } catch (err) {
      sendErr(res, err);
    }
  });
}

function loadOwnReport(tenantId: string, patientId: string, reportId: string): LabRow | undefined {
  return getDb()
    .prepare("SELECT * FROM lab_reports WHERE id = ? AND tenant_id = ? AND patient_id = ?")
    .get(reportId, tenantId, patientId) as LabRow | undefined;
}

function sendErr(res: Response, err: unknown) {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
  const message = err instanceof Error ? err.message : "Could not read this report.";
  if (!status || status >= 500) reportCaughtError(err, "lab-reading");
  res.status(status || 500).json({ error: status && status < 500 ? message : "Could not read this report." });
}

async function extractReport(req: Request, res: Response, tenantId: string) {
  try {
    const patient = loadPatient(tenantId, req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    const doc = getDb()
      .prepare(
        `SELECT * FROM patient_documents
         WHERE id = ? AND tenant_id = ? AND patient_id = ? AND deleted_at IS NULL`
      )
      .get(req.params.documentId, tenantId, req.params.id) as Record<string, unknown> | undefined;
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (String(doc.doc_type || "") !== "lab_report" && String(doc.doc_type || "") !== "imaging") {
      return res.status(400).json({ error: "Only a lab report or imaging file can be read." });
    }
    const existing = getDb()
      .prepare("SELECT * FROM lab_reports WHERE tenant_id = ? AND patient_id = ? AND document_id = ?")
      .get(tenantId, req.params.id, String(doc.id || "")) as LabRow | undefined;
    if (existing && String(existing.status || "") === "confirmed") {
      return res.status(409).json({ error: "This report is already confirmed." });
    }
    const bytes = await readStoredPatientDocument(tenantId, String(doc.storage_key || ""), String(doc.storage_backend || "local"));
    let text = "";
    try {
      const response = await vertexGenerateContent({
        model: vertexGeminiModel(),
        contents: [
          { inlineData: { mimeType: String(doc.mime_type || "application/pdf"), data: bytes.toString("base64") } },
          { text: READING_PROMPT },
        ],
      });
      text = String(response.text || "");
    } catch (err) {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code || "") : "";
      if (code === AI_TRANSCRIPTION_NOT_CONFIGURED) {
        return res.status(503).json({ error: "Lab reading is not configured.", code });
      }
      console.error("lab reading failed", err instanceof Error ? err.name : "Error");
      return res.status(503).json({ error: "Lab reading is temporarily unavailable." });
    }
    const results = parseLabDraft(text);
    const now = new Date().toISOString();
    const id = existing ? String(existing.id) : `lab-${crypto.randomUUID().slice(0, 12)}`;
    if (existing) {
      getDb()
        .prepare(
          `UPDATE lab_reports
           SET draft_results = ?, status = 'draft', date = ?, appointment_id = ?
           WHERE id = ? AND tenant_id = ? AND patient_id = ?`
        )
        .run(JSON.stringify(results), String(doc.document_date || ""), String(doc.appointment_id || ""), id, tenantId, req.params.id);
    } else {
      getDb()
        .prepare(
          `INSERT INTO lab_reports (
            id, tenant_id, patient_id, patient_uhid, patient_name, date, lab_name, category,
            doctor_interpretation, results, pdf_url, created_at, document_id, appointment_id,
            status, draft_results, confirmed_by_id, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '[]', '', ?, ?, ?, 'draft', ?, '', '')`
        )
        .run(
          id,
          tenantId,
          req.params.id,
          String(patient.uhid || ""),
          String(patient.name || ""),
          String(doc.document_date || now.slice(0, 10)),
          "Uploaded report",
          String(doc.doc_type || "") === "imaging" ? "Imaging" : "Lab report",
          now,
          String(doc.id || ""),
          String(doc.appointment_id || ""),
          JSON.stringify(results)
        );
    }
    auditReading(req, "lab_reading.draft", tenantId, req.params.id, id);
    const saved = loadOwnReport(tenantId, req.params.id, id);
    res.status(existing ? 200 : 201).json({
      report: saved ? presentReport(saved, String(req.user?.role || "")) : { id, draft: true, results },
    });
  } catch (err) {
    sendErr(res, err);
  }
}
