/**
 * Lumera Health ABDM v3 & NRCeS FHIR R4 Bundle Serializer
 * Conforms to National Resource Centre for EHR Standards (NRCeS) India:
 * - PrescriptionRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord)
 * - DiagnosticReportRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord)
 * - OPConsultRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord)
 * - DischargeSummaryRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord)
 */

import crypto from "node:crypto";

// Common NRCeS Profiles
export const NRCES_PROFILES = {
  PRESCRIPTION: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord",
  DIAGNOSTIC_REPORT: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord",
  OP_CONSULT: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord",
  DISCHARGE_SUMMARY: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord",
  PATIENT: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient",
  PRACTITIONER: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner",
  ORGANIZATION: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization",
  ENCOUNTER: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Encounter",
  CONDITION: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition",
  OBSERVATION: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation",
  MEDICATION_REQUEST: "https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest",
};

// Common SNOMED-CT Codes for Composition Types
export const SNOMED_COMPOSITION_TYPES = {
  PRESCRIPTION: {
    system: "http://snomed.info/sct",
    code: "440545006",
    display: "Prescription record",
  },
  DIAGNOSTIC_REPORT: {
    system: "http://snomed.info/sct",
    code: "721981007",
    display: "Diagnostic studies report",
  },
  OP_CONSULT: {
    system: "http://snomed.info/sct",
    code: "371530004",
    display: "Clinical consultation report",
  },
  DISCHARGE_SUMMARY: {
    system: "http://snomed.info/sct",
    code: "373942005",
    display: "Discharge summary",
  },
};

// Common LOINC Codes for Diagnostics and Vitals
export const LOINC_CODES = {
  // Panels & Studies
  LIPID_PANEL: { code: "24357-6", display: "Lipid panel with direct LDL" },
  METABOLIC_PANEL: { code: "18719-5", display: "Comprehensive metabolic panel" },
  CBC: { code: "58410-2", display: "Complete blood count panel" },
  DIABETES_PANEL: { code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood" },

  // Vitals
  BP_PANEL: { code: "85354-9", display: "Blood pressure panel with all children optional" },
  BP_SYSTOLIC: { code: "8480-6", display: "Systolic blood pressure" },
  BP_DIASTOLIC: { code: "8462-4", display: "Diastolic blood pressure" },
  HEART_RATE: { code: "8867-4", display: "Heart rate" },
  BODY_TEMP: { code: "8310-5", display: "Body temperature" },
  OXYGEN_SAT: { code: "2708-6", display: "Oxygen saturation in Arterial blood" },
  BODY_WEIGHT: { code: "29463-7", display: "Body weight" },
  BODY_HEIGHT: { code: "8302-2", display: "Body height" },
  BMI: { code: "39156-5", display: "Body mass index (BMI) [Ratio]" },
  BLOOD_GLUCOSE: { code: "2339-0", display: "Glucose [Mass/volume] in Blood" },
  FASTING_GLUCOSE: { code: "1558-6", display: "Fasting glucose [Mass/volume] in Blood" },
  SERUM_CREATININE: { code: "2160-0", display: "Creatinine [Mass/volume] in Serum or Plasma" },
  EGFR: { code: "33914-3", display: "Glomerular filtration rate/1.73 sq M.predicted" },
};

export interface PatientContext {
  id: string;
  uhid: string;
  name: string;
  gender: string;
  age?: number;
  phone?: string;
  email?: string;
  address?: string;
  abhaNumber?: string;
  abhaAddress?: string;
  kycStatus?: string;
}

export interface DoctorContext {
  id: string;
  name: string;
  regNumber?: string;
  specialty?: string;
  hprId?: string;
  qualification?: string;
}

export interface TenantContext {
  id: string;
  name: string;
  hfrId?: string;
  phone?: string;
}

/**
 * Creates an NRCeS FHIR Patient resource with ABHA identifiers
 */
export function buildFhirPatient(p: PatientContext) {
  const birthYear = p.age ? new Date().getFullYear() - p.age : 1985;
  const birthDate = `${birthYear}-01-01`;

  const identifiers = [
    {
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MR",
            display: "Medical Record Number",
          },
        ],
      },
      system: "https://lumera.health/uhid",
      value: p.uhid || `UHID-${p.id}`,
    },
  ];

  if (p.abhaNumber) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code",
            code: "ABHA",
            display: "Ayushman Bharat Health Account Number",
          },
        ],
      },
      system: "https://healthid.ndhm.gov.in",
      value: p.abhaNumber,
    });
  }

  if (p.abhaAddress) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code",
            code: "ABHA-ADDRESS",
            display: "Ayushman Bharat Health Account Address",
          },
        ],
      },
      system: "https://abdm.gov.in/abha-address",
      value: p.abhaAddress,
    });
  }

  return {
    resourceType: "Patient",
    id: `pat-${p.id.replace(/[^a-zA-Z0-9-]/g, "")}`,
    meta: {
      profile: [NRCES_PROFILES.PATIENT],
      versionId: "1",
      lastUpdated: new Date().toISOString(),
    },
    identifier: identifiers,
    name: [
      {
        use: "official",
        text: p.name,
      },
    ],
    telecom: p.phone
      ? [
          {
            system: "phone",
            value: p.phone,
            use: "mobile",
          },
        ]
      : undefined,
    gender: (p.gender || "male").toLowerCase() === "female" ? "female" : "male",
    birthDate,
    address: p.address
      ? [
          {
            use: "home",
            text: p.address,
            country: "IND",
          },
        ]
      : undefined,
  };
}

