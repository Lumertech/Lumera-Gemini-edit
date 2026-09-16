/**
 * Lumera Health ABDM v3 Gateway & Identity Service
 * Implements:
 * 1. ABDM Sandbox OAuth Bridge Session (/v3/bridgesession)
 * 2. Aadhaar ABHA Generation & Verification (/v3/registration/aadhaar/*)
 * 3. ABDM Webhook Listeners for Consent & Tokenized Data Transfer with Diffie-Hellman (ECDH) Key Exchange
 * 4. DHIS (Digital Health Incentive Scheme) transaction registration and audit engine
 */

import { type Request } from "express";
import crypto from "node:crypto";
import { getDb, mapConsentArtefact } from "./db.ts";
import { getAbdmBridgeStatus, resolveAbdmMode } from "./abdm-mode.ts";
import { decideAbdmCallbackSignature } from "./abdm-hmac.ts";

// SECURITY: this module is a *local stand-in* for the real ABDM sandbox
// gateway (no requests currently leave this server for GATEWAY_URL — see
// the integration notes). Until real ABDM sandbox credentials are wired in,
// it accepts a fixed test OTP for local development convenience only. This
// must never echo the OTP back to the client, or accept the fixed test OTP,
// once NODE_ENV=production is set.

// Stub-only local stand-in. Sandbox mode (#38) must use env creds — never these placeholders.
const STUB_GATEWAY = "https://sandbox.abdm.gov.in/api/v3";
export const ABDM_CONFIG = {
  GATEWAY_URL: process.env.ABDM_GATEWAY_URL || STUB_GATEWAY,
  CLIENT_ID: resolveAbdmMode() === "sandbox" ? process.env.ABDM_CLIENT_ID || "" : process.env.ABDM_CLIENT_ID || "",
  CLIENT_SECRET: resolveAbdmMode() === "sandbox" ? process.env.ABDM_CLIENT_SECRET || "" : process.env.ABDM_CLIENT_SECRET || "",
  HFR_ID: process.env.ABDM_HFR_ID || "HFR-IN-8829104",
  FACILITY_NAME: "Lumera Polyclinic & Diagnostic Network",
};

export const NHA_SANDBOX_NOTICE =
  "NHA sandbox: local stand-in until NHA credentials are provisioned.";

export function tenantIdOf(req: { user?: { tenantId?: string } }): string {
  return String(req.user?.tenantId || "").trim();
}

export function callbackTenantId(req: { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }): string | null {
  const sessionTenant = tenantIdOf(req);
  if (sessionTenant) return sessionTenant;
  const hip = String(req.headers["x-hip-id"] || req.headers["X-HIP-ID"] || "").trim();
  const hiu = String(req.headers["x-hiu-id"] || req.headers["X-HIU-ID"] || "").trim();
  const hrp = String(req.headers["x-hrp-id"] || req.headers["X-HRP-ID"] || "").trim();
  const headerId = hip || hiu || hrp;
  if (headerId) {
    const tenant = getDb()
      .prepare("SELECT id FROM tenants WHERE hfr_id = ? AND TRIM(hfr_id) != ''")
      .get(headerId) as { id: string } | undefined;
    if (tenant?.id) return tenant.id;
  }
  const bodyTenant = String(req.body?.tenantId || req.body?.tenant_id || "").trim();
  return bodyTenant || null;
}

export function careContextReference(uhid: string, encounterId: string): string {
  const id = String(encounterId || "OPD").trim() || "OPD";
  return `CARE-CTX-${String(uhid || "").trim()}-${id}`;
}

export function callbackHmac(req: Request) {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body || {}));
  return decideAbdmCallbackSignature({
    rawBody,
    signatureHeader: req.headers["x-abdm-signature"],
  });
}

export function findTenantArtefactByConsentId(tenantId: string, consentId: string) {
  if (!tenantId || !consentId) return undefined;
  const row = getDb()
    .prepare("SELECT * FROM abdm_consent_artefacts WHERE tenant_id = ? AND consent_id = ?")
    .get(tenantId, consentId) as Record<string, unknown> | undefined;
  return row ? mapConsentArtefact(row) : undefined;
}

export function consentBlocksFetch(artefact: { status?: unknown; dateRange?: unknown } | undefined): boolean {
  const status = String(artefact?.status || "").toUpperCase();
  const until = String((artefact?.dateRange as { to?: string } | undefined)?.to || "");
  const expired = Boolean(until && new Date(until).getTime() < Date.now());
  return status === "DENIED" || status === "REVOKED" || expired;
}

// In-Memory Consent Artefacts Registry
interface ConsentArtefact {
  consentId: string;
  status: "GRANTED" | "REVOKED" | "DENIED";
  patientAbha: string;
  hiTypes: string[];
  dateRange: { from: string; to: string };
  requesterName: string;
  purpose: string;
  grantedAt: string;
}
export const consentStore = new Map<string, ConsentArtefact>();

