import type { SqlDatabase } from "./sql-engine.ts";

/**
 * Idempotent rewrite of stored seed copy that pointed at domains Lumera does
 * not own. The same statements run on Postgres and on the sqlite dev file.
 * A second boot finds no old values and writes nothing. The statements are
 * plain SQL shared by both engines.
 *
 * Custom clinic text is rewritten only when it still contains one of the old
 * values. @lumera.me demo logins are left for the founder.
 */

const EXACT_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["care@lumeraclinic.in", "ravee@lumer.me"],
  ["contact@lumera.health", "ravee@lumer.me"],
  ["emr@lumera.health", "ravee@lumer.me"],
  ["rajiv.saxena@gmail.com", "rajiv.saxena@mylumera.in"],
  ["priyanka.m@gmail.com", "priyanka.m@mylumera.in"],
  ["sunita.roy@gmail.com", "sunita.roy@mylumera.in"],
  ["rohan.deshmukh@outlook.com", "rohan.deshmukh@mylumera.in"],
  ["aarav.g@gmail.com", "aarav.g@mylumera.in"],
  ["tariq.mohd@gmail.com", "tariq.mohd@mylumera.in"],
  ["kavita.m@gmail.com", "kavita.m@mylumera.in"],
  ["@lumera.health", "@mylumera.in"],
  ["https://lumeraclinic.in", "https://www.mylumera.in"],
  ["http://lumeraclinic.in", "https://www.mylumera.in"],
  ["https://lumera.health", "https://www.mylumera.in"],
  ["http://lumera.health", "https://www.mylumera.in"],
  ["lumeraclinic.in", "www.mylumera.in"],
  ["lumera.health", "www.mylumera.in"],
  ["Lumera Health EMR System • Digital Rx", "Demo clinic • Digital Rx"],
  ["Appointment Confirmation - Lumera Health", "Appointment Confirmation - Demo clinic"],
  ["Lumera Apex PolyClinic • Indiranagar, Bengaluru", "Demo clinic • Indiranagar, Bengaluru"],
  ["your Lumera Portal", "your patient portal"],
  ["Lumera Central Diagnostics", "Demo clinic diagnostics"],
  ["Your Lumera Health verification code", "Your verification code"],
  ["Lumera Health is organizing", "Demo clinic is organizing"],
  ["Welcome to *Lumera Polyclinic WhatsApp Health Desk*", "Welcome to *Demo clinic*"],
  ["Welcome to Lumera Health Desk.", "Welcome to Demo clinic."],
  ["Lumera Clinical Care Team", "Demo clinic"],
  ["🏥 Lumera Polyclinic - Appointment Confirmed", "🏥 Demo clinic - Appointment Confirmed"],
  ["📄 Digital Rx Ready - Lumera Health", "📄 Digital Rx Ready"],
  ["from Lumera Clinic", "from Demo clinic"],
  ["Lumera Patient Adherence Program", "Demo clinic adherence check-in"],
];

