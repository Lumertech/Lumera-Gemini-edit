import type { SqlDatabase } from "./sql-engine.ts";
import { reportCaughtError } from "./error-tracker.ts";

/**
 * Idempotent rewrite of stored demo-seed copy that pointed at domains Lumera
 * does not own. Every UPDATE is limited to demo tenants:
 * tenant-lumera-main, tenant-rehab-mumbai, tenant-suspended-demo,
 * tenant-543feff7 (Sunrise demo, when that row exists), and ids with the
 * tenant-demo- prefix.
 *
 * Emails, websites, and UPI ids match the whole value. A clinic note that
 * merely mentions a retired host is left alone. Unsplash avatar URLs are
 * left alone. WhatsApp rows outside a demo tenant are left alone.
 * Patient-link slots are rewritten only on the seeded template ids.
 * @lumera.me demo logins are left for the founder.
 */

const RETIRED_HEALTH = ["lumera", "health"].join(".");
const RETIRED_CLINIC = ["lumeraclinic", "in"].join(".");
const OPAQUE_BASE = "https://www.mylumera.in";
const DEMO_UPI = "demo@upi-sandbox";
const DEMO_LETTERHEAD_EMAIL = "care@example.com";
const DEMO_LETTERHEAD_SITE = "https://example.com";
const LANDING_EMAIL = "ravee@lumer.me";

/** Seeded WhatsApp template ids. Link slots are rewritten only on these rows. */
export const SEED_TEMPLATE_IDS = ["tpl-1", "tpl-2", "tpl-3", "tpl-4", "tpl-5", "tpl-6"] as const;

const DEMO_TENANT_IDS = [
  "tenant-lumera-main",
  "tenant-rehab-mumbai",
  "tenant-suspended-demo",
  "tenant-543feff7",
] as const;

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
] as const;

const SEEDED_PATIENT_LOCALS = [
  "rajiv.saxena",
  "priyanka.m",
  "sunita.roy",
  "rohan.deshmukh",
  "aarav.g",
  "tariq.mohd",
  "kavita.m",
] as const;

const SEEDED_PATIENT_FROM_HOSTS = ["gmail.com", "outlook.com", "mylumera.in"] as const;

const PHRASES: ReadonlyArray<readonly [string, string]> = [
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

function demoTenantPredicate(column: string): string {
  const exact = DEMO_TENANT_IDS.map((id) => `${column} = '${id}'`).join(" OR ");
  return `(${exact} OR ${column} LIKE 'tenant-demo-%')`;
}

function seedTemplatePredicate(column: string): string {
  const list = SEED_TEMPLATE_IDS.map((id) => `'${id}'`).join(", ");
  return `${column} IN (${list})`;
}

function doctorEmailPairs(): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = [];
  for (const local of SEED_DOCTOR_LOCALS) {
    pairs.push([`${local}@${RETIRED_HEALTH}`, `${local}@example.com`]);
    pairs.push([`${local}@mylumera.in`, `${local}@example.com`]);
  }
  return pairs;
}

function patientEmailPairs(): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = [];
  for (const local of SEEDED_PATIENT_LOCALS) {
    for (const host of SEEDED_PATIENT_FROM_HOSTS) {
      if (local === "rohan.deshmukh" && host === "gmail.com") continue;
      if (local !== "rohan.deshmukh" && host === "outlook.com") continue;
      pairs.push([`${local}@${host}`, `${local}@example.com`]);
    }
  }
  return pairs;
}

const LETTERHEAD_EMAILS = new Map<string, string>([
  [`care@${RETIRED_CLINIC}`, DEMO_LETTERHEAD_EMAIL],
  [`emr@${RETIRED_HEALTH}`, DEMO_LETTERHEAD_EMAIL],
  [`contact@${RETIRED_HEALTH}`, DEMO_LETTERHEAD_EMAIL],
]);

const LETTERHEAD_SITES = new Set([
  `https://${RETIRED_CLINIC}`,
  `http://${RETIRED_CLINIC}`,
  `https://www.${RETIRED_CLINIC}`,
  `http://www.${RETIRED_CLINIC}`,
  `https://${RETIRED_HEALTH}`,
  `http://${RETIRED_HEALTH}`,
  `https://www.${RETIRED_HEALTH}`,
  `http://www.${RETIRED_HEALTH}`,
]);

const SEED_UPI = new Set(["lumerahealth@icici", "demo-clinic@upi-sample", DEMO_UPI]);

function whole(value: string): string {
  return value.trim().toLowerCase().replace(/\/$/, "");
}

