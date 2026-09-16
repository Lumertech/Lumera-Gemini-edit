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
];
