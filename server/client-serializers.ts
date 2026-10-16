/**
 * Allowlist serializers for rows sent to browsers.
 *
 * `SELECT *` must not be JSON-encoded to a client. Tenant rows store Meta /
 * WABA access tokens (`meta_access_token`, `meta_token_expires_at`). Future
 * columns — encrypted tokens, registration PINs, webhook secrets, API keys —
 * stay on the server because they are not on the allowlist.
 */

const SECRET_KEY_RE =
  /(?:^|_)(?:password(?:_hash)?|passwd|secret|api_?key|ciphertext|encrypted(?:_token)?)(?:_|$)|(?:^|_)token(?:_|$)|(?:^|_)pin(?:_|$)/;

/** snake_case form of a row key (`metaAccessToken` → `meta_access_token`). */
export function canonicalColumnKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

/**
 * Keys that match the token rule but are clinic display settings, not credentials.
 * `tokenPrefix` is the queue token label edited in onboarding (`FrontDeskRules`).
 */
const SAFE_CLIENT_KEYS = new Set(["token_prefix"]);

/** True for Meta/WABA tokens, encrypted tokens, PINs, webhook secrets, API keys, password hashes. */
export function isClientSecretKey(key: string): boolean {
  const canonical = canonicalColumnKey(key);
  if (SAFE_CLIENT_KEYS.has(canonical)) return false;
  return SECRET_KEY_RE.test(canonical);
}

function camelOf(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function readColumn(row: Record<string, unknown>, snake: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, snake)) return row[snake];
  const camel = camelOf(snake);
  if (camel !== snake && Object.prototype.hasOwnProperty.call(row, camel)) return row[camel];
  return undefined;
}

/**
 * JSON object/array stored in a TEXT column (`practice_settings` and any other
 * JSON-string field on a client payload). Non-JSON strings are left alone.
 */
function parseJsonContainer(value: string): Record<string, unknown> | unknown[] | undefined {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as Record<string, unknown> | unknown[];
  } catch {
    return undefined;
  }
}

/**
 * Drop secret-named keys at every level, including keys nested inside a
 * JSON-string column. The string is parsed, filtered, and re-serialized.
 * `tokenPrefix` is on the safe-key list and is kept. The stored column is not rewritten.
 */
export function omitClientSecretKeys<T>(value: T): T {
  if (typeof value === "string") {
    const parsed = parseJsonContainer(value);
    if (parsed === undefined) return value;
    return JSON.stringify(omitClientSecretKeys(parsed)) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => omitClientSecretKeys(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isClientSecretKey(key)) continue;
    out[key] = omitClientSecretKeys(child);
  }
  return out as T;
}

function pickAllowlist(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (isClientSecretKey(key)) continue;
    const value = readColumn(row, key);
    if (value !== undefined) out[key] = value;
  }
  return omitClientSecretKeys(out);
}

/**
 * Clinic profile fields a signed-in client may see.
 * Snake_case matches the historical `SELECT *` payload, minus secrets.
 */
export const PUBLIC_TENANT_KEYS = [
  "id",
  "name",
  "specialty",
  "country",
  "timezone",
  "phone",
  "email",
  "slug",
  "practice_type",
  "trial_ends_at",
  "ai_scribe_minutes_limit",
  "ai_scribe_minutes_used",
  "active_status",
  "hfr_id",
  "waba_id",
  "phone_number_id",
  "meta_waba_name",
  "meta_quality_rating",
  "meta_onboarding_status",
  "tagline",
  "address",
  "city",
  "website",
  "gstin",
  "reg_id",
  "upi_id",
  "whatsapp_number",
  "seal_text",
  "footer_disclaimer",
  "practice_settings",
  "lifecycle_status",
  "owner_name",
  "owner_email",
  "owner_phone",
  "deleted_at",
  "created_at",
  "updated_at",
] as const;

/** Branch columns the clinic UI reads. Extra columns are dropped. */
export const PUBLIC_BRANCH_KEYS = [
  "id",
  "tenant_id",
  "name",
  "address",
  "phone",
  "opd_hours",
  "active_doctors",
  "status",
] as const;

export function publicTenant(
  row: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  return pickAllowlist(row, PUBLIC_TENANT_KEYS);
}

export function publicBranch(
  row: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  return pickAllowlist(row, PUBLIC_BRANCH_KEYS);
}

/**
 * Clinic card a patient session may see. Staff responses keep `publicTenant`.
 * Contact fields are the numbers and email the clinic published. An empty
 * public value stays null — owner phone, owner email, and the registration
 * copy of those contacts are never substituted.
 */
export const PATIENT_TENANT_KEYS = [
  "name",
  "logo_url",
  "address",
  "phone",
  "whatsapp_number",
  "email",
  "opening_hours",
  "specialties",
  "doctor_name",
  "doctor_reg_number",
  "upi_id",
] as const;