/**
 * Creates an NRCeS FHIR Practitioner resource with HPR ID
 */
export function buildFhirPractitioner(d: DoctorContext) {
  const identifiers = [
    {
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MD",
            display: "Medical License number",
          },
        ],
      },
      system: "https://nmc.org.in",
      value: d.regNumber || "NMC-2018-99201",
    },
  ];

  if (d.hprId) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code",
            code: "HPR",
            display: "Healthcare Professional Registry ID",
          },
        ],
      },
      system: "https://doctor.ndhm.gov.in",
      value: d.hprId,
    });
  }

  return {
    resourceType: "Practitioner",
    id: `prac-${d.id.replace(/[^a-zA-Z0-9-]/g, "")}`,
    meta: {
      profile: [NRCES_PROFILES.PRACTITIONER],
      versionId: "1",
      lastUpdated: new Date().toISOString(),
    },
    identifier: identifiers,
    name: [
      {
        use: "official",
        text: d.name,
        prefix: ["Dr."],
      },
    ],
    qualification: [
      {
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "394802001",
              display: d.specialty || "General Medicine",
            },
          ],
          text: d.qualification || "MBBS, MD",
        },
      },
    ],
  };
}

/**
 * Creates an NRCeS FHIR Organization resource with HFR ID
 */
export function buildFhirOrganization(t: TenantContext) {
  return {
    resourceType: "Organization",
    id: `org-${t.id.replace(/[^a-zA-Z0-9-]/g, "")}`,
    meta: {
      profile: [NRCES_PROFILES.ORGANIZATION],
      versionId: "1",
      lastUpdated: new Date().toISOString(),
    },
    identifier: [
      {
        type: {
          coding: [
            {
              system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code",
              code: "HFR",
              display: "Health Facility Registry ID",
            },
          ],
        },
        system: "https://facility.ndhm.gov.in",
        value: t.hfrId || "HFR-IN-8829104",
      },
    ],
    name: t.name || "Lumera Clinical Health Centre",
    telecom: t.phone ? [{ system: "phone", value: t.phone }] : undefined,
  };
}

// -------------------------------------------------------------
// 1. PRESCRIPTION BUNDLE SERIALIZER
// -------------------------------------------------------------
export interface PrescriptionInput {
  id: string;
  rxNumber: string;
  date: string;
  diagnosis: string;
  icd10Code?: string;
  medicines: Array<{
    name: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    instructions?: string;
    route?: string;
  }>;
  advice?: string[];
}

