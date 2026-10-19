/** Client helpers for Wave 2 clinician billing UX. Consume Platform invoice APIs as-is. */

import { formatINR } from "./currency.ts";
import { formatClinicDayLabel } from "./clinicDay";

export type BillingPaymentMode = "UPI" | "Cash" | "Card" | "Insurance";

export type BillingLetterhead = {
  clinicName?: string;
  gstin?: string;
  upiId?: string;
  address?: string;
  city?: string;
  phone?: string;
  regId?: string;
};

export type BillingSettings = {
  psp: string;
  razorpayConfigured: boolean;
  sandboxSimulatorsEnabled: boolean;
  gstin: string;
  upiId: string;
  clinicName: string;
  sampleTaxInvoice?: boolean;
  letterhead?: BillingLetterhead;
  notice?: string;
};

export type DayEndReport = {
  date: string;
  paidCount: number;
  paidAmount: number;
  dueCount: number;
  dueAmount: number;
  invoices: PersistedInvoice[];
};

export const DRAFT_INVOICE_LABEL = "Draft (not saved)";

const GST_INVOICE_NUMBER = /^INV-\d{4}-[A-Z0-9]+$/i;

const SAVED_LINE_CATEGORIES = new Set(["Consultation", "Pharmacy", "Lab", "Procedure", "Nursing", "Package"]);

export type SavedBillLine = {
  id: string;
  description: string;
  category: "Consultation" | "Pharmacy" | "Lab" | "Procedure" | "Nursing" | "Package";
  hsnSacCode?: string;
  quantity: number;
  unitPrice: number;
  gstPercent: number;
  total: number;
};

export type SavedInvoiceView = {
  items: SavedBillLine[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
};

export type PersistedInvoice = {
  id: string;
  invoiceNumber: string;
  appointmentId?: string;
  patientId?: string;
  patientName?: string;
  patientPhone?: string;
  patientUhid?: string;
  date?: string;
  paymentStatus: string;
  paymentMode?: string;
  payLink?: string;
  gstin?: string;
  upiId?: string;
  sampleTaxInvoice?: boolean;
  subtotal?: number;
  discountAmount?: number;
  totalAmount?: number;
  items?: unknown;
  createdAt?: string;
  receiptWhatsAppChannel?: string;
  receiptWhatsAppStatus?: string;
  receiptWhatsAppMessageId?: string;
  issuedBy?: string;
  consultingDoctorId?: string;
  consultingDoctorName?: string;
};

export type ReceiptDispatchResult = {
  channel?: string;
  sandbox?: boolean;
  graphDelivered?: boolean;
  wamid?: string | null;
  messageId?: string | null;
  notice?: string;
  code?: string;
};

/** Receipt send failed because Meta needs a payment method. Not a Lumera wallet. */
export const META_PAYMENT_REQUIRED = "META_PAYMENT_REQUIRED";

export function receiptFailureMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code || "") : "";
  if (code === META_PAYMENT_REQUIRED) {
    return "WhatsApp could not send this receipt. Meta needs a payment method on the clinic number.";
  }
  return error instanceof Error ? error.message : "WhatsApp receipt failed";
}

export type ReceiptHonesty = {
  graphDelivered: boolean;
  sandbox: boolean;
  wamid: string | null;
  headline: string;
  detail: string;
  tone: "graph" | "sandbox" | "failed";
};

export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Desk collections shows day-end totals. An unsaved bill is not rendered beside them. */
export function deskCollectionsView(
  report: Pick<DayEndReport, "date" | "paidCount" | "paidAmount" | "dueCount" | "dueAmount"> | null | undefined,
  opts?: { hasSavedInvoice?: boolean }
) {
  const date = String(report?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    showInvoicePreview: Boolean(opts?.hasSavedInvoice),
    date,
    dateLabel: formatClinicDayLabel(date),
    paidCount: Number(report?.paidCount) || 0,
    totalCollected: Number(report?.paidAmount) || 0,
    dueCount: Number(report?.dueCount) || 0,
    dueAmount: Number(report?.dueAmount) || 0,
  };
}

export function isInvoicePaid(invoice: { paymentStatus?: string } | null | undefined): boolean {
  return String(invoice?.paymentStatus || "") === "Paid";
}

export function paymentStatusLabel(opts: {
  invoicePaid?: boolean;
  appointmentIsPaid?: boolean;
}): "Paid" | "Unpaid" {
  return opts.invoicePaid || opts.appointmentIsPaid ? "Paid" : "Unpaid";
}

export function deskCollectAllowed(mode: BillingPaymentMode): boolean {
  return mode === "Cash" || mode === "Card" || mode === "Insurance";
}

/** Never locally flip UPI/Razorpay to Paid — only webhook / sandbox-pay on the server. */
export function canMarkPaidLocally(mode: BillingPaymentMode): boolean {
  return deskCollectAllowed(mode);
}

export function shouldShowSandboxPay(opts: {
  isPaid: boolean;
  sandboxSimulatorsEnabled: boolean;
  hasInvoiceId: boolean;
}): boolean {
  return !opts.isPaid && opts.sandboxSimulatorsEnabled && opts.hasInvoiceId;
}

export function paymentModeFromInvoice(mode?: string): BillingPaymentMode {
  const raw = String(mode || "").trim();
  if (raw === "Cash" || raw === "Card" || raw === "Insurance") return raw;
  return "UPI";
}

function invoiceRecency(invoice: PersistedInvoice): number {
  const stamp = Date.parse(String(invoice.createdAt || ""));
  return Number.isFinite(stamp) ? stamp : 0;
}

