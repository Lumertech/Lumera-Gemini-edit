import type { SqlDatabase } from "./sql-engine.ts";
import { reportCaughtError } from "./error-tracker.ts";

/**
 * Idempotent, forward-only rewrite of demo config that pointed at domains
 * Lumera does not own. Demo tenants are tenant-lumera-main,
 * tenant-rehab-mumbai, tenant-suspended-demo, tenant-543feff7 (Sunrise demo,
 * when that row exists), and ids with the tenant-demo- prefix.
 *
 * Updates letterhead, contact fields, seeded template definitions, seed
 * mailbox defaults, qr_verification_url, and demo-tenant invoices.upi_id.
 * The seeded post_consultation_rx body keeps a doctor variable and a clinic
 * variable. Known Lumera Portal / Lumera Health EMR / Rx-number copies of
 * that seed are replaced only on demo seed template ids.
 * lumera.health and lumeraclinic.in match only as an exact host or as the
 * prefix of an http(s) URL. lumerahealth@icici matches only as a whole value.
 * A note that merely contains those strings is left alone.
 *
 * Does not rewrite message history, conversation previews, outbound event
 * logs, or existing audit rows, on any tenant. One new audit row records the
 * per-table counts when a pass changes something. A second pass writes nothing.
 * @lumera.me demo logins are left for the founder.
 */

const RETIRED_HEALTH = "lumera.health";
const RETIRED_CLINIC = "lumeraclinic.in";
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

/**
 * Roster ids from DOCTOR_SEED. doc-2 through doc-9 are inserted with a null
 * user_id, so a demo-user join never sees them.
 */
const SEED_DOCTOR_IDS = ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5", "doc-6", "doc-7", "doc-8", "doc-9"] as const;

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

/**
 * Doctor {{1}} and clinic {{2}}. No product name and no prescription number.
 * Existing demo seed rows are rewritten onto this sentence.
 */
export const POST_CONSULTATION_BODY =
  "Thank you for consulting Dr. {{1}} at {{2}}. Your consultation summary and receipt are attached above.";

const POST_CONSULTATION_EXAMPLE = ["Vikram Malhotra", "City Clinic"] as const;

const LEGACY_POST_CONSULTATION_BODIES = new Set([
  "Dear {{1}}, thank you for consulting Dr. {{2}}. Your digital prescription (Rx: {{3}}) and itemized consultation receipt are attached above. You can view dosage schedules anytime on your Lumera Portal.",
  "Dear {{1}}, thank you for consulting Dr. {{2}}. Your digital prescription (Rx: {{3}}) and itemized consultation receipt are attached above. You can view dosage schedules anytime on your patient portal.",
]);

const LEGACY_POST_CONSULTATION_EXAMPLE = ["Sunita Roy", "Vikram Malhotra", "RX-2026-0101"];

const LEGACY_POST_CONSULTATION_FOOTERS = new Set([
  "Lumera Health EMR System • Digital Rx",
  "Lumera Health EMR System • Certified Digital Rx",
  "Demo clinic • Digital Rx",
]);

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

const EXACT_RETIRED_UPI = new Set(["lumerahealth@icici", "demo-clinic@upi-sample"]);
const SEED_UPI = new Set([...EXACT_RETIRED_UPI, DEMO_UPI]);
const AUDIT_ACTION = "Unowned domain migration";

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
  if (EXACT_RETIRED_UPI.has(key)) return DEMO_UPI;
  return value;
}

function isExactRetiredHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    host === RETIRED_HEALTH ||
    host === `www.${RETIRED_HEALTH}` ||
    host === RETIRED_CLINIC ||
    host === `www.${RETIRED_CLINIC}`
  );
}

/** Whole http(s) URL whose host is exactly a retired host, or that host alone. */
export function isRetiredExactUrl(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && isExactRetiredHost(parsed.hostname)) {
      return true;
    }
  } catch {
    /* A scheme-less host is checked below. */
  }
  const bare = raw.replace(/\/$/, "");
  if (isExactRetiredHost(bare)) return true;
  const health = RETIRED_HEALTH.replace(/\./g, "\\.");
  const clinic = RETIRED_CLINIC.replace(/\./g, "\\.");
  return new RegExp(`^(?:www\\.)?(?:${health}|${clinic})(?:\\/|$)`, "i").test(raw);
}

