import { getTenantLetterhead } from "./letterhead.ts";

export const RX_NUMBER_REQUIRED = "RX_NUMBER_REQUIRED";
export const RX_NOT_FOUND = "RX_NOT_FOUND";
export const RX_NOT_SIGNED = "RX_NOT_SIGNED";
export const RX_SEND_FAILED = "RX_SEND_FAILED";

type Sql = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
};

export type SignedRxSend =
  | { ok: false; status: number; code: string }
  | {
      ok: true;
      rxNumber: string;
      phone: string;
      patientName: string;
      doctorName: string;
      text: string;
      pdfUrl: string;
    };

function fail(status: number, code: string): SignedRxSend {
  return { ok: false, status, code };
}

function reviewedBy(row: Record<string, unknown>): string {
  try {
    const modules = JSON.parse(String(row.specialty_modules || "{}")) as { reviewedBy?: unknown };
    return String(modules.reviewedBy || "").trim();
  } catch {
    return "";
  }
}

function medicineLines(raw: unknown): { lines: string; count: number } {
  let medicines: Array<{ drugName?: unknown; dosage?: unknown; frequency?: unknown }> = [];
  if (Array.isArray(raw)) medicines = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) medicines = parsed;
    } catch {
      medicines = [];
    }
  }
  const lines = medicines
    .slice(0, 3)
    .map((med, index) => {
      const name = String(med.drugName || "Medicine");
      const dosage = String(med.dosage || "");
      const frequency = String(med.frequency || "");
      return `  ${index + 1}. *${name}* (${dosage} - ${frequency})`;
    })
    .join("\n");
  const more = medicines.length > 3 ? `\n  _...and ${medicines.length - 3} more medications_` : "";
  return { lines: `${lines}${more}`, count: medicines.length };
}

/** Clinic copy for a signed Rx. {{portal_url}} is replaced only with the server origin. */
export function signedRxWhatsAppText(input: {
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string;
  patientName: string;
  uhid: string;
  diagnosis: string;
  medicineLines: string;
  medicineCount: number;
  pdfUrl: string;
  portalUrl: string;
}): string {
  const clinicName = input.clinicName.trim() || "your clinic";
  const doctorName = input.doctorName.trim() || "your doctor";
  const specialty = input.doctorSpecialty.trim() || "General Medicine";
  const portalUrl = String(input.portalUrl || "").trim().replace(/\/$/, "");
  const template = `🩺 *${clinicName}*\n*Official Digital Prescription*\n\nNamaste *${input.patientName}* (UHID: ${input.uhid}),\nYour consultation prescription has been finalized and signed by *${doctorName}* (${specialty}).\n\n📋 *Diagnosis:* ${input.diagnosis}\n💊 *Prescribed Medications (${input.medicineCount}):*\n${input.medicineLines}\n\n📄 *Download Official PDF Prescription:*\n${input.pdfUrl}\n\nPatient portal: {{portal_url}}\n\n_Please follow the dosage schedule strictly. For emergency follow-up, reply to this chat._`;
  return template.replaceAll("{{portal_url}}", portalUrl);
}

/**
 * Load one signed prescription for the session tenant.
 * patientPhone, patientName, diagnosis, medicines, and portal_url on the body are never read.
 */
export function resolveSignedRxWhatsAppSend(
  db: Sql,
  tenantId: string,
  body: unknown,
  portalUrl: string
): SignedRxSend {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rxNumber = String(record.rxNumber || record.rx_number || "").trim();
  if (!rxNumber) return fail(400, RX_NUMBER_REQUIRED);
  const tenant = String(tenantId || "").trim();
  if (!tenant) return fail(404, RX_NOT_FOUND);

  const rx = db
    .prepare("SELECT * FROM prescriptions WHERE rx_number = ? AND tenant_id = ?")
    .get(rxNumber, tenant) as Record<string, unknown> | undefined;
  if (!rx) return fail(404, RX_NOT_FOUND);
  if (!reviewedBy(rx)) return fail(409, RX_NOT_SIGNED);

  const patientId = String(rx.patient_id || "").trim();
  const patient = patientId
    ? (db.prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?").get(patientId, tenant) as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const phone = String(patient?.phone || "").trim();
  if (!patient || !phone) return fail(404, RX_NOT_FOUND);

  const storedRxNumber = String(rx.rx_number || rxNumber);
  const pdfUrl = `/api/whatsapp/prescription/${storedRxNumber}/pdf`;
  const meds = medicineLines(rx.medicines);
  const clinicName = getTenantLetterhead(tenant).clinicName;
  const text = signedRxWhatsAppText({
    clinicName,
    doctorName: String(rx.doctor_name || ""),
    doctorSpecialty: String(rx.doctor_specialty || ""),
    patientName: String(patient.name || "").trim() || "Patient",
    uhid: String(patient.uhid || ""),
    diagnosis: String(rx.diagnosis || ""),
    medicineLines: meds.lines,
    medicineCount: meds.count,
    pdfUrl,
    portalUrl,
  });
  return {
    ok: true,
    rxNumber: storedRxNumber,
    phone,
    patientName: String(patient.name || "").trim() || "Patient",
    doctorName: String(rx.doctor_name || "").trim() || "your doctor",
    text,
    pdfUrl,
  };
}
