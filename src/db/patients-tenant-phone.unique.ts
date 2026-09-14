/**
 * MERGE NOTE for PR #80 `src/db/schema-a.ts` patients table:
 *
 * Replace the global unique on phone:
 *   phone: text("phone").notNull().unique()
 * with a tenant-scoped unique (two clinics may share a patient mobile):
 *
 *   unique("patients_tenant_id_phone_unique").on(t.tenantId, t.phone)
 *
 * Runtime sqlite (this branch / main `server/db.ts`):
 *   CREATE UNIQUE INDEX idx_patients_tenant_phone ON patients(tenant_id, phone)
 *
 * Do not keep a table-level UNIQUE on phone alone.
 */
export const PATIENTS_PHONE_UNIQUE = "UNIQUE(tenant_id, phone)" as const;
