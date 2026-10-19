import fs from "node:fs";
import path from "node:path";

/**
 * Hosts and email domains src/ and server/ may contain.
 * Owned: mylumera.in (any subdomain) and lumer.me.
 * The other entries are hosts this product actually calls or embeds.
 *
 * TODO(founder): @lumera.me addresses are demo logins and stay until the
 * founder replaces them. The exemption is emails only, not https://lumera.me.
 * @lumera.health is not exempt.
 *
 * PR #164's server/public-url-hosts.test.ts is the lumera.health / lumera.me
 * host regression. This scan is the broader host and email allowlist. It does
 * not flag the URL strings that test already owns (Rx QR, FHIR systems, the
 * client Rx/pay buttons, and the seeded portal URL). The clinicalData.ts
 * patterns match only those two button URLs. They do not cover
 * DEFAULT_DOCTORS: those nine roster mailboxes are @example.com and are not
 * logins. Each of those exemptions must still match source. When #164 removes
 * the URL, this test fails until the exemption is deleted.
 */
export const ALLOWED_HOSTS: ReadonlyArray<{ host: string; why: string }> = [
  { host: "mylumera.in", why: "Apex domain Lumera owns. Subdomains such as www are included." },
  { host: "lumer.me", why: "Owned contact domain. The public contact mailbox is ravee@lumer.me." },
  { host: "example.com", why: "Demo clinic letterhead contact and non-login doctor mailboxes." },
  { host: "clinic.example", why: "Placeholder mailbox on the clinic team form. PR #164 uses doctor@clinic.example." },
  { host: "fonts.googleapis.com", why: "Google Fonts stylesheet host used by the public pages." },
  { host: "oauth2.googleapis.com", why: "Google OAuth token endpoint." },
  { host: "www.googleapis.com", why: "Google OAuth userinfo endpoint." },
  { host: "accounts.google.com", why: "Google account host used by the OAuth consent screen." },
  { host: "fonts.gstatic.com", why: "Google Fonts file host." },
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
  { host: "facebook.net", why: "Facebook script CDN allowed by the page Content-Security-Policy." },
  { host: "fbcdn.net", why: "Facebook image CDN allowed by the page Content-Security-Policy." },
  { host: "www.w3.org", why: "XML namespace on the SVG logo in public/. Not a clinic link." },
  { host: "localhost", why: "Loopback dev origin. Not a public host." },
  { host: "127.0.0.1", why: "Loopback dev origin. Not a public host." },
];

/**
 * Suffixes that cover a real subdomain family. Each entry is also an exact
 * ALLOWED_HOSTS host and has at least two labels, so a one-label suffix
 * cannot allow every host on the internet. Google and Unsplash are exact
 * hosts only: images.unsplash.com is allowed only when product code still
 * references it.
 */
export const HOST_SUFFIXES = [
  "mylumera.in",
  "facebook.com",
  "whatsapp.com",
  "abdm.gov.in",
  "ndhm.gov.in",
  "hl7.org",
  "razorpay.com",
  "facebook.net",
  "fbcdn.net",
];

export function assertHostSuffixes(
  suffixes: readonly string[] = HOST_SUFFIXES,
  allowed: ReadonlyArray<{ host: string }> = ALLOWED_HOSTS
): void {
  const names = new Set(allowed.map((entry) => entry.host));
  for (const suffix of suffixes) {
    const labels = suffix.split(".").filter(Boolean);
    if (labels.length < 2) {
      throw new Error(`HOST_SUFFIXES entry ${suffix} needs at least two labels`);
    }
    if (!names.has(suffix)) {
      throw new Error(`HOST_SUFFIXES entry ${suffix} is not an ALLOWED_HOSTS host`);
    }
  }
}

assertHostSuffixes();

/**
 * URL shapes PR #164 already replaces. The broader scan leaves them alone so
 * it does not fight public-url-hosts.test.ts. Any other host in those files
 * still fails. unusedPr164Exemptions() fails the test when a pattern matches
 * nothing, so the exemption can be deleted once #164 lands.
 */
