import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["src", "server", "app/applet/src"];

export type IndiaOnlyViolation = { file: string; line: number; message: string };

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
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

type StringHit = { content: string; index: number; before: string };

/** Static string pieces, skipping comments, template interpolations, and test files. */
function stringLiterals(source: string): StringHit[] {
  const hits: StringHit[] = [];
  let i = 0;
  let codeStart = 0;
  const push = (content: string, index: number) => {
    hits.push({ content, index, before: source.slice(Math.max(0, codeStart), index).slice(-400) });
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      codeStart = i;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      codeStart = i;
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
      codeStart = i;
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
          if (content) push(content, start);
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
      if (content) push(content, start);
      i++;
      codeStart = i;
      continue;
    }
    i++;
  }
  return hits;
}

function dollarDigitAllowed(content: string, match: string, after: string, before: string): boolean {
  if (after.startsWith(".") || after.startsWith(",")) return false;
  if (/\b(SELECT|INSERT|UPDATE|DELETE|WITH|FROM|WHERE|VALUES)\b/i.test(content)) return true;
  if (/\.replace\s*\(/.test(before) && /^\$\d+(?:_\$\d+|=|$|[^0-9.,])/.test(match + after)) return true;
  return false;
}

function localeViolations(source: string, file: string): IndiaOnlyViolation[] {
  const violations: IndiaOnlyViolation[] = [];
  const callRe = /\.toLocale(?:TimeString|DateString|String)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(source))) {
    const open = match.index + match[0].length - 1;
    const args = readArgs(source, open);
    const line = lineOf(source, match.index);
    if (args == null) {
      violations.push({ file, line, message: "toLocale call could not be parsed" });
      continue;
    }
    const first = firstArgument(args).trim();
    if (!/^['"]en-IN['"]$/.test(first)) {
      violations.push({
        file,
        line,
        message: first.includes("en-US")
          ? "toLocale call uses en-US"
          : "toLocale call is missing the en-IN locale",
      });
    }
    if (!/timeZone\s*:\s*['"]Asia\/Kolkata['"]/.test(args)) {
      violations.push({ file, line, message: "toLocale call is missing timeZone Asia/Kolkata" });
    }
  }
  return violations;
}

function readArgs(source: string, openParen: number): string | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (quote === "`" && ch === "$" && source[i + 1] === "{") {
        i += 2;
        let braces = 1;
        while (i < source.length && braces > 0) {
          if (source[i] === "{") braces++;
          else if (source[i] === "}") braces--;
          i++;
        }
        i--;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return null;
}

function firstArgument(args: string): string {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return args.slice(0, i);
  }
  return args;
}

