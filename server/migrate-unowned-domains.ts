import type { SqlDatabase } from "./sql-engine.ts";
import { PATIENT_LINK_PUBLIC_BASE_URL } from "./patient-link-token.ts";

/**
 * Idempotent rewrite of stored seed copy that pointed at domains Lumera does
 * not own. The same statements run on Postgres and on the sqlite dev file.
 * A second boot finds no old values and writes nothing. The statements are
 * plain SQL shared by both engines.
 *
 * Letterhead contact becomes care@example.com / https://example.com.
 * Demo UPI becomes demo@upi-sandbox. Patient-link URLs become
 * https://www.mylumera.in/<purpose>/v/{{1}} (the slot filled by
 * mintPatientLinkToken). Stored prescription QR urls that still name a
 * retired host, or that put an rx number on mylumera.in, are set to NULL.
 * @lumera.me demo logins are left for the founder.
 */

const RETIRED_HEALTH = "lumera.health";
const RETIRED_CLINIC = "lumeraclinic.in";
const OPAQUE_BASE = PATIENT_LINK_PUBLIC_BASE_URL.replace(/\/$/, "");
const DEMO_UPI = "demo@upi-sandbox";
const DEMO_LETTERHEAD_EMAIL = "care@example.com";
const DEMO_LETTERHEAD_SITE = "https://example.com";

const SEED_DOCTOR_LOCALS = [
  "dr.malhotra",
  "dr.siddharth",
  "dr.ananya",
  "dr.rajesh",
  "dr.meera",
  "dr.harsh",
  "dr.shalini",
  "dr.arun",
  "dr.alok",
];

const SEEDED_PATIENT_PARTS: ReadonlyArray<readonly [string, string]> = [
  ["rajiv.saxena", "gmail.com"],
  ["priyanka.m", "gmail.com"],
  ["sunita.roy", "gmail.com"],
  ["rohan.deshmukh", "outlook.com"],
  ["aarav.g", "gmail.com"],
  ["tariq.mohd", "gmail.com"],
  ["kavita.m", "gmail.com"],
];

function seededPatientEmails(): string[] {
  return SEEDED_PATIENT_PARTS.map(([local, host]) => `${local}@${host}`);
}

function exactReplacements(): Array<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [
    [`care@${RETIRED_CLINIC}`, DEMO_LETTERHEAD_EMAIL],
    [`emr@${RETIRED_HEALTH}`, DEMO_LETTERHEAD_EMAIL],
    [`contact@${RETIRED_HEALTH}`, "ravee@lumer.me"],
  ];
  for (const email of seededPatientEmails()) {
    const local = email.slice(0, email.indexOf("@"));
    rows.push([email, `${local}@mylumera.in`]);
  }
  for (const local of SEED_DOCTOR_LOCALS) {
    rows.push([`${local}@${RETIRED_HEALTH}`, `${local}@example.com`]);
    rows.push([`${local}@mylumera.in`, `${local}@example.com`]);
  }
  rows.push(
    [`@${RETIRED_HEALTH}`, "@example.com"],
    [`https://${RETIRED_CLINIC}`, DEMO_LETTERHEAD_SITE],
    [`http://${RETIRED_CLINIC}`, DEMO_LETTERHEAD_SITE],
    [`https://${RETIRED_HEALTH}`, DEMO_LETTERHEAD_SITE],
    [`http://${RETIRED_HEALTH}`, DEMO_LETTERHEAD_SITE],
    [RETIRED_CLINIC, "example.com"],
    [RETIRED_HEALTH, "example.com"],
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
    ["Lumera Patient Adherence Program", "Demo clinic adherence check-in"]
  );
  return rows;
}

