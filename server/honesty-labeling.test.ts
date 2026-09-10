import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const WAVE0_FILES = [
  "src/components/LandingPage.tsx",
  "src/components/admin/AdminMetaTechProvider.tsx",
  "src/components/admin/AdminShell.tsx",
];

/** Theatre phrases removed by #12 / PR #18. Must not return on rebase. */
const THEATRE = [
  /ABDM M1,\s*M2,\s*M3 Certified/i,
  /Official Meta WhatsApp Tech Provider/i,
  /official Meta Tech Provider/i,
  /HIPAA Grade/i,
  /HIPAA-grade/i,
  /Certified for ABDM/i,
  /Certified compliant with NHA/i,
  /government-certified/i,
  /Official Tech Provider/i,
  /All Endpoints Verified Live/i,
  /Meta Tech Provider Verified/i,
];

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Compliance #18 honesty labeling (LandingPage / Admin Meta)", () => {
  it("Wave 0 files keep #18 sandbox / path copy and do not reintroduce theatre", () => {
    const landing = readRepo("src/components/LandingPage.tsx");
    assert.match(landing, /ABDM M1–M3 · NHA sandbox path/);
    assert.match(landing, /ABDM sandbox milestone path/);
    assert.match(landing, /Built for DPDP Act 2023/);
    assert.match(landing, /Jan Aushadhi planned/);
    assert.match(landing, /WhatsApp Cloud API · Meta Tech Provider path/);
    assert.match(landing, /building toward Meta Tech Provider/i);
    assert.match(landing, /Designed for ABDM M1–M3/);
    assert.match(landing, /App Review is not submitted/);
    assert.equal(/HIPAA/i.test(landing), false);

    const adminMeta = readRepo("src/components/admin/AdminMetaTechProvider.tsx");
    assert.match(adminMeta, /SANDBOX/);
    assert.equal(/Official Tech Provider/i.test(adminMeta), false);
    assert.equal(/All Endpoints Verified Live/i.test(adminMeta), false);

    const adminShell = readRepo("src/components/admin/AdminShell.tsx");
    assert.match(adminShell, /SANDBOX|Simulator/);
  });

  it("grep gate: no certified / official Meta / HIPAA / live Jan Aushadhi on Wave 0 files", () => {
    const gate = /certified|official meta|hipaa|jan aushadhi/i;
    for (const rel of WAVE0_FILES) {
      const src = readRepo(rel);
      const leftover = src
        .split(/\n/)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => gate.test(line) && !/Jan Aushadhi planned/i.test(line));
      assert.deepEqual(
        leftover,
        [],
        `${rel} failed #18 grep gate:\n${leftover.map((r) => `  L${r.n}: ${r.line.trim()}`).join("\n")}`
      );
    }
  });

  it("does not reintroduce pre-#12 theatre phrases in landing/admin/policy surfaces", () => {
    const surfaces = [
      ...WAVE0_FILES,
      "src/pages/PolicyPage.tsx",
    ];
    for (const rel of surfaces) {
      const src = readRepo(rel);
      for (const pattern of THEATRE) {
        assert.equal(pattern.test(src), false, `${rel} reintroduced theatre: ${pattern}`);
      }
    }
  });
});
