export const RX_FLASH_MATCHERS: RegExp[] = [
  /chief complaints/i,
  /clinical diagnosis/i,
  /icd-10/i,
  /medication schedule/i,
  /joint range of motion/i,
  /manual muscle testing/i,
  /special (orthopedic )?tests/i,
  /home exercise program/i,
];

const FLASH_CLASSES = [
  "ring-2",
  "ring-violet-400",
  "bg-violet-50/80",
  "shadow-[0_0_0_3px_rgba(167,139,250,0.25)]",
  "rounded-lg",
  "transition-all",
];

/**
 * Briefly rings Rx sections the clinician should review after Pulse auto-populate.
 * Uses label text so we do not have to rewrite PrescriptionWriter / physio tabs.
 */
export function flashPopulatedRxFields(timeoutMs = 2800): void {
  if (typeof document === "undefined") return;
  const nodes = Array.from(document.querySelectorAll("label, h3, h4"));
  const boxes: HTMLElement[] = [];
  for (const el of nodes) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!RX_FLASH_MATCHERS.some((re) => re.test(text))) continue;
    const box = (el.closest("div") as HTMLElement | null) || (el.parentElement as HTMLElement | null);
    if (!box || boxes.includes(box)) continue;
    box.classList.add(...FLASH_CLASSES);
    boxes.push(box);
  }
  window.setTimeout(() => {
    boxes.forEach((box) => box.classList.remove(...FLASH_CLASSES));
  }, timeoutMs);
}