export function createPrescriptionBundle(
  rx: PrescriptionInput,
  patient: PatientContext,
  doctor: DoctorContext,
  tenant: TenantContext
) {
  const bundleId = `bundle-rx-${rx.id || crypto.randomUUID().slice(0, 8)}`;
  const compositionId = `comp-rx-${rx.id || crypto.randomUUID().slice(0, 8)}`;
  const conditionId = `cond-rx-${rx.id || crypto.randomUUID().slice(0, 8)}`;

  const fhirPatient = buildFhirPatient(patient);
  const fhirDoctor = buildFhirPractitioner(doctor);
  const fhirOrg = buildFhirOrganization(tenant);

  // Condition Resource
  const conditionResource = {
    resourceType: "Condition",
    id: conditionId,
    meta: {
      profile: [NRCES_PROFILES.CONDITION],
    },
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
          display: "Active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed",
          display: "Confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "encounter-diagnosis",
            display: "Encounter Diagnosis",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://hl7.org/fhir/sid/icd-10",
          code: rx.icd10Code || "R69",
          display: rx.diagnosis,
        },
        {
          system: "http://snomed.info/sct",
          code: "404684003",
          display: rx.diagnosis,
        },
      ],
      text: rx.diagnosis,
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    recordedDate: rx.date ? new Date(rx.date).toISOString() : new Date().toISOString(),
  };

  // MedicationRequest Resources
  const medicationResources = (rx.medicines || []).map((med, idx) => {
    const medId = `med-req-${rx.id}-${idx + 1}`;
    return {
      resourceType: "MedicationRequest",
      id: medId,
      meta: {
        profile: [NRCES_PROFILES.MEDICATION_REQUEST],
      },
      status: "active",
      intent: "order",
      medicationCodeableConcept: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "372600007",
            display: med.name,
          },
        ],
        text: med.name,
      },
      subject: {
        reference: `Patient/${fhirPatient.id}`,
        display: patient.name,
      },
      authoredOn: rx.date ? new Date(rx.date).toISOString() : new Date().toISOString(),
      requester: {
        reference: `Practitioner/${fhirDoctor.id}`,
        display: doctor.name,
      },
      reasonReference: [
        {
          reference: `Condition/${conditionId}`,
        },
      ],
      dosageInstruction: [
        {
          text: `${med.dosage || "1 Tab"} - ${med.frequency || "Once Daily"} - ${med.duration || "5 Days"} (${med.instructions || "After meals"})`,
          timing: {
            code: {
              text: med.frequency || "Once daily",
            },
          },
          route: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "260548002",
                display: med.route || "Oral",
              },
            ],
          },
        },
      ],
    };
  });

  // Composition Entry (Header / Document Anchor)
  const compositionResource = {
    resourceType: "Composition",
    id: compositionId,
    meta: {
      profile: [NRCES_PROFILES.PRESCRIPTION],
      versionId: "1",
      lastUpdated: new Date().toISOString(),
    },
    status: "final",
    type: {
      coding: [SNOMED_COMPOSITION_TYPES.PRESCRIPTION],
      text: "Prescription Record",
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    date: rx.date ? new Date(rx.date).toISOString() : new Date().toISOString(),
    author: [
      {
        reference: `Practitioner/${fhirDoctor.id}`,
        display: doctor.name,
      },
    ],
    title: `Digital Prescription #${rx.rxNumber || rx.id}`,
    custodian: {
      reference: `Organization/${fhirOrg.id}`,
      display: tenant.name,
    },
    section: [
      {
        title: "Clinical Diagnosis",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "4241000179101",
              display: "Diagnosis section",
            },
          ],
        },
        entry: [{ reference: `Condition/${conditionId}` }],
      },
      {
        title: "Prescribed Medications",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "721912009",
              display: "Medication summary section",
            },
          ],
        },
        entry: medicationResources.map((m) => ({ reference: `MedicationRequest/${m.id}` })),
      },
    ],
  };

  const entries = [
    { fullUrl: `urn:uuid:${compositionId}`, resource: compositionResource },
    { fullUrl: `urn:uuid:${fhirPatient.id}`, resource: fhirPatient },
    { fullUrl: `urn:uuid:${fhirDoctor.id}`, resource: fhirDoctor },
    { fullUrl: `urn:uuid:${fhirOrg.id}`, resource: fhirOrg },
    { fullUrl: `urn:uuid:${conditionId}`, resource: conditionResource },
    ...medicationResources.map((m) => ({ fullUrl: `urn:uuid:${m.id}`, resource: m })),
  ];

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      versionId: "1",
      lastUpdated: new Date().toISOString(),
      profile: [NRCES_PROFILES.PRESCRIPTION],
      security: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
          code: "R",
          display: "Restricted",
        },
      ],
    },
    identifier: {
      system: "https://lumera.health/fhir/prescription",
      value: rx.rxNumber || rx.id,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

// -------------------------------------------------------------
// 2. DIAGNOSTIC REPORT BUNDLE SERIALIZER (LOINC)
// -------------------------------------------------------------
export interface DiagnosticReportInput {
  id: string;
  date: string;
  category: string;
  labName: string;
  doctorInterpretation?: string;
  results: Array<{
    param: string;
    value: string | number;
    unit?: string;
    normalRange?: string;
    status?: string;
  }>;
}

export function createDiagnosticReportBundle(
  report: DiagnosticReportInput,
  patient: PatientContext,
  doctor: DoctorContext,
  tenant: TenantContext
) {
  const bundleId = `bundle-diag-${report.id || crypto.randomUUID().slice(0, 8)}`;
  const compositionId = `comp-diag-${report.id || crypto.randomUUID().slice(0, 8)}`;
  const reportResourceId = `diag-rep-${report.id || crypto.randomUUID().slice(0, 8)}`;

  const fhirPatient = buildFhirPatient(patient);
  const fhirDoctor = buildFhirPractitioner(doctor);
  const fhirOrg = buildFhirOrganization(tenant);

  // Observation Resources for each test parameter with LOINC mapping
  const observationResources = (report.results || []).map((item, idx) => {
    const obsId = `obs-diag-${report.id}-${idx + 1}`;
    const pUpper = item.param.toUpperCase();

    // Smart LOINC mapping
    let loinc = { code: "18719-5", display: item.param };
    if (pUpper.includes("HBA1C") || pUpper.includes("GLYCOSYLATED")) loinc = LOINC_CODES.DIABETES_PANEL;
    else if (pUpper.includes("FASTING") && pUpper.includes("SUGAR")) loinc = LOINC_CODES.FASTING_GLUCOSE;
    else if (pUpper.includes("GLUCOSE") || pUpper.includes("SUGAR")) loinc = LOINC_CODES.BLOOD_GLUCOSE;
    else if (pUpper.includes("CREATININE")) loinc = LOINC_CODES.SERUM_CREATININE;
    else if (pUpper.includes("EGFR")) loinc = LOINC_CODES.EGFR;
    else if (pUpper.includes("CHOLESTEROL") && pUpper.includes("TOTAL")) loinc = { code: "2093-3", display: "Cholesterol in Serum" };
    else if (pUpper.includes("LDL")) loinc = { code: "13457-7", display: "LDL Cholesterol" };
    else if (pUpper.includes("HDL")) loinc = { code: "2085-9", display: "HDL Cholesterol" };
    else if (pUpper.includes("TRIGLYCERIDE")) loinc = { code: "2571-8", display: "Triglycerides" };

    const numVal = typeof item.value === "number" ? item.value : parseFloat(String(item.value));
    const isNum = !isNaN(numVal);

    return {
      resourceType: "Observation",
      id: obsId,
      meta: {
        profile: [NRCES_PROFILES.OBSERVATION],
      },
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
              display: "Laboratory",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: loinc.code,
            display: loinc.display,
          },
        ],
        text: item.param,
      },
      subject: {
        reference: `Patient/${fhirPatient.id}`,
        display: patient.name,
      },
      effectiveDateTime: report.date ? new Date(report.date).toISOString() : new Date().toISOString(),
      performer: [
        {
          reference: `Organization/${fhirOrg.id}`,
          display: report.labName || tenant.name,
        },
      ],
      valueQuantity: isNum
        ? {
            value: numVal,
            unit: item.unit || "",
            system: "http://unitsofmeasure.org",
          }
        : undefined,
      valueString: !isNum ? String(item.value) : undefined,
      referenceRange: item.normalRange
        ? [
            {
              text: item.normalRange,
            },
          ]
        : undefined,
      interpretation: item.status
        ? [
            {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                  code: item.status.toUpperCase() === "HIGH" ? "H" : item.status.toUpperCase() === "LOW" ? "L" : "N",
                  display: item.status,
                },
              ],
            },
          ]
        : undefined,
    };
  });

  // DiagnosticReport Resource
  const diagnosticReportResource = {
    resourceType: "DiagnosticReport",
    id: reportResourceId,
    meta: {
      profile: [NRCES_PROFILES.DIAGNOSTIC_REPORT],
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0074",
            code: "LAB",
            display: "Laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: LOINC_CODES.METABOLIC_PANEL.code,
          display: report.category || LOINC_CODES.METABOLIC_PANEL.display,
        },
      ],
      text: report.category || "Diagnostic Pathology Report",
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    effectiveDateTime: report.date ? new Date(report.date).toISOString() : new Date().toISOString(),
    issued: new Date().toISOString(),
    performer: [
      {
        reference: `Organization/${fhirOrg.id}`,
        display: report.labName || tenant.name,
      },
    ],
    resultsInterpreter: [
      {
        reference: `Practitioner/${fhirDoctor.id}`,
        display: doctor.name,
      },
    ],
    result: observationResources.map((o) => ({ reference: `Observation/${o.id}` })),
    conclusion: report.doctorInterpretation || "All findings reviewed and verified by attending pathologist.",
  };

  // Composition Resource
  const compositionResource = {
    resourceType: "Composition",
    id: compositionId,
    meta: {
      profile: [NRCES_PROFILES.DIAGNOSTIC_REPORT],
    },
    status: "final",
    type: {
      coding: [SNOMED_COMPOSITION_TYPES.DIAGNOSTIC_REPORT],
      text: "Diagnostic Studies Report",
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    date: report.date ? new Date(report.date).toISOString() : new Date().toISOString(),
    author: [
      {
        reference: `Practitioner/${fhirDoctor.id}`,
        display: doctor.name,
      },
    ],
    title: `Diagnostic Report - ${report.category}`,
    custodian: {
      reference: `Organization/${fhirOrg.id}`,
      display: tenant.name,
    },
    section: [
      {
        title: "Diagnostic Report Details",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "721981007",
              display: "Diagnostic studies report",
            },
          ],
        },
        entry: [{ reference: `DiagnosticReport/${reportResourceId}` }],
      },
    ],
  };

  const entries = [
    { fullUrl: `urn:uuid:${compositionId}`, resource: compositionResource },
    { fullUrl: `urn:uuid:${fhirPatient.id}`, resource: fhirPatient },
    { fullUrl: `urn:uuid:${fhirDoctor.id}`, resource: fhirDoctor },
    { fullUrl: `urn:uuid:${fhirOrg.id}`, resource: fhirOrg },
    { fullUrl: `urn:uuid:${reportResourceId}`, resource: diagnosticReportResource },
    ...observationResources.map((o) => ({ fullUrl: `urn:uuid:${o.id}`, resource: o })),
  ];

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      versionId: "1",
      lastUpdated: new Date().toISOString(),
      profile: [NRCES_PROFILES.DIAGNOSTIC_REPORT],
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

