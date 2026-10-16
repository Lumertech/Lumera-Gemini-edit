/**
 * Health-document storage notice v1.
 * English body is the Compliance paste from #116, with the clinic name substituted.
 * Hindi is the Compliance paragraph. A native Hindi speaker must check it before production.
 * Other Eighth Schedule languages can be added beside these two without a new purpose.
 */

export const HEALTH_DOCUMENT_PURPOSE = "health_document_storage";
export const HEALTH_DOCUMENT_NOTICE_VERSION = "v1";

/** Compliance floor. Founder confirms the default before real tenants. No purge job ships here. */
export const HEALTH_DOCUMENT_RETENTION_YEARS_PLACEHOLDER = 3;

export const HEALTH_DOCUMENT_CONSENT_METHODS = [
  "staff_attested_verbal",
  "signed_paper",
  "in_app",
  "whatsapp",
] as const;

export type HealthDocumentConsentMethod = (typeof HEALTH_DOCUMENT_CONSENT_METHODS)[number];
export type HealthDocumentNoticeLanguage = "en" | "hi";

export const HEALTH_DOCUMENT_NOTICE_EN_TITLE = "Storing your medical reports";
export const HEALTH_DOCUMENT_NOTICE_HI_TITLE = "आपकी मेडिकल रिपोर्ट रखने के बारे में";

const PRIVACY_URL = "https://www.mylumera.in/privacy-policy";
const PRIVACY_EMAIL = "ravee@lumer.me";

/** Shown to staff when the tenant has no clinic name. Consent capture stays blocked. */
export const CLINIC_NAME_REQUIRED_MESSAGE =
  "Set the clinic name in clinic settings before recording consent. The notice must name this clinic.";

/** Hindi-only stand-in. Never use an English placeholder such as "This clinic". */
const HINDI_CLINIC_NAME_FALLBACK = "यह क्लिनिक";

/** Trimmed tenant clinic name. Blank stays blank so consent capture can be refused. */
export function clinicNameForNotice(raw: string | null | undefined): string {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function healthDocumentNoticeTitle(language: HealthDocumentNoticeLanguage): string {
  return language === "hi" ? HEALTH_DOCUMENT_NOTICE_HI_TITLE : HEALTH_DOCUMENT_NOTICE_EN_TITLE;
}

export function healthDocumentNoticeBody(language: HealthDocumentNoticeLanguage, clinicName: string): string {
  const trimmed = clinicNameForNotice(clinicName);
  const clinic = trimmed || (language === "hi" ? HINDI_CLINIC_NAME_FALLBACK : "");
  if (!clinic) throw new Error(CLINIC_NAME_REQUIRED_MESSAGE);
  if (language === "hi") {
    // A native Hindi speaker must check this text before production.
    return `${clinic} आपकी दी हुई मेडिकल रिपोर्ट (फ़ोटो या PDF) आपके मरीज़ रिकॉर्ड में रखेगा, ताकि आपके डॉक्टर और क्लिनिक का स्टाफ़ आपके इलाज के लिए उनका इस्तेमाल कर सकें। ये रिपोर्ट Lumera में सुरक्षित रूप से सेव की जाती हैं। Lumera वह सॉफ़्टवेयर है जिसे यह क्लिनिक इस्तेमाल करता है। इन्हें सिर्फ़ इस क्लिनिक के वही कर्मचारी देख सकते हैं जिन्हें इसकी अनुमति है। मेडिकल रिकॉर्ड के नियमों के अनुसार जितने समय तक ज़रूरी हो, हम इन्हें रखते हैं, उसके बाद इन्हें मिटा देते हैं। आप कभी भी क्लिनिक को बताकर अपनी सहमति वापस ले सकते हैं; इसके बाद आपकी कोई नई रिपोर्ट सेव नहीं की जाएगी। किसी सवाल या शिकायत के लिए क्लिनिक से संपर्क करें। Lumera आपका डेटा कैसे संभालता है, यह जानने के लिए ${PRIVACY_URL} देखें या ${PRIVACY_EMAIL} पर लिखें।`;
  }
  return `${clinic} will store the medical reports you share (photos or PDFs) in your patient record so your doctor and clinic staff can use them for your care. They are stored securely by Lumera, the software the clinic uses, and are visible only to authorised staff at this clinic. We keep them as long as medical record rules require, then delete them. You can withdraw consent at any time by telling the clinic; new reports will then not be stored. For questions or complaints, contact the clinic. For how Lumera handles data, see ${PRIVACY_URL} or write to ${PRIVACY_EMAIL}.`;
}

export function healthDocumentNotices(clinicName: string): Record<
  HealthDocumentNoticeLanguage,
  { title: string; body: string }
> {
  const clinic = clinicNameForNotice(clinicName);
  if (!clinic) {
    return {
      en: { title: healthDocumentNoticeTitle("en"), body: "" },
      hi: { title: healthDocumentNoticeTitle("hi"), body: "" },
    };
  }
  return {
    en: {
      title: healthDocumentNoticeTitle("en"),
      body: healthDocumentNoticeBody("en", clinic),
    },
    hi: {
      title: healthDocumentNoticeTitle("hi"),
      body: healthDocumentNoticeBody("hi", clinic),
    },
  };
}

export function isHealthDocumentConsentMethod(value: string): value is HealthDocumentConsentMethod {
  return (HEALTH_DOCUMENT_CONSENT_METHODS as readonly string[]).includes(value);
}

/** Completed years from an ISO date. Invalid dates return null. */
export function ageInYears(dateOfBirth: string, now = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateOfBirth || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  const monthDelta = now.getUTCMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < day)) age -= 1;
  return age;
}

/**
 * A patient is a minor when date of birth says under 18.
 * When date of birth is missing, a recorded age under 18 is treated the same way
 * so a guardian is still required.
 */
export function patientIsMinor(input: { dateOfBirth?: string | null; age?: number | null }, now = new Date()): boolean {
  const fromDob = ageInYears(String(input.dateOfBirth || ""), now);
  if (fromDob != null) return fromDob < 18;
  const age = Number(input.age);
  return Number.isFinite(age) && age > 0 && age < 18;
}

export function consentMethodLabel(method: string): string {
  switch (method) {
    case "staff_attested_verbal":
      return "Staff attested, patient agreed verbally";
    case "signed_paper":
      return "Signed paper";
    case "in_app":
      return "Agreed in the app";
    case "whatsapp":
      return "Agreed on WhatsApp";
    default:
      return method;
  }
}
