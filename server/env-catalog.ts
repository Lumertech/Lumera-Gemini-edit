/**
 * Canonical environment catalog + runtime assertions.
 *
 * Production required keys stay JWT_SECRET + a durable Postgres URL.
 * Meta Graph / WhatsApp / Facebook / Razorpay / ABDM stay optional until the
 * founder provisions them — but malformed values and half-set pairs fail closed.
 *
 * Standard assertions (not zod) so Cloud Run `dist/server.cjs` has no extra
 * runtime dependency. Contact ravee@lumer.me.
 */

import { databaseUrlFromEnv } from "../src/db/url.ts";
import { isUnsetOrPlaceholder, readEnvSecret } from "../src/db/env-value.ts";

export type EnvKeyDoc = {
  name: string;
  aliases?: string[];
  requiredInProduction?: boolean;
  description: string;
  dummy?: string;
};

/** Keys that must appear in `.env.example` (name or a listed alias). */
export const ENV_CATALOG: EnvKeyDoc[] = [
  {
    name: "JWT_SECRET",
    requiredInProduction: true,
    description: "HMAC for session JWTs. No weak default. Fail-closed in production.",
    dummy: "change-me-to-a-long-random-secret",
  },
  {
    name: "DATABASE_URL",
    requiredInProduction: true,
    description:
      "Postgres URI. Cloud Run unix socket: postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:asia-south1:INSTANCE",
    dummy: "postgres://lumera:replace-with-sql-password@/lumera?host=/cloudsql/PROJECT:asia-south1:INSTANCE",
  },
  {
    name: "INSTANCE_CONNECTION_NAME",
    aliases: ["CLOUD_SQL_CONNECTION_NAME"],
    description: "Cloud SQL instance connection name PROJECT:asia-south1:INSTANCE. Composed into DATABASE_URL when the URI is unset.",
    dummy: "gen-lang-client-0108182367:asia-south1:lumera-pg",
  },
  {
    name: "SQL_USER",
    aliases: ["POSTGRES_USER"],
    description: "Cloud SQL / Postgres user (with SQL_PASSWORD + SQL_DB_NAME + INSTANCE_CONNECTION_NAME).",
    dummy: "lumera",
  },
  {
    name: "SQL_PASSWORD",
    aliases: ["POSTGRES_PASSWORD"],
    description: "Cloud SQL / Postgres password. Secret Manager only — never git.",
    dummy: "replace-with-sql-password",
  },
  {
    name: "SQL_DB_NAME",
    aliases: ["POSTGRES_DB"],
    description: "Database name.",
    dummy: "lumera",
  },
  {
    name: "SQL_HOST",
    description: "TCP host for local Postgres / drizzle-kit when DATABASE_URL is unset.",
    dummy: "127.0.0.1",
  },
  {
    name: "SQL_PORT",
    description: "TCP port for local Postgres / drizzle-kit.",
    dummy: "5432",
  },
  {
    name: "SQL_ADMIN_USER",
    description: "Optional drizzle-kit admin user (local generate/migrate).",
    dummy: "postgres",
  },
  {
    name: "SQL_ADMIN_PASSWORD",
    description: "Optional drizzle-kit admin password (local only).",
    dummy: "replace-with-sql-admin-password",
  },
  {
    name: "APP_URL",
    description: "Public origin, no trailing slash. Production: https://www.mylumera.in",
    dummy: "http://localhost:3000",
  },
  {
    name: "ALLOWED_ORIGINS",
    description: "Comma-separated CORS origins. Unset → APP_URL.",
    dummy: "http://localhost:3000,http://127.0.0.1:3000",
  },
  {
    name: "PORT",
    description: "Listen port. Cloud Run injects this; do not commit it.",
    dummy: "3000",
  },
  {
    name: "NODE_ENV",
    description: "production | development | test. Bundled dist/server.cjs implies production if unset.",
    dummy: "development",
  },
  {
    name: "GEMINI_API_KEY",
    description: "Gemini AI. AI Studio injects this; local needs a real key for scribe.",
    dummy: "MY_GEMINI_API_KEY",
  },
  {
    name: "META_VERIFY_TOKEN",
    description: "GET /api/meta/webhook hub.verify_token. No hardcoded fallback.",
    dummy: "replace-with-meta-verify-token",
  },
  {
    name: "META_APP_SECRET",
    aliases: ["WHATSAPP_APP_SECRET"],
    description: "HMAC-SHA256 for POST /api/meta/webhook X-Hub-Signature-256. Facebook app-secret fallback.",
    dummy: "replace-with-meta-app-secret",
  },
  {
    name: "META_WEBHOOK_ALLOW_UNSIGNED",
    description: "Non-prod only: allow unsigned webhook POSTs. Ignored in production.",
    dummy: "true",
  },
  {
    name: "META_GRAPH_API_VERSION",
    description: "Graph API version for WhatsApp send and Facebook Login.",
    dummy: "v21.0",
  },
  {
    name: "META_ACCESS_TOKEN",
    aliases: ["WHATSAPP_ACCESS_TOKEN"],
    description: "WhatsApp Cloud API / Graph send token. Pair with META_PHONE_NUMBER_ID.",
    dummy: "replace-with-meta-access-token",
  },
  {
    name: "META_PHONE_NUMBER_ID",
    aliases: ["WHATSAPP_PHONE_NUMBER_ID"],
    description: "WhatsApp Cloud API phone-number-id. Pair with META_ACCESS_TOKEN.",
    dummy: "replace-with-meta-phone-number-id",
  },
  {
    name: "META_FALLBACK_ACCESS_TOKEN",
    description:
      "Optional shared test-number token for tenant appointment reminders while custom display name / phone await Meta verification. Unset → META_ACCESS_TOKEN.",
    dummy: "replace-with-meta-fallback-access-token",
  },
  {
    name: "META_FALLBACK_PHONE_NUMBER_ID",
    description:
      "Optional Lumera shared test phone-number-id for tenant reminders during Meta verification. Unset → META_PHONE_NUMBER_ID.",
    dummy: "replace-with-meta-fallback-phone-number-id",
  },
  {
    name: "META_OTP_TEMPLATE_NAME",
    description: "Optional authentication template for OTP. Unset → session text body.",
    dummy: "lumera_login_otp",
  },
  {
    name: "META_OTP_TEMPLATE_LANGUAGE",
    description: "OTP template language code.",
    dummy: "en",
  },
  {
    name: "META_OTP_TEMPLATE_BUTTON",
    description: "OTP template uses a button component when true.",
    dummy: "true",
  },
  {
    name: "META_REMINDER_TEMPLATE_NAME",
    description: "Optional Wave 2 appointment reminder utility template.",
    dummy: "lumera_appointment_reminder",
  },
  {
    name: "META_BOOK_CONFIRMATION_TEMPLATE_NAME",
    description: "Optional book-confirmation utility template.",
    dummy: "lumera_book_confirmation",
  },
  {
    name: "META_RECEIPT_TEMPLATE_NAME",
    description: "Optional payment-receipt utility template.",
    dummy: "lumera_payment_receipt",
  },
  {
    name: "META_UTILITY_TEMPLATE_LANGUAGE",
    description: "Language for Wave 2 utility templates.",
    dummy: "en",
  },
  {
    name: "APPOINTMENT_REMINDER_SCHEDULER",
    description: "Enable T−24h / T−2h appointment reminder scheduler.",
    dummy: "true",
  },
  {
    name: "APPOINTMENT_REMINDER_INTERVAL_MS",
    description: "Reminder scheduler poll interval in milliseconds.",
    dummy: "900000",
  },
  {
    name: "FACEBOOK_APP_ID",
    aliases: ["META_APP_ID"],
    description: "Facebook Login numeric app id. Optional until founder provisions the Meta app.",
    dummy: "replace-with-facebook-app-id",
  },
  {
    name: "FACEBOOK_APP_SECRET",
    description: "Facebook Login app secret. Falls back to META_APP_SECRET.",
    dummy: "replace-with-facebook-app-secret",
  },
  {
    name: "FACEBOOK_REDIRECT_URI",
    aliases: ["FACEBOOK_CALLBACK_URL"],
    description: "Exact Facebook Login redirect URI (no trailing slash).",
    dummy: "http://localhost:3000/api/auth/facebook/callback",
  },
  {
    name: "META_EMBEDDED_SIGNUP_CONFIG_ID",
    description: "Facebook Login for Business Embedded Signup v4 configuration id. Not Tech Provider certification.",
    dummy: "replace-with-embedded-signup-config-id",
  },
  {
    name: "META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED",
    description: "Manual flag after Meta approves whatsapp_business_* scopes. Default unset/false.",
    dummy: "false",
  },
  {
    name: "META_WHATSAPP_ONBOARDING_VERIFIED",
    description: "Manual flag after Meta business verification (200 / 7-day onboarding cap).",
    dummy: "false",
  },
  {
    name: "FACEBOOK_OAUTH_STATE_SECRET",
    description: "Optional HMAC for Facebook OAuth state JWTs. Unset → JWT_SECRET.",
    dummy: "replace-with-facebook-oauth-state-secret",
  },
  {
    name: "GOOGLE_CLIENT_ID",
    aliases: ["GOOGLE_OAUTH_CLIENT_ID"],
    description: "Google OAuth 2.0 Web application client id (Sign-in + Calendar).",
    dummy: "replace-with-google-client-id.apps.googleusercontent.com",
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    aliases: ["GOOGLE_OAUTH_CLIENT_SECRET"],
    description: "Google OAuth 2.0 Web application client secret.",
    dummy: "replace-with-google-client-secret",
  },
  {
    name: "GOOGLE_REDIRECT_URI",
    aliases: ["GOOGLE_CALLBACK_URL"],
    description: "Google Sign-in redirect URI. Default {APP_URL}/api/auth/google/callback.",
    dummy: "http://localhost:3000/api/auth/google/callback",
  },
  {
    name: "GOOGLE_OAUTH_STATE_SECRET",
    description: "Optional HMAC for Google OAuth state JWTs. Unset → JWT_SECRET.",
    dummy: "replace-with-google-oauth-state-secret",
  },
  {
    name: "GOOGLE_CALENDAR_REDIRECT_URI",
    aliases: ["GOOGLE_CALENDAR_CALLBACK_URL"],
    description: "Doctor Calendar connect redirect URI. Default {APP_URL}/api/tenant/doctor/google-calendar/callback.",
    dummy: "http://localhost:3000/api/tenant/doctor/google-calendar/callback",
  },
  {
    name: "TOKEN_ENCRYPTION_KEY",
    description: "Optional AES-256 key for Calendar tokens. Unset → JWT_SECRET is hashed.",
    dummy: "replace-with-32-byte-token-encryption-key",
  },
  {
    name: "RAZORPAY_KEY_ID",
    description: "Razorpay key id. Optional locally (SANDBOX pay-order). Production without keys does not fake capture.",
    dummy: "replace-with-razorpay-key-id",
  },
  {
    name: "RAZORPAY_KEY_SECRET",
    description: "Razorpay key secret.",
    dummy: "replace-with-razorpay-key-secret",
  },
  {
    name: "RAZORPAY_WEBHOOK_SECRET",
    description: "Razorpay webhook HMAC secret.",
    dummy: "replace-with-razorpay-webhook-secret",
  },
  {
    name: "META_BILL_SERVICE_WINDOW",
    description: "Usage billing: treat 24h service/utility replies as billed now (true/false).",
    dummy: "false",
  },
  {
    name: "META_FREE_SERVICE_WINDOW",
    description: "Usage billing: keep pre-Oct-2026 free service window (tests / rollback).",
    dummy: "true",
  },
  {
    name: "META_SERVICE_WINDOW_CUTOVER",
    description: "Usage billing ISO-8601 cutover instant. Default 2026-10-01T00:00:00.000Z.",
    dummy: "2026-10-01T00:00:00.000Z",
  },
  {
    name: "GEMINI_SCRIBE_RAW_COST_INR",
    description: "Optional INR cost per successful AI Scribe session. Unset → wallet is not debited for scribe.",
    dummy: "12.5",
  },
  {
    name: "ABDM_MODE",
    description: "stub (default, zero outbound) | sandbox (requires real NHA creds).",
    dummy: "stub",
  },
  {
    name: "ABDM_CLIENT_ID",
    description: "ABDM / NHA client id. Never commit live values.",
    dummy: "replace-with-abdm-client-id",
  },
  {
    name: "ABDM_CLIENT_SECRET",
    description: "ABDM / NHA client secret.",
    dummy: "replace-with-abdm-client-secret",
  },
  {
    name: "ABDM_GATEWAY_URL",
    description: "ABDM gateway base URL.",
    dummy: "https://sandbox.abdm.gov.in/api/v3",
  },
  {
    name: "ABDM_CALLBACK_SECRET",
    description: "Optional HMAC for public HIP/HIU callbacks (X-ABDM-Signature).",
    dummy: "replace-with-abdm-callback-secret",
  },
  {
    name: "ERROR_REPORTING",
    aliases: ["SENTRY_DSN"],
    description: "unset | gcp | console. SENTRY_DSN must stay unset (not used).",
    dummy: "console",
  },
  {
    name: "ERROR_REPORTING_PROJECT_ID",
    description: "Optional GCP project id for Error Reporting. Unset on Cloud Run uses the metadata server.",
    dummy: "gen-lang-client-0108182367",
  },
];

