import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.ts";
import {
  getDb,
  mapInvoice,
  writeAudit,
} from "./db.ts";
import { getTenantLetterhead } from "./letterhead.ts";
import { scrubSeedBillingIds } from "./seed-branding.ts";
import { resolveGraphCredentials, sendWhatsAppGraphText } from "./graph-whatsapp.ts";
import {
  createRazorpayCollectOrder,
  decideRazorpayWebhookSignature,
  extractRazorpayPaidRefs,
  getRazorpayKeyId,
  getRazorpayWebhookSecret,
  razorpayKeysConfigured,
} from "./razorpay.ts";
import { appPublicUrl, isProduction, sandboxSimulatorsEnabled } from "./runtime.ts";

function tenantIdOf(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = tenantIdOf(req);
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function yearToken(prefix: string): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function todayDate(value?: string): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function jsonText(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function rupeeAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function getTenantInvoice(tenantId: string, id: string) {
  return getDb()
    .prepare("SELECT * FROM invoices WHERE (id = ? OR invoice_number = ?) AND tenant_id = ?")
    .get(id, id, tenantId) as Record<string, unknown> | undefined;
}

function uniqueInvoiceNumber(tenantId: string, requested?: string): string {
  const candidate = String(requested || "").trim() || yearToken("INV");
  const taken = getDb()
    .prepare("SELECT id FROM invoices WHERE tenant_id = ? AND invoice_number = ?")
    .get(tenantId, candidate);
  if (!taken) return candidate;
  return yearToken("INV");
}

function billingSnapshot(tenantId: string, _body: Record<string, unknown>) {
  const letterhead = getTenantLetterhead(tenantId);
  const ids = scrubSeedBillingIds(tenantId, {
    gstin: letterhead.gstin,
    upiId: letterhead.upiId,
  });
  return { gstin: ids.gstin, upiId: ids.upiId, clinicName: letterhead.clinicName || letterhead.name };
}

function markInvoicePaid(opts: {
  invoice: Record<string, unknown>;
  paymentMode: string;
  paymentRef: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpayPaymentLinkId?: string;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  const total = Number(opts.invoice.total_amount || 0);
  getDb()
    .prepare(
      `UPDATE invoices SET
        status = 'Paid',
        paid_amount = ?,
        payment_mode = ?,
        payment_ref = ?,
        razorpay_payment_id = CASE WHEN ? != '' THEN ? ELSE razorpay_payment_id END,
        razorpay_order_id = CASE WHEN ? != '' THEN ? ELSE razorpay_order_id END,
        razorpay_payment_link_id = CASE WHEN ? != '' THEN ? ELSE razorpay_payment_link_id END,
        paid_at = COALESCE(paid_at, ?)
       WHERE id = ? AND tenant_id = ?`
    )
    .run(
      total,
      opts.paymentMode,
      opts.paymentRef,
      opts.razorpayPaymentId || "",
      opts.razorpayPaymentId || "",
      opts.razorpayOrderId || "",
      opts.razorpayOrderId || "",
      opts.razorpayPaymentLinkId || "",
      opts.razorpayPaymentLinkId || "",
      now,
      String(opts.invoice.id),
      String(opts.invoice.tenant_id)
    );

  const appointmentId = String(opts.invoice.appointment_id || "").trim();
  if (appointmentId) {
    getDb()
      .prepare("UPDATE appointments SET is_paid = 1 WHERE id = ? AND tenant_id = ?")
      .run(appointmentId, String(opts.invoice.tenant_id));
  }

  writeAudit(
    getDb(),
    null,
    "Razorpay webhook",
    "Invoice paid",
    `${opts.invoice.invoice_number} ${opts.paymentRef}`
  );

  return getDb()
    .prepare("SELECT * FROM invoices WHERE id = ?")
    .get(String(opts.invoice.id)) as Record<string, unknown>;
}

function findInvoiceForRazorpayRefs(refs: {
  invoiceId: string;
  tenantId: string;
  orderId: string;
  paymentLinkId: string;
}): Record<string, unknown> | undefined {
  const db = getDb();
  if (refs.invoiceId) {
    const byId = db
      .prepare("SELECT * FROM invoices WHERE id = ?")
      .get(refs.invoiceId) as Record<string, unknown> | undefined;
    if (byId) {
      if (refs.tenantId && String(byId.tenant_id) !== refs.tenantId) return undefined;
      return byId;
    }
  }
  if (refs.orderId) {
    const byOrder = db
      .prepare("SELECT * FROM invoices WHERE razorpay_order_id = ?")
      .get(refs.orderId) as Record<string, unknown> | undefined;
    if (byOrder) return byOrder;
  }
  if (refs.paymentLinkId) {
    const byLink = db
      .prepare("SELECT * FROM invoices WHERE razorpay_payment_link_id = ?")
      .get(refs.paymentLinkId) as Record<string, unknown> | undefined;
    if (byLink) return byLink;
  }
  return undefined;
}

function recordReceiptEvent(opts: {
  phone: string;
  name: string;
  status: string;
  details: string;
  payload: Record<string, unknown>;
  conversationContent?: string;
}) {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const timeDisplay = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const cleanPhone = opts.phone.trim();
    const convId = `conv-rcpt-${cleanPhone.replace(/\D/g, "").slice(-8) || "pt"}`;
    const userName = opts.name.trim() || "Patient";

    let conv = db
      .prepare("SELECT * FROM whatsapp_conversations WHERE id = ? OR patient_phone = ?")
      .get(convId, cleanPhone) as Record<string, unknown> | undefined;

    if (!conv) {
      db.prepare(
        `INSERT INTO whatsapp_conversations (
          id, patient_phone, patient_name, handover_mode, assigned_staff, tags,
          preferred_language, unread_count, last_message, last_message_time, updated_at
        ) VALUES (?, ?, ?, 'bot', 'Lumera Billing', '["Billing", "Receipt"]', 'en', 0, ?, ?, ?)`
      ).run(convId, cleanPhone, userName, opts.details, timeDisplay, now);
    } else {
      db.prepare(
        `UPDATE whatsapp_conversations
         SET last_message = ?, last_message_time = ?, updated_at = ?
         WHERE id = ?`
      ).run(opts.details, timeDisplay, now, String(conv.id));
    }

    if (opts.conversationContent) {
      const msgId = `msg-rcpt-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO whatsapp_messages (
          id, conversation_id, patient_phone, sender, staff_name, content,
          translated_content, detected_language, time_display, buttons, media, status, created_at
        ) VALUES (?, ?, ?, 'agent', 'Lumera Billing', ?, null, 'en', ?, null, null, ?, ?)`
      ).run(msgId, convId, cleanPhone, opts.conversationContent, timeDisplay, opts.status, now);
    }

    db.prepare(
      `INSERT INTO whatsapp_outbound_events (
        id, event_type, patient_phone, patient_name, status, details, action_payload, sent_at
      ) VALUES (?, 'invoice_receipt', ?, ?, ?, ?, ?, ?)`
    ).run(
      `evt-rcpt-${crypto.randomUUID().slice(0, 8)}`,
      cleanPhone,
      userName,
      opts.status,
      opts.details,
      JSON.stringify(opts.payload),
      now
    );
  } catch (err) {
    console.error("Failed to record invoice receipt WhatsApp event:", err);
  }
}

function receiptBody(invoice: ReturnType<typeof mapInvoice>, sandbox: boolean): string {
  const gstinLine = invoice.gstin ? `\nGSTIN: ${invoice.gstin}` : "";
  const upiLine = invoice.upiId ? `\nUPI: ${invoice.upiId}` : "";
  const sandboxLine = sandbox
    ? "\n\nSANDBOX / DEV-ONLY — recorded locally, not sent via WhatsApp Cloud API."
    : "";
  return `*Payment receipt*\nInvoice *${invoice.invoiceNumber}*\nPatient: ${invoice.patientName}\nAmount paid: ₹${invoice.totalAmount}\nStatus: ${invoice.paymentStatus}${gstinLine}${upiLine}${sandboxLine}`;
}

async function dispatchInvoiceReceipt(
  invoiceRow: Record<string, unknown>
): Promise<{ ok: true; channel: "graph" | "sandbox"; messageId?: string } | { ok: false; error: string; channel: "none" | "graph" }> {
  const invoice = mapInvoice(invoiceRow);
  const creds = resolveGraphCredentials(getDb());
  if (creds) {
    const graph = await sendWhatsAppGraphText({
      credentials: creds,
      to: invoice.patientPhone,
      body: receiptBody(invoice, false),
      previewUrl: Boolean(invoice.payLink),
    });
    if (graph.ok) {
      recordReceiptEvent({
        phone: invoice.patientPhone,
        name: invoice.patientName,
        status: "sent",
        details: `WhatsApp Cloud API receipt accepted for ${invoice.invoiceNumber}`,
        payload: { invoiceId: invoice.id, channel: "graph", messageId: graph.messageId },
        conversationContent: receiptBody(invoice, false),
      });
      getDb()
        .prepare(
          `UPDATE invoices SET receipt_whatsapp_status = ?, receipt_whatsapp_channel = ?, receipt_whatsapp_message_id = ?
           WHERE id = ?`
        )
        .run("sent", "graph", graph.messageId, invoice.id);
      return { ok: true, channel: "graph", messageId: graph.messageId };
    }
    const graphError = "error" in graph ? graph.error : "Graph receipt send failed.";
    recordReceiptEvent({
      phone: invoice.patientPhone,
      name: invoice.patientName,
      status: "failed",
      details: `Graph receipt send failed for ${invoice.invoiceNumber}: ${graphError}`,
      payload: { invoiceId: invoice.id, channel: "graph", error: graphError },
    });
    getDb()
      .prepare(
        `UPDATE invoices SET receipt_whatsapp_status = ?, receipt_whatsapp_channel = ? WHERE id = ?`
      )
      .run("failed", "graph", invoice.id);
    return { ok: false, error: graphError, channel: "graph" };
  }

  if (isProduction()) {
    recordReceiptEvent({
      phone: invoice.patientPhone,
      name: invoice.patientName,
      status: "failed",
      details: `Receipt not delivered for ${invoice.invoiceNumber}: Graph credentials required in production.`,
      payload: { invoiceId: invoice.id, channel: "none", sandbox: false },
    });
    getDb()
      .prepare(
        `UPDATE invoices SET receipt_whatsapp_status = ?, receipt_whatsapp_channel = ? WHERE id = ?`
      )
      .run("failed", "none", invoice.id);
    return {
      ok: false,
      channel: "none",
      error:
        "WhatsApp Cloud API is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID. Receipt was not delivered.",
    };
  }

  const content = receiptBody(invoice, true);
  recordReceiptEvent({
    phone: invoice.patientPhone,
    name: invoice.patientName,
    status: "sandbox_recorded",
    details: `SANDBOX / DEV-ONLY receipt recorded locally for ${invoice.invoiceNumber} (not Graph)`,
    payload: { invoiceId: invoice.id, sandbox: true, channel: "sandbox" },
    conversationContent: content,
  });
  getDb()
    .prepare(
      `UPDATE invoices SET receipt_whatsapp_status = ?, receipt_whatsapp_channel = ? WHERE id = ?`
    )
    .run("sandbox_recorded", "sandbox", invoice.id);
  return { ok: true, channel: "sandbox" };
}

function insertInvoice(tenantId: string, body: Record<string, unknown>, actor?: { name?: string }) {
  const items = Array.isArray(body.items) ? body.items : [];
  const computedSubtotal = items.reduce((sum, item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return sum + rupeeAmount(row.total ?? Number(row.unitPrice || 0) * Number(row.quantity || 1));
  }, 0);
  const subtotal = body.subtotal != null ? rupeeAmount(body.subtotal) : computedSubtotal;
  const discountAmount = rupeeAmount(body.discountAmount ?? body.discount_amount);
  const taxAmount = rupeeAmount(body.taxAmount ?? body.tax_amount);
  const totalAmount =
    body.totalAmount != null || body.total_amount != null
      ? rupeeAmount(body.totalAmount ?? body.total_amount)
      : Math.max(0, subtotal - discountAmount + taxAmount);
  if (totalAmount <= 0) {
    throw Object.assign(new Error("Invoice total must be greater than 0"), { status: 400 });
  }

  const snapshot = billingSnapshot(tenantId, body);
  const patientId = String(body.patientId || body.patient_id || "").trim();
  if (patientId) {
    const patient = getDb()
      .prepare("SELECT id FROM patients WHERE id = ? AND tenant_id = ?")
      .get(patientId, tenantId);
    if (!patient) {
      throw Object.assign(new Error("Patient not found"), { status: 404 });
    }
  }

  const appointmentId = String(body.appointmentId || body.appointment_id || "").trim();
  if (appointmentId) {
    const apt = getDb()
      .prepare("SELECT id FROM appointments WHERE id = ? AND tenant_id = ?")
      .get(appointmentId, tenantId);
    if (!apt) {
      throw Object.assign(new Error("Appointment not found"), { status: 404 });
    }
  }

  const id = shortId("inv");
  const invoiceNumber = uniqueInvoiceNumber(tenantId, String(body.invoiceNumber || body.invoice_number || ""));
  const now = new Date().toISOString();
  const date = todayDate(String(body.date || ""));

  getDb()
    .prepare(
      `INSERT INTO invoices (
        id, tenant_id, invoice_number, appointment_id, patient_id, patient_name, patient_phone,
        patient_uhid, date, items, subtotal, discount_amount, gstin, gst_percent, tax_amount,
        total_amount, paid_amount, status, payment_mode, payment_ref, upi_id, issued_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Unpaid', '', '', ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      invoiceNumber,
      appointmentId,
      patientId,
      String(body.patientName || body.patient_name || ""),
      String(body.patientPhone || body.patient_phone || ""),
      String(body.patientUhid || body.patient_uhid || body.uhid || ""),
      date,
      jsonText(items, "[]"),
      subtotal,
      discountAmount,
      snapshot.gstin,
      Number(body.gstPercent ?? body.gst_percent ?? 0),
      taxAmount,
      totalAmount,
      snapshot.upiId,
      String(body.issuedBy || body.issued_by || actor?.name || ""),
      now
    );

  return getTenantInvoice(tenantId, id)!;
}

export function createBillingRouter(): Router {
  const api = Router();

  api.get("/billing/settings", requireAuth, (req, res) => {
    const tenantId = tenantIdOf(req);
    const letterhead = getTenantLetterhead(tenantId, req.user?.id);
    const ids = scrubSeedBillingIds(tenantId, { gstin: letterhead.gstin, upiId: letterhead.upiId });
    res.json({
      psp: "razorpay",
      razorpayConfigured: razorpayKeysConfigured(),
      sandboxSimulatorsEnabled: sandboxSimulatorsEnabled(),
      gstin: ids.gstin,
      upiId: ids.upiId,
      clinicName: letterhead.clinicName || letterhead.name,
      letterhead,
      notice:
        "Razorpay collect is not a PCI DSS certification and does not imply a certified payment-partner status.",
    });
  });

  api.get("/billing/day-end", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const date = todayDate(String(req.query.date || ""));
    const rows = getDb()
      .prepare("SELECT * FROM invoices WHERE tenant_id = ? AND date = ? ORDER BY created_at ASC")
      .all(tenantId, date) as Record<string, unknown>[];
    let paidCount = 0;
    let paidAmount = 0;
    let dueCount = 0;
    let dueAmount = 0;
    for (const row of rows) {
      const total = Number(row.total_amount || 0);
      if (String(row.status) === "Paid") {
        paidCount += 1;
        paidAmount += total;
      } else if (String(row.status) !== "Cancelled") {
        dueCount += 1;
        dueAmount += total;
      }
    }
    res.json({
      date,
      tenantId,
      paidCount,
      paidAmount,
      dueCount,
      dueAmount,
      invoices: rows.map(mapInvoice),
    });
  });

  api.get("/invoices", requireAuth, (req, res) => {
    try {
      const tenantId = tenantIdOf(req);
      if (!tenantId) return res.json({ invoices: [] });
      const date = String(req.query.date || "").trim();
      const rows = (
        date
          ? getDb()
              .prepare(
                "SELECT * FROM invoices WHERE tenant_id = ? AND date = ? ORDER BY created_at DESC"
              )
              .all(tenantId, date)
          : getDb()
              .prepare("SELECT * FROM invoices WHERE tenant_id = ? ORDER BY created_at DESC")
              .all(tenantId)
      ) as Record<string, unknown>[];
      res.json({ invoices: rows.map(mapInvoice) });
    } catch {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  api.get("/invoices/:id", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantInvoice(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    res.json({ invoice: mapInvoice(row) });
  });

  api.post("/invoices", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const row = insertInvoice(tenantId, req.body || {}, { name: req.user?.name });
      writeAudit(
        getDb(),
        req.user?.id || null,
        req.user?.name || "Clinician",
        "Invoice created",
        mapInvoice(row).invoiceNumber
      );
      res.status(201).json({ invoice: mapInvoice(row) });
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
      const message = err instanceof Error ? err.message : "Failed to create invoice";
      res.status(status || 500).json({ error: message });
    }
  });

  api.post("/invoices/:id/pay-order", requireAuth, async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantInvoice(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    if (String(row.status) === "Paid") {
      return res.json({ invoice: mapInvoice(row), sandbox: false, alreadyPaid: true });
    }

    const mapped = mapInvoice(row);
    const created = await createRazorpayCollectOrder({
      amountRupees: mapped.totalAmount,
      invoiceId: mapped.id,
      invoiceNumber: mapped.invoiceNumber,
      tenantId,
      patientName: mapped.patientName,
      patientPhone: mapped.patientPhone,
      description: `Invoice ${mapped.invoiceNumber}`,
      publicUrl: appPublicUrl(req.get("host") || undefined, req.protocol),
    });
    if (created.ok === false) {
      return res.status(isProduction() ? 503 : 502).json({
        error: created.error,
        sandbox: created.sandbox,
      });
    }

    getDb()
      .prepare(
        `UPDATE invoices SET
          razorpay_order_id = ?, razorpay_payment_link_id = ?, pay_link = ?, payment_mode = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(
        created.orderId,
        created.paymentLinkId,
        created.payLink,
        created.sandbox ? "UPI / QR" : "Razorpay",
        mapped.id,
        tenantId
      );

    const updated = mapInvoice(getTenantInvoice(tenantId, mapped.id)!);
    res.json({
      invoice: updated,
      payLink: created.payLink,
      orderId: created.orderId,
      paymentLinkId: created.paymentLinkId,
      keyId: created.keyId || getRazorpayKeyId(),
      sandbox: created.sandbox,
      upiCapable: true,
      notice: created.sandbox
        ? "SANDBOX / DEV-ONLY pay link. Razorpay keys are unset. Paid status requires POST /api/invoices/:id/sandbox-pay."
        : "Open the Razorpay pay link (UPI / cards / netbanking). Invoice stays Unpaid until a verified webhook.",
    });
  });

  api.post("/invoices/:id/sandbox-pay", requireAuth, (req, res) => {
    if (!sandboxSimulatorsEnabled()) {
      return res.status(403).json({
        error: "SANDBOX / DEV-ONLY Razorpay mock is disabled in production.",
        sandbox: true,
      });
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantInvoice(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    const paid = markInvoicePaid({
      invoice: row,
      paymentMode: "Razorpay",
      paymentRef: `sandbox_${row.id}`,
      razorpayPaymentId: `pay_sandbox_${row.id}`,
    });
    res.json({
      invoice: mapInvoice(paid),
      sandbox: true,
      notice: "SANDBOX / DEV-ONLY mock capture. Not a Razorpay settlement.",
    });
  });

  api.post("/invoices/:id/desk-collect", requireAuth, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantInvoice(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    const mode = String(req.body?.paymentMode || req.body?.payment_mode || "Cash");
    if (mode === "Razorpay" || mode === "UPI" || mode === "UPI / QR") {
      return res.status(400).json({
        error: "UPI / Razorpay invoices cannot be marked paid at the desk. Wait for a verified webhook or use sandbox-pay in non-prod.",
      });
    }
    const paid = markInvoicePaid({
      invoice: row,
      paymentMode: mode,
      paymentRef: String(req.body?.paymentRef || req.body?.payment_ref || `desk_${row.id}`),
    });
    res.json({ invoice: mapInvoice(paid) });
  });

  api.post("/invoices/:id/receipt", requireAuth, async (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const row = getTenantInvoice(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    if (String(row.status) !== "Paid") {
      return res.status(409).json({ error: "Receipt can only be sent for a Paid invoice." });
    }
    const result = await dispatchInvoiceReceipt(row);
    const updated = mapInvoice(getTenantInvoice(tenantId, String(row.id))!);
    if (result.ok === false) {
      return res.status(503).json({
        error: result.error,
        invoice: updated,
        channel: result.channel,
        graphDelivered: false,
        sandbox: false,
        wamid: null,
        messageId: null,
      });
    }
    const graphDelivered = result.channel === "graph";
    const wamid = graphDelivered ? result.messageId || null : null;
    res.json({
      ok: true,
      invoice: updated,
      channel: result.channel,
      sandbox: result.channel === "sandbox",
      graphDelivered,
      wamid,
      messageId: wamid,
      notice:
        result.channel === "sandbox"
          ? "SANDBOX / DEV-ONLY — recorded locally, not sent via Graph; no live wamid."
          : undefined,
    });
  });

  api.post("/billing/razorpay/webhook", (req, res) => {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body || {}));
    const decision = decideRazorpayWebhookSignature({
      rawBody,
      signatureHeader: req.headers["x-razorpay-signature"],
      webhookSecret: getRazorpayWebhookSecret(),
    });
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const refs = extractRazorpayPaidRefs(req.body);
    if (!refs) {
      return res.json({ ok: true, ignored: true });
    }

    const invoice = findInvoiceForRazorpayRefs(refs);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found for Razorpay payload." });
    }

    if (String(invoice.status) === "Paid") {
      return res.json({ ok: true, duplicate: true, invoice: mapInvoice(invoice) });
    }

    const paid = markInvoicePaid({
      invoice,
      paymentMode: "Razorpay",
      paymentRef: refs.paymentId || refs.orderId || refs.paymentLinkId,
      razorpayPaymentId: refs.paymentId,
      razorpayOrderId: refs.orderId,
      razorpayPaymentLinkId: refs.paymentLinkId,
    });
    res.json({ ok: true, invoice: mapInvoice(paid) });
  });

  return api;
}