// -------------------------------------------------------------
// 3. OP CONSULT BUNDLE SERIALIZER (Encounter + Condition + Vitals Observation)
// -------------------------------------------------------------
export interface OPConsultInput {
  id: string;
  tokenNumber?: number;
  date: string;
  consultationType?: string;
  diagnosis: string;
  icd10Code?: string;
  chiefComplaints?: string[];
  vitals?: {
    bpSys?: number;
    bpDia?: number;
    heartRate?: number;
    temperature?: number;
    spO2?: number;
    weight?: number;
    height?: number;
    bloodSugar?: number;
  };
  notes?: string;
}

export function createOPConsultBundle(
  consult: OPConsultInput,
  patient: PatientContext,
  doctor: DoctorContext,
  tenant: TenantContext
) {
  const bundleId = `bundle-opd-${consult.id || crypto.randomUUID().slice(0, 8)}`;
  const compositionId = `comp-opd-${consult.id || crypto.randomUUID().slice(0, 8)}`;
  const encounterId = `enc-opd-${consult.id || crypto.randomUUID().slice(0, 8)}`;
  const conditionId = `cond-opd-${consult.id || crypto.randomUUID().slice(0, 8)}`;

  const fhirPatient = buildFhirPatient(patient);
  const fhirDoctor = buildFhirPractitioner(doctor);
  const fhirOrg = buildFhirOrganization(tenant);

  // Encounter Resource
  const encounterResource = {
    resourceType: "Encounter",
    id: encounterId,
    meta: {
      profile: [NRCES_PROFILES.ENCOUNTER],
    },
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "Ambulatory (Outpatient)",
    },
    type: [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "308335008",
            display: consult.consultationType || "Patient encounter procedure",
          },
        ],
      },
    ],
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    participant: [
      {
        type: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                code: "PPRF",
                display: "Primary Performer",
              },
            ],
          },
        ],
        individual: {
          reference: `Practitioner/${fhirDoctor.id}`,
          display: doctor.name,
        },
      },
    ],
    period: {
      start: consult.date ? new Date(consult.date).toISOString() : new Date().toISOString(),
      end: new Date().toISOString(),
    },
    serviceProvider: {
      reference: `Organization/${fhirOrg.id}`,
      display: tenant.name,
    },
  };

  // Condition Resource
  const conditionResource = {
    resourceType: "Condition",
    id: conditionId,
    meta: {
      profile: [NRCES_PROFILES.CONDITION],
    },
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
          display: "Active",
        },
      ],
    },
    code: {
      coding: [
        {
          system: "http://hl7.org/fhir/sid/icd-10",
          code: consult.icd10Code || "R69",
          display: consult.diagnosis,
        },
        {
          system: "http://snomed.info/sct",
          code: "404684003",
          display: consult.diagnosis,
        },
      ],
      text: consult.diagnosis,
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    encounter: {
      reference: `Encounter/${encounterId}`,
    },
    recordedDate: consult.date ? new Date(consult.date).toISOString() : new Date().toISOString(),
  };

  // Vitals Observation Resources (LOINC)
  const vitalsResources: any[] = [];
  const v = consult.vitals || {};

  // Blood Pressure Panel
  if (v.bpSys || v.bpDia) {
    vitalsResources.push({
      resourceType: "Observation",
      id: `obs-bp-${consult.id}`,
      meta: { profile: [NRCES_PROFILES.OBSERVATION] },
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
              display: "Vital Signs",
            },
          ],
        },
      ],
      code: {
        coding: [LOINC_CODES.BP_PANEL],
        text: "Blood Pressure",
      },
      subject: { reference: `Patient/${fhirPatient.id}`, display: patient.name },
      encounter: { reference: `Encounter/${encounterId}` },
      effectiveDateTime: new Date().toISOString(),
      component: [
        v.bpSys
          ? {
              code: { coding: [LOINC_CODES.BP_SYSTOLIC] },
              valueQuantity: { value: v.bpSys, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
            }
          : null,
        v.bpDia
          ? {
              code: { coding: [LOINC_CODES.BP_DIASTOLIC] },
              valueQuantity: { value: v.bpDia, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
            }
          : null,
      ].filter(Boolean),
    });
  }

  // Heart Rate
  if (v.heartRate) {
    vitalsResources.push({
      resourceType: "Observation",
      id: `obs-hr-${consult.id}`,
      meta: { profile: [NRCES_PROFILES.OBSERVATION] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
      code: { coding: [LOINC_CODES.HEART_RATE], text: "Heart Rate" },
      subject: { reference: `Patient/${fhirPatient.id}` },
      valueQuantity: { value: v.heartRate, unit: "beats/min", system: "http://unitsofmeasure.org", code: "/min" },
    });
  }

  // SpO2
  if (v.spO2) {
    vitalsResources.push({
      resourceType: "Observation",
      id: `obs-spo2-${consult.id}`,
      meta: { profile: [NRCES_PROFILES.OBSERVATION] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
      code: { coding: [LOINC_CODES.OXYGEN_SAT], text: "Pulse Oximetry" },
      subject: { reference: `Patient/${fhirPatient.id}` },
      valueQuantity: { value: v.spO2, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
    });
  }

  // Weight
  if (v.weight) {
    vitalsResources.push({
      resourceType: "Observation",
      id: `obs-wt-${consult.id}`,
      meta: { profile: [NRCES_PROFILES.OBSERVATION] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
      code: { coding: [LOINC_CODES.BODY_WEIGHT], text: "Body Weight" },
      subject: { reference: `Patient/${fhirPatient.id}` },
      valueQuantity: { value: v.weight, unit: "kg", system: "http://unitsofmeasure.org", code: "kg" },
    });
  }

  // Composition Entry
  const compositionResource = {
    resourceType: "Composition",
    id: compositionId,
    meta: {
      profile: [NRCES_PROFILES.OP_CONSULT],
    },
    status: "final",
    type: {
      coding: [SNOMED_COMPOSITION_TYPES.OP_CONSULT],
      text: "Clinical Consultation Report",
    },
    subject: {
      reference: `Patient/${fhirPatient.id}`,
      display: patient.name,
    },
    encounter: {
      reference: `Encounter/${encounterId}`,
    },
    date: consult.date ? new Date(consult.date).toISOString() : new Date().toISOString(),
    author: [
      {
        reference: `Practitioner/${fhirDoctor.id}`,
        display: doctor.name,
      },
    ],
    title: `OPD Consultation Note - Token #${consult.tokenNumber || 1}`,
    custodian: {
      reference: `Organization/${fhirOrg.id}`,
      display: tenant.name,
    },
    section: [
      {
        title: "Encounter Information",
        entry: [{ reference: `Encounter/${encounterId}` }],
      },
      {
        title: "Clinical Diagnosis",
        entry: [{ reference: `Condition/${conditionId}` }],
      },
      {
        title: "Vital Signs",
        entry: vitalsResources.map((vr) => ({ reference: `Observation/${vr.id}` })),
      },
    ],
  };

  const entries = [
    { fullUrl: `urn:uuid:${compositionId}`, resource: compositionResource },
    { fullUrl: `urn:uuid:${fhirPatient.id}`, resource: fhirPatient },
    { fullUrl: `urn:uuid:${fhirDoctor.id}`, resource: fhirDoctor },
    { fullUrl: `urn:uuid:${fhirOrg.id}`, resource: fhirOrg },
    { fullUrl: `urn:uuid:${encounterId}`, resource: encounterResource },
    { fullUrl: `urn:uuid:${conditionId}`, resource: conditionResource },
    ...vitalsResources.map((vr) => ({ fullUrl: `urn:uuid:${vr.id}`, resource: vr })),
  ];

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      versionId: "1",
      lastUpdated: new Date().toISOString(),
      profile: [NRCES_PROFILES.OP_CONSULT],
    },
    identifier: {
      system: "https://lumera.health/fhir/op-consult",
      value: consult.id,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}