export interface PatientTenantExtras {
  doctorName?: unknown;
  doctorRegNumber?: unknown;
  openingHours?: unknown;
  logoUrl?: unknown;
  specialties?: unknown;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sameContact(a: string, b: string): boolean {
  if (a.includes("@") || b.includes("@")) return a.toLowerCase() === b.toLowerCase();
  const digitsA = a.replace(/\D/g, "");
  const digitsB = b.replace(/\D/g, "");
  if (digitsA.length >= 8 && digitsA === digitsB) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function settingsObject(row: Record<string, unknown>): Record<string, unknown> {
  const raw = readColumn(row, "practice_settings");
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  const parsed = parseJsonContainer(raw);
  if (!parsed || Array.isArray(parsed)) return {};
  return parsed;
}

function explicitSetting(
  settings: Record<string, unknown>,
  keys: readonly string[]
): { set: boolean; value: string | null } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      return { set: true, value: textOrNull(settings[key]) };
    }
  }
  return { set: false, value: null };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return list.length ? list : null;
}

function publishedPhone(row: Record<string, unknown>, settings: Record<string, unknown>): string | null {
  const explicit = explicitSetting(settings, ["public_phone", "publicPhone"]);
  if (explicit.set) return explicit.value;
  const column = textOrNull(readColumn(row, "phone"));
  const owner = textOrNull(readColumn(row, "owner_phone"));
  if (!column) return null;
  if (owner && sameContact(column, owner)) return null;
  return column;
}

function publishedEmail(row: Record<string, unknown>, settings: Record<string, unknown>): string | null {
  const explicit = explicitSetting(settings, ["public_email", "publicEmail"]);
  if (explicit.set) return explicit.value;
  const column = textOrNull(readColumn(row, "email"));
  const owner = textOrNull(readColumn(row, "owner_email"));
  if (!column) return null;
  if (owner && sameContact(column, owner)) return null;
  return column;
}

function publishedWhatsapp(row: Record<string, unknown>, settings: Record<string, unknown>): string | null {
  const explicit = explicitSetting(settings, ["public_whatsapp", "publicWhatsapp", "public_whatsapp_number"]);
  if (explicit.set) return explicit.value;
  const column = textOrNull(readColumn(row, "whatsapp_number"));
  const owner = textOrNull(readColumn(row, "owner_phone"));
  if (!column) return null;
  if (owner && sameContact(column, owner)) return null;
  return column;
}

function publishedAddress(row: Record<string, unknown>, settings: Record<string, unknown>): string | null {
  const explicit = explicitSetting(settings, ["public_address", "publicAddress"]);
  if (explicit.set) return explicit.value;
  const line = textOrNull(readColumn(row, "address"));
  const city = textOrNull(readColumn(row, "city"));
  const combined = [line, city].filter(Boolean).join(", ");
  return combined || null;
}

function publishedSpecialties(
  row: Record<string, unknown>,
  settings: Record<string, unknown>,
  extras?: PatientTenantExtras
): string[] {
  const fromExtras = stringList(extras?.specialties);
  if (fromExtras) return fromExtras;
  const fromSettings = stringList(settings.departments) || stringList(settings.specialties);
  if (fromSettings) return fromSettings;
  const specialty = textOrNull(readColumn(row, "specialty"));
  if (!specialty) return [];
  return specialty
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function patientTenant(
  row: Record<string, unknown> | null | undefined,
  extras?: PatientTenantExtras
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const settings = settingsObject(row);
  const explicitUpi = explicitSetting(settings, ["public_upi", "publicUpi"]);
  const logo =
    textOrNull(readColumn(row, "logo_url")) ||
    textOrNull(settings.logo_url) ||
    textOrNull(settings.logoUrl) ||
    textOrNull(settings.logo) ||
    textOrNull(extras?.logoUrl);
  const openingHours =
    textOrNull(settings.opening_hours) ||
    textOrNull(settings.openingHours) ||
    textOrNull(settings.opd_hours) ||
    textOrNull(settings.opdHours) ||
    textOrNull(extras?.openingHours);
  const upi = explicitUpi.set ? explicitUpi.value : textOrNull(readColumn(row, "upi_id"));
  return {
    name: textOrNull(readColumn(row, "name")),
    logo_url: logo,
    address: publishedAddress(row, settings),
    phone: publishedPhone(row, settings),
    whatsapp_number: publishedWhatsapp(row, settings),
    email: publishedEmail(row, settings),
    opening_hours: openingHours,
    specialties: publishedSpecialties(row, settings, extras),
    doctor_name:
      textOrNull(extras?.doctorName) ||
      textOrNull(readColumn(row, "doctor_name")) ||
      textOrNull(settings.doctor_name) ||
      textOrNull(settings.doctorName),
    doctor_reg_number:
      textOrNull(extras?.doctorRegNumber) ||
      textOrNull(readColumn(row, "doctor_reg_number")) ||
      textOrNull(settings.doctor_reg_number) ||
      textOrNull(settings.doctorRegNumber),
    upi_id: upi,
  };
}

/** Phone printed on an Rx for a patient: the published clinic line, never the owner handset. */
export function patientVisibleClinicPhone(
  stamped: unknown,
  row: Record<string, unknown> | null | undefined
): string | null {
  const tenant = patientTenant(row);
  const published = [tenant?.phone, tenant?.whatsapp_number].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  const text = textOrNull(stamped);
  if (text && published.some((value) => sameContact(text, value))) return text;
  const owner = row ? textOrNull(readColumn(row, "owner_phone")) : null;
  if (text && owner && sameContact(text, owner)) return published[0] || null;
  if (text) return text;
  return published[0] || null;
}