const UNSPLASH_URL = /https:\/\/images\.unsplash\.com\/[^"'\\\s]+/g;

export function rewriteUnownedSeedText(value: string): string {
  let next = String(value ?? "");
  for (const [from, to] of EXACT_REPLACEMENTS) {
    if (next.includes(from)) next = next.split(from).join(to);
  }
  next = next.replace(/lumerahealth@icici/gi, "demo-clinic@upi-sample");
  next = next.replace(UNSPLASH_URL, "/lumera-logo.svg");
  return next;
}

type IdValue = { id?: unknown; value?: unknown };

function rewriteTextColumn(
  database: SqlDatabase,
  table: string,
  idColumn: string,
  column: string,
  where: string
): void {
  try {
    const rows = database
      .prepare(`SELECT ${idColumn} AS id, ${column} AS value FROM ${table} WHERE ${where}`)
      .all() as IdValue[];
    const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`);
    for (const row of rows) {
      const id = row?.id;
      if (id == null || id === "") continue;
      const current = row.value == null ? "" : String(row.value);
      const next = rewriteUnownedSeedText(current);
      if (next !== current) update.run(next, id);
    }
  } catch {
    /* table or column is created in this same migrate() pass, or is absent */
  }
}

const OLD_NEEDLE = `
  lower(CAST(%COL% AS TEXT)) LIKE '%lumera.health%'
  OR lower(CAST(%COL% AS TEXT)) LIKE '%lumeraclinic.in%'
  OR lower(CAST(%COL% AS TEXT)) LIKE '%lumerahealth@icici%'
  OR CAST(%COL% AS TEXT) LIKE '%images.unsplash.com%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Health%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Portal%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Clinic%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Central Diagnostics%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Patient Adherence%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Polyclinic WhatsApp%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Health Desk%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Clinical Care Team%'
  OR CAST(%COL% AS TEXT) LIKE '%Lumera Apex PolyClinic •%'
`;

function whereColumn(column: string): string {
  return OLD_NEEDLE.replaceAll("%COL%", column);
}

const SEEDED_PATIENT_EMAILS = [
  "rajiv.saxena@gmail.com",
  "priyanka.m@gmail.com",
  "sunita.roy@gmail.com",
  "rohan.deshmukh@outlook.com",
  "aarav.g@gmail.com",
  "tariq.mohd@gmail.com",
  "kavita.m@gmail.com",
];

export function migrateUnownedDomains(database: SqlDatabase): void {
  try {
    const rows = database
      .prepare(
        `SELECT id, email, website, upi_id
           FROM tenants
          WHERE ${whereColumn("email")}
             OR ${whereColumn("website")}
             OR ${whereColumn("upi_id")}`
      )
      .all() as Array<{ id?: unknown; email?: unknown; website?: unknown; upi_id?: unknown }>;
    const update = database.prepare(
      "UPDATE tenants SET email = ?, website = ?, upi_id = ? WHERE id = ?"
    );
    for (const row of rows) {
      if (row?.id == null) continue;
      const email = rewriteUnownedSeedText(String(row.email ?? ""));
      const website = rewriteUnownedSeedText(String(row.website ?? ""));
      const upi = rewriteUnownedSeedText(String(row.upi_id ?? ""));
      if (
        email !== String(row.email ?? "") ||
        website !== String(row.website ?? "") ||
        upi !== String(row.upi_id ?? "")
      ) {
        update.run(email, website, upi, row.id);
      }
    }
  } catch {
    /* tenants letterhead columns are added in this same migrate() pass */
  }

  rewriteTextColumn(database, "doctors", "id", "email", whereColumn("email"));
  rewriteTextColumn(database, "doctors", "id", "avatar_url", whereColumn("avatar_url"));
  rewriteTextColumn(database, "staff", "id", "email", whereColumn("email"));
  rewriteTextColumn(
    database,
    "users",
    "id",
    "email",
    `(${whereColumn("email")}) AND lower(email) NOT LIKE '%@lumera.me'`
  );
  rewriteTextColumn(database, "meta_templates", "id", "components", whereColumn("components"));
  rewriteTextColumn(database, "cms_settings", "key", "value", whereColumn("value"));
  rewriteTextColumn(database, "whatsapp_messages", "id", "content", whereColumn("content"));
  rewriteTextColumn(
    database,
    "whatsapp_conversations",
    "id",
    "last_message",
    whereColumn("last_message")
  );
  rewriteTextColumn(
    database,
    "prescriptions",
    "id",
    "qr_verification_url",
    whereColumn("qr_verification_url")
  );

  const patientList = SEEDED_PATIENT_EMAILS.map((email) => `'${email}'`).join(", ");
  rewriteTextColumn(
    database,
    "patients",
    "id",
    "email",
    `email IN (${patientList}) OR lower(email) LIKE '%@lumera.health%' OR lower(email) LIKE '%lumeraclinic.in%'`
  );
}
