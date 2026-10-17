import type { WhatsAppTemplate } from "../types.ts";

/**
 * Positional WhatsApp templates submitted to Meta.
 * sendWhatsAppGraphTemplate sends bodyParameters in this index order.
 * A URL button is a fixed base plus one trailing {{1}}, filled on the server
 * with serverUrlButtonSuffix — never a client portal URL.
 */
export const META_TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

/** App categories Meta does not accept. Those three submit as UTILITY. */
export const APP_CATEGORY_TO_META = {
  APPOINTMENT_REMINDER: "UTILITY",
  PRESCRIPTION_DELIVERY: "UTILITY",
  FOLLOWUP_CHECK: "UTILITY",
} as const;

export const RX_TEMPLATE_URL = "https://www.mylumera.in/rx/{{1}}";
export const INVOICE_TEMPLATE_URL = "https://www.mylumera.in/pay/{{1}}";
/** Meta marketing opt-out quick reply. There is no inbound STOP handler. */
export const MARKETING_OPT_OUT_BUTTON_TEXT = "Stop promotions";
export const AUTH_PRESET_BODY = "{{1}} is your verification code.";

const URL_BUTTON = /^https:\/\/[^\s{}]+\/\{\{1\}\}$/;
const URL_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

export type MetaButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example: string[] }
  | { type: "OTP"; otp_type: "COPY_CODE"; text: string };

export type MetaComponent =
  | { type: "HEADER"; format: "TEXT"; text: string }
  | { type: "HEADER"; format: "DOCUMENT" | "IMAGE" }
  | { type: "BODY"; text: string; example?: { body_text: string[][] } }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: MetaButton[] };

export type TemplateSurface = "seed" | "ui" | "form";

export type WhatsAppTemplateSpec = {
  name: string;
  category: MetaTemplateCategory;
  surface: TemplateSurface;
  bodyIndex: Record<string, number>;
  components: MetaComponent[];
  ui?: {
    id: string;
    language: string;
    status: "APPROVED" | "PENDING";
    payloads?: Record<string, string>;
  };
};

export type TemplateDraft = {
  name: string;
  category: MetaTemplateCategory;
  headerText?: string;
  bodyText: string;
  footerText?: string;
  button1Text?: string;
  button2Text?: string;
  bodyExample?: string[];
};

const SIGNED_RX_BODY =
  "{{1}} at {{2}} has reviewed and signed your prescription (Rx {{3}}). It is attached above.";

function body(text: string, example: string[]): MetaComponent {
  return { type: "BODY", text, example: { body_text: [example] } };
}

function quick(text: string): MetaButton {
  return { type: "QUICK_REPLY", text };
}

function urlButton(text: string, url: string, sample: string): MetaButton {
  return { type: "URL", text, url, example: [sample] };
}

