/**
 * Lumera Health ABDM v3 Gateway & Identity Service
 * Implements:
 * 1. ABDM Sandbox OAuth Bridge Session (/v3/bridgesession)
 * 2. Aadhaar ABHA Generation & Verification (/v3/registration/aadhaar/*)
 * 3. ABDM Webhook Listeners for Consent & Tokenized Data Transfer with Diffie-Hellman (ECDH) Key Exchange
 * 4. DHIS (Digital Health Incentive Scheme) transaction registration and audit engine
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { getDb, writeAudit } from "./db.ts";
import { allowOtpEcho, requireAuth } from "./auth.ts";
import { getAbdmBridgeStatus, resolveAbdmMode } from "./abdm-mode.ts";
import { decideAbdmCallbackSignature } from "./abdm-hmac.ts";
import { getTenantPatient, listTenantConsentArtefacts, storeConsentArtefact } from "./clinical.ts";
import {
  createPrescriptionBundle,
  createOPConsultBundle,
  createDiagnosticReportBundle,
  type PatientContext,
  type DoctorContext,
  type TenantContext,
} from "./fhir.ts";

// SECURITY: this module is a *local stand-in* for the real ABDM sandbox
// gateway (no requests currently leave this server for GATEWAY_URL — see
// the integration notes). Until real ABDM sandbox credentials are wired in,
// it accepts a fixed test OTP for local development convenience only. This
// must never echo the OTP back to the client, or accept the fixed test OTP,
// once NODE_ENV=production is set.

// Stub-only local stand-in. Sandbox mode (#38) must use env creds — never these placeholders.
const STUB_GATEWAY = "https://sandbox.abdm.gov.in/api/v3";
const ABDM_CONFIG = {
  GATEWAY_URL: process.env.ABDM_GATEWAY_URL || STUB_GATEWAY,
  CLIENT_ID: resolveAbdmMode() === "sandbox" ? process.env.ABDM_CLIENT_ID || "" : process.env.ABDM_CLIENT_ID || "",
  CLIENT_SECRET: resolveAbdmMode() === "sandbox" ? process.env.ABDM_CLIENT_SECRET || "" : process.env.ABDM_CLIENT_SECRET || "",
  HFR_ID: process.env.ABDM_HFR_ID || "HFR-IN-8829104",
  FACILITY_NAME: "Lumera Polyclinic & Diagnostic Network",
};

const NHA_SANDBOX_NOTICE =
  "NHA sandbox: local stand-in until NHA credentials are provisioned.";

function tenantIdOf(req: { user?: { tenantId?: string } }): string {
  return String(req.user?.tenantId || "").trim();
}

function callbackTenantId(req: { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }): string | null {
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

// In-Memory ABDM Token Cache
interface AbdmSession {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
}
let cachedSession: AbdmSession | null = null;

// In-Memory Aadhaar OTP Session Cache for Sandbox Flow
interface AadhaarOtpSession {
  txnId: string;
  aadhaarNumber: string;
  otp: string;
  expiresAt: number;
  name: string;
  gender: string;
  dob: string;
  mobile: string;
  pincode: string;
  address: string;
}
const otpSessions = new Map<string, AadhaarOtpSession>();

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
const consentStore = new Map<string, ConsentArtefact>();

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
  // Local stand-in: OTP/DHIS work in-process. Do not report sandbox until #45
  // wires real NHA creds (ABDM_MODE=sandbox). Placeholder SBX_* is not sandbox.
  return { abdmMode: "stub", bridgeReady: true };
}

/**
 * Creates the ABDM v3 Gateway and Identity Express Router
 */
