import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { createMetaRouter } from "./meta.ts";
import { bootWhatsAppOwnershipSchema, createWhatsAppNumbersRouter, practitionerLinkMiddleware } from "./whatsapp-numbers-routes.ts";
import { getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { completeEmbeddedSignup, exchangeEmbeddedSignupCode, subscribeAppToCustomerWaba } from "./embedded-signup.ts";
import { clinicActor, getTenantWabaNumber } from "./whatsapp-numbers.ts";
import { buildMetaReadinessOverview } from "./meta-security.ts";
import { decideDataDeletionSignedRequest, signMetaSignedRequest } from "./meta-signed-request.ts";
import { wabaOnboardingCapsOverview } from "./waba-onboarding-caps.ts";

const APP_ID = "111222333444555";
const APP_SECRET = "embedded-signup-unit-secret";
const WABA_ID = "102290129340398";
const PHONE_ID = "106540352242922";
const BUSINESS_TOKEN = "EAAAN6tcBzAUBOwtDtTfmZCJ9n3FHpSDcDTH86ekf89XnnMZAtaitMUysPDE7LES3CXkA4MmbKCghdQeU1boHr0QZA05SShiILcoUy7ZAb2GE7hrUEpYHKLDuP2sYZCURkZCHGEvEGjScGLHzC4KDm8tq2slt4BsOQE1HHX8DzHahdT51MRDqBw0YaeZByrVFZkVAoVTxXUtuKgDDdrmJQXMnI4jqJYetsZCP1efj5ygGscZBm4OvvuCYB039ZAFlyNn";

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}