/**
 * Match a bill to one appointment. Patient id is ignored so an older paid
 * invoice for the same person cannot attach to today's visit.
 * When several invoices share that appointment, the newest createdAt wins.
 * Callers that omit createdAt keep the first match (list is newest-first).
 */
export function pickInvoiceForContext(
  invoices: PersistedInvoice[],
  opts: { appointmentId?: string; patientId?: string }
): PersistedInvoice | null {
  const appointmentId = String(opts.appointmentId || "").trim();
  if (!appointmentId) return null;
  const matches = (Array.isArray(invoices) ? invoices : []).filter(
    (inv) => String(inv.appointmentId || "") === appointmentId
  );
  if (!matches.length) return null;
  return [...matches].sort((a, b) => invoiceRecency(b) - invoiceRecency(a))[0];
}

export function displayInvoiceNumber(invoiceNumber?: string | null): string {
  const raw = String(invoiceNumber || "").trim();
  if (!raw || raw === DRAFT_INVOICE_LABEL) return DRAFT_INVOICE_LABEL;
  return raw;
}

/** Empty string means the server must allocate the GST number. Never persist a draft placeholder. */
export function invoiceNumberToPersist(displayed?: string | null): string {
  const raw = String(displayed || "").trim();
  if (!raw || raw === DRAFT_INVOICE_LABEL) return "";
  return GST_INVOICE_NUMBER.test(raw) ? raw : "";
}

export function shouldRecomputeDraftLines(invoice: { id?: string } | null | undefined): boolean {
  return !String(invoice?.id || "").trim();
}

function readSavedItems(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function finiteAmount(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSavedLine(raw: unknown, index: number): SavedBillLine {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const quantity = finiteAmount(row.quantity ?? 1, 1) || 1;
  const unitPrice = finiteAmount(row.unitPrice ?? row.unit_price, 0);
  const total = row.total != null || row.line_total != null
    ? finiteAmount(row.total ?? row.line_total, unitPrice * quantity)
    : unitPrice * quantity;
  const categoryRaw = String(row.category || "Procedure");
  const category = SAVED_LINE_CATEGORIES.has(categoryRaw)
    ? (categoryRaw as SavedBillLine["category"])
    : "Procedure";
  const hsn = String(row.hsnSacCode || row.hsn_sac_code || "").trim();
  return {
    id: String(row.id || `saved-line-${index + 1}`),
    description: String(row.description || "Saved line"),
    category,
    ...(hsn ? { hsnSacCode: hsn } : {}),
    quantity,
    unitPrice,
    gstPercent: finiteAmount(row.gstPercent ?? row.gst_percent, 0),
    total,
  };
}

/**
 * Render a saved invoice as stored. Line totals and the invoice total are not
 * rebuilt from the doctor's consult fee or estimated prescription prices.
 */
export function savedInvoiceView(invoice: {
  items?: unknown;
  subtotal?: number;
  discountAmount?: number;
  totalAmount?: number;
}): SavedInvoiceView {
  const items = readSavedItems(invoice.items).map(normalizeSavedLine);
  const lineSum = items.reduce((sum, item) => sum + finiteAmount(item.total, 0), 0);
  const subtotal = finiteAmount(invoice.subtotal, lineSum);
  const discountAmount = finiteAmount(invoice.discountAmount, 0);
  const hasAuthoritativeTotal = invoice.totalAmount != null && Number.isFinite(Number(invoice.totalAmount));
  const totalAmount = hasAuthoritativeTotal
    ? Number(invoice.totalAmount)
    : Math.max(0, subtotal - discountAmount);
  return { items, subtotal, discountAmount, totalAmount };
}

export function displayBillingIds(
  settings: BillingSettings | null,
  fallback?: { gstin?: string; upiId?: string; name?: string }
): { gstin: string; upiId: string; clinicName: string; gstinLabel: string; upiLabel: string } {
  const gstin = settings ? String(settings.gstin || "") : String(fallback?.gstin || "");
  const upiId = settings ? String(settings.upiId || "") : String(fallback?.upiId || "");
  const clinicName = settings?.clinicName?.trim() || fallback?.name || "";
  return {
    gstin,
    upiId,
    clinicName,
    gstinLabel: gstin.trim() || "Not set",
    upiLabel: upiId.trim() || "Not set",
  };
}

/**
 * Honest receipt copy from POST /api/invoices/:id/receipt.
 * Never treat sandbox / missing Graph as patient WhatsApp delivery.
 */
export function receiptHonestyFromResponse(res: ReceiptDispatchResult): ReceiptHonesty {
  const sandbox = Boolean(res.sandbox) || res.channel === "sandbox";
  const rawWamid = String(res.wamid || res.messageId || "").trim() || null;
  if (res.graphDelivered === true) {
    return {
      graphDelivered: true,
      sandbox: false,
      wamid: rawWamid,
      headline: "Delivered via WhatsApp Cloud API (Graph)",
      detail: rawWamid
        ? `Graph accepted. wamid ${rawWamid}`
        : "Graph accepted this send (no wamid in the response).",
      tone: "graph",
    };
  }
  if (sandbox) {
    return {
      graphDelivered: false,
      sandbox: true,
      wamid: null,
      headline: "SANDBOX / DEV-ONLY — not sent via Graph",
      detail: "Recorded locally. No live wamid. Do not treat this as patient WhatsApp delivery.",
      tone: "sandbox",
    };
  }
  return {
    graphDelivered: false,
    sandbox: false,
    wamid: null,
    headline: "WhatsApp receipt was not delivered via Graph",
    detail: res.notice || "No Graph wamid. Check Meta credentials before claiming delivery.",
    tone: "failed",
  };
}

export function formatRupees(amount: number): string {
  return formatINR(amount);
}