const SEEDED_SPECS: WhatsAppTemplateSpec[] = [
  {
    name: "appointment_reminder_v1",
    category: "UTILITY",
    surface: "seed",
    bodyIndex: {
      patient_name: 1,
      doctor_name: 2,
      clinic_name: 3,
      date: 4,
      time: 5,
      token: 6,
    },
    components: [
      { type: "HEADER", format: "TEXT", text: "Appointment confirmation" },
      body(
        "Hello {{1}}, your consultation with {{2}} at {{3}} is confirmed for {{4}} at {{5}}. Your OPD token is {{6}}. Please arrive 10 minutes prior to your slot.",
        ["Rajiv Saxena", "Dr Vikram Malhotra", "Sunrise Family Clinic", "Tomorrow", "09:30 AM", "04"]
      ),
      {
        type: "BUTTONS",
        buttons: [quick("Confirm Arrival"), quick("Reschedule Slot")],
      },
    ],
  },
  {
    name: "post_consultation_rx",
    category: "UTILITY",
    surface: "seed",
    bodyIndex: { doctor_name: 1, clinic_name: 2, rx_number: 3 },
    components: [
      { type: "HEADER", format: "DOCUMENT" },
      body(SIGNED_RX_BODY, ["Dr Meera Shah", "Sunrise Family Clinic", "RX-2026-0101"]),
      { type: "FOOTER", text: "Digital prescription" },
      {
        type: "BUTTONS",
        buttons: [urlButton("Open Patient Portal", RX_TEMPLATE_URL, "https://www.mylumera.in/rx/RX-2026-0101")],
      },
    ],
  },
  {
    name: "lab_report_ready",
    category: "UTILITY",
    surface: "seed",
    bodyIndex: { patient_name: 1, test_name: 2, date: 3, clinic_name: 4 },
    components: [
      { type: "HEADER", format: "TEXT", text: "Diagnostic Pathology Report" },
      body(
        "Namaste {{1}}, your test results for {{2}} conducted on {{3}} at {{4}} have been signed off by the pathologist and are now ready for download.",
        ["Rajiv Saxena", "Renal and Vitamin Profile", "28 Aug 2026", "Sunrise Family Clinic"]
      ),
      {
        type: "BUTTONS",
        buttons: [quick("Download PDF"), quick("Book Follow-up")],
      },
    ],
  },
  {
    name: "opd_queue_token_alert",
    category: "UTILITY",
    surface: "seed",
    bodyIndex: { token: 1, patient_name: 2, doctor_name: 3, clinic_name: 4, room: 5 },
    components: [
      { type: "HEADER", format: "TEXT", text: "Live Queue Update" },
      body(
        "Patient alert: token {{1}} ({{2}}). You are next in line for {{3}} at {{4}}. Please proceed to {{5}}.",
        ["02", "Priyanka Mukherjee", "Dr Siddharth Varma", "Sunrise Family Clinic", "Rehab Suite 105"]
      ),
    ],
  },
  {
    name: "otp_login_verification",
    category: "AUTHENTICATION",
    surface: "seed",
    bodyIndex: { otp: 1 },
    components: [
      body(AUTH_PRESET_BODY, ["492810"]),
      {
        type: "BUTTONS",
        buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }],
      },
    ],
  },
  {
    name: "preventive_cardiac_camp",
    category: "MARKETING",
    surface: "seed",
    bodyIndex: { patient_name: 1, clinic_name: 2, date: 3, doctor_name: 4 },
    components: [
      { type: "HEADER", format: "IMAGE" },
      body(
        "Dear {{1}}, {{2}} is organizing a cardiac wellness camp on Saturday, {{3}} with {{4}}. Includes ECG, lipid profile, and a cardiologist consultation.",
        ["Rajiv", "Sunrise Family Clinic", "15 September 2026", "Dr Meera Shah"]
      ),
      {
        type: "BUTTONS",
        buttons: [quick("Book Camp Slot"), quick("View Details"), quick(MARKETING_OPT_OUT_BUTTON_TEXT)],
      },
    ],
  },
];

