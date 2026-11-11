import type { MedicineItem, Prescription, SoapNote } from "../types";

const FREQUENCIES = new Set<MedicineItem["frequency"]>([
  "1-0-1",
  "1-0-0",
  "0-0-1",
  "1-1-1",
  "1-1-0",
  "0-1-0",
  "SOS",
  "Once a week",
]);

export interface ScribeMedicineEdit {
  drugName: string;
  dosage: string;
  frequency: string;
  durationDays: string;
}

/** Editable SOAP and draft Rx. Unedited sections stay on the note. */
export interface ScribeDraftEdit {
  chiefComplaints: string;
  historyOfPresentIllness: string;
  physicalExamination: string;
  primaryDiagnosis: string;
  icd10Code: string;
  medicines: ScribeMedicineEdit[];
}

export function scribeDraftEditFromSoap(soap: SoapNote): ScribeDraftEdit {
  return {
    chiefComplaints: (soap.subjective?.chiefComplaints || []).join("\n"),
    historyOfPresentIllness: soap.subjective?.historyOfPresentIllness || "",
    physicalExamination: soap.objective?.physicalExamination || "",
    primaryDiagnosis: soap.assessment?.primaryDiagnosis || "",
    icd10Code: soap.assessment?.icd10Code || "",
    medicines: (soap.plan?.medicines || []).map((med) => ({
      drugName: med.drugName || "",
      dosage: med.dosage || "",
      frequency: med.frequency || "",
      durationDays: med.durationDays == null ? "" : String(med.durationDays),
    })),
  };
}

function frequencyOf(typed: string, previous?: MedicineItem): MedicineItem["frequency"] {
  const trimmed = typed.trim();
  if (FREQUENCIES.has(trimmed as MedicineItem["frequency"])) return trimmed as MedicineItem["frequency"];
  return previous?.frequency || "1-0-1";
}

/**
 * Layer the doctor's edits onto the drafted note.
 * Fields they did not change, including labs, red flags, and specialty modules, stay.
 */
export function applyScribeDraftEdit(soap: SoapNote, edit: ScribeDraftEdit): SoapNote {
  const complaints = edit.chiefComplaints
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const medicines = edit.medicines
    .filter((row) => row.drugName.trim() || row.dosage.trim() || row.frequency.trim())
    .map((row, index) => {
      const previous = soap.plan?.medicines?.[index];
      const frequency = frequencyOf(row.frequency, previous);
      const days = Number(row.durationDays);
      const typedFrequency = row.frequency.trim();
      const frequencyKnown = FREQUENCIES.has(typedFrequency as MedicineItem["frequency"]);
      return {
        id: previous?.id || `med-draft-${index + 1}`,
        drugName: row.drugName.trim(),
        composition: previous?.composition || "",
        dosage: row.dosage.trim(),
        form: previous?.form || "Tablet",
        frequency,
        timing: previous?.timing || "After Food",
        durationDays: Number.isFinite(days) && days > 0 ? Math.round(days) : previous?.durationDays || 1,
        instructions: frequencyKnown ? previous?.instructions : typedFrequency || previous?.instructions,
      } satisfies MedicineItem;
    });
  return {
    ...soap,
    subjective: {
      ...soap.subjective,
      chiefComplaints: complaints,
      historyOfPresentIllness: edit.historyOfPresentIllness,
    },
    objective: {
      ...soap.objective,
      physicalExamination: edit.physicalExamination,
    },
    assessment: {
      ...soap.assessment,
      primaryDiagnosis: edit.primaryDiagnosis,
      icd10Code: edit.icd10Code,
    },
    plan: {
      ...soap.plan,
      medicines,
    },
  };
}

export function emptyScribeMedicine(): ScribeMedicineEdit {
  return { drugName: "", dosage: "", frequency: "1-0-1", durationDays: "3" };
}

/** An AI draft is not a chart entry until the doctor accepts it. */
export function unacceptedAiMustNotPersist(rx: {
  aiSource?: string;
  aiGeneratedAt?: string;
  aiAcknowledged?: boolean;
  reviewedBy?: string;
}): boolean {
  const ai = Boolean(String(rx.aiSource || "").trim() || String(rx.aiGeneratedAt || "").trim());
  if (!ai) return false;
  if (rx.aiAcknowledged === true) return false;
  if (String(rx.reviewedBy || "").trim()) return false;
  return true;
}

export function scribeAcceptanceAllowsPersist(input: {
  accepted?: boolean;
  aiAcknowledged?: boolean;
  reviewedBy?: string;
}): boolean {
  if (input.accepted === true) return true;
  if (input.aiAcknowledged === true) return true;
  return Boolean(String(input.reviewedBy || "").trim());
}

/** Vendor and key text must not reach the consult. */
export function publicScribeDraftError(raw: unknown): string {
  const text = String(raw || "").trim();
  if (!text || /gemini|api key|vertex|ai studio/i.test(text)) {
    return "Could not draft a SOAP note. Nothing was written to the chart.";
  }
  return text;
}

export function prescriptionCarriesAcceptance(rx: Pick<Prescription, "aiAcknowledged" | "reviewedBy">): boolean {
  return rx.aiAcknowledged === true || Boolean(String(rx.reviewedBy || "").trim());
}
