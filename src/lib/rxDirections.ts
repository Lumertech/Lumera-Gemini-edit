/** Standard dosage directions. Drug names are never passed through this map. */

export const RX_LANGUAGES = ["en", "hi", "mr"] as const;
export type RxLanguage = (typeof RX_LANGUAGES)[number];

export function isRxLanguage(value: string): value is RxLanguage {
  return (RX_LANGUAGES as readonly string[]).includes(value);
}

const PHRASES: Record<string, Record<RxLanguage, string>> = {
  "1-0-1": { en: "morning and night", hi: "सुबह और रात", mr: "सकाळी आणि रात्री" },
  "1-0-0": { en: "in the morning", hi: "सुबह", mr: "सकाळी" },
  "0-0-1": { en: "at night", hi: "रात में", mr: "रात्री" },
  "1-1-1": { en: "morning, afternoon and night", hi: "सुबह, दोपहर और रात", mr: "सकाळ, दुपार आणि रात्री" },
  "1-1-0": { en: "morning and afternoon", hi: "सुबह और दोपहर", mr: "सकाळ आणि दुपार" },
  "0-1-0": { en: "in the afternoon", hi: "दोपहर में", mr: "दुपारी" },
  SOS: { en: "only if needed", hi: "ज़रूरत पड़ने पर", mr: "गरज पडल्यास" },
  "Once a week": { en: "once a week", hi: "हफ्ते में एक बार", mr: "आठवड्यातून एकदा" },
  "After Food": { en: "after food", hi: "खाने के बाद", mr: "जेवणानंतर" },
  "Before Food": { en: "before food", hi: "खाने से पहले", mr: "जेवणापूर्वी" },
  "With Food": { en: "with food", hi: "खाने के साथ", mr: "जेवणासोबत" },
  "At Bedtime": { en: "at bedtime", hi: "सोते समय", mr: "झोपताना" },
  "Empty Stomach": { en: "on an empty stomach", hi: "खाली पेट", mr: "रिकाम्या पोटी" },
};

export type DirectionLine = {
  drugName: string;
  directions: string;
};

export function phraseIn(language: RxLanguage, source: string): string {
  const key = String(source || "").trim();
  const row = PHRASES[key];
  if (!row) return key;
  return row[language] || row.en;
}

/** Frequency, timing, and duration in the chosen language. The drug name is copied as written. */
export function directionLine(
  medicine: { drugName?: string; frequency?: string; timing?: string; durationDays?: number; instructions?: string },
  language: RxLanguage
): DirectionLine {
  const drugName = String(medicine.drugName || "").trim();
  const parts = [phraseIn(language, String(medicine.frequency || "")), phraseIn(language, String(medicine.timing || ""))].filter(Boolean);
  const days = Number(medicine.durationDays || 0);
  if (days > 0) {
    const forDays =
      language === "hi" ? `${days} दिन` : language === "mr" ? `${days} दिवस` : `${days} days`;
    parts.push(forDays);
  }
  return { drugName, directions: parts.join(", ") };
}

export function directionLines(
  medicines: Array<{ drugName?: string; frequency?: string; timing?: string; durationDays?: number; instructions?: string }>,
  language: RxLanguage
): DirectionLine[] {
  return medicines.map((medicine) => directionLine(medicine, language));
}