const UI_SPECS: WhatsAppTemplateSpec[] = [
  {
    name: "appointment_confirmation_v2",
    category: APP_CATEGORY_TO_META.APPOINTMENT_REMINDER,
    surface: "ui",
    bodyIndex: {
      patient_name: 1,
      doctor_name: 2,
      specialty: 3,
      clinic_name: 4,
      date: 5,
      time: 6,
      token: 7,
      room: 8,
    },
    ui: {
      id: "tmpl-1",
      language: "English (en_IN)",
      status: "APPROVED",
      payloads: { "Confirm Arrival": "CONFIRM_ARRIVAL", "Reschedule Slot": "RESCHEDULE" },
    },
    components: [
      { type: "HEADER", format: "TEXT", text: "Appointment confirmed" },
      body(
        "Hello {{1}}, your appointment with {{2}} ({{3}}) at {{4}} has been confirmed for {{5}} at {{6}}. Token No: {{7}}. Room: {{8}}. Please arrive 10 minutes prior for vitals check.",
        ["Asha Rao", "Dr Meera Shah", "General Medicine", "Sunrise Family Clinic", "12 October 2026", "09:30 AM", "14", "Room 3"]
      ),
      { type: "FOOTER", text: "Reply CANCEL to cancel or RESCHEDULE to change time" },
      {
        type: "BUTTONS",
        buttons: [quick("Confirm Arrival"), quick("Reschedule Slot")],
      },
    ],
  },
  {
    name: "digital_prescription_ready",
    category: APP_CATEGORY_TO_META.PRESCRIPTION_DELIVERY,
    surface: "ui",
    bodyIndex: { doctor_name: 1, clinic_name: 2, rx_number: 3 },
    ui: {
      id: "tmpl-2",
      language: "English (en_IN)",
      status: "APPROVED",
      payloads: { "Order Medicines": "ORDER_MEDS" },
    },
    components: [
      { type: "HEADER", format: "TEXT", text: "Prescription ready" },
      body(SIGNED_RX_BODY, ["Dr Meera Shah", "Sunrise Family Clinic", "RX-2026-0101"]),
      { type: "FOOTER", text: "Digital prescription" },
      {
        type: "BUTTONS",
        buttons: [
          urlButton("View Digital Rx PDF", RX_TEMPLATE_URL, "https://www.mylumera.in/rx/RX-2026-0101"),
          quick("Order Medicines"),
        ],
      },
    ],
  },
  {
    name: "invoice_payment_link",
    category: "UTILITY",
    surface: "ui",
    bodyIndex: { patient_name: 1, invoice_number: 2, clinic_name: 3, description: 4, amount: 5 },
    ui: { id: "tmpl-3", language: "English (en_IN)", status: "APPROVED" },
    components: [
      { type: "HEADER", format: "TEXT", text: "Bill and payment request" },
      body(
        "Dear {{1}}, invoice {{2}} from {{3}} for {{4}} has been generated for ₹{{5}}.",
        ["Asha Rao", "INV-1042", "Sunrise Family Clinic", "Consultation", "1,250"]
      ),
      { type: "FOOTER", text: "Instant GST receipt provided on payment" },
      {
        type: "BUTTONS",
        buttons: [urlButton("Pay invoice", INVOICE_TEMPLATE_URL, "https://www.mylumera.in/pay/INV-1042")],
      },
    ],
  },
  {
    name: "medication_adherence_checkin",
    category: APP_CATEGORY_TO_META.FOLLOWUP_CHECK,
    surface: "ui",
    bodyIndex: { patient_name: 1, doctor_name: 2, clinic_name: 3, rx_number: 4 },
    ui: {
      id: "tmpl-4",
      language: "English (en_IN)",
      status: "APPROVED",
      payloads: { "All Taken": "MEDS_TAKEN", "Experiencing Side Effect": "SIDE_EFFECT" },
    },
    components: [
      { type: "HEADER", format: "TEXT", text: "Daily medication check-in" },
      body(
        "Hi {{1}}. A reminder from {{2}} at {{3}} about your prescription (Rx {{4}}). Please confirm whether you took today's doses.",
        ["Asha Rao", "Dr Meera Shah", "Sunrise Family Clinic", "RX-2026-0101"]
      ),
      {
        type: "BUTTONS",
        buttons: [quick("All Taken"), quick("Experiencing Side Effect")],
      },
    ],
  },
];

export const TREATMENT_FOLLOWUP_FORM_DEFAULT: TemplateDraft & { language: string } = {
  name: "treatment_followup_reminder",
  category: "UTILITY",
  language: "en",
  headerText: "Clinical follow-up reminder",
  bodyText: "Hello {{1}}, {{2}} at {{3}} has scheduled your review for {{4}}.",
  footerText: "Clinical follow-up",
  button1Text: "Confirm attendance",
  button2Text: "Request reschedule",
  bodyExample: ["Asha Rao", "Dr Meera Shah", "Sunrise Family Clinic", "Tuesday at 10:00 AM"],
};

export function matchingBodyExample(text: string, preferred: readonly string[]): string[] {
  const nums = [...String(text || "").matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const count = nums.length === 0 ? 0 : Math.max(...nums);
  const out = preferred.map((value) => String(value)).slice(0, count);
  while (out.length < count) out.push(`Sample ${out.length + 1}`);
  return out;
}

export function draftTemplateSpec(
  draft: TemplateDraft,
  bodyIndex?: Record<string, number>
): WhatsAppTemplateSpec {
  const components: MetaComponent[] = [];
  const header = String(draft.headerText || "").trim();
  if (header) components.push({ type: "HEADER", format: "TEXT", text: header });
  const example = matchingBodyExample(draft.bodyText, draft.bodyExample || []);
  components.push({
    type: "BODY",
    text: draft.bodyText,
    ...(example.length > 0 ? { example: { body_text: [example] } } : {}),
  });
  const footer = String(draft.footerText || "").trim();
  if (footer) components.push({ type: "FOOTER", text: footer });
  const buttons: MetaButton[] = [];
  if (draft.button1Text?.trim()) buttons.push(quick(draft.button1Text.trim()));
  if (draft.button2Text?.trim()) buttons.push(quick(draft.button2Text.trim()));
  if (buttons.length > 0) components.push({ type: "BUTTONS", buttons });
  const count = example.length;
  const index =
    bodyIndex ??
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`v${i + 1}`, i + 1]));
  return {
    name: draft.name,
    category: draft.category,
    surface: "form",
    bodyIndex: index,
    components,
  };
}

