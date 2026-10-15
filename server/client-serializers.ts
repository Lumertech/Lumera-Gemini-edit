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

/** True for Meta/WABA tokens, encrypted tokens, PINs, webhook secrets, API keys, password hashes. */
export function isClientSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(canonicalColumnKey(key));
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
 * A queue label such as `tokenPrefix` matches the token-key rule and is omitted
 * from the client copy; the stored column is not rewritten.
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
