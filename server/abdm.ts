/**
 * Lumera Health ABDM v3 Gateway & Identity Service
 * Implements:
 * 1. ABDM Sandbox OAuth Bridge Session (/v3/bridgesession)
 * 2. Aadhaar ABHA Generation & Verification (/v3/registration/aadhaar/*)
 * 3. ABDM Webhook Listeners for Consent & Tokenized Data Transfer with Diffie-Hellman (ECDH) Key Exchange
 * 4. DHIS (Digital Health Incentive Scheme) transaction registration and audit engine
 *
 * Implementation is split across abdm-internal / abdm-identity-routes / abdm-consent-routes
 * so GitHub uploads stay under the MCP truncation limit. Behavior matches main + copy labels.
 */
import { Router } from "express";
import { registerAbdmIdentityRoutes } from "./abdm-identity-routes.ts";
import { registerAbdmConsentRoutes } from "./abdm-consent-routes.ts";

export {
  generateAbdmEcdhKeys,
  encryptFhirPayloadWithDiffieHellman,
  recordDhisTransaction,
  buildAbdmStatusPayload,
  type AbdmMode,
} from "./abdm-internal.ts";

export function createAbdmRouter(): Router {
  const router = Router();
  registerAbdmIdentityRoutes(router);
  registerAbdmConsentRoutes(router);
  return router;
}
