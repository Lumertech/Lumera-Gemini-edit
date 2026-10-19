import { PATIENT_DOC_MAX_FILE_BYTES, PATIENT_REPORT_MAX_BYTES } from "./patientReportLimits.ts";

/** Client check before a reception intake file is queued. The server repeats this on upload. */
export function intakeFileProblem(file: { name: string; size: number; type: string }): string {
  if (!file || file.size <= 0) return "Choose a file to upload.";
  if (file.size > PATIENT_DOC_MAX_FILE_BYTES) return "Each file must be 10 MB or smaller.";
  if (file.size > PATIENT_REPORT_MAX_BYTES) return "Each report must be 25 MB or smaller.";
  const name = file.name.toLowerCase();
  const allowedExt = [".pdf", ".jpg", ".jpeg", ".png"];
  const allowedType = ["application/pdf", "image/jpeg", "image/png", "image/jpg", ""];
  const extOk = allowedExt.some((ext) => name.endsWith(ext));
  const type = (file.type || "").toLowerCase();
  if (type && !allowedType.includes(type) && type !== "application/octet-stream") {
    return "Use a PDF, JPG, or PNG file.";
  }
  if (!extOk && type && !allowedType.includes(type)) return "Use a PDF, JPG, or PNG file.";
  if (!extOk && !type) return "Use a PDF, JPG, or PNG file.";
  return "";
}

export function titleFromReportName(name: string): string {
  const base = String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  return base.slice(0, 200);
}
