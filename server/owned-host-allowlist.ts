import fs from "node:fs";
import path from "node:path";

/**
 * Hosts and email domains src/ and server/ may contain.
 * Owned: mylumera.in (any subdomain) and lumer.me.
 * The other entries are hosts this product actually calls or embeds.
 *
 * TODO(founder): @lumera.me addresses are demo logins and stay until the
 * founder replaces them. The exemption is emails only, not https://lumera.me.
 *
 * PR #164's server/public-url-hosts.test.ts is the lumera.health / lumera.me
 * host regression. This scan is the broader host and email allowlist. It does
 * not flag the URL strings that test already owns (Rx QR, FHIR systems, the
 * client Rx/pay buttons, and the seeded portal URL). @lumera.health mailboxes
 * are stripped the same way that test strips them.
 */
export const ALLOWED_HOSTS: ReadonlyArray<{ host: string; why: string }> = [
  { host: "mylumera.in", why: "Apex domain Lumera owns. Subdomains such as www are included." },
  { host: "lumer.me", why: "Owned contact domain. The public contact mailbox is ravee@lumer.me." },
  { host: "example.com", why: "Demo clinic letterhead contact and non-login doctor mailboxes." },
  { host: "clinic.example", why: "Placeholder mailbox on the clinic team form. PR #164 uses doctor@clinic.example." },
  { host: "googleapis.com", why: "Google Fonts, OAuth token, and Google API hosts." },
  { host: "gstatic.com", why: "Google Fonts file host." },
  { host: "google.com", why: "Google account host used by OAuth (accounts.google.com)." },
  { host: "facebook.com", why: "Facebook Login and Embedded Signup. Subdomains (www, web, developers) are included." },
  { host: "connect.facebook.net", why: "Facebook JavaScript SDK loaded for Embedded Signup." },
  { host: "whatsapp.com", why: "WhatsApp click-to-chat and Cloud API hosts." },
  { host: "wa.me", why: "WhatsApp short link host." },
  { host: "abdm.gov.in", why: "ABDM sandbox and production hosts, including sandbox.abdm.gov.in." },
  { host: "ndhm.gov.in", why: "NDHM facility, doctor, and health-id hosts used by the ABDM flows." },
  { host: "nrces.in", why: "NHA NRCeS FHIR structure-definition and code-system URIs." },
  { host: "hl7.org", why: "HL7 FHIR code systems, including terminology.hl7.org." },
  { host: "snomed.info", why: "SNOMED CT coding system used on clinical resources." },
  { host: "loinc.org", why: "LOINC coding system used on observations." },
  { host: "unitsofmeasure.org", why: "UCUM unit system on FHIR quantity observations." },
  { host: "nmc.org.in", why: "National Medical Commission license system on the FHIR Practitioner identifier." },
  { host: "razorpay.com", why: "Clinic Razorpay API. Patient money settles to the clinic, not to Lumera." },
  { host: "unsplash.com", why: "Optional remote image host. Seed avatars no longer depend on it." },
  { host: "localhost", why: "Loopback dev origin. Not a public host." },
  { host: "127.0.0.1", why: "Loopback dev origin. Not a public host." },
];

const HOST_SUFFIXES = [
  "mylumera.in",
  "facebook.com",
  "whatsapp.com",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "abdm.gov.in",
  "ndhm.gov.in",
  "hl7.org",
  "razorpay.com",
  "unsplash.com",
];

/**
 * URL shapes PR #164 already replaces. The broader scan leaves them alone so
 * it does not fight public-url-hosts.test.ts. Any other host in those files
 * still fails.
 */
export const PR164_OWNED_URLS: Readonly<Record<string, readonly RegExp[]>> = {
  "server/clinical.ts": [/https:\/\/lumera\.health\/rx\/\$\{/],
  "server/fhir.ts": [/https:\/\/lumera\.health\/(?:uhid|fhir\/prescription|fhir\/op-consult)\b/],
  "src/components/PrescriptionWriter.tsx": [/https:\/\/lumera\.health\/rx\//],
  "src/data/clinicalData.ts": [/https:\/\/lumera\.health\/rx\/\{\{3/, /https:\/\/lumera\.health\/pay\/\{\{2/],
  "server/db-seed-meta.ts": [/https:\/\/lumera\.health\/portal\b/],
};

export type HostViolation = { file: string; line: number; host: string; kind: string };

function ownedByPr164(relPath: string, url: string): boolean {
  const patterns = PR164_OWNED_URLS[relPath.replace(/\\/g, "/")];
  if (!patterns) return false;
  return patterns.some((pattern) => pattern.test(url));
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Keep line numbers. Comments are not shipped copy. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/" && source[i - 1] !== ":") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (ch === "<" && source.startsWith("<!--", i)) {
      out += "    ";
      i += 4;
      while (i < source.length && !source.startsWith("-->", i)) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "   ";
      i = Math.min(source.length, i + 3);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function hostAllowed(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!normalized) return false;
  for (const entry of ALLOWED_HOSTS) {
    if (normalized === entry.host) return true;
  }
  for (const suffix of HOST_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/** src/ and server/, excluding tests. */
export function scannedFiles(root: string): string[] {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  walk(path.join(root, "server"), files);
  return files.filter((file) => !isTestFile(file));
}

const URL_RE = /\b(?:https?):\/\/[^\s"'`<>)\]}]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

function hostFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[),.;]+$/, ""));
    const host = url.hostname || "";
    if (!host || /[${}]/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function findUnownedHosts(source: string, relPath: string): HostViolation[] {
  const stripped = stripComments(source);
  const hits: HostViolation[] = [];
  const push = (index: number, host: string, kind: string) => {
    const line = lineOf(stripped, index);
    // TODO(founder): @lumera.me demo logins await the founder. Emails only.
    // @lumera.health mailboxes match PR #164's host test, which strips them
    // before looking for hosts. A lumera.health URL is still a violation.
    if (kind === "email" && (host.toLowerCase() === "lumera.me" || host.toLowerCase() === "lumera.health")) return;
    if (hostAllowed(host)) return;
    hits.push({ file: relPath.replace(/\\/g, "/"), line, host, kind });
  };

  for (const match of stripped.matchAll(URL_RE)) {
    if (ownedByPr164(relPath, match[0])) continue;
    const host = hostFromUrl(match[0]);
    if (host) push(match.index ?? 0, host, "url");
  }

  for (const match of stripped.matchAll(EMAIL_RE)) {
    const host = match[1] || "";
    push(match.index ?? 0, host, "email");
  }

  return hits;
}

export function scanUserFacingHosts(root: string): HostViolation[] {
  const violations: HostViolation[] = [];
  for (const file of scannedFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    violations.push(...findUnownedHosts(source, rel));
  }
  return violations;
}
