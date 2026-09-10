/**
 * Dual onboarding (#40 / ABDM-06) — Clinical UX client for the Platform patient SoT.
 *
 * Practice-simple (default): POST /api/patients
 *   Server may return the existing tenant patient on phone match.
 *
 * ABHA sandbox (secondary): generateOtp → verifyOTP → POST /api/patients/link-abha
 *   Body (Platform #45): { patientId?, phone?, abhaNumber, abhaAddress?,
 *     demographics?, consentArtefact?, source, abdmMode }
 *   Response: { patient, abdmMode, sandboxNotice }
 *   kycStatus on the linked patient is always LINKED_SANDBOX.
 *   consentArtefact.consentId is required or the server 400s.
 *
 * Platform owns the patients SoT — this module is a UI client only.
 * Client calls: POST /api/patients, POST /api/patients/link-abha,
 *   GET /api/abdm/status { bridgeReady, abdmMode },
 *   POST /api/abdm/v3/registration/aadhaar/generateOtp|verifyOTP.
 * ABDM-03+ OpenAPI bridge stubs are later — do not add HIU/HIP/HRP client chrome here.
 *
 * One patients table. No parallel ABDM EMR. Honesty badges: NHA sandbox / Simulator / LINKED_SANDBOX.
 */

import { apiFetch } from "../api/http";
import type { AbdmConsentArtefact, Patient } from "../types";

export type OnboardingPath = "practice-simple" | "abha-sandbox";
export type ClinicalHandoffView = "queue" | "rx" | "billing";

export const NHA_SANDBOX_BADGE = "NHA sandbox";
export const SIMULATOR_BADGE = "Simulator";
export const LINK_ABHA_CTA = "Link ABHA (NHA sandbox)";
export const LINKED_SANDBOX_CHIP = "LINKED_SANDBOX";
export const NHA_SANDBOX_NOTICE =
  "ABHA linking uses the NHA sandbox simulator. Production ABDM is out of scope on this track.";
export const BRIDGE_DOWN_MESSAGE =
  "NHA sandbox bridge is not ready (bridgeReady=false or the ABDM bridge is down). ABHA cannot be linked. Use practice-simple intake, or retry when the sandbox bridge is up.";
export const PRACTICE_SIMPLE_ABHA_LATER =
  "ABHA can be linked later via Link ABHA (NHA sandbox). This path does not collect ABDM consent.";
export const BACK_TO_PRACTICE_SIMPLE = "Back to practice-simple";
export const OTP_FAILED_MESSAGE =
  "NHA sandbox OTP did not succeed. ABHA was not linked. Use practice-simple intake, or retry when the sandbox bridge is up.";
export const OTP_ACCEPTED_NOTICE =
  "OTP accepted (NHA sandbox). Save to call link-abha — the chart chip becomes LINKED_SANDBOX only after that API succeeds.";

export type LinkAbhaSource = "aadhaar_otp" | "abha_search" | "qr";
export type LinkAbdmMode = "stub" | "sandbox";

/** Client consent payload for Platform #45 — consentId is required. */
export type AbhaConsentArtefact = AbdmConsentArtefact & {
  granted?: boolean;
  capturedAt?: string;
  sandbox?: true;
  source?: "nha-sandbox" | string;
  txnId?: string;
};

export type AbhaDemographics = {
  name?: string;
  age?: number;
  gender?: "Male" | "Female" | "Other" | string;
  phone?: string;
  address?: string;
  abhaAddress?: string;
  dob?: string;
};

export type LinkAbhaRequest = {
  patientId?: string;
  phone?: string;
  abhaNumber: string;
  abhaAddress?: string;
  demographics?: AbhaDemographics;
  consentArtefact?: AbhaConsentArtefact;
  source: LinkAbhaSource;
  abdmMode: LinkAbdmMode;
};

export type LinkAbhaResponse = {
  patient: Patient;
  abdmMode: LinkAbdmMode;
  sandboxNotice: string;
};

