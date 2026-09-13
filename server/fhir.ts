import { randomUUID } from 'node:crypto';
import { addAuditLog, getClinic } from './db.js';
import { isAbdmPlaceholderRegistryMode } from './abdm-mode.js';

export interface FhirBundle {
  resourceType: 'Bundle';
  id: string;
  type: 'document';
  timestamp: string;
  entry: Array<{ resource: Record<string, unknown> }>;
}

function fhirIdentifierDisplay(system: string, value: string): string {
  if (!isAbdmPlaceholderRegistryMode()) return value;
  if (system.includes('hfr')) {
    return `${value} (pending — not yet verified with the National Health Authority)`;
  }
  if (system.includes('hpr')) {
    return `${value} (pending — not yet verified with the National Health Authority)`;
  }
  return `${value} (Lumera sandbox identifier — not an NHA-issued ID)`;
}

export function createPrescriptionBundle(
  patientName: string,
  patientId: string,
  doctorName: string,
  doctorId: string,
  meds: Array<{ name: string; dose: string; freq: string }>,
): FhirBundle {
  const clinic = getClinic();
  const bundle: FhirBundle = {
    resourceType: 'Bundle',
    id: randomUUID(),
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: [
      {
        resource: {
          resourceType: 'Composition',
          status: 'final',
          type: { coding: [{ system: 'http://loinc.org', code: '57833-6', display: 'Prescription' }] },
          subject: { display: patientName },
          author: [{ display: doctorName }],
          title: 'Prescription',
          date: new Date().toISOString(),
        },
      },
      {
        resource: {
          resourceType: 'Patient',
          id: patientId,
          name: [{ text: patientName }],
          identifier: [{ system: 'https://healthid.ndhm.gov.in', value: patientId, display: fhirIdentifierDisplay('https://healthid.ndhm.gov.in', patientId) }],
        },
      },
      {
        resource: {
          resourceType: 'Practitioner',
          id: doctorId,
          name: [{ text: doctorName }],
          identifier: clinic?.hprId
            ? [{ system: 'https://hpr.abdm.gov.in', value: clinic.hprId, display: fhirIdentifierDisplay('https://hpr.abdm.gov.in', clinic.hprId) }]
            : [],
        },
      },
      {
        resource: {
          resourceType: 'Organization',
          id: clinic?.id ?? 'unknown',
          name: clinic?.name ?? 'Unknown Clinic',
          identifier: clinic?.hfrId
            ? [{ system: 'https://facility.abdm.gov.in', value: clinic.hfrId, display: fhirIdentifierDisplay('https://facility.abdm.gov.in', clinic.hfrId) }]
            : [],
        },
      },
      ...meds.map(m => ({
        resource: {
          resourceType: 'MedicationRequest',
          status: 'active',
          intent: 'order',
          medicationCodeableConcept: { text: m.name },
          dosageInstruction: [{ text: `${m.dose} ${m.freq}` }],
          subject: { display: patientName },
          requester: { display: doctorName },
        },
      })),
    ],
  };

  addAuditLog({
    action: 'FHIR_BUNDLE_CREATED',
    actor: doctorId,
    details: `Prescription bundle ${bundle.id} created for ${patientName}`,
  });

  return bundle;
}

export function createOpConsultBundle(
  patientName: string,
  patientId: string,
  doctorName: string,
  doctorId: string,
  chiefComplaint: string,
  diagnosis: string,
): FhirBundle {
  const clinic = getClinic();
  const bundle: FhirBundle = {
    resourceType: 'Bundle',
    id: randomUUID(),
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: [
      {
        resource: {
          resourceType: 'Composition',
          status: 'final',
          type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'OP Consult Note' }] },
          subject: { display: patientName },
          author: [{ display: doctorName }],
          title: 'OP Consultation',
          date: new Date().toISOString(),
        },
      },
      {
        resource: {
          resourceType: 'Patient',
          id: patientId,
          name: [{ text: patientName }],
          identifier: [{ system: 'https://healthid.ndhm.gov.in', value: patientId, display: fhirIdentifierDisplay('https://healthid.ndhm.gov.in', patientId) }],
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          code: { text: diagnosis },
          subject: { display: patientName },
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          code: { text: 'Chief Complaint' },
          valueString: chiefComplaint,
          subject: { display: patientName },
        },
      },
    ],
  };

  addAuditLog({
    action: 'FHIR_BUNDLE_CREATED',
    actor: doctorId,
    details: `OP consult bundle ${bundle.id} created for ${patientName}`,
  });

  return bundle;
}
