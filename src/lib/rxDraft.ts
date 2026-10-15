import type {
  CardiologyAssessment,
  DentalAssessment,
  DermatologyAssessment,
  GynecologyAssessment,
  MedicineItem,
  LabTestItem,
  OphthalmologyAssessment,
  OrthopedicAssessment,
  PediatricAssessment,
  PhysiotherapyAssessment,
  PhysiotherapyProcedure,
  PolyclinicSpecialty,
  PrescribedExercise,
  SoapNote,
  Vitals,
} from "../types.ts";

/**
 * Consult audio/text is PHI. The privacy policy keeps only the payload needed
 * to run a feature (DPDP data minimization), so drafts store a SHA-256 of the
 * transcript, never the raw transcript.
 */
export const DEMO_DRAFT_KEY_PREFIX = "lumera.rxDraft";

export type RiskLevel = NonNullable<SoapNote["assessment"]["riskLevel"]>;

export interface RxClinicalFields {
  chiefComplaints: string[];
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  reviewOfSystems: string;
  vitals: Vitals;
  physicalExamination: string;
  clinicalFindings: string[];
  diagnosis: string;
  icd10Code: string;
  differentialDiagnoses: string[];
  riskLevel: RiskLevel | null;
  medicines: MedicineItem[];
  labTests: LabTestItem[];
  advice: string[];
  redFlags: string[];
  followUpDays: number | null;
  followUpDate: string;
  specialtyType?: PolyclinicSpecialty;
  physiotherapyAssessment?: PhysiotherapyAssessment;
  performedTherapies: PhysiotherapyProcedure[];
  prescribedExercises: PrescribedExercise[];
  cardiologyAssessment?: CardiologyAssessment;
  dermatologyAssessment?: DermatologyAssessment;
  pediatricAssessment?: PediatricAssessment;
  orthopedicAssessment?: OrthopedicAssessment;
  ophthalmologyAssessment?: OphthalmologyAssessment;
  dentalAssessment?: DentalAssessment;
  gynecologyAssessment?: GynecologyAssessment;
  aiSource?: string;
  aiGeneratedAt?: string;
  transcriptHash?: string;
  transcriptSummary?: string;
  ambientRecordingDurationSec?: number;
  reviewedBy?: string;
  aiAcknowledged?: boolean;
  pendingAiFields: string[];
}

export const SOAP_RX_FIELD_NAMES = [
  "chiefComplaints",
  "historyOfPresentIllness",
  "pastMedicalHistory",
  "reviewOfSystems",
  "vitals",
  "physicalExamination",
  "clinicalFindings",
  "diagnosis",
  "icd10Code",
  "differentialDiagnoses",
  "riskLevel",
  "medicines",
  "labTests",
  "advice",
  "redFlags",
  "followUpDays",
  "followUpDate",
  "specialtyType",
  "physiotherapyAssessment",
  "performedTherapies",
  "prescribedExercises",
  "cardiologyAssessment",
  "dermatologyAssessment",
  "pediatricAssessment",
  "orthopedicAssessment",
  "ophthalmologyAssessment",
  "dentalAssessment",
  "gynecologyAssessment",
] as const;

export type SoapRxFieldName = (typeof SOAP_RX_FIELD_NAMES)[number];

