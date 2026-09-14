/**
 * Resolve the Postgres connection string.
 *
 * Cloud Run unix socket (Cloud SQL Auth Proxy mount):
 *   postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:asia-south1:INSTANCE
 *
 * INSTANCE_CONNECTION_NAME + SQL_USER/SQL_PASSWORD/SQL_DB_NAME are composed
 * into that URI when DATABASE_URL is unset.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const direct = String(env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const instance = String(env.INSTANCE_CONNECTION_NAME || env.CLOUD_SQL_CONNECTION_NAME || "").trim();
  const user = String(env.SQL_USER || env.POSTGRES_USER || "").trim();
  const password = String(env.SQL_PASSWORD || env.POSTGRES_PASSWORD || "");
  const database = String(env.SQL_DB_NAME || env.POSTGRES_DB || "").trim();
  if (instance && user && password && database) {
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@/${encodeURIComponent(database)}?host=/cloudsql/${instance}`;
  }
  return "";
}

export function cloudSqlUnixSocketUrl(opts: {
  user: string;
  password: string;
  database: string;
  instanceConnectionName: string;
}): string {
  return `postgres://${encodeURIComponent(opts.user)}:${encodeURIComponent(opts.password)}@/${encodeURIComponent(opts.database)}?host=/cloudsql/${opts.instanceConnectionName}`;
}
