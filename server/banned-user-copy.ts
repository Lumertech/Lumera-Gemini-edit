import fs from "node:fs";
import path from "node:path";

/** Retired product labels. Split so this file is not itself a user-facing hit. */
const ABDM_ALIGNED = "ABDM-" + "aligned";
const NHA_SANDBOX = "NHA " + "sandbox";

/** User-visible source and the built bundle must not ship these. */
export const RETIRED_USER_COPY: { re: RegExp; label: string }[] = [
  { re: new RegExp(ABDM_ALIGNED, "i"), label: ABDM_ALIGNED },
  { re: new RegExp(NHA_SANDBOX, "i"), label: NHA_SANDBOX },
];

export function retiredUserCopyLabels(content: string): string[] {
  return RETIRED_USER_COPY.filter((phrase) => phrase.re.test(content)).map((phrase) => phrase.label);
}

const BUNDLE_EXT = new Set([".js", ".mjs", ".cjs", ".html", ".css"]);

export type BundleCopyHit = { file: string; line: number; label: string };

/** Scan emitted JS, HTML, and CSS. Sourcemaps are skipped; they keep comments. */
export function scanBuiltBundle(distDir: string): BundleCopyHit[] {
  if (!fs.existsSync(distDir)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!BUNDLE_EXT.has(path.extname(entry.name))) continue;
      files.push(full);
    }
  };
  walk(distDir);
  const hits: BundleCopyHit[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const label of retiredUserCopyLabels(line)) {
        hits.push({ file, line: index + 1, label });
      }
    });
  }
  return hits;
}
