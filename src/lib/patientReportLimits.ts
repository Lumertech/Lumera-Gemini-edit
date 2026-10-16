/** One uploaded report: 25 MB and 20 pages. Images count as one page. */

export const PATIENT_REPORT_MAX_BYTES = 25 * 1024 * 1024;
export const PATIENT_REPORT_MAX_PAGES = 20;
export const PATIENT_REPORT_LIMIT_LABEL = "Each report can be up to 25 MB and 20 pages.";

/** Clear-text PDF page objects, then a /Count on a page tree. Compressed object streams return null. */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const pageObjects = text.match(/\/Type\s*\/Page(?!s)/g);
  if (pageObjects?.length) return pageObjects.length;
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,300}?\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((count) => Number.isFinite(count) && count > 0);
  if (counts.length) return Math.max(...counts);
  return null;
}
