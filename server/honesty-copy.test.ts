import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RETIRED_USER_COPY, retiredUserCopyLabels, scanBuiltBundle } from "./banned-user-copy.ts";
import { rewriteLegacyHonestyCopy } from "./db-migrate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type HonestyViolation = { file: string; line: number; message: string };

const PHRASES: { re: RegExp; label: string }[] = [
  { re: /digitally verified under/i, label: "digitally verified under" },
  { re: /Certified Digital Rx/, label: "Certified Digital Rx" },
  { re: /\bgemini\b/i, label: "Gemini" },
  { re: /(valid|verified) under (the )?NHA/i, label: "(valid|verified) under NHA" },
  ...RETIRED_USER_COPY,
];

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function phraseHits(content: string): string[] {
  return PHRASES.filter((phrase) => phrase.re.test(content)).map((phrase) => phrase.label);
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function isSrcUiFile(file: string): boolean {
  return /(^|\/)src\/.+\.(tsx|jsx)$/.test(file.replace(/\\/g, "/"));
}

/** Import specifiers, file names, env vars, and model ids are not product claims. */
function allowListed(content: string, lookback: string): boolean {
  const tail = lookback.trimEnd();
  const trimmed = content.trim();
  if (/\bfrom\s*$/.test(tail) || /\bimport\s*(?:\(\s*)?$/.test(tail)) return true;
  if (/(?:^|[\\/])[^\\/\s]*gemini[^\\/\s]*\.(?:tsx?|jsx?|mjs|cjs|json|png|svg)$/i.test(trimmed)) return true;
  if (/[\\/][^"'`\s]*gemini/i.test(trimmed)) return true;
  if (/\bGEMINI_[A-Z0-9_]+\b/.test(content)) return true;
  if (/process\.env(?:\s*\.\s*GEMINI_|\s*\[\s*['"]GEMINI_)/.test(`${tail}${content}`)) return true;
  if (/^(?:models\/)?gemini-[\d.]+(?:-[a-z0-9]+)*$/i.test(trimmed)) return true;
  return false;
}

function isConsoleCall(lookback: string): boolean {
  return /console\.(?:error|warn|log|info|debug)\s*\(\s*$/.test(lookback.trimEnd());
}

function isUserFacingString(lookback: string): boolean {
  const tail = lookback.trimEnd();
  if (isConsoleCall(tail)) return false;
  if (/(?:source|label|text|title|placeholder|aria-label|aria-labelledby|alt|message|footerText|footerDisclaimer)\s*:\s*$/.test(tail)) {
    return true;
  }
  if (/(?:label|title|placeholder|aria-label|aria-labelledby|alt|text|source)\s*=\s*\{?\s*$/.test(tail)) return true;
  // JSX expression children ({ "…", cond ? "…" : "…"), not object keys like sender:.
  if (/(?:^|[^$\w])[:?]\s*$/.test(tail)) return true;
  if (/(?:^|[^$\w])\{\s*$/.test(tail)) return true;
  if (/(?:&&|\|\|)\s*$/.test(tail)) return true;
  return false;
}

function isFooterDefault(lookback: string): boolean {
  const tail = lookback.trimEnd();
  if (/(?:footerDisclaimer|footerText)\s*:\s*$/.test(tail)) return true;
  if (/type:\s*["']FOOTER["']\s*,\s*text:\s*$/.test(tail)) return true;
  return false;
}

function isAiInstruction(lookback: string): boolean {
  return /systemInstruction\s*[:=]\s*$/.test(lookback.trimEnd());
}

function isResponseLabel(lookback: string): boolean {
  return /(?:source|label)\s*:\s*$/.test(lookback.trimEnd());
}

type StringHit = { content: string; index: number };

function stringLiterals(source: string): StringHit[] {
  const hits: StringHit[] = [];
  let i = 0;
  const push = (content: string, index: number) => {
    if (content) hits.push({ content, index });
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let content = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          content += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        content += source[i];
        i++;
      }
      i++;
      push(content, start);
      continue;
    }
    if (ch === "`") {
      const start = i;
      i++;
      let content = "";
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") {
          content += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          push(content, start);
          content = "";
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          continue;
        }
        content += source[i];
        i++;
      }
      push(content, start);
      i++;
      continue;
    }
    i++;
  }
  return hits;
}

function maskNonJsxText(source: string): string {
  let out = "";
  let i = 0;
  const space = (ch: string) => (ch === "\n" ? "\n" : " ");
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
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
        out += space(source[i]);
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += " ";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          out += "  ";
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            out += space(source[i]);
            i++;
          }
          continue;
        }
        out += space(source[i]);
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function lookback(source: string, index: number): string {
  return source.slice(Math.max(0, index - 220), index);
}

/**
 * Positive honesty rule: a user-visible ABHA / ABDM / e-KYC badge or label
 * must carry sandbox, not-yet-live, or local-stub on the same line or the
 * same JSX element. `@abdm` address domains are identifiers, not badges.
 * Allowlist only with `honesty-allow:` plus a real justification.
 */
const ABDM_LABEL_TOKEN = /(?<!@)\b(?:ABHA|ABDM|e-?KYC)\b/i;
const NOT_LIVE_MARKER = /sandbox|not[- ]yet[- ]live|local[- ]stub/i;
const HONESTY_ALLOW = /honesty-allow:\s*\S[^\n*]{23,}/;

/** Paths and kebab-case ids are not badges. `e-KYC` stays a label because it is not lowercase. */
function isCodeIdentifier(content: string): boolean {
  const trimmed = content.trim();
  if (/^(?:https?:\/\/|\/)[\w./?=&:-]*$/i.test(trimmed)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(trimmed)) return true;
  return false;
}

function isSrcProductFile(file: string): boolean {
  return /(^|\/)src\/.+\.(tsx?|jsx?)$/.test(file.replace(/\\/g, "/"));
}

/** Server badge/label props. Generic ternaries and thrown errors are not labels. */
function isBadgeOrLabelProp(lookbackText: string): boolean {
  const tail = lookbackText.trimEnd();
  if (isFooterDefault(tail)) return true;
  if (/(?:source|label|text|title|placeholder|aria-label|aria-labelledby|alt|footerText|footerDisclaimer)\s*:\s*$/.test(tail)) {
    return true;
  }
  if (/(?:label|title|placeholder|aria-label|aria-labelledby|alt|text)\s*=\s*\{?\s*$/.test(tail)) return true;
  return false;
}

function skipString(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (quote === "`" && source[j] === "$" && source[j + 1] === "{") {
      j += 2;
      let depth = 1;
      while (j < source.length && depth > 0) {
        const ch = source[j];
        if (ch === "'" || ch === '"' || ch === "`") {
          j = skipString(source, j);
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      continue;
    }
    if (source[j] === quote) return j + 1;
    j++;
  }
  return source.length;
}

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
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
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function prevNonWs(source: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  return j >= 0 ? source[j] : "";
}

function isJsxTagStart(source: string, i: number): boolean {
  if (source[i] !== "<") return false;
  const next = source[i + 1];
  if (!next || next === "=" || next === "!" || /\s/.test(next)) return false;
  if (next === "/") return true;
  if (next !== ">" && !/[A-Za-z]/.test(next)) return false;
  const prev = prevNonWs(source, i);
  if (prev && /[A-Za-z0-9_$]/.test(prev)) return false;
  return true;
}

function findTagEnd(source: string, i: number): number {
  let j = i + 1;
  while (j < source.length) {
    const ch = source[j];
    if (ch === "'" || ch === '"' || ch === "`") {
      j = skipString(source, j);
      continue;
    }
    if (ch === "{") {
      j++;
      let depth = 1;
      while (j < source.length && depth > 0) {
        const inner = source[j];
        if (inner === "'" || inner === '"' || inner === "`") {
          j = skipString(source, j);
          continue;
        }
        if (inner === "{") depth++;
        else if (inner === "}") depth--;
        j++;
      }
      continue;
    }
    if (ch === ">") return j + 1;
    j++;
  }
  return source.length;
}

type JsxEl = { start: number; end: number };

function jsxElements(source: string): JsxEl[] {
  const els: JsxEl[] = [];
  const stack: number[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "<" && isJsxTagStart(source, i)) {
      if (next === "/") {
        const closeEnd = source.indexOf(">", i);
        const end = closeEnd === -1 ? source.length : closeEnd + 1;
        const start = stack.pop();
        if (start !== undefined && end > start) els.push({ start, end });
        i = Math.max(i + 1, end);
        continue;
      }
      const tagEnd = findTagEnd(source, i);
      const selfClosing = tagEnd >= 2 && source[tagEnd - 2] === "/";
      if (selfClosing) els.push({ start: i, end: tagEnd });
      else stack.push(i);
      i = Math.max(i + 1, tagEnd);
      continue;
    }
    i++;
  }
  return els;
}

function innermostElement(els: JsxEl[], index: number): JsxEl | null {
  let best: JsxEl | null = null;
  for (const el of els) {
    if (el.start <= index && index < el.end && (!best || el.start >= best.start)) best = el;
  }
  if (!best) return null;
  const slice = best.end - best.start;
  // A page-sized wrapper must not launder a distant sandbox note onto a badge.
  if (slice > 2500) return null;
  return best;
}

function lineText(source: string, index: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const endIdx = source.indexOf("\n", index);
  return source.slice(start, endIdx === -1 ? source.length : endIdx);
}

function nearbySource(source: string, index: number): string {
  let from = index;
  let lines = 0;
  while (from > 0 && lines < 12) {
    from--;
    if (source[from] === "\n") lines++;
  }
  return source.slice(from, Math.min(source.length, index + 120));
}

function unmarkedAbdmLabels(source: string, file: string): HonestyViolation[] {
  const product = isSrcProductFile(file);
  const ui = isSrcUiFile(file);
  if (!product && !/(^|\/)server\//.test(file.replace(/\\/g, "/"))) return [];
  const els = product ? jsxElements(source) : [];
  const violations: HonestyViolation[] = [];
  const seen = new Set<string>();
  const push = (index: number, sample: string) => {
    const snippet = sample.replace(/\s+/g, " ").trim().slice(0, 80);
    const key = `${lineOf(source, index)}:${snippet}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      file,
      line: lineOf(source, index),
      message: `user-visible ABHA/ABDM/e-KYC label lacks a not-live marker (sandbox, not-yet-live, or local stub) ("${snippet}")`,
    });
  };
  const marked = (index: number, content: string) => {
    if (NOT_LIVE_MARKER.test(content)) return true;
    if (NOT_LIVE_MARKER.test(stripComments(lineText(source, index)))) return true;
    const el = innermostElement(els, index);
    if (el && NOT_LIVE_MARKER.test(stripComments(source.slice(el.start, el.end)))) return true;
    if (HONESTY_ALLOW.test(nearbySource(source, index))) return true;
    return false;
  };
  const inScope = (content: string, index: number) => {
    if (!ABDM_LABEL_TOKEN.test(content) || isCodeIdentifier(content)) return false;
    const before = lookback(source, index);
    if (allowListed(content, before) || isConsoleCall(before)) return false;
    if (product) return true;
    return isBadgeOrLabelProp(before);
  };

  for (const hit of stringLiterals(source)) {
    if (!inScope(hit.content, hit.index)) continue;
    if (!marked(hit.index, hit.content)) push(hit.index, hit.content);
  }
  if (ui) {
    const masked = maskNonJsxText(source);
    const textRe = />([^<>{}]*)</g;
    let text: RegExpExecArray | null;
    while ((text = textRe.exec(masked))) {
      const sample = text[1];
      const index = text.index + 1;
      if (!inScope(sample, index)) continue;
      if (!marked(index, sample)) push(index, sample);
    }
  }
  return violations;
}

/**
 * User-facing copy only: src JSX text and string props, server response
 * source/label strings, and seed/default footer text.
 */
export function findHonestyViolations(source: string, file = "src/components/Example.tsx"): HonestyViolation[] {
  const violations: HonestyViolation[] = [];
  const seen = new Set<string>();
  const push = (index: number, labels: string[]) => {
    for (const label of labels) {
      const key = `${lineOf(source, index)}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ file, line: lineOf(source, index), message: `user-facing copy contains ${label}` });
    }
  };

  const ui = isSrcUiFile(file);
  for (const hit of stringLiterals(source)) {
    const labels = phraseHits(hit.content);
    const retired = retiredUserCopyLabels(hit.content);
    if (labels.length === 0 && retired.length === 0) continue;
    const before = lookback(source, hit.index);
    if (allowListed(hit.content, before)) continue;
    const footer = isFooterDefault(before);
    const response = isResponseLabel(before);
    const instruction = isAiInstruction(before);
    const facing = ui && isUserFacingString(before);
    if (labels.length && (footer || response || instruction || facing)) push(hit.index, labels);
    // Retired labels are banned in every shipped string, not only JSX props.
    // Console lines stay allowed; comments never reach this parser.
    if (retired.length && !isConsoleCall(before)) push(hit.index, retired);
  }

  if (ui) {
    const masked = maskNonJsxText(source);
    const textRe = />([^<>{}]*)</g;
    let text: RegExpExecArray | null;
    while ((text = textRe.exec(masked))) {
      const sample = text[1];
      if (allowListed(sample, "")) continue;
      const labels = phraseHits(sample);
      if (labels.length) push(text.index + 1, labels);
    }
  }
  violations.push(...unmarkedAbdmLabels(source, file));
  return violations;
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

function scanRepository(): HonestyViolation[] {
  const files: string[] = [];
  for (const rel of ["src", "server"]) walk(path.join(root, rel), files);
  const violations: HonestyViolation[] = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    violations.push(...findHonestyViolations(source, path.relative(root, file)));
  }
  return violations;
}

const OLD_FOOTER =
  "This prescription is digitally verified under National Health Authority (NHA) & Telemedicine Practice Guidelines. Please report any adverse drug reactions immediately.";
const NEW_FOOTER = "Prescription issued under the Telemedicine Practice Guidelines, 2020.";

describe("honesty copy scan", () => {
  it("flags the overclaim phrases in JSX, response labels, and footer defaults", () => {
    const jsx = findHonestyViolations(
      `export function Rx(){ return <p>This prescription is digitally verified under NHA rules</p>; }\n`,
      "src/components/Rx.tsx"
    );
    assert.ok(jsx.some((item) => item.message.includes("digitally verified under")));
    assert.ok(jsx.some((item) => item.message.includes("(valid|verified) under NHA")));

    const nhaFooter = findHonestyViolations(
      `footerText: "Valid under NHA Telemedicine Guidelines"\n`,
      "src/data/clinicalData.ts"
    );
    assert.equal(nhaFooter.length, 1);
    assert.match(nhaFooter[0].message, /\(valid\|verified\) under NHA/);

    const nhaThe = findHonestyViolations(
      `export function Rx(){ return <p>Verified under the NHA sandbox</p>; }\n`,
      "src/components/Rx.tsx"
    );
    assert.equal(nhaThe.length, 2);
    assert.ok(nhaThe.some((item) => item.message.includes("(valid|verified) under NHA")));
    assert.ok(nhaThe.some((item) => item.message.includes("NHA sandbox")));

    const notice = findHonestyViolations(
      `export const NOTICE = "NHA sandbox: local stand-in";\n`,
      "server/clinical.ts"
    );
    assert.equal(notice.length, 1);
    assert.match(notice[0].message, /NHA sandbox/);

    const aligned = findHonestyViolations(
      `export function Badge(){ return <span>ABDM-aligned records</span>; }\n`,
      "src/components/Badge.tsx"
    );
    assert.ok(aligned.some((item) => item.message.includes("ABDM-aligned")));

    const logLine = findHonestyViolations(
      `console.info("NHA sandbox boot");\n`,
      "server/clinical.ts"
    );
    assert.deepEqual(logLine, []);

    const certified = findHonestyViolations(
      `export function Badge(){ return <span>Certified Digital Rx</span>; }\n`,
      "src/components/Badge.tsx"
    );
    assert.equal(certified.length, 1);
    assert.match(certified[0].message, /Certified Digital Rx/);

    const vendor = findHonestyViolations(
      `export function Copilot(){ return <span>Gemini 3.8 Flash</span>; }\n`,
      "src/components/Copilot.tsx"
    );
    assert.equal(vendor.length, 1);
    assert.match(vendor[0].message, /Gemini/);

    const prop = findHonestyViolations(
      `export function Copilot(){ return <input aria-label="Gemini copilot" />; }\n`,
      "src/components/Copilot.tsx"
    );
    assert.ok(prop.some((item) => item.message.includes("Gemini")));

    const source = findHonestyViolations(
      `return res.json({ response: text, source: "Pulse AI (Google Gemini 3.8 Flash)" });\n`,
      "server/gemini-clinical.ts"
    );
    assert.equal(source.length, 1);
    assert.match(source[0].message, /Gemini/);

    const footer = findHonestyViolations(
      `export const DEMO = { footerDisclaimer: "${OLD_FOOTER}" };\n`,
      "server/letterhead.ts"
    );
    assert.equal(footer.length, 1);

    const whatsapp = findHonestyViolations(
      `{ type: "FOOTER", text: "Lumera Health EMR System • Certified Digital Rx" }\n`,
      "server/db-seed-meta.ts"
    );
    assert.equal(whatsapp.length, 1);
  });

  it("requires a not-live marker on the same ABHA, ABDM, or e-KYC label", () => {
    const bare = findHonestyViolations(
      `export function Badge(){ return <span>ABHA</span>; }\n`,
      "src/components/Badge.tsx"
    );
    assert.ok(bare.some((item) => item.message.includes("not-live marker")));

    const marked = findHonestyViolations(
      `export function Badge(){ return <span>ABHA (sandbox)</span>; }\n`,
      "src/components/Badge.tsx"
    );
    assert.deepEqual(marked.filter((item) => item.message.includes("not-live marker")), []);

    const localStub = findHonestyViolations(
      `export function Note(){ return <span>Auto-filled from ABHA KYC (local stub)</span>; }\n`,
      "src/components/Note.tsx"
    );
    assert.deepEqual(localStub.filter((item) => item.message.includes("not-live marker")), []);

    const notYet = findHonestyViolations(
      `export function Foot(){ return <p>Designed for ABDM records (sandbox — not yet live)</p>; }\n`,
      "src/components/Foot.tsx"
    );
    assert.deepEqual(notYet.filter((item) => item.message.includes("not-live marker")), []);

    const ekyc = findHonestyViolations(
      `export function Kyc(){ return <span>Aadhaar e-KYC linked</span>; }\n`,
      "src/components/Kyc.tsx"
    );
    assert.ok(ekyc.some((item) => item.message.includes("not-live marker")));

    const sameElement = findHonestyViolations(
      `export function Badge(){\n  return <span title="sandbox-unverified">\n    ABHA\n  </span>;\n}\n`,
      "src/components/Badge.tsx"
    );
    assert.deepEqual(sameElement.filter((item) => item.message.includes("not-live marker")), []);

    const distant = findHonestyViolations(
      `export function Page(){\n  return <div>\n    <p>ABDM integration is in sandbox testing and not yet live.</p>\n    <span>ABDM records</span>\n  </div>;\n}\n`,
      "src/components/Page.tsx"
    );
    assert.ok(distant.some((item) => item.message.includes("not-live marker")));

    const allow = findHonestyViolations(
      `export function Search(){\n  return (\n    // honesty-allow: names the ABHA id as a search field, not a live-link badge\n    <input placeholder="Name, phone, or ABHA" />\n  );\n}\n`,
      "src/components/Search.tsx"
    );
    assert.deepEqual(allow.filter((item) => item.message.includes("not-live marker")), []);

    const thinAllow = findHonestyViolations(
      `export function Search(){\n  // honesty-allow: ok\n  return <span>ABHA</span>;\n}\n`,
      "src/components/Search.tsx"
    );
    assert.ok(thinAllow.some((item) => item.message.includes("not-live marker")));

    const address = findHonestyViolations(
      `export function Card(){ return <span>rajiv.saxena@abdm</span>; }\n`,
      "src/components/Card.tsx"
    );
    assert.deepEqual(address.filter((item) => item.message.includes("not-live marker")), []);

    const serverTitle = findHonestyViolations(
      `title: "ABDM records"\n`,
      "server/db-seed-meta.ts"
    );
    assert.ok(serverTitle.some((item) => item.message.includes("not-live marker")));

    const serverError = findHonestyViolations(
      `throw httpError(409, "Phone and ABHA resolve to different patients");\n`,
      "server/clinical.ts"
    );
    assert.deepEqual(serverError.filter((item) => item.message.includes("not-live marker")), []);

    const path = findHonestyViolations(
      `export function Load(){ return apiFetch("/api/abdm/v3/registration/aadhaar/generateOtp"); }\nconst id = "abha-linking-status";\n`,
      "src/components/Load.tsx"
    );
    assert.deepEqual(path.filter((item) => item.message.includes("not-live marker")), []);
  });

  it("allow-lists imports, file names, env vars, and model ids", () => {
    const imports = findHonestyViolations(
      `import { GeminiAssistant } from "./Gemini";\nimport panel from "./components/GeminiAssistant.tsx";\n`,
      "src/ClinicianApp.tsx"
    );
    assert.deepEqual(imports, []);

    const fileName = findHonestyViolations(
      `export function Row(){ return <img alt="server/gemini-clinical.ts" />; }\n`,
      "src/components/Row.tsx"
    );
    assert.deepEqual(fileName, []);

    const env = findHonestyViolations(
      `export function Key(){ return <p title="GEMINI_API_KEY">Pulse AI</p>; }\n`,
      "src/components/Key.tsx"
    );
    assert.deepEqual(env, []);

    const modelId = findHonestyViolations(
      `return res.json({ soap, source: "gemini-3.7-flash" });\nconst model = "gemini-3.8-flash";\n`,
      "server/gemini-clinical.ts"
    );
    assert.deepEqual(modelId, []);

    const jsxModel = findHonestyViolations(
      `export function Model(){ return <option value="models/gemini-3.7-flash">gemini-3.7-flash</option>; }\n`,
      "src/components/admin/AdminSettings.tsx"
    );
    assert.deepEqual(jsxModel, []);

    const legacyNeedle = findHonestyViolations(
      `const LEGACY_SEEDED_FOOTER_DISCLAIMER = "${OLD_FOOTER}";\nconst LEGACY_WHATSAPP_RX_FOOTER = "Certified Digital Rx";\n`,
      "server/db-migrate.ts"
    );
    assert.deepEqual(legacyNeedle, []);

    const prompt = findHonestyViolations(
      "const systemInstruction = `You are Pulse AI, powered by Google Gemini.`;\n",
      "server/gemini-clinical.ts"
    );
    assert.equal(prompt.length, 1);
    assert.match(prompt[0].message, /Gemini/);

    const log = findHonestyViolations(
      `console.error("Gemini transcribe error", err);\n`,
      "src/components/CompactAmbientScribe.tsx"
    );
    assert.deepEqual(log, []);

    const sender = findHonestyViolations(
      `const msg = { sender: "gemini", text: "Pulse AI" };\n`,
      "src/components/GeminiAssistant.tsx"
    );
    assert.deepEqual(sender, []);

    const custom = findHonestyViolations(
      `footerDisclaimer: "Digitally signed Rx — Meera Heart Clinic"\n`,
      "server/letterhead.ts"
    );
    assert.deepEqual(custom, []);
  });

  it("scans src and server user-facing copy", () => {
    const violations = scanRepository();
    assert.deepEqual(
      violations,
      [],
      violations.map((item) => `${item.file}:${item.line} ${item.message}`).join("\n")
    );
  });

  it("fails the built bundle when retired labels are emitted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumera-bundle-scan-"));
    try {
      fs.writeFileSync(path.join(dir, "app.js"), `console.log("ok");\n`);
      fs.writeFileSync(path.join(dir, "notes.map"), "NHA sandbox in a sourcemap comment\n");
      assert.deepEqual(scanBuiltBundle(dir), []);
      fs.writeFileSync(path.join(dir, "chunk.js"), `p("ABDM-aligned records")`);
      const hits = scanBuiltBundle(dir);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].label, "ABDM-" + "aligned");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const dist = path.join(root, "dist");
    if (fs.existsSync(dist)) {
      const shipped = scanBuiltBundle(dist);
      assert.deepEqual(
        shipped,
        [],
        shipped.map((hit) => `${hit.file}:${hit.line} ${hit.label}`).join("\n")
      );
    }
  });
});

describe("legacy honesty copy migration", () => {
  it("rewrites seeded overclaims and leaves custom tenant text", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY, footer_disclaimer TEXT DEFAULT '');
      CREATE TABLE meta_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        components TEXT NOT NULL DEFAULT '[]'
      );
    `);
    const insertTenant = db.prepare("INSERT INTO tenants (id, footer_disclaimer) VALUES (?, ?)");
    insertTenant.run("exact", OLD_FOOTER);
    insertTenant.run("contains", "Clinic note: digitally verified under an old banner.");
    insertTenant.run("custom", "Digitally signed Rx — Meera Heart Clinic");
    insertTenant.run("empty", "");
    insertTenant.run("already", NEW_FOOTER);

    const oldComponents = JSON.stringify([
      { type: "BODY", text: "Dear {{1}}" },
      { type: "FOOTER", text: "Lumera Health EMR System • Certified Digital Rx" },
    ]);
    const labComponents = JSON.stringify([{ type: "FOOTER", text: "Lumera Central Diagnostics" }]);
    const customPhrase = "Clinic note: Certified Digital Rx for our patients only";
    const customComponents = JSON.stringify([
      { type: "BODY", text: "Hello {{1}}" },
      { type: "FOOTER", text: customPhrase },
    ]);
    const nearComponents = JSON.stringify([
      { type: "FOOTER", text: "Lumera Health EMR System • Certified Digital Rx — edited" },
    ]);
    const insertTpl = db.prepare("INSERT INTO meta_templates (id, name, components) VALUES (?, ?, ?)");
    const intermediateComponents = JSON.stringify([
      { type: "FOOTER", text: "Lumera Health EMR System • Digital Rx" },
    ]);
    insertTpl.run("tpl-2", "post_consultation_rx", oldComponents);
    insertTpl.run("tpl-intermediate", "post_consultation_rx", intermediateComponents);
    insertTpl.run("tpl-3", "lab_report_ready", labComponents);
    insertTpl.run("tpl-custom", "clinic_branded_rx", customComponents);
    insertTpl.run("tpl-near", "post_consultation_rx", nearComponents);

    rewriteLegacyHonestyCopy(db);
    rewriteLegacyHonestyCopy(db);

    const footer = (id: string) =>
      (db.prepare("SELECT footer_disclaimer AS v FROM tenants WHERE id = ?").get(id) as { v: string }).v;
    assert.equal(footer("exact"), NEW_FOOTER);
    assert.equal(footer("contains"), "Clinic note: digitally verified under an old banner.");
    assert.equal(footer("custom"), "Digitally signed Rx — Meera Heart Clinic");
    assert.equal(footer("empty"), "");
    assert.equal(footer("already"), NEW_FOOTER);

    const componentsOf = (id: string) =>
      (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get(id) as { v: string }).v;
    const tpl2 = componentsOf("tpl-2");
    assert.equal(tpl2.includes("Certified Digital Rx"), false);
    assert.equal(tpl2.includes("Lumera Health EMR System"), false);
    const parsed = JSON.parse(tpl2) as { type: string; text?: string }[];
    assert.equal(parsed[0].text, "Dear {{1}}");
    assert.equal(parsed.find((part) => part.type === "FOOTER")?.text, "Digital prescription");
    const intermediate = JSON.parse(componentsOf("tpl-intermediate")) as { type: string; text?: string }[];
    assert.equal(intermediate.find((part) => part.type === "FOOTER")?.text, "Digital prescription");

    assert.equal(componentsOf("tpl-3"), labComponents);
    assert.equal(componentsOf("tpl-custom"), customComponents);
    assert.equal(componentsOf("tpl-near"), nearComponents);
    assert.match(componentsOf("tpl-custom"), /Certified Digital Rx/);
  });
});
