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
import { getDb, mapConsentArtefact, mapPatient, writeAudit } from "./db.ts";
import { allowOtpEcho, requireAuth } from "./auth.ts";
import { getAbdmBridgeStatus, resolveAbdmMode } from "./abdm-mode.ts";
import { decideAbdmCallbackSignature } from "./abdm-hmac.ts";
import {
  findTenantPatientByAbha,
  getTenantPatient,
  listTenantConsentArtefacts,
  storeConsentArtefact,
} from "./clinical.ts";
import {
  createPrescriptionBundle,
  createOPConsultBundle,
  createDiagnosticReportBundle,
  type PatientContext,
  type DoctorContext,
  type TenantContext,
} from "./fhir.ts";
