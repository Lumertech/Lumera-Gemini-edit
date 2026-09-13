/**
 * ABDM HIP/HIU consent and encrypted FHIR share routes.
 * Extracted from server/abdm.ts so GitHub MCP can upload without truncating the gateway.
 */
import { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import { getDb, mapPatient, writeAudit } from "./db.ts";
import { isAbdmPlaceholderRegistryMode, resolveAbdmMode } from "./abdm-mode.ts";
import { formatAbdmArtefactLabel } from "../src/lib/abdmRegistryLabel.ts";
import { createPrescriptionBundle } from "./fhir.ts";
import {
  findTenantPatientByAbha,
  getTenantPatient,
  listTenantConsentArtefacts,
  storeConsentArtefact,
} from "./clinical.ts";
import {
  ABDM_CONFIG,
  NHA_SANDBOX_NOTICE,
  callbackTenantId,
  callbackHmac,
  careContextReference,
  findTenantArtefactByConsentId,
  consentBlocksFetch,
  encryptFhirPayloadWithDiffieHellman,
} from "./abdm-internal.ts";

export function registerAbdmConsentRoutes(router: Router): void {
  // HIP + HIU freeze scaffolds (#35 comment 5625629400). NHA sandbox only.
  // No distinct HRP routes — records stay on clinical SoT + FHIR serializers.
  // -------------------------------------------------------------
  type ArtefactKind =
    | "hip_notify"
    | "hip_care_context"
    | "hip_link_confirm"
    | "hip_on_request"
    | "hiu_consent"
    | "hiu_consent_init"
    | "hiu_fetch"
    | "hiu_receive";

  const persistCallbackArtefact = (
    req: Request,
    res: Response,
    kind: ArtefactKind
  ) => {
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }

    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    if (!patientId) {
      return res.status(400).json({ error: "patientId is required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    if (!getTenantPatient(tenantId, patientId)) {
      return res.status(403).json({ error: "Patient not found", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }

    const existing = listTenantConsentArtefacts(tenantId, patientId);
    const grantId = String(
      req.body?.consentId || req.body?.consent_id || req.body?.consentArtefact?.consentId || ""
    ).trim();
    if (kind === "hiu_fetch" || kind === "hiu_receive" || kind === "hip_on_request") {
      const consent = existing.find((row) => !grantId || String(row.consentId) === grantId) || findTenantArtefactByConsentId(tenantId, grantId);
      if (consentBlocksFetch(consent)) {
        return res.status(403).json({
          error: "HIU fetch blocked: consent is not granted",
          abdmMode: resolveAbdmMode(),
          sandboxNotice: NHA_SANDBOX_NOTICE,
        });
      }
    }

    const raw = req.body?.consentArtefact || req.body?.consent_artefact || req.body?.consent;
    const persistId =
      kind === "hiu_fetch"
        ? String(req.body?.fetchId || `fetch-${grantId || crypto.randomUUID().slice(0, 8)}`)
        : kind === "hiu_receive"
          ? String(req.body?.receiveId || `recv-${grantId || crypto.randomUUID().slice(0, 8)}`)
          : kind === "hip_on_request"
            ? String(req.body?.requestId || `hip-req-${grantId || crypto.randomUUID().slice(0, 8)}`)
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
            status: req.body?.status || (kind === "hiu_fetch" || kind === "hiu_receive" ? "FETCHED" : "GRANTED"),
            hiTypes: req.body?.hiTypes,
            dateRange: req.body?.dateRange,
            purpose: req.body?.purpose || kind,
            requesterName: req.body?.requesterName,
            grantedAt: req.body?.grantedAt || new Date().toISOString(),
            hfrId: req.body?.hfrId || req.body?.hfr_id,
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
    const ack = kind === "hiu_fetch" || kind === "hiu_receive" || kind === "hip_on_request" ? 200 : 202;
    return res.status(ack).json({
      status: ack === 200 ? "OK" : "ACKNOWLEDGED",
      abdmMode: resolveAbdmMode(),
      patientId,
      consentId: artefact.consentId,
      consentIdLabel: formatAbdmArtefactLabel(String(artefact.consentId || ""), isAbdmPlaceholderRegistryMode()),
      kind,
      signatureOk: hmac.ok && hmac.matched === true,
      artefacts,
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHipCareContext = (req: Request, res: Response) => {
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    const encounterId = String(req.body?.encounterId || req.body?.encounter_id || "").trim();
    if (!patientId || !encounterId) {
      return res.status(400).json({
        error: "patientId and encounterId are required",
        abdmMode: resolveAbdmMode(),
        sandboxNotice: NHA_SANDBOX_NOTICE,
      });
    }
    const row = getTenantPatient(tenantId, patientId);
    if (!row) {
      return res.status(403).json({ error: "Patient not found", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patient = mapPatient(row);
    const ref = careContextReference(patient.uhid, encounterId);
    storeConsentArtefact(
      tenantId,
      patientId,
      {
        consentId: ref,
        kind: "hip_care_context",
        status: "LINKED",
        careContextReference: ref,
        encounterId,
        hiTypes: req.body?.hiTypes || [],
        display: req.body?.display || encounterId,
        recordProducer: "lumera",
        purpose: "hip_care_context",
      },
      { id: req.user?.id, name: req.user?.name || "HIP care-context" }
    );
    return res.json({
      careContextReference: ref,
      careContextLabel: formatAbdmArtefactLabel(ref, isAbdmPlaceholderRegistryMode()),
      abdmMode: resolveAbdmMode(),
      patientId,
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHipPatientDiscover = (req: Request, res: Response) => {
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const abhaNumber = String(req.body?.abhaNumber || req.body?.abha_number || "").trim();
    const abhaAddress = String(req.body?.abhaAddress || req.body?.abha_address || "").trim();
    const row = findTenantPatientByAbha(tenantId, abhaNumber, abhaAddress);
    if (!row) {
      return res.json({ found: false, abdmMode: resolveAbdmMode(), careContexts: [], sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patient = mapPatient(row);
    const artefacts = listTenantConsentArtefacts(tenantId, patient.id);
    const careContexts = artefacts
      .filter((item) => String((item as { kind?: string }).kind || "") === "hip_care_context" || (item as { careContextReference?: string }).careContextReference)
      .map((item) => ({
        careContextReference: String((item as { careContextReference?: string }).careContextReference || item.consentId),
        display: String((item as { display?: string }).display || item.consentId),
      }));
    return res.json({
      found: true,
      abdmMode: resolveAbdmMode(),
      patient: {
        patientId: patient.id,
        abhaNumber: patient.abhaNumber,
        abhaAddress: patient.abhaAddress,
        name: patient.name,
        uhid: patient.uhid,
      },
      careContexts,
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHipOnConfirm = (req: Request, res: Response) => {
    const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    if (patientId) {
      return persistCallbackArtefact(req, res, "hip_link_confirm");
    }
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    return res.status(202).json({
      status: "ACKNOWLEDGED",
      abdmMode: resolveAbdmMode(),
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHipOnRequest = (req: Request, res: Response) => {
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const grantId = String(
      req.body?.consentId || req.body?.consent_id || req.body?.consent?.id || req.body?.consent?.consentId || ""
    ).trim();
    let patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    const byConsent = grantId ? findTenantArtefactByConsentId(tenantId, grantId) : undefined;
    if (!patientId && byConsent?.patientId) patientId = String(byConsent.patientId);
    if (!patientId) {
      return res.status(400).json({ error: "patientId is required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const row = getTenantPatient(tenantId, patientId);
    if (!row) {
      return res.status(403).json({ error: "Patient not found", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    if (grantId) {
      const grant = byConsent || findTenantArtefactByConsentId(tenantId, grantId);
      if (consentBlocksFetch(grant)) {
        return res.status(403).json({
          error: "HIU fetch blocked: consent is not granted",
          abdmMode: resolveAbdmMode(),
          sandboxNotice: NHA_SANDBOX_NOTICE,
        });
      }
    }
    const patient = mapPatient(row);
    const encounterId = String(req.body?.encounterId || req.body?.encounter_id || "OPD").trim() || "OPD";
    const ref = careContextReference(patient.uhid, encounterId);
    const persistId = `hip-req-${grantId || crypto.randomUUID().slice(0, 8)}`;
    storeConsentArtefact(
      tenantId,
      patientId,
      {
        consentId: persistId,
        grantId: grantId || undefined,
        kind: "hip_on_request",
        status: "SHARED",
        careContextReference: ref,
        purpose: "hip_on_request",
        transactionId: req.body?.transactionId,
      },
      { id: req.user?.id, name: req.user?.name || "HIP on-request" }
    );

    const doctor = (getDb().prepare("SELECT * FROM doctors LIMIT 1").get() || {
      id: "doc-stub",
      name: "Clinician",
      reg_number: "",
      specialty: "General Medicine",
      hpr_id: "",
    }) as Record<string, unknown>;
    const rxBundle = createPrescriptionBundle(
      {
        id: persistId,
        rxNumber: `RX-SBX-${persistId.slice(-6)}`,
        date: new Date().toISOString(),
        diagnosis: "NHA sandbox stub record",
        icd10Code: "",
        medicines: [],
      },
      {
        id: patient.id,
        uhid: patient.uhid,
        name: patient.name,
        gender: patient.gender,
        age: patient.age,
        phone: patient.phone,
        abhaNumber: patient.abhaNumber,
        abhaAddress: patient.abhaAddress,
        kycStatus: "LINKED_SANDBOX",
      },
      {
        id: String(doctor.id || "doc-stub"),
        name: String(doctor.name || "Clinician"),
        regNumber: String(doctor.reg_number || ""),
        specialty: String(doctor.specialty || "General Medicine"),
        hprId: String(doctor.hpr_id || ""),
        qualification: String(doctor.qualification || ""),
      },
      { id: tenantId, name: ABDM_CONFIG.FACILITY_NAME, hfrId: ABDM_CONFIG.HFR_ID }
    );
    const requesterKey = req.body?.keyMaterial?.dhPublicKey?.keyValue;
    const { encryptedContent, checksum, localPublicKeyHex, nonce } =
      encryptFhirPayloadWithDiffieHellman(rxBundle, requesterKey);

    return res.json({
      pageNumber: 1,
      pageCount: 1,
      transactionId: String(req.body?.transactionId || `tx-sbx-${crypto.randomUUID().slice(0, 8)}`),
      abdmMode: resolveAbdmMode(),
      patientId,
      consentId: grantId || persistId,
      careContextReference: ref,
      keyMaterial: {
        cryptoAlg: "ECDH",
        curve: "prime256v1",
        dhPublicKey: {
          expiry: new Date(Date.now() + 3600000).toISOString(),
          parameters: "NIST P-256",
          keyValue: localPublicKeyHex,
        },
        nonce,
      },
      entries: [
        {
          content: encryptedContent,
          media: "application/fhir+json",
          checksum,
          careContextReference: ref,
          linkId: rxBundle.id,
        },
      ],
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHiuConsentInit = (req: Request, res: Response) => {
    const hmac = callbackHmac(req);
    if (hmac.ok === false) {
      return res.status(hmac.status).json({ error: hmac.error, abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
    if (!patientId) {
      return res.status(400).json({ error: "patientId is required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    if (!getTenantPatient(tenantId, patientId)) {
      return res.status(403).json({ error: "Patient not found", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const consentRequestId = String(req.body?.consentRequestId || `cr-${crypto.randomUUID().slice(0, 8)}`);
    storeConsentArtefact(
      tenantId,
      patientId,
      {
        consentId: consentRequestId,
        kind: "hiu_consent_init",
        status: "REQUESTED",
        hiTypes: req.body?.hiTypes || [],
        dateRange: req.body?.dateRange,
        purpose: req.body?.purpose || "hiu_consent_init",
        abhaAddress: req.body?.abhaAddress,
      },
      { id: req.user?.id, name: req.user?.name || "HIU consent init" }
    );
    return res.json({
      consentRequestId,
      abdmMode: resolveAbdmMode(),
      patientId,
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  const handleHiuListConsents = (req: Request, res: Response) => {
    const tenantId = callbackTenantId(
      req as unknown as { user?: { tenantId?: string }; headers: Record<string, unknown>; body?: Record<string, unknown> }
    );
    if (!tenantId) {
      return res.status(401).json({ error: "Authentication required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    const patientId = String(req.query.patientId || req.query.patient_id || "").trim();
    if (!patientId) {
      return res.status(400).json({ error: "patientId is required", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    if (!getTenantPatient(tenantId, patientId)) {
      return res.status(403).json({ error: "Patient not found", abdmMode: resolveAbdmMode(), sandboxNotice: NHA_SANDBOX_NOTICE });
    }
    return res.json({
      abdmMode: resolveAbdmMode(),
      patientId,
      artefacts: listTenantConsentArtefacts(tenantId, patientId),
      sandboxNotice: NHA_SANDBOX_NOTICE,
    });
  };

  router.post(["/hip/link/care-context", "/v3/hip/link/care-context"], handleHipCareContext);
  router.post(["/hip/patient-discover", "/v3/hip/patient-discover"], handleHipPatientDiscover);
  router.post(["/hip/link/on-confirm", "/v3/hip/link/on-confirm"], handleHipOnConfirm);
  router.post(
    ["/hip/consent/on-notify", "/hip/notify", "/callbacks/hip/notify", "/v3/hip/notify"],
    (req, res) => persistCallbackArtefact(req, res, "hip_notify")
  );
  router.post(
    [
      "/hip/health-information/on-request",
      "/v3/hip/health-information/on-request",
      "/hip/data-notification",
      "/v3/hip/data-notification",
      "/data-notification",
    ],
    handleHipOnRequest
  );

  router.post(["/hiu/consent-request/init", "/v3/hiu/consent-request/init"], handleHiuConsentInit);
  router.post(
    [
      "/hiu/consent-request/on-status",
      "/hiu/consent-requests",
      "/v3/hiu/consent-requests",
      "/consent-requests",
      "/hiu/consent/notify",
      "/hiu/consent",
      "/callbacks/hiu/consent",
      "/v3/hiu/consent/notify",
    ],
    (req, res) => persistCallbackArtefact(req, res, "hiu_consent")
  );
  router.post(
    ["/hiu/health-information/request", "/hiu/fetch", "/callbacks/hiu/fetch", "/v3/hiu/fetch"],
    (req, res) => persistCallbackArtefact(req, res, "hiu_fetch")
  );
  router.post(
    ["/hiu/health-information/on-receive", "/v3/hiu/health-information/on-receive"],
    (req, res) => persistCallbackArtefact(req, res, "hiu_receive")
  );
  router.get(["/hiu/consents", "/v3/hiu/consents"], handleHiuListConsents);

}