export const PARTIAL_CLOUD_SQL_MESSAGE =
  "Partial Cloud SQL configuration. Set DATABASE_URL (postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:asia-south1:INSTANCE) or all of INSTANCE_CONNECTION_NAME (or CLOUD_SQL_CONNECTION_NAME), SQL_USER, SQL_PASSWORD, and SQL_DB_NAME. Placeholders like replace-with-* do not count.";

export const META_GRAPH_PAIR_MESSAGE =
  "META_ACCESS_TOKEN and META_PHONE_NUMBER_ID must be set together in production (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID aliases accepted). Half-set Graph credentials are not a SANDBOX send path on Cloud Run.";

const BOOL_RE = /^(1|0|true|false|yes|no|on|off)$/i;

function assertOptionalBool(env: NodeJS.ProcessEnv, name: string): void {
  const raw = String(env[name] || "").trim();
  if (!raw || isUnsetOrPlaceholder(raw)) return;
  if (!BOOL_RE.test(raw)) {
    throw new Error(`${name} must be a boolean (true/false/1/0/yes/no/on/off), got ${JSON.stringify(raw)}`);
  }
}

function assertOptionalIsoDate(env: NodeJS.ProcessEnv, name: string): void {
  const raw = String(env[name] || "").trim();
  if (!raw || isUnsetOrPlaceholder(raw)) return;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`${name} must be an ISO-8601 datetime, got ${JSON.stringify(raw)}`);
  }
}

