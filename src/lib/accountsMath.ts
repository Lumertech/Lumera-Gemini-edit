/**
 * Clinic day-book math: collections by mode, GST (CGST + SGST), stock picks.
 * Amounts are rupees. GST is rounded to the nearest rupee per rate, then split
 * into equal CGST and SGST so the two halves add back to the tax.
 */
import { formatINR } from "./currency.ts";

export const COLLECTION_MODES = ["cash", "upi", "card", "razorpay"] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];
export type CountedModes = Record<CollectionMode, number>;
export type ExpectedModes = CountedModes & { other: number };

export type GstLine = { taxable: number; gstPercent: number };

export type GstSlice = {
  rate: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
};

export type GstBreakdown = {
  exempt: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  slices: GstSlice[];
  /** Shown on the bill. Exempt healthcare stays exempt. */
  label: "Exempt" | "CGST + SGST";
};

export type StockLot = { id: string; qty: number; expiry: string };

export type DayCloseBill = {
  status: string;
  amount: number;
  mode: string;
  collectedOn: string;
};

export type DayCloseRefund = { amount: number; mode: string };

export type DayCloseTotals = {
  expected: ExpectedModes;
  counted: CountedModes;
  discrepancy: CountedModes;
  billsTotal: number;
  refundTotal: number;
  /** Collected minus refunds, including insurance and any other mode. */
  netExpected: number;
  /** The four modes reception counts: cash, UPI, card, Razorpay. */
  fourExpected: number;
  countedTotal: number;
  discrepancyTotal: number;
};

const COLLECTED = new Set(["paid", "collected", "partially paid"]);

export function emptyCounted(): CountedModes {
  return { cash: 0, upi: 0, card: 0, razorpay: 0 };
}

export function emptyExpected(): ExpectedModes {
  return { cash: 0, upi: 0, card: 0, razorpay: 0, other: 0 };
}

function rupee(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** Cash, the clinic's own UPI, card, or the clinic's own Razorpay. Anything else is other. */
export function collectionMode(raw: unknown): CollectionMode | "other" {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "cash") return "cash";
  if (value === "card") return "card";
  if (value === "razorpay") return "razorpay";
  if (value === "upi" || value === "upi / qr") return "upi";
  return "other";
}

export function isCollectedStatus(status: unknown): boolean {
  return COLLECTED.has(String(status || "").trim().toLowerCase());
}

/**
 * Intra-state clinic GST. Each rate is summed, then rounded once.
 * 0% stays exempt and is not called a tax.
 */
export function gstBreakdown(lines: readonly GstLine[]): GstBreakdown {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    const rate = Number(line.gstPercent);
    const taxable = rupee(line.taxable);
    if (!Number.isFinite(rate) || rate < 0 || taxable === 0) continue;
    const key = Math.round(rate * 100) / 100;
    byRate.set(key, (byRate.get(key) || 0) + taxable);
  }
  const slices: GstSlice[] = [];
  let exempt = 0;
  for (const rate of [...byRate.keys()].sort((a, b) => a - b)) {
    const taxable = byRate.get(rate) || 0;
    if (rate === 0) {
      exempt += taxable;
      continue;
    }
    const tax = rupee((taxable * rate) / 100);
    const cgst = tax / 2;
    const sgst = tax - cgst;
    slices.push({ rate, taxable, tax, cgst, sgst });
  }
  const taxable = slices.reduce((sum, slice) => sum + slice.taxable, 0);
  const tax = slices.reduce((sum, slice) => sum + slice.tax, 0);
  const cgst = slices.reduce((sum, slice) => sum + slice.cgst, 0);
  const sgst = slices.reduce((sum, slice) => sum + slice.sgst, 0);
  return {
    exempt,
    taxable,
    tax,
    cgst,
    sgst,
    slices,
    label: tax > 0 ? "CGST + SGST" : "Exempt",
  };
}