export function createAbdmRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------
  // 1. ABDM V3 GATEWAY BRIDGE SESSION (/v3/bridgesession)
  // -------------------------------------------------------------
  const handleBridgeSession = (req: Request, res: Response) => {
    try {
      const clientId = req.body?.clientId || req.headers["x-client-id"] || ABDM_CONFIG.CLIENT_ID;
      const clientSecret = req.body?.clientSecret || req.headers["x-client-secret"] || ABDM_CONFIG.CLIENT_SECRET;

      // Check cache
      if (cachedSession && cachedSession.expiresAt > Date.now() + 60000) {
        return res.json({
          accessToken: cachedSession.accessToken,
          expiresIn: Math.floor((cachedSession.expiresAt - Date.now()) / 1000),
          tokenType: cachedSession.tokenType,
          hfrId: ABDM_CONFIG.HFR_ID,
          gatewayUrl: ABDM_CONFIG.GATEWAY_URL,
          cached: true,
        });
      }

      // Generate session token (local stub)
      const expiresIn = 1800; // 30 minutes
      const accessToken = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abdm_sbx_${crypto.randomUUID().replace(/-/g, "")}.${Date.now()}`;

      cachedSession = {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: "Bearer",
      };

      writeAudit(getDb(), req.user?.id || null, req.user?.name || "ABDM Service", "ABDM_OAUTH_TOKEN_EXCHANGED", `Client: ${clientId}`);

      res.json({
        accessToken,
        expiresIn,
        tokenType: "Bearer",
        hfrId: ABDM_CONFIG.HFR_ID,
        facilityName: ABDM_CONFIG.FACILITY_NAME,
        abdmMode: buildAbdmStatusPayload().abdmMode,
        gatewayUrl: ABDM_CONFIG.GATEWAY_URL,
      });
    } catch (err: any) {
      res.status(500).json({ error: "ABDM Gateway Bridge Session error: " + err.message });
    }
  };

  router.post(["/v3/bridgesession", "/bridgesession", "/v3/sessions", "/sessions"], handleBridgeSession);

  // Status check — exactly { abdmMode, bridgeReady } (#47 / #38 freeze).
  router.get("/status", (_req, res) => {
    res.json(buildAbdmStatusPayload());
  });

  // -------------------------------------------------------------
  // 2. AADHAAR ABHA GENERATION & VERIFICATION WORKFLOWS
  // -------------------------------------------------------------

  // Step 1: Generate Aadhaar OTP (/v3/registration/aadhaar/generateOtp)
  const handleGenerateAadhaarOtp = (req: Request, res: Response) => {
    try {
      const { aadhaar } = req.body;
      const cleanAadhaar = (aadhaar || "").replace(/\D/g, "");

      if (cleanAadhaar.length !== 12) {
        return res.status(400).json({
          error: "Invalid Aadhaar number. Must be a 12-digit number.",
        });
      }

      const txnId = `txn-abdm-${crypto.randomUUID().slice(0, 8)}`;
      const testOtp = "123456"; // Standard ABDM Sandbox OTP
      const lastFour = cleanAadhaar.slice(-4);

      // Deterministic demo name based on last digits for testing variety
      const demoNames: Record<string, { name: string; gender: string; dob: string; mobile: string }> = {
        "5678": { name: "Rajiv Saxena", gender: "M", dob: "1982-04-12", mobile: "+91 98234 55667" },
        "4456": { name: "Priyanka Mukherjee", gender: "F", dob: "1974-09-21", mobile: "+91 98311 44556" },
        "3456": { name: "Sunita Roy", gender: "F", dob: "1978-06-18", mobile: "+91 98301 23456" },
        "5432": { name: "Rohan Deshmukh", gender: "M", dob: "1994-11-05", mobile: "+91 98200 45678" },
      };

      const matched = demoNames[lastFour] || {
        name: "Abhinav Sharma",
        gender: "M",
        dob: "1988-08-14",
        mobile: `+91 98${cleanAadhaar.slice(4, 12)}`,
      };

      otpSessions.set(txnId, {
        txnId,
        aadhaarNumber: cleanAadhaar,
        otp: testOtp,
        expiresAt: Date.now() + 10 * 60 * 1000,
        name: matched.name,
        gender: matched.gender,
        dob: matched.dob,
        mobile: matched.mobile,
        pincode: "560066",
        address: "E-104, Palm Meadows, Whitefield, Bengaluru, Karnataka",
      });

      const abdmMode = resolveAbdmMode();
      res.json({
        txnId,
        message: `OTP sent successfully to Aadhaar-registered mobile ending in ******${lastFour}`,
        // Stub-only echo when allowOtpEcho(); never in production or sandbox.
        testOtp: allowOtpEcho() && abdmMode === "stub" ? "123456" : undefined,
        expiresInSeconds: 600,
        abdmMode,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to generate Aadhaar OTP: " + err.message });
    }
  };

  router.post(["/v3/registration/aadhaar/generateOtp", "/registration/aadhaar/generateOtp", "/aadhaar/generate-otp"], handleGenerateAadhaarOtp);

  // Step 2: Verify Aadhaar OTP (/v3/registration/aadhaar/verifyOTP)
  const handleVerifyAadhaarOtp = (req: Request, res: Response) => {
    try {
      const { txnId, otp } = req.body;

      if (!txnId || !otp) {
        return res.status(400).json({ error: "Both txnId and otp are required" });
      }

      const session = otpSessions.get(txnId);
      if (!session) {
        return res.status(400).json({ error: "Transaction session expired or invalid. Please request a new OTP." });
      }

      const allowFixedTestOtp = allowOtpEcho() && otp === "123456";
      if (otp !== session.otp && !allowFixedTestOtp) {
        return res.status(400).json({
          error: allowOtpEcho() ? "Incorrect OTP. Use 123456 in local Sandbox mode." : "Incorrect OTP.",
        });
      }

      // Generate 14-digit ABHA Number (Format: 91-XXXX-XXXX-XXXX)
      const abhaSeed = session.aadhaarNumber.slice(2, 12) + "99";
      const abhaNumber = `91-${abhaSeed.slice(0, 4)}-${abhaSeed.slice(4, 8)}-${abhaSeed.slice(8, 12)}`;
      const cleanName = session.name.toLowerCase().replace(/[^a-z]/g, ".");
      const abhaAddress = `${cleanName}@sbx`;

      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Reception Desk",
        "ABHA OTP matched (NHA sandbox)",
        `ABHA: ${abhaNumber} (${abhaAddress})`
      );

      res.json({
        success: true,
        abdmMode: resolveAbdmMode(),
        abhaNumber,
        abhaAddress,
        kycStatus: "LINKED_SANDBOX",
        profile: {
          name: session.name,
          gender: session.gender,
          dob: session.dob,
          mobile: session.mobile,
          address: session.address,
          pincode: session.pincode,
        },
        sandboxNotice: NHA_SANDBOX_NOTICE,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to verify Aadhaar OTP: " + err.message });
    }
  };

  router.post(["/v3/registration/aadhaar/verifyOTP", "/registration/aadhaar/verifyOTP", "/aadhaar/verify-otp"], handleVerifyAadhaarOtp);

  // Search by ABHA — tenant-scoped; do not invent a profile when missing.
  router.post(["/v3/search/searchByAbha", "/search/searchByAbha", "/v3/search/searchByMobile", "/search/searchByMobile"], requireAuth, (req, res) => {
    const tenantId = tenantIdOf(req);
    const needle = String(req.body?.abhaAddress || req.body?.abhaNumber || req.body?.mobile || "").trim();
    if (!tenantId || !needle) {
      return res.json({ found: false, abdmMode: resolveAbdmMode() });
    }
    const row = getDb()
      .prepare(
        `SELECT * FROM patients
         WHERE tenant_id = ? AND (abha_address = ? OR abha_number = ? OR phone = ?)
         LIMIT 1`
      )
      .get(tenantId, needle, needle, needle) as Record<string, unknown> | undefined;
    if (!row) {
      return res.json({ found: false, abdmMode: resolveAbdmMode() });
    }
    res.json({
      found: true,
      abdmMode: resolveAbdmMode(),
      profile: {
        name: row.name,
        gender: row.gender,
        dob: "",
        mobile: row.phone,
        address: row.address,
        pincode: "",
        abhaNumber: row.abha_number,
        abhaAddress: row.abha_address,
      },
    });
  });

  // QR share — return profile fields only; Platform link-abha is the SoT write.
  router.post(["/v3/profile/share", "/profile/share"], (req, res) => {
    try {
      const { qrPayload } = req.body;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof qrPayload === "string" ? JSON.parse(qrPayload) : qrPayload || {};
      } catch {
        parsed = {};
      }
      const abhaNumber = String(parsed.hidn || parsed.abhaNumber || "");
      const abhaAddress = String(parsed.hid || parsed.abhaAddress || "");
      res.json({
        success: true,
        abdmMode: resolveAbdmMode(),
        abhaNumber,
        abhaAddress,
        kycStatus: "LINKED_SANDBOX",
        profile: {
          name: String(parsed.name || ""),
          gender: String(parsed.gender || ""),
          dob: String(parsed.dob || ""),
          mobile: String(parsed.mobile || ""),
          address: String(parsed.address || ""),
          pincode: String(parsed.pincode || ""),
        },
        sandboxNotice: NHA_SANDBOX_NOTICE,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to process ABDM QR Profile Share: " + err.message });
    }
  });

  // -------------------------------------------------------------
  // 3. ABDM WEBHOOK LISTENERS: CONSENT & TOKENIZED DATA TRANSFER (Diffie-Hellman)
  // -------------------------------------------------------------

  // Webhook: Consent Request Notification (/api/v3/hiu/consent-requests)
  const handleConsentRequestWebhook = (req: Request, res: Response) => {
    try {
      const { consentRequestId, consentArtefact, timestamp } = req.body;
      const cid = consentArtefact?.consentId || consentRequestId || `consent-${crypto.randomUUID().slice(0, 8)}`;

      consentStore.set(cid, {
        consentId: cid,
        status: consentArtefact?.status || "GRANTED",
        patientAbha: consentArtefact?.patientAbha || "rajiv.saxena@abdm",
        hiTypes: consentArtefact?.hiTypes || ["Prescription", "OPConsultation", "DiagnosticReport"],
        dateRange: consentArtefact?.dateRange || { from: "2026-01-01", to: "2026-12-31" },
        requesterName: consentArtefact?.requesterName || "Health Information User (HIU)",
        purpose: consentArtefact?.purpose || "Clinical Care Continuity",
        grantedAt: timestamp || new Date().toISOString(),
      });

      writeAudit(getDb(), null, "ABDM Gateway", "ABDM_CONSENT_WEBHOOK_RECEIVED", `Consent ID: ${cid}`);

      res.status(202).json({
        status: "ACKNOWLEDGED",
        consentId: cid,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: "Consent webhook processing error: " + err.message });
    }
  };

  router.post(["/v3/hiu/consent-requests", "/hiu/consent-requests", "/consent-requests"], handleConsentRequestWebhook);

  // Webhook: Data Notification & Encrypted Transfer (/api/v3/hip/data-notification)
  const handleDataNotificationWebhook = (req: Request, res: Response) => {
    try {
      const { transactionId, consent, keyMaterial, hiTypes } = req.body;
      const consentId = consent?.id || "consent-art-991";
      const consentRecord = consentStore.get(consentId) || {
        patientAbha: "rajiv.saxena@abdm",
        status: "GRANTED",
      };

      // Retrieve clinical records for the patient
      const db = getDb();
      const patient = (db.prepare("SELECT * FROM patients WHERE abha_address = ? OR phone LIKE '%98234%'").get(consentRecord.patientAbha) ||
        db.prepare("SELECT * FROM patients LIMIT 1").get()) as any;

      const doctor = (db.prepare("SELECT * FROM doctors LIMIT 1").get() || {
        id: "doc-1",
        name: "Dr. Vikram Malhotra",
        reg_number: "MCI-2012-8819",
        specialty: "General Medicine",
        hpr_id: "HPR-IN-9024819",
      }) as any;

      const tenant = {
        id: "tenant-lumera-main",
        name: ABDM_CONFIG.FACILITY_NAME,
        hfrId: ABDM_CONFIG.HFR_ID,
      };

      const patientContext: PatientContext = {
        id: patient.id,
        uhid: patient.uhid,
        name: patient.name,
        gender: patient.gender,
        age: patient.age,
        phone: patient.phone,
        abhaNumber: patient.abha_number || "91-4428-9102-3841",
        abhaAddress: patient.abha_address || "rajiv.saxena@abdm",
        kycStatus: "LINKED_SANDBOX",
      };

      const doctorContext: DoctorContext = {
        id: doctor.id,
        name: doctor.name,
        regNumber: doctor.reg_number,
        specialty: doctor.specialty,
        hprId: doctor.hpr_id,
        qualification: doctor.qualification,
      };

      // Generate NRCeS FHIR R4 Bundle
      const rxBundle = createPrescriptionBundle(
        {
          id: "rx-transfer-101",
          rxNumber: "RX-ABDM-2026-881",
          date: new Date().toISOString(),
          diagnosis: "Essential Hypertension & Mild Type 2 Diabetes",
          icd10Code: "I10",
          medicines: [
            { name: "Telmisartan 40mg", dosage: "1 Tab", frequency: "Once daily (Morning)", duration: "30 Days", route: "Oral" },
            { name: "Metformin 500mg SR", dosage: "1 Tab", frequency: "Twice daily", duration: "30 Days", route: "Oral" },
          ],
        },
        patientContext,
        doctorContext,
        tenant
      );

      // Perform Diffie-Hellman Key Exchange + AES-256-GCM Encryption
      const requesterKey = keyMaterial?.dhPublicKey?.keyValue;
      const { encryptedContent, checksum, localPublicKeyHex, nonce } =
        encryptFhirPayloadWithDiffieHellman(rxBundle, requesterKey);

      // Record DHIS Transaction for the encrypted data transfer!
      recordDhisTransaction({
        transactionType: "PRESCRIPTION",
        patientId: patient.id,
        abhaAddress: patientContext.abhaAddress,
        abhaNumber: patientContext.abhaNumber,
        kycStatus: "LINKED_SANDBOX",
        recordId: "rx-transfer-101",
        fhirBundleId: rxBundle.id,
      });

      res.status(200).json({
        pageNumber: 1,
        pageCount: 1,
        transactionId: transactionId || `tx-ecdh-${crypto.randomUUID().slice(0, 8)}`,
        keyMaterial: {
          cryptoAlg: "ECDH",
          curve: "prime256v1",
          dhPublicKey: {
            expiry: new Date(Date.now() + 3600000).toISOString(),
            parameters: "Curve25519/NIST P-256",
            keyValue: localPublicKeyHex,
          },
          nonce,
        },
        entries: [
          {
            content: encryptedContent,
            media: "application/fhir+json",
            checksum,
            careContextReference: `CARE-CTX-${patient.uhid}-OPD`,
            linkId: rxBundle.id,
          },
        ],
        dhisStatus: "QUALIFIED_INCENTIVE_RECORDED",
      });
    } catch (err: any) {
      res.status(500).json({ error: "Data notification error: " + err.message });
    }
  };

  router.post(["/v3/hip/data-notification", "/hip/data-notification", "/data-notification"], handleDataNotificationWebhook);

  // -------------------------------------------------------------
  // 4. DHIS INCENTIVE TRACKER & AUDIT ENGINE
  // -------------------------------------------------------------
  router.get("/dhis/overview", (_req, res) => {
    try {
      const db = getDb();
      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      // Get count of transactions for current month
      const countRow = db.prepare(`
        SELECT COUNT(*) as count 
        FROM dhis_transactions 
        WHERE month_year = ? AND status = 'QUALIFIED'
      `).get(currentMonth) as { count: number };

      const transactionsCount = countRow?.count || 0;
      const threshold = 100;
      const thresholdReached = transactionsCount >= threshold;

      // Incentive calculations: ₹20 per qualifying digital health record
      const totalIncentiveEarned = transactionsCount * 20;
      const clinicShare = transactionsCount * 14; // 70%
      const lumeraShare = transactionsCount * 6;  // 30%

      // Breakdown by transaction type
      const breakdownRows = db.prepare(`
        SELECT transaction_type, COUNT(*) as c 
        FROM dhis_transactions 
        WHERE month_year = ? AND status = 'QUALIFIED'
        GROUP BY transaction_type
      `).all(currentMonth) as Array<{ transaction_type: string; c: number }>;

      const breakdown: Record<string, number> = {
        OP_CONSULT: 0,
        PRESCRIPTION: 0,
        DIAGNOSTIC_REPORT: 0,
        DISCHARGE_SUMMARY: 0,
      };
      for (const row of breakdownRows) {
        if (row.transaction_type in breakdown) {
          breakdown[row.transaction_type] = row.c;
        }
      }

      // Recent 20 transactions
      const recentTransactions = db.prepare(`
        SELECT id, transaction_type, abha_address, abha_number, kyc_status, fhir_bundle_id, incentive_amount, clinic_share, lumera_share, created_at
        FROM dhis_transactions
        WHERE month_year = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(currentMonth);

      // KYC count in patients table
      const kycRow = db.prepare(`
        SELECT COUNT(*) as c FROM patients WHERE kyc_status = 'LINKED_SANDBOX'
      `).get() as { c: number };

      res.json({
        currentMonth,
        transactionsCount,
        threshold,
        progressPercent: Math.min(100, Math.round((transactionsCount / threshold) * 100)),
        thresholdReached,
        totalIncentiveEarned,
        clinicShare,
        lumeraShare,
        breakdown,
        kycLinkedPatients: kycRow?.c || 0,
        recentTransactions,
        schemeDetails: {
          schemeName: "NHA Digital Health Incentive Scheme (DHIS v3)",
          baseRate: "₹20 / Qualifying Transaction",
          splitRatio: "70% Facility (₹14) / 30% Lumera Digital Solution (₹6)",
          disbursementSchedule: "Simulated ledger only (local stub — not a live incentive rail)",
          notice: "DHIS meter is a local stub / NHA sandbox simulation — not a live incentive claim.",
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch DHIS overview: " + err.message });
    }
  });

  // Simulate a DHIS transaction for testing & demonstration
  router.post("/dhis/simulate-transaction", (req, res) => {
    try {
      const { type = "OP_CONSULT", abhaAddress = "rajiv.saxena@abdm" } = req.body;
      const validTypes: Array<"OP_CONSULT" | "PRESCRIPTION" | "DIAGNOSTIC_REPORT" | "DISCHARGE_SUMMARY"> = [
        "OP_CONSULT",
        "PRESCRIPTION",
        "DIAGNOSTIC_REPORT",
        "DISCHARGE_SUMMARY",
      ];
      const selectedType = validTypes.includes(type) ? type : "OP_CONSULT";

      const tx = recordDhisTransaction({
        transactionType: selectedType,
        abhaAddress,
        abhaNumber: "91-4428-9102-3841",
        kycStatus: "LINKED_SANDBOX",
        recordId: `rec-${crypto.randomUUID().slice(0, 8)}`,
        fhirBundleId: `bundle-${crypto.randomUUID().slice(0, 8)}`,
      });

      res.json({
        success: true,
        transaction: tx,
        message: `Successfully registered 1 ${selectedType} DHIS transaction. Meter updated.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to simulate transaction: " + err.message });
    }
  });

  // FHIR Bundle Validation and Inspector Endpoint
  router.get("/fhir/sample/:type", (req, res) => {
    const { type } = req.params;
    const db = getDb();
    const patient = (db.prepare("SELECT * FROM patients LIMIT 1").get() || {}) as any;
    const doctor = (db.prepare("SELECT * FROM doctors LIMIT 1").get() || {}) as any;

    const patientContext: PatientContext = {
      id: patient.id || "pat-6",
      uhid: patient.uhid || "LUM-2026-0106",
      name: patient.name || "Rajiv Saxena",
      gender: patient.gender || "Male",
      age: patient.age || 44,
      phone: patient.phone || "+91 98234 55667",
      abhaNumber: patient.abha_number || "91-4428-9102-3841",
      abhaAddress: patient.abha_address || "rajiv.saxena@abdm",
      kycStatus: "LINKED_SANDBOX",
    };

    const doctorContext: DoctorContext = {
      id: doctor.id || "doc-1",
      name: doctor.name || "Dr. Vikram Malhotra",
      regNumber: doctor.reg_number || "MCI-2012-8819",
      specialty: doctor.specialty || "General Medicine",
      hprId: doctor.hpr_id || "HPR-IN-9024819",
      qualification: doctor.qualification || "MBBS, MD",
    };

    const tenantContext: TenantContext = {
      id: "tenant-lumera-main",
      name: ABDM_CONFIG.FACILITY_NAME,
      hfrId: ABDM_CONFIG.HFR_ID,
    };

    if (type === "prescription") {
      const bundle = createPrescriptionBundle(
        {
          id: "rx-sample-01",
          rxNumber: "RX-2026-0819",
          date: new Date().toISOString(),
          diagnosis: "Type 2 Diabetes Mellitus with Microalbuminuria",
          icd10Code: "E11.9",
          medicines: [
            { name: "Metformin 500mg", dosage: "1 Tab", frequency: "Twice daily with meals", duration: "30 Days", route: "Oral" },
            { name: "Empagliflozin 10mg", dosage: "1 Tab", frequency: "Once daily morning", duration: "30 Days", route: "Oral" },
          ],
        },
        patientContext,
        doctorContext,
        tenantContext
      );
      return res.json(bundle);
    }

    if (type === "diagnostic") {
      const bundle = createDiagnosticReportBundle(
        {
          id: "lab-sample-01",
          date: new Date().toISOString(),
          category: "Metabolic & Renal Profile",
          labName: "Lumera Pathology & Diagnostic Lab",
          doctorInterpretation: "Mild renal insufficiency noted. Metformin dosage adjusted.",
          results: [
            { param: "HbA1c", value: 7.8, unit: "%", normalRange: "< 5.7", status: "High" },
            { param: "Fasting Blood Sugar", value: 142, unit: "mg/dL", normalRange: "70 - 99", status: "High" },
            { param: "Serum Creatinine", value: 1.28, unit: "mg/dL", normalRange: "0.6 - 1.1", status: "High" },
            { param: "eGFR", value: 58, unit: "mL/min/1.73m²", normalRange: "> 90", status: "Low" },
          ],
        },
        patientContext,
        doctorContext,
        tenantContext
      );
      return res.json(bundle);
    }

    // Default: OP Consult
    const bundle = createOPConsultBundle(
      {
        id: "opd-sample-01",
        tokenNumber: 4,
        date: new Date().toISOString(),
        consultationType: "New Outpatient Consultation",
        diagnosis: "Lumbar Disc Strain (L4-L5) with Myofascial Pain",
        icd10Code: "M54.5",
        vitals: {
          bpSys: 124,
          bpDia: 82,
          heartRate: 74,
          temperature: 98.4,
          spO2: 99,
          weight: 72,
          height: 172,
        },
      },
      patientContext,
      doctorContext,
      tenantContext
    );
    return res.json(bundle);
  });

  // -------------------------------------------------------------
  // Thin HIP notify + HIU consent/fetch stubs (#35 / #39)
  // Persist artefacts on tenant-scoped patientId. NHA sandbox only.
  // -------------------------------------------------------------
  const persistCallbackArtefact = (
    req: Request,
    res: Response,
    kind: "hip_notify" | "hiu_consent" | "hiu_fetch" | "hrp_registry"
  ) => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body || {}));
    const hmac = decideAbdmCallbackSignature({
      rawBody,
      signatureHeader: req.headers["x-abdm-signature"],
    });
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, sandboxNotice: NHA_SANDBOX_NOTICE });
    }

    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    if (!patientId) {
      return res.status(400).json({ error: "patientId is required", sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    if (!getTenantPatient(tenantId, patientId)) {
      return res.status(403).json({ error: "Patient not found", sandboxNotice: NHA_SANDBOX_NOTICE });
    }

    const existing = listTenantConsentArtefacts(tenantId, patientId);
    const grantId = String(
      req.body?.consentId || req.body?.consent_id || req.body?.consentArtefact?.consentId || ""
    ).trim();
    if (kind === "hiu_fetch") {
      const consent = existing.find((row) => !grantId || String(row.consentId) === grantId);
      const status = String(consent?.status || "").toUpperCase();
      const until = String((consent?.dateRange as { to?: string } | undefined)?.to || "");
      const expired = Boolean(until && new Date(until).getTime() < Date.now());
      if (status === "DENIED" || status === "REVOKED" || expired) {
        return res.status(403).json({
          error: "HIU fetch blocked: consent is not granted",
          sandboxNotice: NHA_SANDBOX_NOTICE,
        });
      }
    }

    const raw = req.body?.consentArtefact || req.body?.consent_artefact || req.body?.consent;
    const persistId =
      kind === "hiu_fetch"
        ? String(req.body?.fetchId || `fetch-${grantId || crypto.randomUUID().slice(0, 8)}`)
        : String(
            (raw && typeof raw === "object" && (raw as Record<string, unknown>).consentId) ||
              req.body?.consentId ||
              req.body?.consentRequestId ||
              `${kind}-${crypto.randomUUID().slice(0, 8)}`
          );
    const artefact =
      raw && typeof raw === "object"
        ? { ...(raw as Record<string, unknown>), kind, consentId: persistId, grantId: grantId || undefined }
        : {
            consentId: persistId,
            grantId: grantId || undefined,
            status: req.body?.status || (kind === "hiu_fetch" ? "FETCHED" : "GRANTED"),
            hiTypes: req.body?.hiTypes,
            dateRange: req.body?.dateRange,
            purpose: req.body?.purpose || kind,
            requesterName: req.body?.requesterName,
            grantedAt: req.body?.grantedAt || new Date().toISOString(),
            hfrId: req.body?.hfrId || req.body?.hfr_id,
            hprId: req.body?.hprId || req.body?.hpr_id,
            kind,
          };
    artefact.kind = kind;
    artefact.consentId = persistId;
    storeConsentArtefact(tenantId, patientId, artefact, { id: req.user?.id, name: req.user?.name || "ABDM callback" });
    writeAudit(
      getDb(),
      req.user?.id || null,
      req.user?.name || "ABDM callback",
      `ABDM ${kind} (NHA sandbox)`,
      `patient ${patientId} artefact ${artefact.consentId}`
    );
    const artefacts = listTenantConsentArtefacts(tenantId, patientId);
    return res.status(kind === "hiu_fetch" ? 200 : 202).json({
      status: kind === "hiu_fetch" ? "OK" : "ACKNOWLEDGED",
      abdmMode: resolveAbdmMode(),
      patientId,
      consentId: artefact.consentId,
      kind,
      signatureOk: hmac.ok && hmac.matched === true,
      artefacts,
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  router.post(["/hip/notify", "/callbacks/hip/notify", "/v3/hip/notify"], (req, res) => {
    persistCallbackArtefact(req, res, "hip_notify");
  });
  router.post(["/hiu/consent/notify", "/hiu/consent", "/callbacks/hiu/consent", "/v3/hiu/consent/notify"], (req, res) => {
    persistCallbackArtefact(req, res, "hiu_consent");
  });
  router.post(["/hiu/fetch", "/callbacks/hiu/fetch", "/v3/hiu/fetch"], (req, res) => {
    persistCallbackArtefact(req, res, "hiu_fetch");
  });
  router.post(["/hrp/registry", "/callbacks/hrp/registry", "/v3/hrp/registry"], (req, res) => {
    persistCallbackArtefact(req, res, "hrp_registry");
  });

  return router;
}