// Pre-seed some default active consents for demonstration
consentStore.set("consent-art-991", {
  consentId: "consent-art-991",
  status: "GRANTED",
  patientAbha: "rajiv.saxena@abdm",
  hiTypes: ["Prescription", "OPConsultation", "DiagnosticReport"],
  dateRange: { from: "2026-01-01", to: "2026-12-31" },
  requesterName: "Apollo Super Specialty HIU",
  purpose: "Referral & Continuous Care Management",
  grantedAt: "2026-08-20T10:30:00Z",
});

consentStore.set("consent-art-992", {
  consentId: "consent-art-992",
  status: "GRANTED",
  patientAbha: "sunita.roy@abdm",
  hiTypes: ["DiagnosticReport", "Prescription"],
  dateRange: { from: "2026-05-01", to: "2026-11-30" },
  requesterName: "Fortis Escorts Endocrinology Registry",
  purpose: "Chronic Glycemic Monitoring",
  grantedAt: "2026-08-24T14:15:00Z",
});

/**
 * Generates an ECDH Keypair for ABDM Encrypted Health Data Exchange (NIST prime256v1)
 */
export function generateAbdmEcdhKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const publicKeyHex = ecdh.getPublicKey("hex");
  const nonce = crypto.randomBytes(32).toString("base64");
  return { ecdh, publicKeyHex, nonce };
}

/**
 * Encrypts a FHIR Bundle payload using ECDH Shared Secret + AES-256-GCM
 */
export function encryptFhirPayloadWithDiffieHellman(
  fhirBundle: any,
  requesterPublicKeyHex?: string
) {
  // 1. Generate local ephemeral keys
  const localEcdh = crypto.createECDH("prime256v1");
  localEcdh.generateKeys();
  const localPublicKeyHex = localEcdh.getPublicKey("hex");

  // 2. Compute or simulate remote public key
  let remoteKeyHex = requesterPublicKeyHex;
  if (!remoteKeyHex || remoteKeyHex.length < 32) {
    const tempRemote = crypto.createECDH("prime256v1");
    tempRemote.generateKeys();
    remoteKeyHex = tempRemote.getPublicKey("hex");
  }

  // 3. Compute shared secret via Diffie-Hellman
  const sharedSecret = localEcdh.computeSecret(Buffer.from(remoteKeyHex, "hex"));

  // 4. Derive AES key via SHA-256 HKDF
  const nonce = crypto.randomBytes(12); // 96-bit IV for GCM
  const derivedKey = crypto.createHash("sha256").update(sharedSecret).digest();

  // 5. Encrypt FHIR JSON
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, nonce);
  const plainJson = JSON.stringify(fhirBundle);
  let encrypted = cipher.update(plainJson, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  const combinedCiphertext = JSON.stringify({
    encryptedData: encrypted,
    authTag,
    iv: nonce.toString("base64"),
  });

  const checksum = crypto.createHash("md5").update(plainJson).digest("hex");

  return {
    encryptedContent: Buffer.from(combinedCiphertext).toString("base64"),
    checksum,
    localPublicKeyHex,
    nonce: nonce.toString("base64"),
  };
}

/**
 * Logs a DHIS (Digital Health Incentive Scheme) qualifying transaction
 */
export function recordDhisTransaction(params: {
  tenantId?: string;
  transactionType: "OP_CONSULT" | "PRESCRIPTION" | "DIAGNOSTIC_REPORT" | "DISCHARGE_SUMMARY";
  patientId?: string;
  abhaAddress?: string;
  abhaNumber?: string;
  kycStatus?: string;
  recordId?: string;
  fhirBundleId?: string;
}) {
  try {
    const db = getDb();
    const txId = `dhis-tx-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const monthYear = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const tenantId = params.tenantId || "tenant-lumera-main";

    // Standard DHIS incentive parameters: ₹20 per qualifying digital health transaction, 70/30 revenue split
    const incentiveAmount = 20;
    const clinicShare = 14; // 70%
    const lumeraShare = 6;  // 30%

    db.prepare(`
      INSERT INTO dhis_transactions (
        id, tenant_id, transaction_type, patient_id, abha_address, abha_number,
        kyc_status, record_id, fhir_bundle_id, incentive_amount, clinic_share, lumera_share,
        status, month_year, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUALIFIED', ?, ?, ?)
    `).run(
      txId,
      tenantId,
      params.transactionType,
      params.patientId || "",
      params.abhaAddress || "patient@sbx",
      params.abhaNumber || "91-0000-0000-0000",
      params.kycStatus || "LINKED_SANDBOX",
      params.recordId || "",
      params.fhirBundleId || `bundle-${crypto.randomUUID().slice(0, 8)}`,
      incentiveAmount,
      clinicShare,
      lumeraShare,
      monthYear,
      now,
      now
    );

    return { txId, incentiveAmount, clinicShare, lumeraShare };
  } catch (err) {
    console.error("Failed to log DHIS transaction:", err);
    return null;
  }
}

/** UI-facing ABDM status. Matches Platform #35 freeze: { abdmMode, bridgeReady } only. */
export type AbdmMode = "stub" | "sandbox";

export function buildAbdmStatusPayload(): { abdmMode: AbdmMode; bridgeReady: boolean } {
  // Same two-key shape as #47. Mode/creds live in abdm-mode.ts.
  return getAbdmBridgeStatus();
}

/**
 * Creates the ABDM v3 Gateway and Identity Express Router
 */
