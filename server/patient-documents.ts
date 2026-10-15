/**
 * Private patient documents.
 *
 * Bytes are never written under ./uploads and never mounted with express.static.
 * The default store is a tenant-prefixed directory outside the public tree.
 * When PATIENT_DOCS_GCS_BUCKET is set, the same key is a private GCS object.
 * GCS reads use a V4 signed URL that expires in five minutes; that URL is
 * fetched on the server and is not returned to the browser. Every HTTP read
 * and write loads the session (or a short-lived preview ticket minted from
 * that session) and requires the document's tenant_id to match.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { getDb, publicUser, writeAudit, type DbUser } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { reportCaughtError } from "./error-tracker.ts";

export const PATIENT_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const PATIENT_DOC_SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const PREVIEW_TICKET_TTL_MS = 5 * 60 * 1000;

export const PATIENT_DOC_TYPES = [
  "lab_report",
  "prescription",
  "discharge_summary",
  "imaging",
  "other",
] as const;

export type PatientDocType = (typeof PATIENT_DOC_TYPES)[number];

const DOCUMENT_STAFF = new Set(["doctor", "receptionist", "CLINIC_ADMIN", "polyclinic_admin"]);

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

type DocumentRow = {
  id: string;
  tenant_id: string;
  patient_id: string;
  title: string;
  doc_type: string;
  document_date: string;
  uploaded_by_id: string;
  uploaded_by_name: string;
  uploaded_by_role: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  storage_backend: string;
  created_at: string;
  deleted_at: string | null;
};

type PreviewTicket = {
  userId: string;
  tenantId: string;
  patientId: string;
  documentId: string;
  expiresAt: number;
};

const previewTickets = new Map<string, PreviewTicket>();

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function errorStatus(err: unknown, fallback = 500): number {
  return typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : fallback;
}

function gcsBucket(): string {
  return String(process.env.PATIENT_DOCS_GCS_BUCKET || "").trim();
}

export function patientDocsRoot(): string {
  return process.env.PATIENT_DOCS_DIR || path.join(process.cwd(), "data", "private-patient-docs");
}

function pathSegment(value: string, label: string): string {
  const raw = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(raw)) {
    throw httpError(400, `Invalid ${label}`);
  }
  return raw;
}

export function assertOwnedStorageKey(storageKey: string, tenantId: string): void {
  const key = String(storageKey || "");
  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    throw httpError(404, "Document not found");
  }
  const parts = key.split("/");
  if (parts.length !== 3) throw httpError(404, "Document not found");
  const [tenant, patient, file] = parts;
  if (tenant !== tenantId) throw httpError(404, "Document not found");
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(tenant)) throw httpError(404, "Document not found");
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(patient)) throw httpError(404, "Document not found");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(file)) throw httpError(404, "Document not found");
}

export function resolvePrivateDocumentPath(storageKey: string, tenantId: string): string {
  assertOwnedStorageKey(storageKey, tenantId);
  const root = path.resolve(patientDocsRoot());
  const full = path.resolve(root, storageKey);
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw httpError(404, "Document not found");
  }
  return full;
}

export function detectPatientDocumentMime(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return detectHeifMime(bytes);
}

function detectHeifMime(bytes: Buffer): "image/heic" | "image/heif" | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(4, 8).toString("latin1") !== "ftyp") return null;
  const brand = bytes.subarray(8, 12).toString("latin1").toLowerCase();
  if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx") return "image/heic";
  if (brand === "heif" || brand === "mif1" || brand === "msf1" || brand === "heim" || brand === "heis") {
    return "image/heif";
  }
  return null;
}

function declaredMatches(detected: string, declared: string): boolean {
  if (!declared || declared === "application/octet-stream") return true;
  if (declared === detected) return true;
  if (detected === "image/jpeg" && (declared === "image/jpg" || declared === "image/pjpeg")) return true;
  if (
    (detected === "image/heic" || detected === "image/heif") &&
    (declared === "image/heic" || declared === "image/heif")
  ) {
    return true;
  }
  return false;
}

export function assertAllowedPatientDocument(bytes: Buffer, declaredMime: string): string {
  if (!bytes.length) throw httpError(400, "The file is empty.");
  if (bytes.length > PATIENT_DOC_MAX_BYTES) throw httpError(400, "Each file must be 10 MB or smaller.");
  const detected = detectPatientDocumentMime(bytes);
  if (!detected || !ALLOWED_MIME.has(detected)) {
    throw httpError(400, "File type is not allowed. Use PDF, JPG, PNG, or HEIC.");
  }
  const declared = String(declaredMime || "").toLowerCase().split(";")[0].trim();
  if (!declaredMatches(detected, declared)) {
    throw httpError(400, "File contents do not match the declared type.");
  }
  return detected;
}

function parseTitle(value: unknown): string {
  const title = String(value || "").trim();
  if (!title || title.length > 200) throw httpError(400, "Enter a title (200 characters or fewer).");
  return title;
}

function parseDocType(value: unknown): PatientDocType {
  const docType = String(value || "").trim();
  if (!(PATIENT_DOC_TYPES as readonly string[]).includes(docType)) {
    throw httpError(400, "Choose a document type.");
  }
  return docType as PatientDocType;
}

function parseDocumentDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw httpError(400, "Enter a document date.");
  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw httpError(400, "Enter a valid document date.");
  }
  return raw;
}

function safeOriginalName(name: string): string {
  const base = path.basename(String(name || "document")).replace(/[\r\n\0]/g, "").slice(0, 180);
  return base || "document";
}

function contentDisposition(download: boolean, filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").slice(0, 160) || "document";
  return `${download ? "attachment" : "inline"}; filename="${ascii}"`;
}

function isClinicAdmin(role: string | undefined): boolean {
  return role === "CLINIC_ADMIN" || role === "polyclinic_admin";
}

function isDocumentStaff(req: Request, res: Response): boolean {
  if (!DOCUMENT_STAFF.has(String(req.user?.role || ""))) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  return true;
}

function tenantIdOf(req: Request, res: Response): string | null {
  const tenantId = String(req.user?.tenantId || "").trim();
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function patientInTenant(tenantId: string, patientId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as { id?: string } | undefined;
  return Boolean(row?.id);
}

function loadDocument(tenantId: string, patientId: string, documentId: string): DocumentRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM patient_documents
       WHERE id = ? AND tenant_id = ? AND patient_id = ? AND deleted_at IS NULL`
    )
    .get(documentId, tenantId, patientId) as DocumentRow | undefined;
}

function canDelete(req: Request, row: DocumentRow): boolean {
  return isClinicAdmin(req.user?.role) || req.user?.id === row.uploaded_by_id;
}

function publicDocument(row: DocumentRow, req: Request) {
  return {
    id: row.id,
    title: row.title,
    docType: row.doc_type,
    documentDate: row.document_date,
    uploadedById: row.uploaded_by_id,
    uploadedByName: row.uploaded_by_name,
    uploadedByRole: row.uploaded_by_role,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at,
    canDelete: canDelete(req, row),
  };
}

function audit(req: Request, action: string, details: Record<string, string>) {
  writeAudit(
    getDb(),
    req.user?.id || null,
    req.user?.name || "Staff",
    action,
    JSON.stringify(details)
  );
}

async function writeGcsObject(bucketName: string, storageKey: string, bytes: Buffer, mime: string) {
  const { Storage } = await import("@google-cloud/storage");
  await new Storage().bucket(bucketName).file(storageKey).save(bytes, {
    resumable: false,
    contentType: mime,
    metadata: { cacheControl: "private, no-store" },
  });
}

async function readGcsObject(bucketName: string, storageKey: string): Promise<Buffer> {
  const { Storage } = await import("@google-cloud/storage");
  const file = new Storage().bucket(bucketName).file(storageKey);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + PATIENT_DOC_SIGNED_URL_TTL_MS,
  });
  const response = await fetch(url);
  if (!response.ok) throw httpError(404, "Document not found");
  return Buffer.from(await response.arrayBuffer());
}

async function deleteGcsObject(bucketName: string, storageKey: string) {
  const { Storage } = await import("@google-cloud/storage");
  await new Storage().bucket(bucketName).file(storageKey).delete({ ignoreNotFound: true });
}

export async function storePatientDocumentBytes(
  tenantId: string,
  patientId: string,
  bytes: Buffer,
  mime: string
): Promise<{ storageKey: string; storageBackend: "local" | "gcs" }> {
  const tenant = pathSegment(tenantId, "tenant");
  const patient = pathSegment(patientId, "patient");
  const storageKey = `${tenant}/${patient}/${crypto.randomUUID()}`;
  const bucket = gcsBucket();
  if (bucket) {
    await writeGcsObject(bucket, storageKey, bytes, mime);
    return { storageKey, storageBackend: "gcs" };
  }
  const full = resolvePrivateDocumentPath(storageKey, tenant);
  fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
  fs.writeFileSync(full, bytes, { mode: 0o600 });
  return { storageKey, storageBackend: "local" };
}

export async function readStoredPatientDocument(
  tenantId: string,
  storageKey: string,
  storageBackend: string
): Promise<Buffer> {
  assertOwnedStorageKey(storageKey, tenantId);
  if (storageBackend === "gcs") {
    const bucket = gcsBucket();
    if (!bucket) throw httpError(404, "Document not found");
    return readGcsObject(bucket, storageKey);
  }
  if (storageBackend !== "local") throw httpError(404, "Document not found");
  const full = resolvePrivateDocumentPath(storageKey, tenantId);
  if (!fs.existsSync(full)) throw httpError(404, "Document not found");
  return fs.readFileSync(full);
}

export async function removeStoredPatientDocument(tenantId: string, storageKey: string, storageBackend: string) {
  assertOwnedStorageKey(storageKey, tenantId);
  if (storageBackend === "gcs") {
    const bucket = gcsBucket();
    if (bucket) await deleteGcsObject(bucket, storageKey);
    return;
  }
  if (storageBackend !== "local") return;
  const full = resolvePrivateDocumentPath(storageKey, tenantId);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

function sweepPreviewTickets() {
  const now = Date.now();
  for (const [id, ticket] of previewTickets) {
    if (ticket.expiresAt <= now) previewTickets.delete(id);
  }
}

function mintPreviewTicket(req: Request, tenantId: string, patientId: string, documentId: string): string {
  sweepPreviewTickets();
  const ticket = crypto.randomBytes(32).toString("hex");
  previewTickets.set(ticket, {
    userId: String(req.user?.id || ""),
    tenantId,
    patientId,
    documentId,
    expiresAt: Date.now() + PREVIEW_TICKET_TTL_MS,
  });
  return ticket;
}

function userFromPreviewTicket(req: Request): void {
  if (req.user) return;
  const ticketId = String(req.query.ticket || "").trim();
  if (!ticketId) return;
  const ticket = previewTickets.get(ticketId);
  if (!ticket || ticket.expiresAt <= Date.now()) {
    previewTickets.delete(ticketId);
    return;
  }
  if (ticket.patientId !== req.params.id || ticket.documentId !== req.params.documentId) return;
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(ticket.userId) as unknown as DbUser | undefined;
  if (!row || row.status === "disabled") return;
  if (String(row.tenant_id || "") !== ticket.tenantId) return;
  req.user = publicUser(row);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PATIENT_DOC_MAX_BYTES, files: 1 },
});

function sendKnownError(res: Response, err: unknown, fallback: string) {
  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : fallback;
  if (status >= 500) reportCaughtError(err, "patient-documents");
  if (!res.headersSent) res.status(status || 500).json({ error: status >= 500 ? fallback : message });
}

export function registerPatientDocumentRoutes(api: Router) {
  api.get("/patients/:id/documents", requireAuth, (req, res) => {
    try {
      if (!isDocumentStaff(req, res)) return;
      const tenantId = tenantIdOf(req, res);
      if (!tenantId) return;
      if (!patientInTenant(tenantId, req.params.id)) {
        return res.status(404).json({ error: "Patient not found" });
      }
      const rows = getDb()
        .prepare(
          `SELECT * FROM patient_documents
           WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
           ORDER BY document_date DESC, created_at DESC`
        )
        .all(tenantId, req.params.id) as DocumentRow[];
      res.json({ documents: rows.map((row) => publicDocument(row, req)) });
    } catch (err) {
      sendKnownError(res, err, "Failed to list documents");
    }
  });

  api.post("/patients/:id/documents", requireAuth, (req, res) => {
    if (!isDocumentStaff(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    if (!patientInTenant(tenantId, req.params.id)) {
      return res.status(404).json({ error: "Patient not found" });
    }
    upload.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err instanceof MulterError && err.code === "LIMIT_FILE_SIZE";
        res.status(400).json({
          error: tooBig ? "Each file must be 10 MB or smaller." : "Could not read the uploaded file.",
        });
        return;
      }
      void handleUpload(req, res, tenantId);
    });
  });

  api.post("/patients/:id/documents/:documentId/preview-ticket", requireAuth, (req, res) => {
    try {
      if (!isDocumentStaff(req, res)) return;
      const tenantId = tenantIdOf(req, res);
      if (!tenantId) return;
      if (!patientInTenant(tenantId, req.params.id)) {
        return res.status(404).json({ error: "Patient not found" });
      }
      const row = loadDocument(tenantId, req.params.id, req.params.documentId);
      if (!row) return res.status(404).json({ error: "Document not found" });
      const ticket = mintPreviewTicket(req, tenantId, req.params.id, row.id);
      res.json({ ticket, expiresInSeconds: Math.floor(PREVIEW_TICKET_TTL_MS / 1000) });
    } catch (err) {
      sendKnownError(res, err, "Failed to open the document");
    }
  });

  api.get("/patients/:id/documents/:documentId/file", (req, res) => {
    userFromPreviewTicket(req);
    requireAuth(req, res, () => {
      void handleFile(req, res);
    });
  });

  api.delete("/patients/:id/documents/:documentId", requireAuth, (req, res) => {
    void handleDelete(req, res);
  });
}

async function handleUpload(req: Request, res: Response, tenantId: string) {
  let stored: { storageKey: string; storageBackend: "local" | "gcs" } | undefined;
  let inserted = false;
  try {
    const file = req.file;
    if (!file?.buffer?.length) throw httpError(400, "Choose a file to upload.");
    const mime = assertAllowedPatientDocument(file.buffer, file.mimetype);
    const title = parseTitle(req.body?.title);
    const docType = parseDocType(req.body?.docType);
    const documentDate = parseDocumentDate(req.body?.documentDate);
    stored = await storePatientDocumentBytes(tenantId, req.params.id, file.buffer, mime);
    const id = `pdoc-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO patient_documents (
          id, tenant_id, patient_id, title, doc_type, document_date,
          uploaded_by_id, uploaded_by_name, uploaded_by_role,
          original_filename, mime_type, size_bytes, storage_key, storage_backend, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        req.params.id,
        title,
        docType,
        documentDate,
        req.user?.id || "",
        req.user?.name || "Staff",
        req.user?.role || "",
        safeOriginalName(file.originalname),
        mime,
        file.buffer.length,
        stored.storageKey,
        stored.storageBackend,
        now
      );
    inserted = true;
    audit(req, "patient_document.upload", {
      tenantId,
      patientId: req.params.id,
      documentId: id,
      docType,
    });
    const row = loadDocument(tenantId, req.params.id, id);
    res.status(201).json({ document: row ? publicDocument(row, req) : { id } });
  } catch (err) {
    if (stored && !inserted) {
      try {
        await removeStoredPatientDocument(tenantId, stored.storageKey, stored.storageBackend);
      } catch {
        /* the row was not inserted */
      }
    }
    sendKnownError(res, err, "Failed to upload the document");
  }
}

