import { giveVaccine } from "./accounts.ts";
import { getDb, mapPatient, writeAudit } from "./db.ts";
import { ensureImmunizationSchema } from "./immunization-schema.ts";
import { getTenantLetterhead } from "./letterhead.ts";
import { vaccineDueReminderHook } from "../src/lib/vaccineDueReminderHook.ts";
import {
  IMMUNIZATION_CATALOG_VERSION,
  IMMUNIZATION_SAFETY_NOTICE,
  IMMUNIZATION_SCHEDULES,
  applyScheduleEdits,
  canonicalSex,
  canonicalSpecies,
  computeImmunizationChart,
  isIsoDate,
  scheduleById,
  type ChartDose,
  type ChartRecord,
  type DoseEdit,
  type ScheduleId,
} from "../src/lib/immunizationSchedules.ts";

export function immunizationError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function dbReady() {
  const database = getDb();
  ensureImmunizationSchema(database);
  return database;
}

export interface ClinicImmunizationSettings {
  pediatricScheduleId: "pediatric_iap" | "pediatric_uip";
  endemicJe: boolean;
  includeOptional: boolean;
  edits: DoseEdit[];
  catalogVersion: string;
  updatedByName: string;
  updatedAt: string;
}

const EMPTY_SETTINGS: ClinicImmunizationSettings = {
  pediatricScheduleId: "pediatric_iap",
  endemicJe: false,
  includeOptional: true,
  edits: [],
  catalogVersion: IMMUNIZATION_CATALOG_VERSION,
  updatedByName: "",
  updatedAt: "",
};

function readEdits(raw: unknown): DoseEdit[] {
  if (!Array.isArray(raw)) return [];
  const edits: DoseEdit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const scheduleId = String(row.scheduleId || row.schedule_id || "").trim();
    const code = String(row.code || "").trim();
    if (!scheduleById(scheduleId) && !code.startsWith("clinic-")) continue;
    if (!scheduleId || !code) continue;
    const edit: DoseEdit = { scheduleId, code };
    if (row.dueAgeDays != null && row.dueAgeDays !== "") edit.dueAgeDays = Number(row.dueAgeDays);
    if (row.overdueAfterDays != null && row.overdueAfterDays !== "") {
      edit.overdueAfterDays = Number(row.overdueAfterDays);
    }
    if (row.doseLabel != null) edit.doseLabel = String(row.doseLabel).slice(0, 80);
    if (row.antigen != null) edit.antigen = String(row.antigen).slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(row, "recurringEveryDays")) {
      const interval = row.recurringEveryDays == null || row.recurringEveryDays === "" ? null : Number(row.recurringEveryDays);
      edit.recurringEveryDays = interval;
    }
    if (row.disabled === true) edit.disabled = true;
    if (row.notes != null) edit.notes = String(row.notes).slice(0, 400);
    edits.push(edit);
  }
  return edits;
}

export function validateDoseEdits(edits: DoseEdit[]): void {
  for (const edit of edits) {
    if (!scheduleById(edit.scheduleId)) {
      throw immunizationError(400, "Unknown schedule.");
    }
    const known = IMMUNIZATION_SCHEDULES[edit.scheduleId as ScheduleId].doses.some((dose) => dose.code === edit.code);
    const custom = edit.code.startsWith("clinic-") && /^clinic-[a-z0-9-]{1,40}$/.test(edit.code);
    if (!known && !custom) throw immunizationError(400, "Unknown dose on this schedule.");
    if (edit.dueAgeDays != null && (!Number.isInteger(edit.dueAgeDays) || edit.dueAgeDays < 0 || edit.dueAgeDays > 8000)) {
      throw immunizationError(400, "Due age must be a whole number of days from birth, up to 8000.");
    }
    if (
      edit.overdueAfterDays != null &&
      (!Number.isInteger(edit.overdueAfterDays) || edit.overdueAfterDays < (edit.dueAgeDays ?? 0) || edit.overdueAfterDays > 9000)
    ) {
      throw immunizationError(400, "The overdue age must be on or after the due age.");
    }
    if (edit.recurringEveryDays != null && edit.recurringEveryDays !== undefined) {
      const interval = Number(edit.recurringEveryDays);
      if (!Number.isInteger(interval) || interval < 7 || interval > 3650) {
        throw immunizationError(400, "A repeating interval must be between 7 and 3650 days.");
      }
    }
    if (custom && !edit.disabled && (!edit.antigen?.trim() || edit.dueAgeDays == null)) {
      throw immunizationError(400, "A clinic-added dose needs an antigen and a due age.");
    }
  }
}