export type PracticeSimpleResponse = {
  patient: Patient;
  created?: boolean;
};

export type AbhaSandboxOtpResponse = {
  txnId: string;
  message?: string;
  testOtp?: string;
  expiresInSeconds?: number;
  bridgeReady?: boolean;
};

export type AbhaSandboxVerifyResponse = {
  success: boolean;
  sandbox?: boolean;
  abhaNumber: string;
  abhaAddress?: string;
  profile: {
    name: string;
    gender: string;
    dob?: string;
    mobile: string;
    address?: string;
    pincode?: string;
  };
  /** verifyOTP does not yet return a Platform artefact; we synthesize one. */
  consent?: Partial<AbhaConsentArtefact>;
};

export type AbdmBridgeStatus = {
  bridgeReady: boolean;
  abdmMode?: string;
};

/** Fail-closed: only an explicit bridgeReady === true is ready. */
export function interpretAbdmStatus(data: { bridgeReady?: boolean; abdmMode?: string } | null | undefined): AbdmBridgeStatus {
  const abdmMode = data && typeof data.abdmMode === "string" ? data.abdmMode : undefined;
  if (!data || data.bridgeReady !== true) {
    return { bridgeReady: false, abdmMode };
  }
  return { bridgeReady: true, abdmMode };
}

export function normalizePhoneDigits(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeAbhaNumber(abha: string): string {
  return String(abha || "").replace(/\D/g, "");
}

export function ageFromDob(dob?: string): number | undefined {
  if (!dob) return undefined;
  const year = Number(String(dob).slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return undefined;
  return Math.max(0, new Date().getFullYear() - year);
}

export function genderFromAbdm(gender?: string): "Male" | "Female" | "Other" {
  const g = String(gender || "").trim().toUpperCase();
  if (g === "M" || g === "MALE") return "Male";
  if (g === "F" || g === "FEMALE") return "Female";
  return "Other";
}

export function findMatchingPatient(
  patients: Patient[],
  query: { phone?: string; abhaNumber?: string }
): Patient | null {
  const phone = normalizePhoneDigits(query.phone || "");
  const abha = normalizeAbhaNumber(query.abhaNumber || "");
  if (!phone && !abha) return null;
  return (
    patients.find((p) => {
      if (phone && normalizePhoneDigits(p.phone) === phone) return true;
      if (abha && normalizeAbhaNumber(p.abhaNumber || "") === abha) return true;
      return false;
    }) || null
  );
}

export function abhaStatusChip(patient: {
  kycStatus?: string;
  abhaNumber?: string;
  abhaLinkedAt?: string;
}): {
  label: string;
  linked: boolean;
} {
  const hasAbha = Boolean(patient.abhaNumber) || Boolean(patient.abhaLinkedAt) || patient.kycStatus === "LINKED_SANDBOX";
  if (!hasAbha) return { label: "No ABHA", linked: false };
  return { label: LINKED_SANDBOX_CHIP, linked: true };
}

export async function fetchAbdmBridgeStatus(): Promise<AbdmBridgeStatus> {
  try {
    const data = await apiFetch<{ bridgeReady?: boolean; abdmMode?: string }>("/api/abdm/status");
    return interpretAbdmStatus(data);
  } catch {
    return interpretAbdmStatus(null);
  }
}

export async function requireAbdmBridgeReady(): Promise<void> {
  const status = await fetchAbdmBridgeStatus();
  if (!status.bridgeReady) {
    throw new Error(BRIDGE_DOWN_MESSAGE);
  }
}

export async function generateAbhaSandboxOtp(aadhaar: string): Promise<AbhaSandboxOtpResponse> {
  await requireAbdmBridgeReady();
  const data = await apiFetch<AbhaSandboxOtpResponse>("/api/abdm/v3/registration/aadhaar/generateOtp", {
    method: "POST",
    body: JSON.stringify({ aadhaar: aadhaar.replace(/\D/g, "") }),
  });
  if (!data?.txnId) {
    throw new Error(OTP_FAILED_MESSAGE);
  }
  return data;
}

export async function verifyAbhaSandboxOtp(txnId: string, otp: string): Promise<AbhaSandboxVerifyResponse> {
  await requireAbdmBridgeReady();
  const data = await apiFetch<AbhaSandboxVerifyResponse>("/api/abdm/v3/registration/aadhaar/verifyOTP", {
    method: "POST",
    body: JSON.stringify({ txnId, otp }),
  });
  if (data?.success === false || !data?.abhaNumber || !data.profile?.name) {
    throw new Error(OTP_FAILED_MESSAGE);
  }
  return data;
}

export async function createPracticeSimplePatient(input: {
  name: string;
  phone: string;
  age?: number;
  gender?: string;
  email?: string;
  bloodGroup?: string;
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContact?: string;
  address?: string;
}): Promise<PracticeSimpleResponse> {
  return apiFetch<PracticeSimpleResponse>("/api/patients", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      phone: input.phone,
      age: input.age,
      gender: input.gender,
      ...(input.email ? { email: input.email } : {}),
      ...(input.bloodGroup ? { bloodGroup: input.bloodGroup } : {}),
      ...(input.allergies ? { allergies: input.allergies } : {}),
      ...(input.chronicConditions ? { chronicConditions: input.chronicConditions } : {}),
      ...(input.emergencyContact ? { emergencyContact: input.emergencyContact } : {}),
      ...(input.address ? { address: input.address } : {}),
    }),
  });
}

