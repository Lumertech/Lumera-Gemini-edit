/**
 * ABDM identity, DHIS, and FHIR sample routes.
 * Extracted from server/abdm.ts so GitHub MCP can upload without truncating the gateway.
 */
import { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import { getDb, writeAudit } from "./db.ts";
import { allowOtpEcho, requireAuth } from "./auth.ts";
import { isAbdmPlaceholderRegistryMode, resolveAbdmMode } from "./abdm-mode.ts";
import { formatAbdmRegistryLabel } from "../src/lib/abdmRegistryLabel.ts";
import {
  createPrescriptionBundle,
  createOPConsultBundle,
  createDiagnosticReportBundle,
  type PatientContext,
  type DoctorContext,
  type TenantContext,
} from "./fhir.ts";
import {
  ABDM_CONFIG,
  NHA_SANDBOX_NOTICE,
  tenantIdOf,
  recordDhisTransaction,
  buildAbdmStatusPayload,
} from "./abdm-internal.ts";

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


export function registerAbdmIdentityRoutes(router: Router): void {
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
          hfrLabel: formatAbdmRegistryLabel("HFR", ABDM_CONFIG.HFR_ID, isAbdmPlaceholderRegistryMode()),
          registryIdsPlaceholder: isAbdmPlaceholderRegistryMode(),
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
        hfrLabel: formatAbdmRegistryLabel("HFR", ABDM_CONFIG.HFR_ID, isAbdmPlaceholderRegistryMode()),
        registryIdsPlaceholder: isAbdmPlaceholderRegistryMode(),
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
        sandboxNotice: NHA_SANDBOX_NOTICE,
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
      kycStatus: "LINKED_SANDBOX",
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
      sandboxNotice: NHA_SANDBOX_NOTICE,
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
  // 3. HIP/HIU freeze paths are registered after DHIS/FHIR sample routes.
  //    /hiu/consent-requests and /hip/data-notification stay as aliases.
  // -------------------------------------------------------------

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
        kycVerifiedPatients: kycRow?.c || 0,
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
}