function assertOptionalNonNegativeNumber(env: NodeJS.ProcessEnv, name: string): void {
  const raw = String(env[name] || "").trim();
  if (!raw || isUnsetOrPlaceholder(raw)) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number (INR), got ${JSON.stringify(raw)}`);
  }
}

function assertOptionalPositiveInt(env: NodeJS.ProcessEnv, name: string): void {
  const raw = String(env[name] || "").trim();
  if (!raw || isUnsetOrPlaceholder(raw)) return;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
}

function cloudSqlPieceSet(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    readEnvSecret(env, "INSTANCE_CONNECTION_NAME", "CLOUD_SQL_CONNECTION_NAME") ||
      readEnvSecret(env, "SQL_USER", "POSTGRES_USER") ||
      readEnvSecret(env, "SQL_PASSWORD", "POSTGRES_PASSWORD") ||
      readEnvSecret(env, "SQL_DB_NAME", "POSTGRES_DB")
  );
}

/**
 * Always-on shape checks. Missing optional integrations are fine.
 * Garbage values and half-set Cloud SQL / Graph pairs are not.
 */
export function assertOptionalEnvShape(env: NodeJS.ProcessEnv = process.env): void {
  assertOptionalBool(env, "META_WEBHOOK_ALLOW_UNSIGNED");
  assertOptionalBool(env, "META_OTP_TEMPLATE_BUTTON");
  assertOptionalBool(env, "APPOINTMENT_REMINDER_SCHEDULER");
  assertOptionalBool(env, "META_APP_REVIEW_WHATSAPP_SCOPES_APPROVED");
  assertOptionalBool(env, "META_WHATSAPP_ONBOARDING_VERIFIED");
  assertOptionalBool(env, "META_BILL_SERVICE_WINDOW");
  assertOptionalBool(env, "META_FREE_SERVICE_WINDOW");
  assertOptionalIsoDate(env, "META_SERVICE_WINDOW_CUTOVER");
  assertOptionalNonNegativeNumber(env, "GEMINI_SCRIBE_RAW_COST_INR");
  assertOptionalPositiveInt(env, "APPOINTMENT_REMINDER_INTERVAL_MS");
  assertOptionalPositiveInt(env, "SQL_PORT");

  const dbUrl = databaseUrlFromEnv(env);
  if (cloudSqlPieceSet(env) && !dbUrl) {
    throw new Error(PARTIAL_CLOUD_SQL_MESSAGE);
  }

  const token = readEnvSecret(env, "META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const phone = readEnvSecret(env, "META_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID");
  if (env.NODE_ENV === "production" && Boolean(token) !== Boolean(phone)) {
    throw new Error(META_GRAPH_PAIR_MESSAGE);
  }
}

/** Every catalog key (or an alias) must be mentioned in `.env.example`. */
export function assertEnvExampleDocumentsCatalog(exampleText: string): void {
  const text = String(exampleText || "");
  const missing: string[] = [];
  for (const key of ENV_CATALOG) {
    const names = [key.name, ...(key.aliases || [])];
    const found = names.some((n) => text.includes(n));
    if (!found) missing.push(key.name);
  }
  if (missing.length) {
    throw new Error(`.env.example is missing catalog keys: ${missing.join(", ")}`);
  }
}