export function getImmunizationSettings(tenantId: string): ClinicImmunizationSettings {
  const row = dbReady()
    .prepare("SELECT * FROM immunization_clinic_settings WHERE tenant_id = ?")
    .get(tenantId) as Record<string, unknown> | undefined;
  if (!row) return { ...EMPTY_SETTINGS, edits: [] };
  const pediatric = String(row.pediatric_schedule_id || "") === "pediatric_uip" ? "pediatric_uip" : "pediatric_iap";
  return {
    pediatricScheduleId: pediatric,
    endemicJe: Number(row.endemic_je || 0) === 1,
    includeOptional: Number(row.include_optional ?? 1) !== 0,
    edits: readEdits(JSON.parse(String(row.edits_json || "[]"))),
    catalogVersion: String(row.catalog_version || IMMUNIZATION_CATALOG_VERSION),
    updatedByName: String(row.updated_by_name || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export function saveImmunizationSettings(
  tenantId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string; role?: string }
): ClinicImmunizationSettings {
  const pediatric = String(body.pediatricScheduleId || body.pediatric_schedule_id || "pediatric_iap");
  if (pediatric !== "pediatric_iap" && pediatric !== "pediatric_uip") {
    throw immunizationError(400, "Choose the IAP schedule or the Government of India UIP schedule.");
  }
  const edits = readEdits(body.edits);
  validateDoseEdits(edits);
  const now = new Date().toISOString();
  dbReady()
    .prepare(
      `INSERT INTO immunization_clinic_settings (
        tenant_id, pediatric_schedule_id, endemic_je, include_optional, edits_json, catalog_version,
        updated_by_id, updated_by_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        pediatric_schedule_id = excluded.pediatric_schedule_id,
        endemic_je = excluded.endemic_je,
        include_optional = excluded.include_optional,
        edits_json = excluded.edits_json,
        catalog_version = excluded.catalog_version,
        updated_by_id = excluded.updated_by_id,
        updated_by_name = excluded.updated_by_name,
        updated_at = excluded.updated_at`
    )
    .run(
      tenantId,
      pediatric,
      body.endemicJe === true || body.endemic_je === true ? 1 : 0,
      body.includeOptional === false || body.include_optional === false ? 0 : 1,
      JSON.stringify(edits),
      IMMUNIZATION_CATALOG_VERSION,
      actor.id,
      actor.name,
      now
    );
  writeAudit(getDb(), actor.id, actor.name, "Immunization schedule edited", `Pediatric schedule ${pediatric}`, {
    tenantId,
    entityType: "immunization_schedule",
    entityId: tenantId,
    actorRole: actor.role || "",
  });
  return getImmunizationSettings(tenantId);
}

function patientRow(tenantId: string, patientId: string): Record<string, unknown> | undefined {
  return dbReady()
    .prepare("SELECT * FROM patients WHERE id = ? AND tenant_id = ?")
    .get(patientId, tenantId) as Record<string, unknown> | undefined;
}

function doseRecords(tenantId: string, patientId: string): ChartRecord[] {
  const rows = dbReady()
    .prepare(
      `SELECT * FROM immunization_dose_records WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at ASC`
    )
    .all(tenantId, patientId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    occurrenceKey: String(row.occurrence_key),
    status: String(row.status) as ChartRecord["status"],
    givenOn: String(row.given_on || ""),
    brand: String(row.brand || ""),
    batchNo: String(row.batch_no || ""),
    givenByName: String(row.given_by_name || ""),
    reason: String(row.reason || ""),
    stockAdministrationId: String(row.stock_administration_id || ""),
  }));
}

export type ChartAudience = "auto" | "pediatric" | "veterinary";

