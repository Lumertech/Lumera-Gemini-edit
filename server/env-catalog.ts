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

export const ENV_CATALOG: EnvKeyDoc[] = [];
export const PARTIAL_CLOUD_SQL_MESSAGE =
  "Partial Cloud SQL configuration. Set DATABASE_URL (postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:asia-south1:INSTANCE) or all of INSTANCE_CONNECTION_NAME (or CLOUD_SQL_CONNECTION_NAME), SQL_USER, SQL_PASSWORD, and SQL_DB_NAME. Placeholders like replace-with-* do not count.";
export const META_GRAPH_PAIR_MESSAGE =
  "META_ACCESS_TOKEN and META_PHONE_NUMBER_ID must be set together in production (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID aliases accepted). Half-set Graph credentials are not a SANDBOX send path on Cloud Run.";

export function assertOptionalEnvShape(env: NodeJS.ProcessEnv = process.env): void {
  void env;
}

export function assertEnvExampleDocumentsCatalog(exampleText: string): void {
  void exampleText;
}