export function rewriteExactEmail(value: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  const key = value.trim().toLowerCase();
  for (const [from, to] of pairs) {
    if (key === from) return to;
  }
  return value;
}

export function rewriteExactUpi(value: string): string {
  const key = value.trim().toLowerCase();
  if (key === "lumerahealth@icici" || key === "demo-clinic@upi-sample") return DEMO_UPI;
  return value;
}

export function rewriteExactWebsite(value: string): string {
  const key = whole(value);
  if (LETTERHEAD_SITES.has(key)) return DEMO_LETTERHEAD_SITE;
  return value;
}

/** Known seed phrases only. Does not rewrite a host that happens to sit inside other text. */
export function rewriteSeedPhrases(value: string): string {
  let next = String(value ?? "");
  for (const [from, to] of PHRASES) {
    if (next.includes(from)) next = next.split(from).join(to);
  }
  return next;
}

/**
 * Opaque slot for a seeded template button.
 * The purpose must be a whole path segment so /payments is not treated as /pay.
 */
export function rewriteSeedTemplateLinks(value: string): string {
  const health = RETIRED_HEALTH.replace(/\./g, "\\.");
  const clinic = RETIRED_CLINIC.replace(/\./g, "\\.");
  const boundary = "(?![A-Za-z0-9_-])";
  const retired = new RegExp(
    `https?:\\/\\/(?:www\\.)?(?:${health}|${clinic})\\/(rx|pay|portal|hep)${boundary}(?:\\/[^\\s"'\\\\]*)?`,
    "gi"
  );
  const ownedWithId = new RegExp(
    `https?:\\/\\/www\\.mylumera\\.in\\/(rx|pay|portal|hep)${boundary}(?!\\/v\\/)(?:\\/[^\\s"'\\\\]*)?`,
    "gi"
  );
  const opaque = (purpose: string) => `${OPAQUE_BASE}/${purpose.toLowerCase()}/v/{{1}}`;
  return String(value ?? "")
    .replace(retired, (_match, purpose: string) => opaque(purpose))
    .replace(ownedWithId, (_match, purpose: string) => opaque(purpose));
}

export function rewriteUnownedSeedText(value: string): string {
  const raw = String(value ?? "");
  const email = rewriteExactEmail(raw, [
    ...LETTERHEAD_EMAILS,
    ...doctorEmailPairs(),
    ...patientEmailPairs(),
  ]);
  if (email !== raw) return email;
  const upi = rewriteExactUpi(raw);
  if (upi !== raw) return upi;
  const site = rewriteExactWebsite(raw);
  if (site !== raw) return site;
  return rewriteSeedPhrases(raw);
}

function rewriteLetterheadFields(email: string, website: string, upi: string): {
  email: string;
  website: string;
  upi: string;
} {
  const nextUpi = rewriteExactUpi(upi);
  let nextEmail = rewriteExactEmail(email, [...LETTERHEAD_EMAILS]);
  let nextSite = rewriteExactWebsite(website);
  const seedUpi = SEED_UPI.has(upi.trim().toLowerCase()) || SEED_UPI.has(nextUpi.trim().toLowerCase());
  const site = whole(website);
  if (seedUpi && (site === "https://www.mylumera.in" || site === "http://www.mylumera.in")) {
    nextSite = DEMO_LETTERHEAD_SITE;
  }
  if (seedUpi && email.trim().toLowerCase() === LANDING_EMAIL) {
    nextEmail = DEMO_LETTERHEAD_EMAIL;
  }
  return { email: nextEmail, website: nextSite, upi: nextUpi };
}

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function runRow(
  label: string,
  apply: () => void
): boolean {
  try {
    apply();
    return true;
  } catch (err) {
    reportCaughtError(err, label);
    return false;
  }
}

function selectRows(database: SqlDatabase, sql: string, label: string, params: unknown[] = []): Row[] | null {
  try {
    return database.prepare(sql).all(...params) as Row[];
  } catch (err) {
    reportCaughtError(err, label);
    return null;
  }
}

function logTable(table: string, count: number): void {
  console.info(`[migrate-unowned-domains] ${table}: ${count} row(s) updated`);
}