const UNSPLASH_URL = /https:\/\/images\.unsplash\.com\/[^"'\\\s]+/g;

function rewritePatientLinks(value: string): string {
  const health = RETIRED_HEALTH.replace(/\./g, "\\.");
  const clinic = RETIRED_CLINIC.replace(/\./g, "\\.");
  const retired = new RegExp(
    `https?:\\/\\/(?:www\\.)?(?:${health}|${clinic})\\/(rx|pay|portal|hep)(?:\\/[^\\s"'\\\\]*)?`,
    "gi"
  );
  const ownedWithId = /https?:\/\/www\.mylumera\.in\/(rx|pay|portal|hep)(?!\/v\/)(?:\/[^\s"'\\]*)?/gi;
  const opaque = (purpose: string) => `${OPAQUE_BASE}/${purpose.toLowerCase()}/v/{{1}}`;
  return value.replace(retired, (_match, purpose: string) => opaque(purpose)).replace(ownedWithId, (_match, purpose: string) => opaque(purpose));
}

export function rewriteUnownedSeedText(value: string): string {
  let next = rewritePatientLinks(String(value ?? ""));
  for (const [from, to] of exactReplacements()) {
    if (next.includes(from)) next = next.split(from).join(to);
  }
  next = next.replace(/lumerahealth@icici/gi, DEMO_UPI);
  next = next.replace(/demo-clinic@upi-sample/gi, DEMO_UPI);
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
  OR lower(CAST(%COL% AS TEXT)) LIKE '%demo-clinic@upi-sample%'
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
  OR CAST(%COL% AS TEXT) LIKE '%mylumera.in/rx/%'
  OR CAST(%COL% AS TEXT) LIKE '%mylumera.in/pay/%'
  OR CAST(%COL% AS TEXT) LIKE '%mylumera.in/portal%'
  OR CAST(%COL% AS TEXT) LIKE '%mylumera.in/hep/%'
`;

function whereColumn(column: string): string {
  return OLD_NEEDLE.replaceAll("%COL%", column);
}

function isSeedUpiValue(value: string): boolean {
  const id = value.trim().toLowerCase();
  return id === "lumerahealth@icici" || id === "demo-clinic@upi-sample" || id === DEMO_UPI;
}

function rewriteLetterheadFields(email: string, website: string, upi: string): {
  email: string;
  website: string;
  upi: string;
} {
  const seedUpi = isSeedUpiValue(upi) || isSeedUpiValue(rewriteUnownedSeedText(upi));
  let nextEmail = rewriteUnownedSeedText(email);
  let nextSite = rewriteUnownedSeedText(website);
  const nextUpi = rewriteUnownedSeedText(upi);
  const site = website.trim().replace(/\/$/, "");
  if (
    seedUpi &&
    (site === "https://www.mylumera.in" || site === "http://www.mylumera.in" || nextSite.startsWith("https://www.mylumera.in"))
  ) {
    nextSite = DEMO_LETTERHEAD_SITE;
  }
  if (seedUpi && email.trim().toLowerCase() === "ravee@lumer.me") {
    nextEmail = DEMO_LETTERHEAD_EMAIL;
  }
  return { email: nextEmail, website: nextSite, upi: nextUpi };
}

function nullRetiredQrUrls(database: SqlDatabase): void {
  try {
    database
      .prepare(
        `UPDATE prescriptions
            SET qr_verification_url = NULL
          WHERE lower(COALESCE(qr_verification_url, '')) LIKE ?
             OR lower(COALESCE(qr_verification_url, '')) LIKE ?
             OR (
                  lower(COALESCE(qr_verification_url, '')) LIKE '%mylumera.in/rx/%'
                  AND lower(COALESCE(qr_verification_url, '')) NOT LIKE '%/rx/v/%'
                )
             OR (
                  lower(COALESCE(qr_verification_url, '')) LIKE '%mylumera.in/pay/%'
                  AND lower(COALESCE(qr_verification_url, '')) NOT LIKE '%/pay/v/%'
                )
             OR (
                  lower(COALESCE(qr_verification_url, '')) LIKE '%mylumera.in/portal%'
                  AND lower(COALESCE(qr_verification_url, '')) NOT LIKE '%/portal/v/%'
                )
             OR (
                  lower(COALESCE(qr_verification_url, '')) LIKE '%mylumera.in/hep/%'
                  AND lower(COALESCE(qr_verification_url, '')) NOT LIKE '%/hep/v/%'
                )`
      )
      .run(`%${RETIRED_HEALTH}%`, `%${RETIRED_CLINIC}%`);
  } catch {
    /* prescriptions.qr_verification_url is added in this same migrate() pass, or is absent */
  }
}

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
      const currentEmail = String(row.email ?? "");
      const currentSite = String(row.website ?? "");
      const currentUpi = String(row.upi_id ?? "");
      const next = rewriteLetterheadFields(currentEmail, currentSite, currentUpi);
      if (next.email !== currentEmail || next.website !== currentSite || next.upi !== currentUpi) {
        update.run(next.email, next.website, next.upi, row.id);
      }
    }
  } catch {
    /* tenants letterhead columns are added in this same migrate() pass */
  }

  const doctorLocals = SEED_DOCTOR_LOCALS.map((local) => `'${local}@mylumera.in'`).join(", ");
  rewriteTextColumn(
    database,
    "doctors",
    "id",
    "email",
    `(${whereColumn("email")}) OR lower(email) IN (${doctorLocals})`
  );
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
  nullRetiredQrUrls(database);

  const patientList = seededPatientEmails()
    .map((email) => `'${email.replace(/'/g, "")}'`)
    .join(", ");
  rewriteTextColumn(
    database,
    "patients",
    "id",
    "email",
    `email IN (${patientList}) OR lower(email) LIKE '%@${RETIRED_HEALTH}%' OR lower(email) LIKE '%${RETIRED_CLINIC}%'`
  );
}
