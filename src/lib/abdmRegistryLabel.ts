/**
 * Honest labels for locally generated ABDM HFR / HPR / consent IDs.
 * Copy only — callers keep the raw ID values unchanged.
 *
 * Placeholder mode = ABDM stub, or sandbox without real NHA credentials.
 * Credentialed sandbox/production keeps the existing “activated” framing.
 */

export const ABDM_REGISTRY_PENDING_NOTE =
  "pending — not yet verified with the National Health Authority";

/** Phrases that would present a local ID as a confirmed NHA registry ID. */
export const CONFIRMED_ABDM_REGISTRY_CLAIM =
  /confirmed (NHA |National Health Authority )?(Health )?(Facility|Professional) Registry|NHA-verified|\bofficial HFR\b|\bofficial HPR\b|ABDM Compliant|verified NHA registry/i;

export function formatAbdmRegistryLabel(
  kind: "HFR" | "HPR",
  id: string | undefined | null,
  placeholderMode: boolean
): string {
  const value = String(id || "").trim();
  if (placeholderMode) {
    return value
      ? `${kind}: ${value} (${ABDM_REGISTRY_PENDING_NOTE})`
      : `${kind}: ${ABDM_REGISTRY_PENDING_NOTE}`;
  }
  return value ? `${kind}: ${value}` : `${kind}: pending`;
}

export function formatAbdmArtefactLabel(
  id: string | undefined | null,
  placeholderMode: boolean
): string {
  const value = String(id || "").trim();
  if (!placeholderMode) return value;
  if (!value) return `Consent artefact (${ABDM_REGISTRY_PENDING_NOTE})`;
  return `${value} (${ABDM_REGISTRY_PENDING_NOTE})`;
}

export function practiceRegisteredWelcomeMessage(practiceName: string, placeholderMode: boolean): string {
  if (placeholderMode) {
    return `Welcome to Lumera! ${practiceName} is ready with 500 AI Scribe minutes and 100 monthly DHIS transactions. Facility and professional registry IDs are local placeholders (${ABDM_REGISTRY_PENDING_NOTE}).`;
  }
  return `Welcome to Lumera! ${practiceName} has been activated with 500 AI Scribe minutes and 100 monthly DHIS transactions.`;
}

export function practiceRegisteredAuditMessage(
  practiceName: string,
  hfrId: string | undefined | null,
  placeholderMode: boolean
): string {
  const id = String(hfrId || "").trim();
  if (placeholderMode) {
    return `Registered tenant: ${practiceName} (${formatAbdmRegistryLabel("HFR", id, true)})`;
  }
  return `Registered and activated tenant: ${practiceName} (HFR: ${id || "Active"})`;
}

export function onboardingCompleteMessage(placeholderMode: boolean): string {
  if (placeholderMode) {
    return `Clinical profile saved. Practice suite is ready. HFR/HPR IDs are ${ABDM_REGISTRY_PENDING_NOTE}.`;
  }
  return "Clinical profile verified & practice suite activated successfully.";
}