function rewriteTenantLetterhead(database: SqlDatabase): number {
  const rows = selectRows(
    database,
    `SELECT id, email, website, upi_id FROM tenants WHERE ${demoTenantPredicate("id")}`,
    "migrate-unowned-domains tenants"
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE tenants SET email = ?, website = ?, upi_id = ? WHERE id = ? AND ${demoTenantPredicate("id")}`,
    "migrate-unowned-domains tenants"
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = asText(row.id);
    if (!id) continue;
    const currentEmail = asText(row.email);
    const currentSite = asText(row.website);
    const currentUpi = asText(row.upi_id);
    const next = rewriteLetterheadFields(currentEmail, currentSite, currentUpi);
    if (next.email === currentEmail && next.website === currentSite && next.upi === currentUpi) continue;
    const wrote = runRow(`migrate-unowned-domains tenants ${id}`, () => {
      update.run(next.email, next.website, next.upi, id);
    });
    if (wrote) count += 1;
  }
  return count;
}

function prepareOrReport(database: SqlDatabase, sql: string, label: string) {
  try {
    return database.prepare(sql);
  } catch (err) {
    reportCaughtError(err, label);
    return null;
  }
}

function rewriteExactColumn(
  database: SqlDatabase,
  table: string,
  idColumn: string,
  column: string,
  pairs: ReadonlyArray<readonly [string, string]>,
  whereSql: string
): number {
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ? AND ${whereSql}`,
    `migrate-unowned-domains ${table}.${column}`
  );
  if (!update) return 0;
  for (const [from, to] of pairs) {
    const rows = selectRows(
      database,
      `SELECT ${idColumn} AS id, ${column} AS value FROM ${table} WHERE lower(${column}) = ? AND ${whereSql}`,
      `migrate-unowned-domains ${table}.${column}`,
      [from]
    );
    if (!rows) return count;
    for (const row of rows) {
      const id = row.id;
      if (id == null || id === "") continue;
      if (asText(row.value).trim().toLowerCase() !== from) continue;
      const wrote = runRow(`migrate-unowned-domains ${table}.${column} ${asText(id)}`, () => {
        update.run(to, id);
      });
      if (wrote) count += 1;
    }
  }
  return count;
}

function userOnDemoTenant(userIdColumn: string): string {
  return `EXISTS (SELECT 1 FROM users u WHERE u.id = ${userIdColumn} AND ${demoTenantPredicate("u.tenant_id")})`;
}

function phraseNeedles(column: string): string {
  return PHRASES.map(([from]) => `CAST(${column} AS TEXT) LIKE '%${from.replace(/'/g, "")}%'`).join(" OR ");
}

function rewritePhrases(
  database: SqlDatabase,
  table: string,
  idColumn: string,
  column: string,
  whereSql: string
): number {
  const rows = selectRows(
    database,
    `SELECT ${idColumn} AS id, ${column} AS value FROM ${table} WHERE (${phraseNeedles(column)}) AND ${whereSql}`,
    `migrate-unowned-domains ${table}.${column}`
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ? AND ${whereSql}`,
    `migrate-unowned-domains ${table}.${column}`
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = row.id;
    if (id == null || id === "") continue;
    const current = asText(row.value);
    const next = rewriteSeedPhrases(current);
    if (next === current) continue;
    const wrote = runRow(`migrate-unowned-domains ${table}.${column} ${asText(id)}`, () => {
      update.run(next, id);
    });
    if (wrote) count += 1;
  }
  return count;
}

function rewriteSeedTemplates(database: SqlDatabase): number {
  const where = `${demoTenantPredicate("tenant_id")} AND ${seedTemplatePredicate("id")}`;
  const rows = selectRows(
    database,
    `SELECT id, components AS value FROM meta_templates WHERE ${where}`,
    "migrate-unowned-domains meta_templates.components"
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE meta_templates SET components = ? WHERE id = ? AND ${where}`,
    "migrate-unowned-domains meta_templates.components"
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = asText(row.id);
    if (!id) continue;
    const current = asText(row.value);
    const next = rewriteSeedPhrases(rewriteSeedTemplateLinks(current));
    if (next === current) continue;
    const wrote = runRow(`migrate-unowned-domains meta_templates.components ${id}`, () => {
      update.run(next, id);
    });
    if (wrote) count += 1;
  }
  return count;
}

