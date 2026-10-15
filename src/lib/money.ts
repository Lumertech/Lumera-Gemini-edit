/** Indian rupees for clinician UI. Grouping follows en-IN (lakh/crore). */
export function formatInr(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const hasFraction = Math.round(Math.abs(value) * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
  return formatted.replace(/[\s\u00a0\u202f]/g, "");
}