export async function linkAbhaSandbox(body: LinkAbhaRequest): Promise<LinkAbhaResponse> {
  if (!body.abhaNumber?.trim()) {
    throw new Error("abhaNumber is required");
  }
  return apiFetch<LinkAbhaResponse>("/api/patients/link-abha", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function consentIdFromTxn(txnId?: string): string {
  const trimmed = String(txnId || "").trim();
  if (trimmed) return `consent-${trimmed}`;
  return `consent-${crypto.randomUUID()}`;
}

export function consentFromVerify(
  txnId: string,
  verified: Partial<AbhaSandboxVerifyResponse> & { abhaNumber?: string } = {}
): AbhaConsentArtefact {
  const existing = verified.consent;
  const now = existing?.grantedAt || existing?.capturedAt || new Date().toISOString();
  const consentId = String(existing?.consentId || "").trim() || consentIdFromTxn(existing?.txnId || txnId);
  return {
    consentId,
    status: existing?.status || "GRANTED",
    purpose: existing?.purpose || "ABHA link",
    grantedAt: now,
    granted: true,
    capturedAt: now,
    sandbox: true,
    source: "nha-sandbox",
    txnId: existing?.txnId || txnId || undefined,
  };
}

export function linkAbhaBodyFromVerify(
  verified: AbhaSandboxVerifyResponse,
  extras: { patientId?: string; phone?: string; txnId?: string } = {}
): LinkAbhaRequest {
  if (!verified.abhaNumber || !verified.profile?.name) {
    throw new Error(OTP_FAILED_MESSAGE);
  }
  const txnId = extras.txnId || verified.consent?.txnId || "";
  return {
    ...(extras.patientId ? { patientId: extras.patientId } : {}),
    phone: extras.phone || verified.profile.mobile,
    abhaNumber: verified.abhaNumber,
    ...(verified.abhaAddress ? { abhaAddress: verified.abhaAddress } : {}),
    demographics: {
      name: verified.profile.name,
      gender: genderFromAbdm(verified.profile.gender),
      phone: verified.profile.mobile,
      address: verified.profile.address,
      abhaAddress: verified.abhaAddress,
      dob: verified.profile.dob,
      age: ageFromDob(verified.profile.dob),
    },
    consentArtefact: consentFromVerify(txnId, verified),
    source: "aadhaar_otp",
    abdmMode: "sandbox",
  };
}
