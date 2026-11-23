/**
 * Shared-mobile multi-profile lookup index on `patients(tenant_id, phone)`.
 *
 * One mobile number in a clinic can hold multiple pets, multiple children under
 * one parent, or a family member / friend, each with its own `id` and `uhid`.
 *
 * Runtime sqlite & postgres (`server/migrate-patients-phone.ts`):
 *   CREATE INDEX IF NOT EXISTS idx_patients_tenant_phone_lookup ON patients(tenant_id, phone)
 *
 * Neither `UNIQUE(phone)` nor `UNIQUE(tenant_id, phone)` is enforced at the DB level.
 */
export const PATIENTS_PHONE_INDEX = "INDEX(tenant_id, phone)" as const;
export const PATIENTS_PHONE_UNIQUE = PATIENTS_PHONE_INDEX;
