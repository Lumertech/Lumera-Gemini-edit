import { formatINR } from "./currency.ts";
import { defaultTooltipProps } from "recharts/es6/component/Tooltip.js";

/** Series whose tooltip values are money. Clinical measures (HbA1c, ROM, VAS) stay numeric. */
const CURRENCY_SERIES =
  /(?:₹|\bINR\b|\brupees?\b|\brevenue\b|\bamounts?\b|\bfees?\b|\bprices?\b|\bMRR\b|\bcosts?\b|\bwallet\b|\bmargin\b|\bbilled\b)/i;

function numericAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Recharts default currency format: ₹ with Indian grouping (₹1,23,456.00).
 * Non-currency series keep the library's plain number display.
 */
export function chartCurrencyFormatter(
  value: unknown,
  name?: unknown,
  item?: { unit?: unknown; dataKey?: unknown; name?: unknown }
): string | number {
  const hint = [name, item?.name, item?.unit, item?.dataKey].map((part) => String(part ?? "")).join(" ");
  if (CURRENCY_SERIES.test(hint)) {
    const amount = numericAmount(value);
    if (amount != null) return formatINR(amount);
  }
  if (Array.isArray(value) && value.length === 2) {
    return value.map((part) => String(part ?? "")).join(" ~ ");
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  return "";
}

defaultTooltipProps.formatter = chartCurrencyFormatter;
