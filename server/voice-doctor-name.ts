/**
 * Doctor names on file often already start with a title. Maya must say that
 * title once. Roster lines, booking read-back, schedule facts, and the text
 * sent to Cloud TTS all go through these helpers.
 *
 * A title is Dr, Dr., Doctor, डॉ, डॉक्टर, with an optional period or danda.
 * "Doctorate" and "Drake" are names, not titles.
 */

const TITLE = String.raw`(?:doctor|dr|डॉक्टर|डॉ)[.।]?(?![A-Za-z\u0900-\u097F])`;

export const MAYA_DOCTOR_TITLE_RULE =
  "A stored doctor name may already include a title such as Dr, Dr., Doctor, डॉ, or डॉक्टर. When you say the name, keep a single title and do not add another one.";

export function stripDoctorTitles(name: string): string {
  let value = String(name || "").replace(/\s+/g, " ").trim();
  const leading = new RegExp(`^${TITLE}\\s+`, "iu");
  for (let i = 0; i < 4 && value; i += 1) {
    const next = value.replace(leading, "").trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

/** One title for speech. English uses "Dr."; Hindi and Marathi use "डॉक्टर". */
export function withSingleDoctorTitle(name: string, language: "en" | "hi" | "mr" = "en"): string {
  const bare = stripDoctorTitles(name);
  if (!bare) return "";
  if (language === "hi" || language === "mr") return `डॉक्टर ${bare}`;
  return `Dr. ${bare}`;
}

/**
 * Final pass on reply and greeting text before TTS.
 * "Doctor Doctor", "Dr. Doctor", "Doctor Dr.", and the Hindi/Marathi pairs
 * collapse to the first title.
 */
export function collapseDoubledDoctorTitles(text: string): string {
  const doubled = new RegExp(`(${TITLE})(?:\\s+${TITLE})+`, "giu");
  return String(text || "").replace(doubled, "$1");
}

export function prepareMayaSpokenText(text: string): string {
  return collapseDoubledDoctorTitles(text).replace(/ {2,}/g, " ").trim();
}