const FOLLOWUP_SPEC = draftTemplateSpec(TREATMENT_FOLLOWUP_FORM_DEFAULT, {
  patient_name: 1,
  doctor_name: 2,
  clinic_name: 3,
  review_at: 4,
});

export const ALL_WHATSAPP_TEMPLATE_SPECS: readonly WhatsAppTemplateSpec[] = [
  ...SEEDED_SPECS,
  ...UI_SPECS,
  FOLLOWUP_SPEC,
];

export const SEEDED_TEMPLATE_NAMES = SEEDED_SPECS.map((spec) => spec.name);

export const WHATSAPP_TEMPLATE_BODY_INDEX: Record<string, Record<string, number>> = Object.fromEntries(
  ALL_WHATSAPP_TEMPLATE_SPECS.map((spec) => [spec.name, spec.bodyIndex])
);

export function templateByName(name: string): WhatsAppTemplateSpec | undefined {
  return ALL_WHATSAPP_TEMPLATE_SPECS.find((spec) => spec.name === name);
}

/** Ordered body parameters for sendWhatsAppGraphTemplate. Keys follow bodyIndex, not object order. */
export function bodyParametersFor(name: string, values: Record<string, string>): string[] {
  const spec = templateByName(name);
  if (!spec) throw new Error("TEMPLATE_UNKNOWN");
  const count = Math.max(0, ...Object.values(spec.bodyIndex));
  const params = Array.from({ length: count }, () => "");
  for (const [key, index] of Object.entries(spec.bodyIndex)) {
    const value = String(values[key] ?? "").trim();
    if (!value) throw new Error("TEMPLATE_PARAMETER_MISSING");
    params[index - 1] = value;
  }
  if (params.some((value) => !value)) throw new Error("TEMPLATE_PARAMETER_MISSING");
  return params;
}

/** Path segment for a template URL button. Rejects a full URL or a client placeholder. */
export function serverUrlButtonSuffix(serverId: string): string {
  const id = String(serverId ?? "").trim();
  if (!URL_SUFFIX.test(id)) throw new Error("URL_BUTTON_SUFFIX_INVALID");
  return id;
}

function placeholders(text: string): string[] {
  return [...String(text || "").matchAll(PLACEHOLDER)].map((match) => match[1].trim());
}

function positionalError(text: string): { count: number; error?: "mixed_placeholder" | "numbering_gap" } {
  const tokens = placeholders(text);
  if (tokens.length === 0) return { count: 0 };
  if (tokens.some((token) => !/^\d+$/.test(token))) return { count: tokens.length, error: "mixed_placeholder" };
  const nums = tokens.map(Number);
  const max = Math.max(...nums);
  const present = new Set(nums);
  for (let i = 1; i <= max; i++) {
    if (!present.has(i)) return { count: max, error: "numbering_gap" };
  }
  return { count: max };
}

function buttonsOf(components: readonly MetaComponent[]): MetaButton[] {
  const block = components.find((component) => component.type === "BUTTONS");
  return block && block.type === "BUTTONS" ? block.buttons : [];
}

function visibleText(components: readonly MetaComponent[]): string {
  const parts: string[] = [];
  for (const component of components) {
    if (component.type === "HEADER" && component.format === "TEXT") parts.push(component.text);
    if (component.type === "BODY") parts.push(component.text);
    if (component.type === "FOOTER") parts.push(component.text);
    if (component.type === "BUTTONS") {
      for (const button of component.buttons) {
        parts.push(button.text);
        if (button.type === "URL") {
          parts.push(button.url);
          parts.push(...button.example);
        }
      }
    }
  }
  return parts.join("\n").replace(/mylumera\.in/gi, "");
}

