import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LUMERA_TABLE_NAMES, patients, users, tenants, invoices } from "./schema.ts";
import { cloudSqlUnixSocketUrl, databaseUrlFromEnv } from "./url.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Drizzle schema vs server/db.ts migrate (Epic 0.1)", () => {
  it("exports every CREATE TABLE from migrate() and platform-tenants", () => {
    const dbSrc = fs.readFileSync(path.join(root, "server/db.ts"), "utf8");
    const migrateSrc = [
      path.join(root, "server/db-migrate.ts"),
      path.join(root, "server/db-bootstrap-ddl.ts"),
    ]
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    const platform = fs.readFileSync(path.join(root, "server/platform-tenants.ts"), "utf8");
    const names = new Set();
    for (const src of [dbSrc, migrateSrc, platform]) {
      for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)) {
        names.add(m[1]);
      }
    }
    assert.deepEqual([...names].sort(), [...LUMERA_TABLE_NAMES].sort());
  });

  it("keeps sqlite-era TEXT PKs (no serial users/entries boilerplate)", () => {
    assert.equal(users.id.name, "id");
    assert.equal(patients.uhid.name, "uhid");
    assert.equal(tenants.wabaId.name, "waba_id");
    assert.equal(invoices.gstPercent.name, "gst_percent");
    const schema = [
      fs.readFileSync(path.join(root, "src/db/schema.ts"), "utf8"),
      fs.readFileSync(path.join(root, "src/db/schema-a.ts"), "utf8"),
      fs.readFileSync(path.join(root, "src/db/schema-b.ts"), "utf8"),
    ].join("\n");
    assert.doesNotMatch(schema, /pgTable\('entries'/);
    assert.match(schema, /pack_id/);
    assert.match(schema, /idx_patients_tenant_abha/);
    assert.match(schema, /practice_settings/);
    assert.match(schema, /lifecycle_status/);
  });
});

describe("DATABASE_URL / Cloud SQL unix socket composition", () => {
  it("builds the Cloud Run unix-socket URI", () => {
    assert.equal(
      cloudSqlUnixSocketUrl({
        user: "lumera",
        password: "s3cret",
        database: "lumera",
        instanceConnectionName: "gen-lang-client-0108182367:asia-south1:lumera-pg",
      }),
      "postgres://lumera:s3cret@/lumera?host=/cloudsql/gen-lang-client-0108182367:asia-south1:lumera-pg"
    );
  });

  it("prefers DATABASE_URL then INSTANCE_CONNECTION_NAME pieces", () => {
    assert.equal(databaseUrlFromEnv({} as NodeJS.ProcessEnv), "");
    assert.equal(
      databaseUrlFromEnv({ DATABASE_URL: "postgres://u:p@localhost/lumera" } as NodeJS.ProcessEnv),
      "postgres://u:p@localhost/lumera"
    );
    const composed = databaseUrlFromEnv({
      INSTANCE_CONNECTION_NAME: "proj:asia-south1:inst",
      SQL_USER: "lumera",
      SQL_PASSWORD: "pw",
      SQL_DB_NAME: "lumera",
    } as NodeJS.ProcessEnv);
    assert.equal(composed, "postgres://lumera:pw@/lumera?host=/cloudsql/proj:asia-south1:inst");
  });
});
