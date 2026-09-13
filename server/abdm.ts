import { randomUUID } from 'node:crypto';
import { addAuditLog } from './db.js';
import { resolveAbdmMode, isAbdmPlaceholderRegistryMode } from './abdm-mode.js';
import { formatAbdmArtefactLabel } from '../src/lib/abdmRegistryLabel.js';

export interface AbdmConsentRecord {
  id: string;
  idLabel: string;
  patientId: string;
  purpose: string;
  hipId: string;
  status: 'GRANTED' | 'REVOKED';
  createdAt: string;
  expiresAt: string;
  careContexts: string[];
}

const consents = new Map<string, AbdmConsentRecord>();

function placeholderAbdm(): boolean {
  return isAbdmPlaceholderRegistryMode();
}

function labelArtefact(kind: 'consent' | 'care-context', id: string): string {
  return formatAbdmArtefactLabel(kind, id, placeholderAbdm());
}

export function requestAbdmConsent(patientId: string, purpose: string): AbdmConsentRecord {
  const id = `CONSENT-${Date.now()}`;
  const record: AbdmConsentRecord = {
    id,
    idLabel: labelArtefact('consent', id),
    patientId,
    purpose,
    hipId: 'LUMERA-HIP-001',
    status: 'GRANTED',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    careContexts: [],
  };
  consents.set(id, record);
  addAuditLog({
    action: 'ABDM_CONSENT_REQUESTED',
    actor: 'system',
    details: placeholderAbdm()
      ? `${record.idLabel} — demo HIP LUMERA-HIP-001 (not a live NHA consent artefact)`
      : `Consent ${id} requested for ${patientId}`,
  });
  return record;
}

export function grantAbdmConsent(consentId: string): AbdmConsentRecord | undefined {
  const record = consents.get(consentId);
  if (!record) return undefined;
  record.status = 'GRANTED';
  addAuditLog({
    action: 'ABDM_CONSENT_GRANTED',
    actor: 'system',
    details: placeholderAbdm()
      ? `${record.idLabel} marked granted in Lumera demo (not NHA-verified)`
      : `Consent ${consentId} granted`,
  });
  return record;
}

export function revokeAbdmConsent(consentId: string): AbdmConsentRecord | undefined {
  const record = consents.get(consentId);
  if (!record) return undefined;
  record.status = 'REVOKED';
  addAuditLog({
    action: 'ABDM_CONSENT_REVOKED',
    actor: 'system',
    details: placeholderAbdm()
      ? `${record.idLabel} revoked in Lumera demo (not NHA-verified)`
      : `Consent ${consentId} revoked`,
  });
  return record;
}

export function linkCareContext(consentId: string, visitId: string): string | undefined {
  const record = consents.get(consentId);
  if (!record || record.status !== 'GRANTED') return undefined;
  const careContextId = `CC-${visitId}`;
  record.careContexts.push(careContextId);
  addAuditLog({
    action: 'ABDM_CARE_CONTEXT_LINKED',
    actor: 'system',
    details: placeholderAbdm()
      ? `${labelArtefact('care-context', careContextId)} linked under ${record.idLabel} (demo — not an NHA care context)`
      : `Care context ${careContextId} linked to ${consentId}`,
  });
  return careContextId;
}

export function getAbdmConsent(consentId: string): AbdmConsentRecord | undefined {
  return consents.get(consentId);
}

export function listAbdmConsents(patientId?: string): AbdmConsentRecord[] {
  const all = [...consents.values()];
  return patientId ? all.filter(c => c.patientId === patientId) : all;
}

export function abdmHealthCheck(): { status: string; hipId: string; hipLabel: string; consentCount: number } {
  const hipId = 'LUMERA-HIP-001';
  return {
    status: 'ok',
    hipId,
    hipLabel: placeholderAbdm()
      ? `HIP: ${hipId} (demo — not a registered NHA Health Information Provider)`
      : `HIP: ${hipId}`,
    consentCount: consents.size,
  };
}
