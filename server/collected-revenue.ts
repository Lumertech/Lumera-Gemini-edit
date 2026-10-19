/**
 * Clinic revenue from collected invoices.
 *
 * Amounts on invoices are rupees (not Razorpay paise). "Today" and the week/month
 * windows use the tenant timezone (IST when unset), taken from paid_at. The
 * invoice issue `date` and a UTC slice of created_at are not the collection day:
 * a payment at 00:30 IST is still that IST date even though the UTC calendar
 * date is the previous day.
 */
import { clinicCalendarDate, shiftIsoDate } from "../src/lib/clinicDay.ts";

const COLLECTED_STATUSES = new Set(["paid", "collected", "partially paid"]);

export interface InvoiceMoneyRow {
  status?: unknown;
  total_amount?: unknown;
  paid_amount?: unknown;
  totalAmount?: unknown;
  paidAmount?: unknown;
  paid_at?: unknown;
  paidAt?: unknown;
  date?: unknown;
  created_at?: unknown;
}

export function isCollectedInvoiceStatus(status: unknown): boolean {
  return COLLECTED_STATUSES.has(String(status || "").trim().toLowerCase());
}

/** Rupees actually collected. paid_amount wins; otherwise the invoice total. */
export function collectedRupees(row: InvoiceMoneyRow): number {
  const paid = Number(row.paid_amount ?? row.paidAmount ?? 0);
  const total = Number(row.total_amount ?? row.totalAmount ?? 0);
  const amount = Number.isFinite(paid) && paid > 0 ? paid : total;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount);
}

function instantFrom(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * IST (or tenant) calendar date the money was collected.
 * paid_at is the source of truth. A bare YYYY-MM-DD issue date is only a
 * fallback when paid_at was never stored. created_at is ignored.
 */
export function collectedClinicDate(row: InvoiceMoneyRow, timezone?: string | null): string {
  const paidAt = instantFrom(row.paid_at ?? row.paidAt);
  if (paidAt) return clinicCalendarDate(paidAt, timezone);
  const issued = String(row.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(issued)) return issued;
  return "";
}

export interface RevenueTotals {
  date: string;
  timezone: string;
  today: number;
  week: number;
  month: number;
  currency: "INR";
}

export function revenueTotals(
  rows: readonly InvoiceMoneyRow[],
  timezone?: string | null,
  now = new Date()
): RevenueTotals {
  const tz = String(timezone || "").trim() || "IST (UTC+5:30)";
  const today = clinicCalendarDate(now, tz);
  const weekStart = shiftIsoDate(today, -6);
  const monthStart = `${today.slice(0, 7)}-01`;
  let todaySum = 0;
  let weekSum = 0;
  let monthSum = 0;
  for (const row of rows) {
    if (!isCollectedInvoiceStatus(row.status)) continue;
    const day = collectedClinicDate(row, tz);
    if (!day) continue;
    const amount = collectedRupees(row);
    if (day >= monthStart && day <= today) monthSum += amount;
    if (day >= weekStart && day <= today) weekSum += amount;
    if (day === today) todaySum += amount;
  }
  return { date: today, timezone: tz, today: todaySum, week: weekSum, month: monthSum, currency: "INR" };
}

export interface DayEndTotals {
  paidCount: number;
  paidAmount: number;
  dueCount: number;
  dueAmount: number;
}

/** Collected on the clinic day, plus invoices issued that day that are still unpaid. */
export function dayEndTotals(
  rows: readonly InvoiceMoneyRow[],
  date: string,
  timezone?: string | null
): DayEndTotals {
  let paidCount = 0;
  let paidAmount = 0;
  let dueCount = 0;
  let dueAmount = 0;
  for (const row of rows) {
    const status = String(row.status || "");
    if (status.trim().toLowerCase() === "cancelled") continue;
    if (isCollectedInvoiceStatus(status)) {
      if (collectedClinicDate(row, timezone) === date) {
        paidCount += 1;
        paidAmount += collectedRupees(row);
      }
      continue;
    }
    if (String(row.date || "") === date) {
      dueCount += 1;
      dueAmount += Math.round(Number(row.total_amount ?? row.totalAmount ?? 0) || 0);
    }
  }
  return { paidCount, paidAmount, dueCount, dueAmount };
}