export function componentContractErrors(
  components: readonly MetaComponent[],
  category: string
): string[] {
  const errors: string[] = [];
  if (!META_TEMPLATE_CATEGORIES.includes(category as MetaTemplateCategory)) errors.push("category");
  for (const component of components) {
    if (component.type === "HEADER" && component.format === "TEXT") {
      const header = positionalError(component.text);
      if (header.error) errors.push(header.error);
      if (header.count > 1) errors.push("header_variables");
    }
    if (component.type === "BODY") {
      const bodyCheck = positionalError(component.text);
      if (bodyCheck.error) errors.push(bodyCheck.error);
      const rows = component.example?.body_text;
      if (bodyCheck.count > 0) {
        if (!rows || rows.length === 0 || rows.some((row) => row.length !== bodyCheck.count)) {
          errors.push("example_count");
        }
      } else if (rows?.some((row) => row.length > 0)) {
        errors.push("example_count");
      }
    }
    if (component.type === "FOOTER" && placeholders(component.text).length > 0) errors.push("footer_variable");
  }
  for (const button of buttonsOf(components)) {
    if (placeholders(button.text).length > 0) errors.push("button_label_variable");
    if (button.type === "URL") {
      const tokens = placeholders(button.url);
      if (!URL_BUTTON.test(button.url) || tokens.length !== 1 || tokens[0] !== "1") errors.push("url_button");
      if (button.example.length !== 1) errors.push("example_count");
    }
  }
  const visible = visibleText(components);
  if (/lumera/i.test(visible)) errors.push("brand_name");
  if (/\bNHA\b/.test(visible)) errors.push("authority_brand");
  if (/\bABDM\b/i.test(visible)) errors.push("registry_brand");
  if (/certif/i.test(visible)) errors.push("certification");
  if (/reply\s+stop/i.test(visible)) errors.push("reply_stop");
  if (category === "MARKETING") {
    const buttons = buttonsOf(components);
    if (!buttons.some((button) => button.type === "QUICK_REPLY" && button.text === MARKETING_OPT_OUT_BUTTON_TEXT)) {
      errors.push("marketing_opt_out");
    }
  }
  if (category === "AUTHENTICATION") {
    const bodyComponent = components.find((component) => component.type === "BODY");
    if (!bodyComponent || bodyComponent.type !== "BODY" || bodyComponent.text !== AUTH_PRESET_BODY) {
      errors.push("auth_preset");
    }
    if (!buttonsOf(components).some((button) => button.type === "OTP" && button.otp_type === "COPY_CODE")) {
      errors.push("auth_copy_code");
    }
  }
  return [...new Set(errors)];
}

export function templateContractErrors(spec: WhatsAppTemplateSpec): string[] {
  const errors = componentContractErrors(spec.components, spec.category);
  const bodyComponent = spec.components.find((component) => component.type === "BODY");
  const text = bodyComponent && bodyComponent.type === "BODY" ? bodyComponent.text : "";
  const count = positionalError(text).count;
  const values = Object.values(spec.bodyIndex);
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const contiguous = values.length === unique.length && unique.length === count && unique.every((n, i) => n === i + 1);
  if (!contiguous) errors.push("index_map");
  if (spec.category === "AUTHENTICATION" && (spec.bodyIndex.clinic_name || spec.bodyIndex.doctor_name)) {
    errors.push("auth_clinic");
  }
  return [...new Set(errors)];
}

function componentText(components: readonly MetaComponent[], type: "HEADER" | "BODY" | "FOOTER"): string | undefined {
  const component = components.find((item) => item.type === type);
  if (!component) return undefined;
  if (component.type === "HEADER" && component.format === "TEXT") return component.text;
  if (component.type === "BODY" || component.type === "FOOTER") return component.text;
  return undefined;
}

export function uiWhatsAppTemplates(): WhatsAppTemplate[] {
  return UI_SPECS.map((spec) => {
    const buttons = buttonsOf(spec.components).map((button) => {
      if (button.type === "URL") return { type: "URL" as const, text: button.text, payload: button.url };
      return {
        type: "QUICK_REPLY" as const,
        text: button.text,
        payload: spec.ui?.payloads?.[button.text],
      };
    });
    const bodyComponent = spec.components.find((component) => component.type === "BODY");
    const bodyExample =
      bodyComponent && bodyComponent.type === "BODY" ? bodyComponent.example?.body_text?.[0] : undefined;
    return {
      id: spec.ui?.id || spec.name,
      name: spec.name,
      category: spec.category,
      language: spec.ui?.language || "en",
      headerText: componentText(spec.components, "HEADER"),
      bodyText: componentText(spec.components, "BODY") || "",
      footerText: componentText(spec.components, "FOOTER"),
      bodyExample,
      buttons,
      status: spec.ui?.status || "APPROVED",
    };
  });
}
