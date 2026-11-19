import { getDb } from "./db.ts";

export type InvestigationFile = {
  id: string;
  title: string;
  docType: string;
  documentDate: string;
  appointmentId: string;
  createdAt: string;
};

export type InvestigationReport = {
  id: string;
  date: string;
  labName: string;
  category: string;
};

const FILE_TYPES = ["lab_report", "imaging"];

export function listInvestigations(tenantId: string, patientId: string): {
  files: InvestigationFile[];
  reports: InvestigationReport[];
} {
  const db = getDb();
  const files = db
    .prepare(
      `SELECT id, title, doc_type, document_date, appointment_id, created_at
       FROM patient_documents
       WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL
         AND doc_type IN ('lab_report', 'imaging')
       ORDER BY document_date DESC, created_at DESC`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  let reports: Record<string, unknown>[] = [];
  try {
    reports = db
      .prepare(
        `SELECT id, date, lab_name, category
         FROM lab_reports
         WHERE tenant_id = ? AND patient_id = ?
         ORDER BY date DESC, created_at DESC`
      )
      .all(tenantId, patientId) as Record<string, unknown>[];
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : String(err))) throw err;
  }
  return {
    files: files
      .filter((row) => FILE_TYPES.includes(String(row.doc_type || "")))
      .map((row) => ({
        id: String(row.id || ""),
        title: String(row.title || ""),
        docType: String(row.doc_type || ""),
        documentDate: String(row.document_date || ""),
        appointmentId: String(row.appointment_id || ""),
        createdAt: String(row.created_at || ""),
      })),
    reports: reports.map((row) => ({
      id: String(row.id || ""),
      date: String(row.date || ""),
      labName: String(row.lab_name || ""),
      category: String(row.category || ""),
    })),
  };
}

export function visitBelongsToPatient(tenantId: string, patientId: string, appointmentId: string): boolean {
  if (!appointmentId) return true;
  const row = getDb()
    .prepare("SELECT id FROM appointments WHERE id = ? AND tenant_id = ? AND patient_id = ?")
    .get(appointmentId, tenantId, patientId) as { id?: string } | undefined;
  return Boolean(row?.id);
}
