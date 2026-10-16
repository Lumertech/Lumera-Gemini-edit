import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { rewriteLegacyHonestyCopy } from "./db-migrate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type HonestyViolation = { file: string; line: number; message: string };

const PHRASES: { re: RegExp; label: string }[] = [
  { re: /digitally verified under/i, label: "digitally verified under" },
  { re: /Certified Digital Rx/, label: "Certified Digital Rx" },
  { re: /\bgemini\b/i, label: "Gemini" },
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

function isUserFacingString(lookback: string): boolean {
  const tail = lookback.trimEnd();
  if (/console\.(?:error|warn|log|info|debug)\s*\(\s*$/.test(tail)) return false;
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
  if (/footerDisclaimer\s*:\s*$/.test(tail)) return true;
  if (/type:\s*["']FOOTER["']\s*,\s*text:\s*$/.test(tail)) return true;
  return false;
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
    if (labels.length === 0) continue;
    const before = lookback(source, hit.index);
    if (allowListed(hit.content, before)) continue;
    const footer = isFooterDefault(before);
    const response = isResponseLabel(before);
    const facing = ui && isUserFacingString(before);
    if (footer || response || facing) push(hit.index, labels);
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
    assert.equal(jsx.length, 1);
    assert.match(jsx[0].message, /digitally verified under/);

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
    assert.deepEqual(prompt, []);

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
});

describe("legacy honesty copy migration", () => {
  it("rewrites seeded overclaims and leaves custom tenant text", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY, footer_disclaimer TEXT DEFAULT '');
      CREATE TABLE meta_templates (id TEXT PRIMARY KEY, components TEXT NOT NULL DEFAULT '[]');
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
    const customComponents = JSON.stringify([{ type: "FOOTER", text: "Lumera Central Diagnostics" }]);
    const insertTpl = db.prepare("INSERT INTO meta_templates (id, components) VALUES (?, ?)");
    insertTpl.run("tpl-2", oldComponents);
    insertTpl.run("tpl-3", customComponents);

    rewriteLegacyHonestyCopy(db);
    rewriteLegacyHonestyCopy(db);

    const footer = (id: string) =>
      (db.prepare("SELECT footer_disclaimer AS v FROM tenants WHERE id = ?").get(id) as { v: string }).v;
    assert.equal(footer("exact"), NEW_FOOTER);
    assert.equal(footer("contains"), NEW_FOOTER);
    assert.equal(footer("custom"), "Digitally signed Rx — Meera Heart Clinic");
    assert.equal(footer("empty"), "");
    assert.equal(footer("already"), NEW_FOOTER);

    const tpl2 = (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-2") as { v: string }).v;
    const tpl3 = (db.prepare("SELECT components AS v FROM meta_templates WHERE id = ?").get("tpl-3") as { v: string }).v;
    assert.equal(tpl2.includes("Certified Digital Rx"), false);
    assert.match(tpl2, /Lumera Health EMR System • Digital Rx/);
    assert.match(tpl3, /Lumera Central Diagnostics/);
    const parsed = JSON.parse(tpl2) as { type: string; text?: string }[];
    assert.equal(parsed[0].text, "Dear {{1}}");
  });
});