export const PR164_OWNED_URLS: Readonly<Record<string, readonly RegExp[]>> = {
  "server/clinical.ts": [/https:\/\/lumera\.health\/rx\/\$\{/],
  "server/fhir.ts": [/https:\/\/lumera\.health\/(?:uhid|fhir\/prescription|fhir\/op-consult)\b/],
  "src/components/PrescriptionWriter.tsx": [/https:\/\/lumera\.health\/rx\//],
  "src/data/clinicalData.ts": [/https:\/\/lumera\.health\/rx\/\{\{3/, /https:\/\/lumera\.health\/pay\/\{\{2/],
  "server/db-seed-meta.ts": [/https:\/\/lumera\.health\/portal\b/],
};

export type HostViolation = { file: string; line: number; host: string; kind: string };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Keep line numbers. Comments are not shipped copy. Quoted text is kept, including //host. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/" && source[i - 1] !== ":") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
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
        i += 1;
      }
      out += "   ";
      i = Math.min(source.length, i + 3);
      continue;
    }
    out += ch;
    i += 1;
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

const SCANNED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css", ".svg", ".json", ".md"]);

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCANNED_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

/** src/, server/, public/, hosting/, plus the root server entry and index.html. Tests are excluded. */
export function scannedFiles(root: string): string[] {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  walk(path.join(root, "server"), files);
  walk(path.join(root, "public"), files);
  walk(path.join(root, "hosting"), files);
  for (const name of ["server.ts", "index.html"]) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) files.push(full);
  }
  return files.filter((file) => !isTestFile(file));
}

const URL_RE = /\b(?:https?):\/\/[^\s"'`<>)\]}]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
/** Bare host. Callers skip matches that already sit inside an http(s) URL. */
const BARE_UNOWNED_RE = /(?:^|[^A-Za-z0-9.:])((?:[a-z0-9-]+\.)*(?:lumera\.health|lumeraclinic\.in))(?![A-Za-z0-9.])/gi;

function hostFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[),.;]+$/, ""));
    let host = url.hostname || "";
    if (!host || /[${}]/.test(host)) return null;
    if (host.startsWith("*.")) host = host.slice(2);
    return host;
  } catch {
    return null;
  }
}

function exemptionSpans(relPath: string, source: string): Array<[number, number]> {
  const patterns = PR164_OWNED_URLS[relPath.replace(/\\/g, "/")];
  if (!patterns) return [];
  const spans: Array<[number, number]> = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    for (const match of source.matchAll(global)) {
      const start = match.index ?? 0;
      spans.push([start, start + match[0].length]);
    }
  }
  return spans;
}

function insideSpan(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

export function unusedPr164Exemptions(root: string): string[] {
  const unused: string[] = [];
  for (const [rel, patterns] of Object.entries(PR164_OWNED_URLS)) {
    const full = path.join(root, rel);
    let source = "";
    try {
      source = stripComments(fs.readFileSync(full, "utf8"));
    } catch {
      unused.push(rel);
      continue;
    }
    patterns.forEach((pattern, index) => {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const global = new RegExp(pattern.source, flags);
      if (!global.test(source)) unused.push(`${rel}#${index}`);
    });
  }
  return unused;
}

export function findUnownedHosts(source: string, relPath: string): HostViolation[] {
  const stripped = stripComments(source);
  const spans = exemptionSpans(relPath, stripped);
  const hits: HostViolation[] = [];
  const urlSpans: Array<[number, number]> = [];
  const push = (index: number, host: string, kind: string) => {
    if (insideSpan(spans, index)) return;
    const line = lineOf(stripped, index);
    // TODO(founder): @lumera.me demo logins await the founder. Emails only.
    if (kind === "email" && host.toLowerCase() === "lumera.me") return;
    if (kind !== "bare" && hostAllowed(host)) return;
    hits.push({ file: relPath.replace(/\\/g, "/"), line, host, kind });
  };

  for (const match of stripped.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    urlSpans.push([index, index + match[0].length]);
    if (insideSpan(spans, index)) continue;
    const host = hostFromUrl(match[0]);
    if (host) push(index, host, "url");
  }

  for (const match of stripped.matchAll(EMAIL_RE)) {
    const host = match[1] || "";
    push(match.index ?? 0, host, "email");
  }

  for (const match of stripped.matchAll(BARE_UNOWNED_RE)) {
    const host = match[1] || "";
    const index = (match.index ?? 0) + (match[0].length - host.length);
    if (insideSpan(urlSpans, index)) continue;
    push(index, host, "bare");
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
