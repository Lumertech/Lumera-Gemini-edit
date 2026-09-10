import crypto from "node:crypto";
import { appPublicUrl, isProduction, isUnsetOrPlaceholder, readSecret, sandboxSimulatorsEnabled } from "./runtime.ts";

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

export function getRazorpayKeyId(): string {
  return readSecret("RAZORPAY_KEY_ID");
}

export function getRazorpayKeySecret(): string {
  return readSecret("RAZORPAY_KEY_SECRET");
}

export function getRazorpayWebhookSecret(): string {
  return readSecret("RAZORPAY_WEBHOOK_SECRET");
}

export function razorpayKeysConfigured(): boolean {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret());
}

export function rupeesToPaise(rupees: number): number {
  return Math.max(0, Math.round(Number(rupees || 0) * 100));
}

export function verifyRazorpayWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | string[] | undefined,
  webhookSecret: string
): boolean {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!header || !webhookSecret) return false;
  const providedHex = header.trim();
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;
  const expectedHex = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export type RazorpayWebhookDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Paid status is fail-closed: a verified HMAC is required.
 * Missing secret in production is a hard fail. Unsigned bodies never mark paid.
 * Non-prod without a secret also rejects the webhook — use the explicit sandbox mock.
 */
export function decideRazorpayWebhookSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader?: string | string[];
  webhookSecret?: string;
  production?: boolean;
}): RazorpayWebhookDecision {
  const production = opts.production ?? isProduction();
  const secret = String(opts.webhookSecret ?? getRazorpayWebhookSecret()).trim();
  if (isUnsetOrPlaceholder(secret)) {
    return {
      ok: false,
      status: production ? 500 : 403,
      error: production
        ? "RAZORPAY_WEBHOOK_SECRET is not configured; webhook signatures cannot be verified."
        : "Razorpay webhook secret is unset. Unsigned webhooks cannot mark invoices paid. Use POST /api/invoices/:id/sandbox-pay in non-prod.",
    };
  }
  if (!verifyRazorpayWebhookSignature(opts.rawBody, opts.signatureHeader, secret)) {
    return { ok: false, status: 403, error: "Invalid or missing X-Razorpay-Signature." };
  }
  return { ok: true };
}

export type RazorpayLinkResult =
  | {
      ok: true;
      sandbox: boolean;
      orderId: string;
      paymentLinkId: string;
      payLink: string;
      keyId: string;
      raw?: unknown;
    }
  | { ok: false; error: string; sandbox: boolean };

async function razorpayRequest(
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ status: number; json: Record<string, unknown> }> {
  const keyId = getRazorpayKeyId();
  const keySecret = getRazorpayKeySecret();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetchImpl(`${RAZORPAY_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function createRazorpayCollectOrder(opts: {
  amountRupees: number;
  invoiceId: string;
  invoiceNumber: string;
  tenantId: string;
  patientName: string;
  patientPhone: string;
  description?: string;
  fetchImpl?: typeof fetch;
  publicUrl?: string;
}): Promise<RazorpayLinkResult> {
  const amountPaise = rupeesToPaise(opts.amountRupees);
  if (amountPaise < 100) {
    return { ok: false, error: "Amount must be at least ₹1.", sandbox: sandboxSimulatorsEnabled() };
  }

  const notes = {
    invoice_id: opts.invoiceId,
    invoice_number: opts.invoiceNumber,
    tenant_id: opts.tenantId,
  };

  if (!razorpayKeysConfigured()) {
    if (isProduction()) {
      return {
        ok: false,
        sandbox: false,
        error:
          "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Invoice was not marked paid.",
      };
    }
    const origin = opts.publicUrl || appPublicUrl();
    return {
      ok: true,
      sandbox: true,
      orderId: `order_sandbox_${opts.invoiceId}`,
      paymentLinkId: `plink_sandbox_${opts.invoiceId}`,
      payLink: `${origin}/sandbox/pay/${opts.invoiceId}`,
      keyId: "",
    };
  }

  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const order = await razorpayRequest(
      "/orders",
      {
        amount: amountPaise,
        currency: "INR",
        receipt: opts.invoiceNumber.slice(0, 40),
        notes,
        payment_capture: 1,
      },
      fetchImpl
    );
    if (order.status >= 400 || !order.json.id) {
      const apiError =
        (order.json.error as { description?: string } | undefined)?.description ||
        `Razorpay order failed (HTTP ${order.status}).`;
      return { ok: false, error: apiError, sandbox: false };
    }

    const link = await razorpayRequest(
      "/payment_links",
      {
        amount: amountPaise,
        currency: "INR",
        accept_partial: false,
        description: opts.description || `Lumera invoice ${opts.invoiceNumber}`,
        customer: {
          name: opts.patientName || "Patient",
          contact: String(opts.patientPhone || "").replace(/[^\d]/g, "").slice(-10),
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes,
        callback_url: `${opts.publicUrl || appPublicUrl()}/billing/razorpay/callback`,
        callback_method: "get",
        options: {
          checkout: {
            name: "Lumera clinic collect",
            method: { upi: 1, card: 1, netbanking: 1 },
          },
        },
      },
      fetchImpl
    );
    const payLink = String(link.json.short_url || link.json.shortUrl || "").trim();
    const paymentLinkId = String(link.json.id || "").trim();
    if (link.status >= 400 || !payLink) {
      const apiError =
        (link.json.error as { description?: string } | undefined)?.description ||
        `Razorpay payment link failed (HTTP ${link.status}).`;
      return { ok: false, error: apiError, sandbox: false };
    }

    return {
      ok: true,
      sandbox: false,
      orderId: String(order.json.id),
      paymentLinkId,
      payLink,
      keyId: getRazorpayKeyId(),
      raw: { order: order.json, paymentLink: link.json },
    };
  } catch (err) {
    return {
      ok: false,
      sandbox: false,
      error: err instanceof Error ? err.message : "Razorpay request failed.",
    };
  }
}

export type RazorpayPaidRefs = {
  invoiceId: string;
  tenantId: string;
  orderId: string;
  paymentId: string;
  paymentLinkId: string;
  event: string;
};

function notesOf(entity: Record<string, unknown> | undefined): Record<string, string> {
  const notes = entity?.notes;
  if (!notes || typeof notes !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes as Record<string, unknown>)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

export function extractRazorpayPaidRefs(payload: unknown): RazorpayPaidRefs | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
      payment_link?: { entity?: Record<string, unknown> };
    };
  };
  const event = String(body.event || "");
  const paidEvents = new Set(["payment.captured", "order.paid", "payment_link.paid"]);
  if (event && !paidEvents.has(event)) return null;

  const payment = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const link = body.payload?.payment_link?.entity;
  const notes = { ...notesOf(link), ...notesOf(order), ...notesOf(payment) };

  return {
    invoiceId: notes.invoice_id || "",
    tenantId: notes.tenant_id || "",
    orderId: String(payment?.order_id || order?.id || link?.order_id || "").trim(),
    paymentId: String(payment?.id || "").trim(),
    paymentLinkId: String(link?.id || "").trim(),
    event: event || "payment.captured",
  };
}