function resolveScheduleId(
  audience: ChartAudience,
  species: ReturnType<typeof canonicalSpecies>,
  settings: ClinicImmunizationSettings,
  requested?: string
): { scheduleId: ScheduleId } | { empty: string } {
  if (requested && scheduleById(requested)) {
    const schedule = scheduleById(requested)!;
    if (schedule.family === "veterinary" && schedule.species && species && species !== schedule.species) {
      return { empty: "This schedule does not match the animal's species." };
    }
    return { scheduleId: schedule.id };
  }
  if (audience === "veterinary" || (audience === "auto" && (species === "dog" || species === "cat"))) {
    if (species === "dog") return { scheduleId: "canine" };
    if (species === "cat") return { scheduleId: "feline" };
    if (species === "other") return { empty: "No published schedule for this species. Dog and cat charts are configured." };
    return { empty: "Set the species (dog or cat) to compute the veterinary chart. The owner stays the existing contact." };
  }
  return { scheduleId: settings.pediatricScheduleId };
}

function letterheadFor(tenantId: string) {
  const letterhead = getTenantLetterhead(tenantId);
  return {
    clinicName: letterhead.clinicName,
    tagline: letterhead.tagline,
    address: letterhead.address,
    city: letterhead.city,
    phone: letterhead.phone,
    email: letterhead.email,
    regId: letterhead.regId,
  };
}

