import fs from "node:fs";
import path from "node:path";

/**
 * User-facing hosts Lumera may ship.
 * Owned: mylumera.in (apex and any subdomain, including www) and lumer.me.
 * Everything else is a host the product actually embeds or calls.
 * @lumera.me addresses are not on this list: demo logins await the founder
 * and are exempt only as emails, not as URLs.
 */
export const ALLOWED_HOSTS: ReadonlyArray<{ host: string; why: string }> = [
  { host: "mylumera.in", why: "Apex domain Lumera owns. Subdomains such as www are included." },
  { host: "lumer.me", why: "Owned contact domain. The only public contact mailbox is ravee@lumer.me." },
  { host: "fonts.googleapis.com", why: "Google Fonts stylesheet linked from index.html." },
  { host: "fonts.gstatic.com", why: "Google Fonts file host, preconnected from index.html." },
  { host: "graph.facebook.com", why: "Meta Graph API host used for WhatsApp Cloud API calls." },
  { host: "facebook.com", why: "Facebook Login and Embedded Signup. Subdomains (www, business, web) are included." },
  { host: "connect.facebook.net", why: "Facebook JavaScript SDK loaded for Embedded Signup." },
  { host: "whatsapp.com", why: "WhatsApp click-to-chat host." },
  { host: "wa.me", why: "WhatsApp short link host." },
  { host: "sandbox.abdm.gov.in", why: "ABDM sandbox console linked from the DHIS meter." },
  { host: "hl7.org", why: "FHIR ICD-10 coding system URI in the public landing sample." },
  { host: "www.w3.org", why: "SVG namespace on the product logo. Not a network call." },
];

const OWNED_SUFFIXES = ["mylumera.in", "facebook.com", "whatsapp.com"];

export type HostViolation = { file: string; line: number; host: string; kind: string };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Keep line numbers. Comments are not user-facing. */
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
  if (!normalized || normalized === "localhost") return false;
  for (const entry of ALLOWED_HOSTS) {
    if (normalized === entry.host) return true;
  }
  for (const suffix of OWNED_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) return true;
  }
  if (normalized === "wa.me") return true;
  return false;
}

/**
 * PrescriptionWriter still prints the Rx verification URL. PR #164 owns that
 * QR and the WhatsApp Rx opaque-token link. This scan does not edit those lines.
 */
export function exemptOwnedByPr164(relPath: string, line: string): boolean {
  const file = relPath.replace(/\\/g, "/");
  if (file === "src/components/PrescriptionWriter.tsx" && line.includes("lumera.health/rx/")) {
    return true;
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

export function userFacingFiles(root: string): string[] {
  const files: string[] = [];
  const src = path.join(root, "src");
  walk(src, files);
  const server = path.join(root, "server");
  if (fs.existsSync(server)) {
    for (const entry of fs.readdirSync(server, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (isTestFile(entry.name)) continue;
      if (/seed/i.test(entry.name) || /template/i.test(entry.name)) {
        files.push(path.join(server, entry.name));
      }
    }
  }
  const publicDir = path.join(root, "public");
  walk(publicDir, files);
  const indexHtml = path.join(root, "index.html");
  if (fs.existsSync(indexHtml)) files.push(indexHtml);
  return files.filter((file) => !isTestFile(file));
}

const URL_RE = /\b(?:https?|upi):\/\/[^\s"'`<>)\]}]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const BARE_HOST_RE = /\b((?:[a-z0-9-]+\.)+(?:health|com|net|org|in|me|io|gov|app))\b/gi;

function hostFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[),.;]+$/, ""));
    return url.hostname || null;
  } catch {
    return null;
  }
}

export function findUnownedHosts(source: string, relPath: string): HostViolation[] {
  const stripped = stripComments(source);
  const hits: HostViolation[] = [];
  const push = (index: number, host: string, kind: string) => {
    const line = lineOf(stripped, index);
    const text = stripped.split("\n")[line - 1] || "";
    if (exemptOwnedByPr164(relPath, text)) return;
    if (kind === "email" && host.toLowerCase() === "lumera.me") return;
    if (kind !== "upi" && hostAllowed(host)) return;
    hits.push({ file: relPath, line, host, kind });
  };

  for (const match of stripped.matchAll(URL_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (raw.toLowerCase().startsWith("upi:")) {
      push(index, raw, "upi");
      continue;
    }
    const host = hostFromUrl(raw);
    if (host) push(index, host, "url");
  }

  for (const match of stripped.matchAll(EMAIL_RE)) {
    const host = match[1] || "";
    push(match.index ?? 0, host, "email");
  }

  for (const match of stripped.matchAll(BARE_HOST_RE)) {
    const host = match[1] || "";
    const index = match.index ?? 0;
    const around = stripped.slice(Math.max(0, index - 8), index);
    if (/https?:\/\/$/i.test(around) || /upi:\/\//i.test(around)) continue;
    if (/@/.test(stripped.slice(Math.max(0, index - 64), index + host.length))) {
      const before = stripped.slice(Math.max(0, index - 80), index);
      if (/[A-Za-z0-9._%+-]@$/.test(before)) continue;
    }
    push(index, host, "host");
  }

  return hits;
}

export function scanUserFacingHosts(root: string): HostViolation[] {
  const violations: HostViolation[] = [];
  for (const file of userFacingFiles(root)) {
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