function rewriteCmsContact(database: SqlDatabase): number {
  const rows = selectRows(
    database,
    `SELECT key AS id, value FROM cms_settings WHERE key = ? AND lower(value) = ?`,
    "migrate-unowned-domains cms_settings",
    ["contact_email", `contact@${RETIRED_HEALTH}`]
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE cms_settings SET value = ? WHERE key = ? AND lower(value) = ?`,
    "migrate-unowned-domains cms_settings"
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = asText(row.id);
    if (asText(row.value).trim().toLowerCase() !== `contact@${RETIRED_HEALTH}`) continue;
    const wrote = runRow(`migrate-unowned-domains cms_settings ${id}`, () => {
      update.run(LANDING_EMAIL, id, `contact@${RETIRED_HEALTH}`);
    });
    if (wrote) count += 1;
  }
  return count;
}

function retiredPatientQr(url: string): boolean {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url.trim());
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
  } catch {
    return false;
  }
  if (
    host === RETIRED_HEALTH ||
    host.endsWith(`.${RETIRED_HEALTH}`) ||
    host === RETIRED_CLINIC ||
    host.endsWith(`.${RETIRED_CLINIC}`)
  ) {
    return true;
  }
  if (host !== "www.mylumera.in" && host !== "mylumera.in") return false;
  const purpose = path.match(/^\/(rx|pay|portal|hep)(?![A-Za-z0-9_-])(?:\/(.*))?$/i);
  if (!purpose) return false;
  const rest = purpose[2] || "";
  return rest !== "v" && !rest.startsWith("v/");
}

function nullRetiredQrUrls(database: SqlDatabase): number {
  const where = demoTenantPredicate("tenant_id");
  const rows = selectRows(
    database,
    `SELECT id, qr_verification_url AS value FROM prescriptions WHERE ${where} AND qr_verification_url IS NOT NULL`,
    "migrate-unowned-domains prescriptions.qr_verification_url"
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE prescriptions SET qr_verification_url = NULL WHERE id = ? AND ${where}`,
    "migrate-unowned-domains prescriptions.qr_verification_url"
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = row.id;
    if (id == null || id === "") continue;
    const current = asText(row.value);
    if (!current || !retiredPatientQr(current)) continue;
    const wrote = runRow(`migrate-unowned-domains prescriptions.qr_verification_url ${asText(id)}`, () => {
      update.run(id);
    });
    if (wrote) count += 1;
  }
  return count;
}

function rewriteInvoiceUpi(database: SqlDatabase): number {
  const where = `${demoTenantPredicate("tenant_id")} AND lower(upi_id) IN ('lumerahealth@icici', 'demo-clinic@upi-sample')`;
  const rows = selectRows(
    database,
    `SELECT id, upi_id AS value FROM invoices WHERE ${where}`,
    "migrate-unowned-domains invoices.upi_id"
  );
  if (!rows) return 0;
  let count = 0;
  const update = prepareOrReport(
    database,
    `UPDATE invoices SET upi_id = ? WHERE id = ? AND ${where}`,
    "migrate-unowned-domains invoices.upi_id"
  );
  if (!update) return 0;
  for (const row of rows) {
    const id = row.id;
    if (id == null || id === "") continue;
    const current = asText(row.value).trim().toLowerCase();
    if (current !== "lumerahealth@icici" && current !== "demo-clinic@upi-sample") continue;
    const wrote = runRow(`migrate-unowned-domains invoices.upi_id ${asText(id)}`, () => {
      update.run(DEMO_UPI, id);
    });
    if (wrote) count += 1;
  }
  return count;
}

export function migrateUnownedDomains(database: SqlDatabase): void {
  const counts: Record<string, number> = {
    tenants: rewriteTenantLetterhead(database),
    doctors: rewriteExactColumn(
      database,
      "doctors",
      "id",
      "email",
      doctorEmailPairs(),
      userOnDemoTenant("doctors.user_id")
    ),
    staff: rewriteExactColumn(
      database,
      "staff",
      "id",
      "email",
      doctorEmailPairs(),
      userOnDemoTenant("staff.user_id")
    ),
    users: rewriteExactColumn(
      database,
      "users",
      "id",
      "email",
      doctorEmailPairs(),
      demoTenantPredicate("tenant_id")
    ),
    patients: rewriteExactColumn(
      database,
      "patients",
      "id",
      "email",
      patientEmailPairs(),
      demoTenantPredicate("tenant_id")
    ),
    invoices: rewriteInvoiceUpi(database),
    meta_templates: rewriteSeedTemplates(database),
    cms_settings: rewriteCmsContact(database),
    whatsapp_messages: rewritePhrases(
      database,
      "whatsapp_messages",
      "id",
      "content",
      demoTenantPredicate("tenant_id")
    ),
    whatsapp_conversations: rewritePhrases(
      database,
      "whatsapp_conversations",
      "id",
      "last_message",
      demoTenantPredicate("tenant_id")
    ),
    prescriptions: nullRetiredQrUrls(database),
  };
  for (const [table, count] of Object.entries(counts)) logTable(table, count);
}