export function rewriteExactWebsite(value: string): string {
  if (isRetiredExactUrl(value)) return DEMO_LETTERHEAD_SITE;
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

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

/**
 * Exact body and footer replacements for the seeded post-consultation template.
 * A longer custom sentence that merely contains one of those phrases is kept.
 * The branded footer is removed; WhatsApp footers cannot carry a clinic variable.
 */
export function neutralizePostConsultationSeed(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (!Array.isArray(parsed)) return value;
  let changed = false;
  const next = [];
  for (const part of parsed) {
    if (!part || typeof part !== "object") {
      next.push(part);
      continue;
    }
    const component = part as Record<string, unknown>;
    if (component.type === "BODY" && LEGACY_POST_CONSULTATION_BODIES.has(String(component.text ?? ""))) {
      changed = true;
      const example = component.example;
      let nextExample = example;
      if (example && typeof example === "object") {
        const bodyText = (example as { body_text?: unknown }).body_text;
        if (Array.isArray(bodyText) && bodyText.length === 1 && sameStrings(bodyText[0], LEGACY_POST_CONSULTATION_EXAMPLE)) {
          nextExample = { ...(example as object), body_text: [POST_CONSULTATION_EXAMPLE] };
        }
      }
      next.push({ ...component, text: POST_CONSULTATION_BODY, ...(nextExample !== undefined ? { example: nextExample } : {}) });
      continue;
    }
    if (component.type === "FOOTER" && LEGACY_POST_CONSULTATION_FOOTERS.has(String(component.text ?? ""))) {
      changed = true;
      continue;
    }
    next.push(part);
  }
  return changed ? JSON.stringify(next) : value;
}

/**
 * Opaque slot for a seeded template button.
 * The purpose must be a whole path segment so /payments is not treated as /pay.
 *
 * TODO(#169): when the opaque patient-link branch lands, remove tpl-2's portal
 * button instead of rewriting it to /portal/v/{{1}}. Leave the #164 and #169
 * template conflict unresolved in this PR.
 */
export function rewriteSeedTemplateLinks(value: string): string {
  const health = RETIRED_HEALTH.replace(/\./g, "\\.");
  const clinic = RETIRED_CLINIC.replace(/\./g, "\\.");
  const boundary = "(?![A-Za-z0-9_-])";
  const retired = new RegExp(
    `https?:\\/\\/(?:www\\.)?(?:${health}|${clinic})(?![A-Za-z0-9.-])(\\/[^\\s"'\\\\]*)?`,
    "gi"
  );
  const ownedWithId = new RegExp(
    `https?:\\/\\/www\\.mylumera\\.in\\/(rx|pay|portal|hep)${boundary}(?!\\/v\\/)(?:\\/[^\\s"'\\\\]*)?`,
    "gi"
  );
  const opaque = (purpose: string) => `${OPAQUE_BASE}/${purpose.toLowerCase()}/v/{{1}}`;
  const withoutRetired = String(value ?? "").replace(retired, (_match, path: string | undefined) => {
    const purpose = String(path || "").match(/^\/(rx|pay|portal|hep)(?![A-Za-z0-9_-])/i);
    if (!purpose) return DEMO_LETTERHEAD_SITE;
    return opaque(purpose[1]);
  });
  return withoutRetired.replace(ownedWithId, (_match, purpose: string) => opaque(purpose));
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

function seedDoctorIdPredicate(idColumn: string): string {
  const list = SEED_DOCTOR_IDS.map((id) => `'${id}'`).join(", ");
  return `${idColumn} IN (${list})`;
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
    const next = neutralizePostConsultationSeed(rewriteSeedPhrases(rewriteSeedTemplateLinks(current)));
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
  if (isRetiredExactUrl(url)) return true;
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url.trim());
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
  } catch {
    return false;
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

function recordMigrationAudit(database: SqlDatabase, counts: Record<string, number>): void {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return;
  const details = Object.entries(counts)
    .map(([table, count]) => `${table}=${count}`)
    .join(" ");
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  try {
    database
      .prepare(
        `INSERT INTO audit_logs (
          id, timestamp, user_id, user_name, action, details,
          tenant_id, patient_id, actor_role, entity_type, entity_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, timestamp, null, "system", AUDIT_ACTION, details, "", "", "", "domain_migration", "unowned-domains");
  } catch (wideErr) {
    try {
      database
        .prepare(
          `INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, details)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, timestamp, null, "system", AUDIT_ACTION, details);
    } catch (err) {
      reportCaughtError(err, "migrate-unowned-domains audit");
      reportCaughtError(wideErr, "migrate-unowned-domains audit.wide");
    }
  }
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
      `(${userOnDemoTenant("doctors.user_id")} OR ${seedDoctorIdPredicate("doctors.id")})`
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
    prescriptions: nullRetiredQrUrls(database),
  };
  for (const [table, count] of Object.entries(counts)) logTable(table, count);
  recordMigrationAudit(database, counts);
}