async function handleFile(req: Request, res: Response) {
  try {
    if (!isDocumentStaff(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    if (!patientInTenant(tenantId, req.params.id)) {
      return res.status(404).json({ error: "Patient not found" });
    }
    const row = loadDocument(tenantId, req.params.id, req.params.documentId);
    if (!row) return res.status(404).json({ error: "Document not found" });
    const bytes = await readStoredPatientDocument(tenantId, row.storage_key, row.storage_backend);
    const purpose = String(req.query.purpose || "view");
    const viewPurpose = purpose === "download" || purpose === "preview" || purpose === "thumbnail" ? purpose : "view";
    audit(req, "patient_document.view", {
      tenantId,
      patientId: req.params.id,
      documentId: row.id,
      docType: row.doc_type,
      purpose: viewPurpose,
    });
    const download = viewPurpose === "download";
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDisposition(download, row.original_filename));
    res.status(200).end(bytes);
  } catch (err) {
    sendKnownError(res, err, "Failed to open the document");
  }
}

async function handleDelete(req: Request, res: Response) {
  try {
    if (!isDocumentStaff(req, res)) return;
    const tenantId = tenantIdOf(req, res);
    if (!tenantId) return;
    if (!patientInTenant(tenantId, req.params.id)) {
      return res.status(404).json({ error: "Patient not found" });
    }
    const row = loadDocument(tenantId, req.params.id, req.params.documentId);
    if (!row) return res.status(404).json({ error: "Document not found" });
    if (!canDelete(req, row)) {
      return res.status(403).json({ error: "Only the uploader or a clinic admin can delete this document." });
    }
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE patient_documents SET deleted_at = ?
         WHERE id = ? AND tenant_id = ? AND patient_id = ? AND deleted_at IS NULL`
      )
      .run(now, row.id, tenantId, req.params.id);
    await removeStoredPatientDocument(tenantId, row.storage_key, row.storage_backend);
    audit(req, "patient_document.delete", {
      tenantId,
      patientId: req.params.id,
      documentId: row.id,
      docType: row.doc_type,
    });
    res.json({ ok: true });
  } catch (err) {
    sendKnownError(res, err, "Failed to delete the document");
  }
}