export function dayCloseTotals(input: {
  bills: readonly DayCloseBill[];
  refunds: readonly DayCloseRefund[];
  counted: CountedModes;
  date: string;
}): DayCloseTotals {
  const expected = emptyExpected();
  let billsTotal = 0;
  for (const bill of input.bills) {
    if (!isCollectedStatus(bill.status)) continue;
    if (String(bill.collectedOn || "") !== input.date) continue;
    const amount = rupee(bill.amount);
    if (amount === 0) continue;
    const mode = collectionMode(bill.mode);
    expected[mode] += amount;
    billsTotal += amount;
  }
  let refundTotal = 0;
  for (const refund of input.refunds) {
    const amount = rupee(refund.amount);
    if (amount === 0) continue;
    const mode = collectionMode(refund.mode);
    expected[mode] -= amount;
    refundTotal += amount;
  }
  const counted = {
    cash: rupee(input.counted.cash),
    upi: rupee(input.counted.upi),
    card: rupee(input.counted.card),
    razorpay: rupee(input.counted.razorpay),
  };
  const discrepancy: CountedModes = {
    cash: counted.cash - expected.cash,
    upi: counted.upi - expected.upi,
    card: counted.card - expected.card,
    razorpay: counted.razorpay - expected.razorpay,
  };
  const fourExpected = expected.cash + expected.upi + expected.card + expected.razorpay;
  const countedTotal = counted.cash + counted.upi + counted.card + counted.razorpay;
  const netExpected = fourExpected + expected.other;
  return {
    expected,
    counted,
    discrepancy,
    billsTotal,
    refundTotal,
    netExpected,
    fourExpected,
    countedTotal,
    discrepancyTotal: countedTotal - fourExpected,
  };
}

export function closingSummary(totals: DayCloseTotals, due: { count: number; amount: number }): string {
  const dueText =
    due.count > 0
      ? `${due.count} bill${due.count === 1 ? "" : "s"} still due (${formatINR(due.amount)})`
      : "No bills due";
  return [
    `Collected ${formatINR(totals.netExpected)}`,
    `Counted ${formatINR(totals.countedTotal)}`,
    `Discrepancy ${formatINR(totals.discrepancyTotal)}`,
    `Refunds ${formatINR(totals.refundTotal)}`,
    dueText,
  ].join(". ") + ".";
}

export const ACCOUNTS_NOTICE =
  "Lumera does not collect patient money. This records what the clinic collected in cash, on the clinic's own UPI, on card, and on the clinic's own Razorpay.";

/**
 * Earliest expiry first. Lots with no expiry go last. Expired lots are skipped.
 * A lot expiring today is still usable.
 */
export function allocateStock(
  lots: readonly StockLot[],
  need: number,
  today: string
): { ok: true; picks: { id: string; qty: number }[] } | { ok: false; shortfall: number } {
  const qtyNeeded = rupee(need);
  if (qtyNeeded <= 0) return { ok: false, shortfall: 0 };
  const usable = lots
    .filter((lot) => rupee(lot.qty) > 0 && lotIsUsable(lot.expiry, today))
    .slice()
    .sort((a, b) => expirySortKey(a.expiry).localeCompare(expirySortKey(b.expiry)) || a.id.localeCompare(b.id));
  let left = qtyNeeded;
  const picks: { id: string; qty: number }[] = [];
  for (const lot of usable) {
    if (left <= 0) break;
    const take = Math.min(rupee(lot.qty), left);
    picks.push({ id: lot.id, qty: take });
    left -= take;
  }
  if (left > 0) return { ok: false, shortfall: left };
  return { ok: true, picks };
}

function lotIsUsable(expiry: string, today: string): boolean {
  const day = String(expiry || "").trim();
  if (!day) return true;
  return day >= today;
}

function expirySortKey(expiry: string): string {
  const day = String(expiry || "").trim();
  return day || "9999-99-99";
}

export type PriceFlag = "no_lock" | "match" | "deviation";

/** Agreed rate is paise. A missing lock is not a deviation. */
export function priceFlag(agreedPaise: number | null, unitCostPaise: number): PriceFlag {
  if (agreedPaise == null) return "no_lock";
  return rupee(agreedPaise) === rupee(unitCostPaise) ? "match" : "deviation";
}

export function rupeesToPaise(rupees: number): number {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function paiseToRupees(paise: number): number {
  return rupee(paise) / 100;
}

export function daysUntil(expiry: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const end = Date.parse(`${expiry}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((end - start) / 86_400_000);
}
