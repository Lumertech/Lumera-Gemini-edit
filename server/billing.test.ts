import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { DEMO_TENANT_ID, getDb, initDatabase } from "./db.ts";
import { hashPassword } from "./password.ts";
import { applyWalletTransaction } from "./usage-wallet.ts";
import {
  decideRazorpayWebhookSignature,
  extractRazorpayPaidRefs,
  razorpayKeysConfigured,
  verifyRazorpayWebhookSignature,
} from "./razorpay.ts";
import { isUnsetOrPlaceholder } from "./runtime.ts";

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

function createClinicUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tenantId = `tenant-${label}-${suffix}`;
  const userId = `user-${label}-${suffix}`;
  const email = `${label}.${suffix}@billing-test.example`.toLowerCase();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO tenants (id, name, specialty, country, timezone, phone, trial_ends_at, ai_scribe_minutes_limit, ai_scribe_minutes_used, active_status, hfr_id, created_at, updated_at)
     VALUES (?, ?, 'General Medicine', 'India', 'IST (UTC+5:30)', '+910000000000', ?, 500, 0, 1, '', ?, ?)`
  ).run(tenantId, `Clinic ${label}`, now, now, now);
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, status, phone, clinic_name, onboarding_completed, practice_type, specialty, last_login, created_at)
     VALUES (?, ?, ?, ?, ?, 'doctor', 'active', ?, ?, 1, 'individual', 'General Medicine', ?, ?)`
  ).run(
    userId,
    tenantId,
    email,
    hashPassword("Lumera@2026"),
    `Dr ${label}`,
    `+91 90000 ${label.slice(0, 5).padEnd(5, "0")}`,
    `Clinic ${label}`,
    now,
    now
  );
  applyWalletTransaction(tenantId, "adjustment", 1000, {
    note: "Test seed credit for WhatsApp metering",
    createdBy: "system",
  });
  return { tenantId, userId, email };
}

describe("Razorpay webhook signatures", () => {
  const secret = "rzp_test_webhook_secret";
  const body = '{"event":"payment.captured"}';

  it("accepts a valid X-Razorpay-Signature", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyRazorpayWebhookSignature(body, sig, secret), true);
  });

  it("rejects a tampered payload", () => {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyRazorpayWebhookSignature(body + "x", sig, secret), false);
  });

  it("fail-closes unsigned webhooks in production when the secret is missing", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      webhookSecret: "",
      production: true,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 500);
  });

  it("fail-closes unsigned webhooks in non-prod (sandbox mock is the only bypass)", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: undefined,
      webhookSecret: "",
      production: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  });

  it("fail-closes a bad signature even when the secret is present", () => {
    const decision = decideRazorpayWebhookSignature({
      rawBody: body,
      signatureHeader: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      webhookSecret: secret,
      production: false,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  });

  it("treats replace-with-* Razorpay env placeholders as unset", () => {
    assert.equal(isUnsetOrPlaceholder("replace-with-razorpay-key-id"), true);
    assert.equal(isUnsetOrPlaceholder("replace-with-razorpay-key-secret"), true);
    assert.equal(isUnsetOrPlaceholder("undefined"), true);
    const prevId = process.env.RAZORPAY_KEY_ID;
    const prevSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = "replace-with-razorpay-key-id";
    process.env.RAZORPAY_KEY_SECRET = "replace-with-razorpay-key-secret";
    assert.equal(razorpayKeysConfigured(), false);
    if (prevId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
  });
