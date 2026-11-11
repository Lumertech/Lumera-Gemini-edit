/**
 * Patient WhatsApp templates for the founder to submit to Meta.
 * These rows are definitions only. Nothing here is an approved template.
 * Body variables are the clinic name and the doctor name. The platform name is not copied in.
 */

export type PatientWhatsAppTemplateDefinition = {
  name: string;
  category: "UTILITY";
  language: "en";
  /** Always NOT_SUBMITTED until Meta approves a submission. */
  status: "NOT_SUBMITTED";
  variables: string[];
  body: string;
  footer: string;
};

export const PATIENT_WHATSAPP_TEMPLATES: readonly PatientWhatsAppTemplateDefinition[] = [
  {
    name: "clinic_queue_turn_near",
    category: "UTILITY",
    language: "en",
    status: "NOT_SUBMITTED",
    variables: ["clinic_name", "doctor_name", "token_number", "people_ahead"],
    body: "{{1}}: your turn with {{2}} is near. Token {{3}}. People ahead: {{4}}. Open the secure visit link already sent in this chat. The link expires.",
    footer: "Reply in this chat if you need the front desk.",
  },
  {
    name: "clinic_visit_summary",
    category: "UTILITY",
    language: "en",
    status: "NOT_SUBMITTED",
    variables: ["clinic_name", "doctor_name"],
    body: "{{1}}: {{2}} has shared your visit summary. Reply to this chat for the secure link. The link expires and is only for you.",
    footer: "Do not forward medical messages.",
  },
] as const;

export function patientTemplateByName(name: string): PatientWhatsAppTemplateDefinition | undefined {
  return PATIENT_WHATSAPP_TEMPLATES.find((row) => row.name === name);
}

/** Approved copy of one of our definitions, for this tenant only. Missing means not approved. */
export function approvedPatientTemplateName(
  db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } },
  tenantId: string,
  name: string
): string | null {
  const definition = patientTemplateByName(name);
  if (!definition) return null;
  try {
    const row = db
      .prepare(
        `SELECT name FROM meta_templates
         WHERE tenant_id = ? AND name = ? AND UPPER(status) = 'APPROVED'
         LIMIT 1`
      )
      .get(tenantId, definition.name) as { name?: string } | undefined;
    const found = String(row?.name || "").trim();
    return found || null;
  } catch {
    return null;
  }
}