export function buildImmunizationChart(
  tenantId: string,
  patientId: string,
  options: { audience?: ChartAudience; scheduleId?: string; today?: string } = {}
) {
  const row = patientRow(tenantId, patientId);
  if (!row) throw immunizationError(404, "Patient not found");
  const patient = mapPatient(row);
  const species = canonicalSpecies(patient.species);
  const settings = getImmunizationSettings(tenantId);
  const audience = options.audience || "auto";
  const today = options.today && isIsoDate(options.today) ? options.today : new Date().toISOString().slice(0, 10);
  const dob = String(patient.dateOfBirth || "");
  const base = {
    patientId,
    patientName: patient.name,
    uhid: patient.uhid,
    dateOfBirth: dob,
    species,
    breed: patient.breed || "",
    ownerName: patient.ownerName || "",
    sex: canonicalSex(patient.gender),
    safetyNotice: IMMUNIZATION_SAFETY_NOTICE,
    catalogVersion: IMMUNIZATION_CATALOG_VERSION,
    reminder: vaccineDueReminderHook(),
    letterhead: letterheadFor(tenantId),
    settings: {
      pediatricScheduleId: settings.pediatricScheduleId,
      endemicJe: settings.endemicJe,
      includeOptional: settings.includeOptional,
      edits: settings.edits,
      updatedByName: settings.updatedByName,
      updatedAt: settings.updatedAt,
    },
  };
  if (!isIsoDate(dob)) {
    return {
      ...base,
      applicable: false,
      needsDateOfBirth: true,
      needsSpecies: false,
      message: "Add a date of birth to compute the immunization chart.",
      schedule: null,
      doses: [] as ChartDose[],
    };
  }
  const picked = resolveScheduleId(audience, species, settings, options.scheduleId);
  if ("empty" in picked) {
    return {
      ...base,
      applicable: false,
      needsDateOfBirth: false,
      needsSpecies: species !== "dog" && species !== "cat",
      message: picked.empty,
      schedule: null,
      doses: [] as ChartDose[],
    };
  }
  const schedule = IMMUNIZATION_SCHEDULES[picked.scheduleId];
  const ageDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dob}T00:00:00Z`)) / 86400000
  );
  if (audience === "auto" && schedule.family === "pediatric" && ageDays > 18 * 365) {
    return {
      ...base,
      applicable: false,
      needsDateOfBirth: false,
      needsSpecies: false,
      message: "This record is older than 18 years, so the childhood schedule is not opened automatically. Open it from Pediatrics if you still need the chart.",
      schedule: { id: schedule.id, version: schedule.version, title: schedule.title, citation: schedule.citation },
      doses: [] as ChartDose[],
    };
  }
  const computed = computeImmunizationChart({
    dateOfBirth: dob,
    today,
    schedule,
    records: doseRecords(tenantId, patientId),
    endemicJe: settings.endemicJe,
    includeOptional: settings.includeOptional,
    edits: settings.edits,
    sex: canonicalSex(patient.gender),
  });
  if (computed.ok === false) throw immunizationError(400, computed.error);
  return {
    ...base,
    applicable: true,
    needsDateOfBirth: false,
    needsSpecies: false,
    message: "",
    schedule: { id: schedule.id, version: schedule.version, title: schedule.title, citation: schedule.citation },
    doses: computed.doses,
  };
}

function assertDoctorConfirmed(body: Record<string, unknown>) {
  if (body.doctorConfirmed !== true && body.doctor_confirmed !== true) {
    throw immunizationError(
      400,
      "The doctor must confirm this dose. Schedules are reminders and are not given automatically."
    );
  }
}

function findChartDose(chart: ReturnType<typeof buildImmunizationChart>, occurrenceKey: string): ChartDose {
  const dose = chart.doses.find((item) => item.occurrenceKey === occurrenceKey);
  if (!dose) throw immunizationError(400, "That dose is not on this patient's chart.");
  return dose;
}

export function recordImmunizationDose(
  tenantId: string,
  patientId: string,
  body: Record<string, unknown>,
  actor: { id: string; name: string; role?: string }
) {
  assertDoctorConfirmed(body);
  const status = String(body.status || "given").trim();
  if (status !== "given" && status !== "skipped" && status !== "contraindicated") {
    throw immunizationError(400, "Status must be given, skipped, or contraindicated.");
  }
  const occurrenceKey = String(body.occurrenceKey || body.occurrence_key || "").trim();
  if (!occurrenceKey) throw immunizationError(400, "Choose a dose on the chart.");
  const audience = String(body.audience || "auto") as ChartAudience;
  const chart = buildImmunizationChart(tenantId, patientId, {
    audience: audience === "pediatric" || audience === "veterinary" ? audience : "auto",
    scheduleId: String(body.scheduleId || body.schedule_id || ""),
  });
  if (!chart.applicable || !chart.schedule) {
    throw immunizationError(400, chart.message || "This chart cannot take a dose yet.");
  }
  const dose = findChartDose(chart, occurrenceKey);
  const reason = String(body.reason || "").trim().slice(0, 400);
  if ((status === "skipped" || status === "contraindicated") && !reason) {
    throw immunizationError(400, "A skipped or contraindicated dose needs a reason.");
  }
  let givenOn = String(body.givenOn || body.given_on || "").trim();
  if (status === "given") {
    if (!isIsoDate(givenOn)) throw immunizationError(400, "Enter the date the dose was given.");
    if (chart.dateOfBirth && givenOn < chart.dateOfBirth) {
      throw immunizationError(400, "The given date cannot be before the date of birth.");
    }
    const today = new Date().toISOString().slice(0, 10);
    if (givenOn > today) throw immunizationError(400, "The given date cannot be in the future.");
  } else {
    givenOn = "";
  }
  let brand = String(body.brand || "").trim().slice(0, 80);
  let batchNo = String(body.batchNo || body.batch_no || "").trim().slice(0, 80);
  let stockAdministrationId = String(body.stockAdministrationId || body.stock_administration_id || "").trim();
  const givenByName = String(body.givenByName || body.given_by_name || actor.name).trim().slice(0, 120) || actor.name;
  const now = new Date().toISOString();
  const existing = dbReady()
    .prepare(
      "SELECT id, stock_administration_id FROM immunization_dose_records WHERE tenant_id = ? AND patient_id = ? AND occurrence_key = ?"
    )
    .get(tenantId, patientId, occurrenceKey) as { id: string; stock_administration_id?: string } | undefined;
  const existingStockId = String(existing?.stock_administration_id || "").trim();
  const wantsNewVial = Boolean(String(body.stockItemId || body.stock_item_id || "").trim());
  if (wantsNewVial) {
    if (existingStockId) {
      throw immunizationError(
        400,
        "This dose is already linked to a stock vial. Correct the date or brand without choosing another vial."
      );
    }
    const administered = giveVaccine(
      tenantId,
      {
        patientId,
        itemId: body.stockItemId || body.stock_item_id,
        batchId: body.stockBatchId || body.stock_batch_id,
        qty: 1,
        dose: dose.doseLabel,
      },
      actor
    );
    stockAdministrationId = administered.id;
    brand = brand || administered.vaccineName;
    batchNo = batchNo || administered.batchNo;
  } else if (stockAdministrationId) {
    const linked = dbReady()
      .prepare("SELECT id, vaccine_name, batch_no FROM vaccine_administrations WHERE id = ? AND tenant_id = ? AND patient_id = ?")
      .get(stockAdministrationId, tenantId, patientId) as { id: string; vaccine_name: string; batch_no: string } | undefined;
    if (!linked) throw immunizationError(404, "That stock dose is not on this patient's record.");
    brand = brand || linked.vaccine_name;
    batchNo = batchNo || linked.batch_no;
  } else {
    stockAdministrationId = existingStockId;
  }
  const id = existing?.id || `imm-${crypto.randomUUID().slice(0, 8)}`;
  if (existing) {
    dbReady()
      .prepare(
        `UPDATE immunization_dose_records SET
          schedule_id = ?, dose_code = ?, antigen = ?, dose_label = ?, status = ?, given_on = ?, brand = ?,
          batch_no = ?, given_by_name = ?, reason = ?, stock_administration_id = ?, confirmed_by_id = ?,
          confirmed_by_name = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND patient_id = ?`
      )
      .run(
        chart.schedule.id,
        dose.code,
        dose.antigen,
        dose.doseLabel,
        status,
        givenOn,
        brand,
        batchNo,
        givenByName,
        reason,
        stockAdministrationId,
        actor.id,
        actor.name,
        now,
        id,
        tenantId,
        patientId
      );
  } else {
    dbReady()
      .prepare(
        `INSERT INTO immunization_dose_records (
          id, tenant_id, patient_id, schedule_id, dose_code, occurrence_key, antigen, dose_label, status,
          given_on, brand, batch_no, given_by_name, reason, stock_administration_id, confirmed_by_id,
          confirmed_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        patientId,
        chart.schedule.id,
        dose.code,
        occurrenceKey,
        dose.antigen,
        dose.doseLabel,
        status,
        givenOn,
        brand,
        batchNo,
        givenByName,
        reason,
        stockAdministrationId,
        actor.id,
        actor.name,
        now,
        now
      );
  }
  writeAudit(
    getDb(),
    actor.id,
    actor.name,
    existing ? "Immunization dose edited" : "Immunization dose recorded",
    `${dose.antigen} ${dose.doseLabel} ${status}`,
    {
      tenantId,
      patientId,
      entityType: "immunization_dose",
      entityId: id,
      actorRole: actor.role || "",
    }
  );
  return {
    id,
    occurrenceKey,
    status,
    givenOn,
    brand,
    batchNo,
    givenByName,
    reason,
    stockAdministrationId,
    confirmedByName: actor.name,
    antigen: dose.antigen,
    doseLabel: dose.doseLabel,
  };
}