export interface SoapApplyMeta {
  source: string;
  generatedAt: string;
  transcriptHash?: string;
  transcriptSummary?: string;
  ambientRecordingDurationSec?: number;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PatientDraftSession {
  patientId: string;
  phase: "loading" | "ready" | "error";
  draft: RxClinicalFields | null;
  version: number;
}

const RISK_LEVELS = new Set<RiskLevel>(["Low", "Moderate", "High", "Emergency"]);

export function emptyVitals(): Vitals {
  return { recordedAt: "" };
}

export async function transcriptHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function emptyClinicalSeed(): RxClinicalFields {
  return {
    chiefComplaints: [],
    historyOfPresentIllness: "",
    pastMedicalHistory: "",
    reviewOfSystems: "",
    vitals: emptyVitals(),
    physicalExamination: "",
    clinicalFindings: [],
    diagnosis: "",
    icd10Code: "",
    differentialDiagnoses: [],
    riskLevel: null,
    medicines: [],
    labTests: [],
    advice: [],
    redFlags: [],
    followUpDays: null,
    followUpDate: "",
    performedTherapies: [],
    prescribedExercises: [],
    pendingAiFields: [],
    aiAcknowledged: false,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asRisk(value: unknown): RiskLevel | null {
  return typeof value === "string" && RISK_LEVELS.has(value as RiskLevel) ? (value as RiskLevel) : null;
}

function asVitals(value: unknown): Vitals {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyVitals();
  const raw = value as Record<string, unknown>;
  const vitals: Vitals = {
    recordedAt: asString(raw.recordedAt),
  };
  const numeric: Array<keyof Vitals> = [
    "bloodPressureSystolic",
    "bloodPressureDiastolic",
    "heartRate",
    "temperature",
    "spO2",
    "respiratoryRate",
    "weightKg",
    "heightCm",
    "bmi",
    "bloodSugarRandom",
  ];
  for (const key of numeric) {
    const n = asNumberOrNull(raw[key]);
    if (n != null) (vitals[key] as number | undefined) = n;
  }
  if (typeof raw.recordedBy === "string") vitals.recordedBy = raw.recordedBy;
  return vitals;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function fieldValue(seed: RxClinicalFields, field: SoapRxFieldName): unknown {
  return seed[field];
}

function isPopulated(field: SoapRxFieldName, value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (field === "vitals") {
    const vitals = value as Vitals;
    return Boolean(
      vitals.recordedAt ||
        vitals.bloodPressureSystolic ||
        vitals.bloodPressureDiastolic ||
        vitals.heartRate ||
        vitals.temperature ||
        vitals.spO2 ||
        vitals.respiratoryRate ||
        vitals.weightKg
    );
  }
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

export function populatedAiFields(seed: RxClinicalFields): string[] {
  return SOAP_RX_FIELD_NAMES.filter((field) => isPopulated(field, fieldValue(seed, field)));
}

/** Map every SOAP section onto an Rx draft. Replaces; does not merge with a previous note. */
export function mapSoapToRxDraft(soap: SoapNote, meta: SoapApplyMeta): RxClinicalFields {
  const seed: RxClinicalFields = {
    chiefComplaints: asStringArray(soap.subjective?.chiefComplaints),
    historyOfPresentIllness: asString(soap.subjective?.historyOfPresentIllness),
    pastMedicalHistory: asString(soap.subjective?.pastMedicalHistory),
    reviewOfSystems: asString(soap.subjective?.reviewOfSystems),
    vitals: asVitals(soap.objective?.vitals),
    physicalExamination: asString(soap.objective?.physicalExamination),
    clinicalFindings: asStringArray(soap.objective?.clinicalFindings),
    diagnosis: asString(soap.assessment?.primaryDiagnosis),
    icd10Code: asString(soap.assessment?.icd10Code),
    differentialDiagnoses: asStringArray(soap.assessment?.differentialDiagnoses),
    riskLevel: asRisk(soap.assessment?.riskLevel),
    medicines: asArray<MedicineItem>(soap.plan?.medicines),
    labTests: asArray<LabTestItem>(soap.plan?.labTests),
    advice: asStringArray(soap.plan?.lifestyleAdvice),
    redFlags: asStringArray(soap.plan?.redFlags),
    followUpDays: asNumberOrNull(soap.plan?.followUpDays),
    followUpDate: asString(soap.plan?.followUpDate),
    specialtyType: soap.specialty,
    physiotherapyAssessment: soap.physiotherapyAssessment,
    performedTherapies: asArray<PhysiotherapyProcedure>(soap.performedTherapies),
    prescribedExercises: asArray<PrescribedExercise>(soap.prescribedExercises),
    cardiologyAssessment: soap.cardiologyAssessment,
    dermatologyAssessment: soap.dermatologyAssessment,
    pediatricAssessment: soap.pediatricAssessment,
    orthopedicAssessment: soap.orthopedicAssessment,
    ophthalmologyAssessment: soap.ophthalmologyAssessment,
    dentalAssessment: soap.dentalAssessment,
    gynecologyAssessment: soap.gynecologyAssessment,
    aiSource: meta.source,
    aiGeneratedAt: meta.generatedAt,
    transcriptHash: meta.transcriptHash || undefined,
    transcriptSummary: meta.transcriptSummary ?? soap.transcriptSummary,
    ambientRecordingDurationSec: meta.ambientRecordingDurationSec ?? soap.ambientRecordingDurationSec,
    reviewedBy: undefined,
    aiAcknowledged: false,
    pendingAiFields: [],
  };
  seed.pendingAiFields = populatedAiFields(seed);
  return seed;
}

export async function applySoapDraft(
  soap: SoapNote,
  input: { transcript?: string; source: string; generatedAt?: string }
): Promise<RxClinicalFields> {
  const transcript = String(input.transcript || "");
  const hash = transcript.trim() ? await transcriptHash(transcript) : undefined;
  return mapSoapToRxDraft(soap, {
    source: input.source,
    generatedAt: input.generatedAt || new Date().toISOString(),
    transcriptHash: hash,
    transcriptSummary: soap.transcriptSummary,
    ambientRecordingDurationSec: soap.ambientRecordingDurationSec,
  });
}

/** Second apply overwrites every AI-mapped field from the new SOAP note. */
export function replaceAiFields(_previous: RxClinicalFields, soap: SoapNote, meta: SoapApplyMeta): RxClinicalFields {
  return mapSoapToRxDraft(soap, meta);
}

export function shouldConfirmAiReplace(current: { aiSource?: string; aiGeneratedAt?: string }): boolean {
  return Boolean(String(current.aiSource || "").trim() || String(current.aiGeneratedAt || "").trim());
}

export function markAiFieldEdited(pending: readonly string[], field: string): string[] {
  return pending.filter((item) => item !== field);
}

export function aiFieldClass(pending: readonly string[], field: string): string {
  return pending.includes(field) ? "ring-2 ring-violet-400 bg-violet-50/80 rounded-lg" : "";
}

export function aiReviewAllowsDispatch(input: {
  aiSource?: string;
  aiGeneratedAt?: string;
  aiAcknowledged?: boolean;
  pendingAiFields?: readonly string[];
}): boolean {
  const ai = Boolean(String(input.aiSource || "").trim() || String(input.aiGeneratedAt || "").trim());
  if (!ai) return true;
  if (input.aiAcknowledged) return true;
  return (input.pendingAiFields || []).length === 0;
}

function readObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Read a stored draft back field-for-field. Missing keys stay empty — nothing is forced to 7 days, Low risk, or blank red flags. */
export function restoreRxDraft(raw: unknown): RxClinicalFields | null {
  const source = readObject(raw);
  if (!source) return null;
  const base = emptyClinicalSeed();
  const restored: RxClinicalFields = {
    ...base,
    chiefComplaints: asStringArray(source.chiefComplaints),
    historyOfPresentIllness: asString(source.historyOfPresentIllness),
    pastMedicalHistory: asString(source.pastMedicalHistory),
    reviewOfSystems: asString(source.reviewOfSystems),
    vitals: source.vitals == null ? emptyVitals() : asVitals(source.vitals),
    physicalExamination: asString(source.physicalExamination),
    clinicalFindings: asStringArray(source.clinicalFindings),
    diagnosis: asString(source.diagnosis),
    icd10Code: asString(source.icd10Code),
    differentialDiagnoses: asStringArray(source.differentialDiagnoses),
    riskLevel: asRisk(source.riskLevel),
    medicines: asArray<MedicineItem>(source.medicines),
    labTests: asArray<LabTestItem>(source.labTests),
    advice: asStringArray(source.advice),
    redFlags: asStringArray(source.redFlags),
    followUpDays: asNumberOrNull(source.followUpDays),
    followUpDate: asString(source.followUpDate),
    specialtyType: source.specialtyType as PolyclinicSpecialty | undefined,
    physiotherapyAssessment: source.physiotherapyAssessment as PhysiotherapyAssessment | undefined,
    performedTherapies: asArray<PhysiotherapyProcedure>(source.performedTherapies),
    prescribedExercises: asArray<PrescribedExercise>(source.prescribedExercises),
    cardiologyAssessment: source.cardiologyAssessment as CardiologyAssessment | undefined,
    dermatologyAssessment: source.dermatologyAssessment as DermatologyAssessment | undefined,
    pediatricAssessment: source.pediatricAssessment as PediatricAssessment | undefined,
    orthopedicAssessment: source.orthopedicAssessment as OrthopedicAssessment | undefined,
    ophthalmologyAssessment: source.ophthalmologyAssessment as OphthalmologyAssessment | undefined,
    dentalAssessment: source.dentalAssessment as DentalAssessment | undefined,
    gynecologyAssessment: source.gynecologyAssessment as GynecologyAssessment | undefined,
    aiSource: asString(source.aiSource) || undefined,
    aiGeneratedAt: asString(source.aiGeneratedAt) || undefined,
    transcriptHash: asString(source.transcriptHash) || undefined,
    transcriptSummary: asString(source.transcriptSummary) || undefined,
    ambientRecordingDurationSec: asNumberOrNull(source.ambientRecordingDurationSec) ?? undefined,
    reviewedBy: asString(source.reviewedBy) || undefined,
    aiAcknowledged: Boolean(source.aiAcknowledged),
    pendingAiFields: asStringArray(source.pendingAiFields),
  };
  return restored;
}

export function chronicPrefillSeed(patient: { chronicConditions?: string[] }): RxClinicalFields {
  const conditions = (patient.chronicConditions || []).map((item) => String(item).trim()).filter(Boolean);
  const seed = emptyClinicalSeed();
  if (!conditions.length) return seed;
  return {
    ...seed,
    chiefComplaints: conditions.map((condition) => `Evaluation & review of ${condition}`),
    diagnosis: `Clinical Evaluation: ${conditions[0]}`,
  };
}

export function buildInitialFormSeed(input: {
  draft: unknown | null | undefined;
  soap: SoapNote | null;
  patient: { chronicConditions?: string[] };
  soapMeta?: SoapApplyMeta;
}): RxClinicalFields {
  if (input.draft) {
    const restored = restoreRxDraft(input.draft);
    if (restored) return restored;
  }
  if (input.soap) {
    return mapSoapToRxDraft(
      input.soap,
      input.soapMeta || {
        source: "soap",
        generatedAt: input.soap.date || "",
        transcriptSummary: input.soap.transcriptSummary,
        ambientRecordingDurationSec: input.soap.ambientRecordingDurationSec,
      }
    );
  }
  return chronicPrefillSeed(input.patient);
}

export function openPatientDraft(patientId: string, version = 0): PatientDraftSession {
  return { patientId, phase: "loading", draft: null, version };
}

export function alignSessionToPatient(session: PatientDraftSession, patientId: string): PatientDraftSession {
  if (session.patientId === patientId) return session;
  return openPatientDraft(patientId, session.version);
}

export function completeDraftFetch(
  session: PatientDraftSession,
  patientId: string,
  raw: unknown | null
): PatientDraftSession {
  if (session.patientId !== patientId) return session;
  return {
    patientId,
    phase: "ready",
    draft: raw ? restoreRxDraft(raw) : null,
    version: session.version + 1,
  };
}

export function failDraftFetch(session: PatientDraftSession, patientId: string): PatientDraftSession {
  if (session.patientId !== patientId) return session;
  return { patientId, phase: "error", draft: null, version: session.version + 1 };
}

export function canAutosaveDraft(session: PatientDraftSession): boolean {
  return session.phase === "ready";
}

export function writerKey(session: PatientDraftSession): string | null {
  if (session.phase !== "ready") return null;
  return `${session.patientId}:${session.version}`;
}

/** Session tenant id for demo draft storage. Blank claims never fall back to a shared key. */
export function sessionDemoDraftTenant(tenantId: string | null | undefined): string | null {
  const id = String(tenantId ?? "").trim();
  return id.length > 0 ? id : null;
}

export function demoDraftStorageKey(tenantId: string, patientId: string): string | null {
  const tenant = sessionDemoDraftTenant(tenantId);
  const patient = String(patientId ?? "").trim();
  if (!tenant || !patient) return null;
  return `${DEMO_DRAFT_KEY_PREFIX}.${tenant}.${patient}`;
}

export function draftForStorage<T extends Record<string, unknown>>(draft: T): Omit<T, "transcript"> {
  const next = { ...draft } as Record<string, unknown>;
  delete next.transcript;
  return next as Omit<T, "transcript">;
}

export function readDemoDraft(storage: DraftStorage, tenantId: string, patientId: string): RxClinicalFields | null {
  const key = demoDraftStorageKey(tenantId, patientId);
  if (!key) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return restoreRxDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDemoDraft(storage: DraftStorage, tenantId: string, patientId: string, draft: Record<string, unknown>): void {
  const key = demoDraftStorageKey(tenantId, patientId);
  if (!key) return;
  const stored = draftForStorage(draft);
  storage.setItem(key, JSON.stringify(stored));
}
