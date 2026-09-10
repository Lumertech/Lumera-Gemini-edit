/** Client helpers for Wave 2 clinician billing UX. Consume Platform invoice APIs as-is. */

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

export type PersistedInvoice = {
  id: string;
  invoiceNumber: string;
  appointmentId?: string;
  patientId?: string;
  paymentStatus: string;
  paymentMode?: string;
  payLink?: string;
  gstin?: string;
  upiId?: string;
  totalAmount?: number;
  items?: unknown[];
  receiptWhatsAppChannel?: string;
  receiptWhatsAppStatus?: string;
  receiptWhatsAppMessageId?: string;
};

export type ReceiptDispatchResult = {
  channel?: string;
  sandbox?: boolean;
  graphDelivered?: boolean;
  wamid?: string | null;
  messageId?: string | null;
  notice?: string;
};

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

export function pickInvoiceForContext(
  invoices: PersistedInvoice[],
  opts: { appointmentId?: string; patientId?: string }
): PersistedInvoice | null {
  const list = Array.isArray(invoices) ? invoices : [];
  if (opts.appointmentId) {
    const forAppt = list.filter((inv) => inv.appointmentId === opts.appointmentId);
    if (forAppt.length) return forAppt[0];
  }
  if (opts.patientId) {
    const forPatient = list.filter((inv) => inv.patientId === opts.patientId);
    if (forPatient.length) return forPatient[0];
  }
  return null;
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
  const n = Number.isFinite(amount) ? amount : 0;
  return `₹${n.toLocaleString("en-IN")}`;
}