export function findIndiaOnlyViolations(source: string, file = "fixture.ts"): IndiaOnlyViolation[] {
  if (isTestFile(file)) return [];
  const violations: IndiaOnlyViolation[] = [];

  const lucideRe = /import\s+(?:type\s+)?[\s\S]*?\sfrom\s*['"]lucide-react['"]/g;
  let lucide: RegExpExecArray | null;
  while ((lucide = lucideRe.exec(source))) {
    if (/\b(?:\w*Dollar\w*|HandCoins)\b/.test(lucide[0])) {
      violations.push({
        file,
        line: lineOf(source, lucide.index),
        message: "lucide import includes Dollar or HandCoins",
      });
    }
  }

  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const currencyRe = /currency\s*[:=]\s*['"]USD['"]/g;
  let currency: RegExpExecArray | null;
  while ((currency = currencyRe.exec(withoutComments))) {
    violations.push({
      file,
      line: lineOf(source, currency.index),
      message: "currency is USD",
    });
  }

  for (const hit of stringLiterals(source)) {
    if (/\bUSD\b/.test(hit.content)) {
      violations.push({ file, line: lineOf(source, hit.index), message: "string contains USD" });
    }
    const dollarRe = /\$(\d+)/g;
    let dollar: RegExpExecArray | null;
    while ((dollar = dollarRe.exec(hit.content))) {
      const after = hit.content.slice(dollar.index + dollar[0].length);
      if (!dollarDigitAllowed(hit.content, dollar[0], after, hit.before)) {
        violations.push({
          file,
          line: lineOf(source, hit.index),
          message: `string contains ${dollar[0]} outside a template, regex replacement, or SQL placeholder`,
        });
      }
    }
  }

  violations.push(...localeViolations(source, file));
  violations.push(...jsxDollarViolations(source, file));
  return violations;
}

function isSrcUiFile(file: string): boolean {
  return /(^|\/)src\/.+\.(tsx|jsx)$/.test(file.replace(/\\/g, "/"));
}

/** Hide comments and string/template bodies so JSX text can be scanned in place. */
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
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += " ";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += space(source[i]);
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    if (ch === "`") {
      out += " ";
      i++;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
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

function dollarGlyph(content: string): string | null {
  const spaced = content.match(/\$\s+\S+/);
  if (spaced) return spaced[0].trim();
  const digit = content.match(/\$\d+/);
  return digit ? digit[0] : null;
}

/**
 * src JSX only: a literal "$ " or "$<digit>" in text nodes or in
 * label / title / aria-label / placeholder. Template ${...} is ignored.
 */
function jsxDollarViolations(source: string, file: string): IndiaOnlyViolation[] {
  if (!isSrcUiFile(file)) return [];
  const violations: IndiaOnlyViolation[] = [];
  const seen = new Set<string>();
  const push = (index: number, sample: string) => {
    const key = `${lineOf(source, index)}:${sample}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      file,
      line: lineOf(source, index),
      message: `JSX shows ${sample}`,
    });
  };

  for (const hit of stringLiterals(source)) {
    if (!/(?:label|title|placeholder|aria-label)\s*=\s*(?:\{\s*)?$/.test(hit.before.trimEnd())) continue;
    const sample = dollarGlyph(hit.content);
    if (sample) push(hit.index, sample);
  }

  const masked = maskNonJsxText(source);
  const textRe = />([^<>{}]*)</g;
  let text: RegExpExecArray | null;
  while ((text = textRe.exec(masked))) {
    const sample = dollarGlyph(text[1]);
    if (sample) push(text.index + 1, sample);
  }
  return violations;
}

function scanRepository(): IndiaOnlyViolation[] {
  const files: string[] = [];
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel), files);
  const violations: IndiaOnlyViolation[] = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    violations.push(...findIndiaOnlyViolations(source, rel));
  }
  return violations;
}

describe("India-only currency and locale scan", () => {
  it("flags dollar icons, USD, dollar amounts, and non-India date locales", () => {
    const dollarIcon = findIndiaOnlyViolations(`import { DollarSign, Wallet } from "lucide-react";\n`);
    assert.equal(dollarIcon.length, 1);
    const handCoins = findIndiaOnlyViolations(`import {\n  HandCoins,\n} from 'lucide-react';\n`);
    assert.equal(handCoins.length, 1);
    const usd = findIndiaOnlyViolations(`const row = { currency: "USD", note: "USD $0.03" };\n`);
    assert.ok(usd.some((item) => item.message.includes("USD")));
    assert.ok(usd.some((item) => item.message.includes("$0")));
    const bare = findIndiaOnlyViolations(`const label = "Fee is $5 today";\n`);
    assert.equal(bare.length, 1);
    const missingLocale = findIndiaOnlyViolations(`new Date().toLocaleTimeString();\n`);
    assert.ok(missingLocale.some((item) => item.message.includes("en-IN")));
    const usLocale = findIndiaOnlyViolations(
      `new Date().toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });\n`
    );
    assert.ok(usLocale.some((item) => item.message.includes("en-US")));
    const emptyLocale = findIndiaOnlyViolations(
      `new Date().toLocaleTimeString([], { hour: "2-digit" });\n`
    );
    assert.ok(emptyLocale.some((item) => item.message.includes("en-IN")));
  });

  it("allows template interpolation, regex replacements, and SQL placeholders", () => {
    const allowed = `
      const fee = \`₹\${amount}\`;
      text.replace(/([a-z])([A-Z])/g, "$1_$2");
      text.replace(/token/gi, "$1=[redacted]");
      db.query("SELECT id FROM sessions WHERE user_id = $1 AND expires_at > $2");
      new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric" });
    `;
    assert.deepEqual(findIndiaOnlyViolations(allowed), []);
  });

  it("flags CircleDollarSign imports and a dollar glyph in JSX text or string props", () => {
    const icon = findIndiaOnlyViolations(
      `import { CircleDollarSign } from "lucide-react";\n`,
      "src/components/Pay.tsx"
    );
    assert.equal(icon.length, 1);
    assert.match(icon[0].message, /Dollar/);

    const text = findIndiaOnlyViolations(
      `export function Pay(){ return <p>$ Paid (verified server status)</p>; }\n`,
      "src/components/Pay.tsx"
    );
    assert.equal(text.length, 1);
    assert.match(text[0].message, /\$ Paid/);

    const props = findIndiaOnlyViolations(
      `export function Pay(){ return <input aria-label="$ 20 due" placeholder="$5" title="ok" />; }\n`,
      "src/components/Pay.tsx"
    );
    assert.ok(props.some((item) => item.message.includes("$ 20")));
    assert.ok(props.some((item) => item.message.includes("$5")));
  });

  it("ignores template interpolation and non-UI dollar text", () => {
    const serverNote = findIndiaOnlyViolations(
      `const note = "$ Paid in a log";\nconst fee = \`₹\${amount}\`;\n`,
      "server/notes.ts"
    );
    assert.deepEqual(serverNote, []);

    const nonUiInComponent = findIndiaOnlyViolations(
      `const note = "$ Paid internally";\nexport function Pay(){ return <span>{\`₹\${amount}\`}</span>; }\n`,
      "src/components/Pay.tsx"
    );
    assert.deepEqual(nonUiInComponent, []);
  });

  it("scans src, server, and app/applet/src", () => {
    const violations = scanRepository();
    assert.deepEqual(
      violations,
      [],
      violations.map((item) => `${item.file}:${item.line} ${item.message}`).join("\n")
    );
  });
});
