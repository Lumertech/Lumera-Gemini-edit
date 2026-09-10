import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { buildAbdmStatusPayload, createAbdmRouter } from "./abdm.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const WAVE0_FILES = [
  "src/components/LandingPage.tsx",
  "src/components/admin/AdminMetaTechProvider.tsx",
  "src/components/admin/AdminShell.tsx",
];

/** Pre-#18 overclaims CoS listed as Compliance BLOCK. Must not return on LandingPage. */
const THEATRE = [
  /ABDM M1,\s*M2,\s*M3 Certified/i,
  /ABDM certified/i,
  /Official Meta WhatsApp Tech Provider/i,
  /official Meta Tech Provider/i,
  /official Meta WhatsApp Business API/i,
  /official Meta API/i,
  /HIPAA Grade/i,
  /HIPAA-grade/i,
  /\bHIPAA\b/i,
  /Certified for ABDM/i,
  /Certified compliant with NHA/i,
  /government-certified/i,
  /Official Tech Provider/i,
  /All Endpoints Verified Live/i,
  /Meta Tech Provider Verified/i,
  /Jan Aushadhi finder/i,
];

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Compliance #18 honesty labeling (LandingPage / Admin Meta)", () => {
  it("LandingPage keeps #18 sandbox copy and has none of the CoS overclaims", () => {
    const landing = readRepo("src/components/LandingPage.tsx");
    assert.match(landing, /ABDM M1–M3 · NHA sandbox path/);
    assert.match(landing, /ABDM sandbox milestone path/);
    assert.match(landing, /Built for DPDP Act 2023/);
    assert.match(landing, /WhatsApp Cloud API · Meta Tech Provider path/);
    assert.match(landing, /building toward Meta Tech Provider/i);
    assert.match(landing, /Designed for ABDM M1–M3/);
    assert.match(landing, /App Review is not submitted/);
    assert.match(landing, /ABDM-aligned records \(sandbox path\)/);

    assert.equal(/ABDM certified/i.test(landing), false);
    assert.equal(/HIPAA/i.test(landing), false);
    assert.equal(/official Meta API/i.test(landing), false);
    assert.equal(/official Meta WhatsApp/i.test(landing), false);
    assert.equal(/Official Tech Provider/i.test(landing), false);
    assert.equal(/certified Tech Provider/i.test(landing), false);
    const janLines = landing.split(/\n/).filter((line) => /jan aushadhi/i.test(line));
    assert.equal(janLines.length, 1);
    assert.match(janLines[0], /Jan Aushadhi planned/);
    assert.equal(/Jan Aushadhi finder/i.test(landing), false);

    const adminMeta = readRepo("src/components/admin/AdminMetaTechProvider.tsx");
    assert.match(adminMeta, /SANDBOX/);
    assert.equal(/Official Tech Provider/i.test(adminMeta), false);
    assert.equal(/All Endpoints Verified Live/i.test(adminMeta), false);

    const adminShell = readRepo("src/components/admin/AdminShell.tsx");
    assert.match(adminShell, /SANDBOX|Simulator/);
  });

  it("cms policy seed has WhatsApp STOP opt-out and stays sandbox-honest", () => {
    const db = readRepo("server/db.ts");
    assert.match(db, /replying \*\*STOP\*\*/);
    assert.match(db, /not a certified Meta Tech Provider/i);
    assert.match(db, /App Review is not submitted/);
    assert.equal(/\bHIPAA\b/i.test(db), false);
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

/** Compliance #44 — same-line honesty markers that exempt a banned phrase. */
const HONESTY_LABEL = /NHA sandbox|local stub|sandbox-unverified/i;

const ISSUE44_BANNED: Array<{ id: string; re: RegExp }> = [
  {
    id: "ABDM Ready|Compliant|Validated|Government Verified",
    re: /ABDM\s+Ready|ABDM[- ]Compliant|\bAudit Compliant\b|ABDM\s+Validated|Compliant with ABDM|Government Verified/i,
  },
  {
    id: "Certified Transactions|COMPLIANT_V3|AUDIT_READY_PASSING",
    re: /Certified Transactions|COMPLIANT_V3|AUDIT_READY_PASSING/i,
  },
  {
    id: "CONNECTED (marketing status)",
    // Caps status token only — Meta WABA "connected" is not ABDM theatre.
    re: /abdmGateway\s*[:=]\s*["']CONNECTED["']|"CONNECTED"/,
  },
  {
    id: "ABDM certified|M1–M3 certified/complete/live|HIPAA|Jan Aushadhi finder",
    re: /ABDM certified|M1.?M3.*(certified|complete|live)|\bHIPAA\b|Jan Aushadhi finder/i,
  },
];

export function bannedHitsOnLine(line: string): string[] {
  if (HONESTY_LABEL.test(line)) return [];
  return ISSUE44_BANNED.filter((rule) => rule.re.test(line)).map((rule) => rule.id);
}

function walkSourceFiles(relDir: string): string[] {
  const abs = path.join(root, relDir);
  const out: string[] = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) out.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

function leftoverBanned(rel: string): Array<{ n: number; line: string; rules: string[] }> {
  return readRepo(rel)
    .split(/\n/)
    .map((line, i) => ({ n: i + 1, line, rules: bannedHitsOnLine(line) }))
    .filter((row) => row.rules.length > 0);
}

const ISSUE44_SURFACES = [
  ...walkSourceFiles("src/components"),
  ...walkSourceFiles("src/pages"),
  "server/abdm.ts",
  "server/db.ts",
];

describe("Compliance #44 honesty gate (clinician / admin / DHIS / CMS / ABDM status)", () => {
  it("fails banned theatre phrases unless the same line has an honesty label", () => {
    const theatre = [
      "ABDM Ready",
      "ABDM Compliant QR",
      "Audit Compliant",
      "ABDM Validated",
      "Government Verified ABHA",
      "Certified Transactions Logged",
      'sandboxAuditStatus: "COMPLIANT_V3"',
      'sandboxStatus: "AUDIT_READY_PASSING"',
      'abdmGateway: "CONNECTED"',
      "ABDM certified",
      "M1–M3 certified",
      "M1-M3 complete",
      "ABDM M1–M3 live HIP-HIU",
      "HIPAA Grade",
      "Jan Aushadhi finder",
    ];
    for (const sample of theatre) {
      assert.ok(
        bannedHitsOnLine(sample).length > 0,
        `detector missed banned phrase: ${sample}`
      );
    }

    const labeled = [
      "ABDM Ready · NHA sandbox",
      "Compliant chip removed — local stub",
      "Validated only as NHA sandbox",
      "Government Verified — sandbox-unverified",
      "Certified Transactions (local stub)",
      'abdmGateway: "CONNECTED" // NHA sandbox stand-in',
      "Jan Aushadhi planned",
      "ABDM M1–M3 · NHA sandbox path",
    ];
    for (const sample of labeled) {
      assert.deepEqual(bannedHitsOnLine(sample), [], `honesty label should exempt: ${sample}`);
    }
  });

  it("grep gate covers clinician, admin, pages, abdm.ts, and db.ts CMS/DHIS seed", () => {
    assert.ok(ISSUE44_SURFACES.some((f) => f.startsWith("src/components/")), "components/** missing");
    assert.ok(ISSUE44_SURFACES.some((f) => f.startsWith("src/pages/")), "pages/** missing");
    assert.ok(ISSUE44_SURFACES.includes("src/components/dhis/DhisMeter.tsx"));
    assert.ok(ISSUE44_SURFACES.includes("src/components/PrescriptionWriter.tsx"));
    assert.ok(ISSUE44_SURFACES.includes("src/pages/LoginPage.tsx"));
    assert.ok(ISSUE44_SURFACES.includes("src/pages/PolicyPage.tsx"));
    assert.ok(ISSUE44_SURFACES.includes("server/abdm.ts"));
    assert.ok(ISSUE44_SURFACES.includes("server/db.ts"));

    const leftovers: string[] = [];
    for (const rel of ISSUE44_SURFACES) {
      const hits = leftoverBanned(rel);
      for (const hit of hits) {
        leftovers.push(`${rel}:${hit.n} [${hit.rules.join("; ")}] ${hit.line.trim()}`);
      }
    }
    assert.deepEqual(leftovers, [], leftovers.join("\n"));
  });

  it("GET /api/abdm/status exposes only abdmMode + bridgeReady", async () => {
    const payload = buildAbdmStatusPayload();
    assert.equal(payload.abdmMode, "stub");
    assert.equal(payload.bridgeReady, true);
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["abdmMode", "bridgeReady"]);

    const serialized = JSON.stringify(payload);
    assert.equal(/COMPLIANT_V3/i.test(serialized), false);
    assert.equal(/AUDIT_READY_PASSING/i.test(serialized), false);
    assert.equal(/abdmGateway/.test(serialized), false);
    assert.equal(/"CONNECTED"/.test(serialized), false);
    assert.equal(/sandboxAuditStatus/.test(serialized), false);

    const app = express();
    app.use("/abdm", createAbdmRouter());
    app.use("/v3", createAbdmRouter());
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;

      for (const urlPath of ["/abdm/status", "/v3/status"]) {
        const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
        assert.equal(res.status, 200);
        const json = (await res.json()) as Record<string, unknown>;
        assert.equal(json.abdmMode, "stub");
        assert.equal(json.bridgeReady, true);
        assert.equal(json.sandboxAuditStatus, undefined);
        assert.equal(json.abdmGateway, undefined);
        assert.equal(json.notice, undefined);
        assert.deepEqual(Object.keys(json).sort(), ["abdmMode", "bridgeReady"]);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("DHIS chrome and CMS seed do not claim PFMS or ABDM Compliant", () => {
    const dhis = readRepo("src/components/dhis/DhisMeter.tsx");
    assert.equal(/PFMS/i.test(dhis), false);
    assert.equal(/Certified Transactions/i.test(dhis), false);
    assert.match(dhis, /NHA sandbox/);

    const db = readRepo("server/db.ts");
    assert.equal(/ABDM Compliant/i.test(db), false);
    assert.match(db, /ABDM-aligned \(NHA sandbox\)/);
  });
});