export function catalogPayload() {
  return {
    catalogVersion: IMMUNIZATION_CATALOG_VERSION,
    safetyNotice: IMMUNIZATION_SAFETY_NOTICE,
    reminder: vaccineDueReminderHook(),
    schedules: Object.values(IMMUNIZATION_SCHEDULES).map((schedule) => ({
      id: schedule.id,
      version: schedule.version,
      family: schedule.family,
      species: schedule.species || "",
      title: schedule.title,
      citation: schedule.citation,
      doses: schedule.doses.map((dose) => ({
        code: dose.code,
        antigen: dose.antigen,
        doseLabel: dose.doseLabel,
        dueAgeDays: dose.dueAgeDays,
        overdueAfterDays: dose.overdueAfterDays,
        maxAgeDays: dose.maxAgeDays ?? null,
        recurringEveryDays: dose.recurringEveryDays ?? null,
        optional: Boolean(dose.optional),
        endemicOnly: Boolean(dose.endemicOnly),
        notes: dose.notes || "",
      })),
    })),
  };
}

export function previewScheduleEdits(scheduleId: string, edits: DoseEdit[]) {
  const schedule = scheduleById(scheduleId);
  if (!schedule) throw immunizationError(400, "Unknown schedule.");
  return applyScheduleEdits(schedule.doses, edits, schedule.id);
}
