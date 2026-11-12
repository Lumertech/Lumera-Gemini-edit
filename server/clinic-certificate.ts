import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import crypto from "node:crypto";
import type { SqlDatabase } from "./sql-engine.ts";
import { getTenantLetterhead } from "./letterhead.ts";

export const CERTIFICATE_KINDS = ["medical", "fitness"] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export function ensureCertificateTable(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_certificates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      appointment_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pdf_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function winAnsi(value: string): string {
  return Array.from(value)
    .map((char) => (char.charCodeAt(0) <= 255 ? char : " "))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function certificateBody(input: {
  kind: CertificateKind;
  patientName: string;
  age: number;
  gender: string;
  date: string;
  diagnosis: string;
  purpose: string;
  doctorName: string;
  clinicName: string;
}): { title: string; body: string } {
  const who = `${input.patientName}, ${input.age} years, ${input.gender}`.replace(/, ,/g, ",");
  if (input.kind === "fitness") {
    return {
      title: "Fitness certificate",
      body: `This is to certify that ${who} was examined at ${input.clinicName} on ${input.date} and is medically fit for ${input.purpose || "routine activity"}. Issued by ${input.doctorName}.`,
    };
  }
  return {
    title: "Medical certificate",
    body: `This is to certify that ${who} was examined at ${input.clinicName} on ${input.date}. Clinical note: ${input.diagnosis || "as recorded in the consultation"}. Issued by ${input.doctorName}.`,
  };
}

export async function renderCertificatePdf(input: {
  clinicName: string;
  address: string;
  phone: string;
  title: string;
  body: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.09, 0.16);
  page.drawText(winAnsi(input.clinicName) || "Clinic", { x: 48, y: 780, size: 18, font: bold, color: ink });
  page.drawText(winAnsi([input.address, input.phone].filter(Boolean).join(" · ")), {
    x: 48,
    y: 758,
    size: 10,
    font,
    color: ink,
  });
  page.drawLine({ start: { x: 48, y: 744 }, end: { x: 547, y: 744 }, thickness: 1, color: ink });
  page.drawText(winAnsi(input.title), { x: 48, y: 710, size: 16, font: bold, color: ink });
  const words = winAnsi(input.body).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, 12) > 480) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 18).forEach((line, index) => {
    page.drawText(line, { x: 48, y: 670 - index * 18, size: 12, font, color: ink });
  });
  return doc.save();
}

export async function issueCertificate(
  db: SqlDatabase,
  input: {
    tenantId: string;
    patientId: string;
    appointmentId?: string;
    kind: CertificateKind;
    patientName: string;
    age: number;
    gender: string;
    date: string;
    diagnosis: string;
    purpose: string;
    doctorName: string;
  }
): Promise<{ id: string; title: string }> {
  ensureCertificateTable(db);
  const letterhead = getTenantLetterhead(input.tenantId);
  const clinicName = letterhead.clinicName || "Clinic";
  const text = certificateBody({ ...input, clinicName });
  const pdf = await renderCertificatePdf({
    clinicName,
    address: [letterhead.address, letterhead.city].filter(Boolean).join(", "),
    phone: letterhead.phone,
    title: text.title,
    body: text.body,
  });
  const id = `cert-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO clinic_certificates (
       id, tenant_id, patient_id, appointment_id, kind, title, body, pdf_base64, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.tenantId,
    input.patientId,
    input.appointmentId || "",
    input.kind,
    text.title,
    text.body,
    Buffer.from(pdf).toString("base64"),
    new Date().toISOString()
  );
  return { id, title: text.title };
}
