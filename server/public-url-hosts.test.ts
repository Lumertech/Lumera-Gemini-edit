import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Seed and test emails may use these domains. Public URL hosts may not. */
const EMAIL_ALLOW = /[A-Za-z0-9._%+-]+@lumera\.(?:health|me)\b/g;

const SCAN_ROOTS = ["src/components", "src/pages", "src/data"];
const SCAN_FILES = [
  "server/clinic-whatsapp-templates.ts",
  "server/clinical.ts",
  "server/fhir.ts",
  "server/db-seed-meta.ts",
  "server/patient-link-token.ts",
  "server/patient-document-links.ts",
  "server/whatsapp-rx-bind.ts",
];

function filesUnder(dir: string): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...filesUnder(path.relative(root, full)));
    } else if (/\.(ts|tsx|html|css)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("public URL hosts", () => {
  it("does not use lumera.health or lumera.me as a host in user-facing URLs", () => {
    const hits: string[] = [];
    const files = [...SCAN_ROOTS.flatMap((dir) => filesUnder(dir)), ...SCAN_FILES.map((file) => path.join(root, file))];
    for (const file of files) {
      const relative = path.relative(root, file);
      if (
        relative.startsWith("server/db-seed") ||
        relative === "src/lib/demoAccounts.ts" ||
        relative === "src/lib/loginFormDefaults.ts" ||
        relative.startsWith("server/demo-")
      ) {
        continue;
      }
      const text = fs.readFileSync(file, "utf8").replace(EMAIL_ALLOW, "");
      if (/lumera\.(?:health|me)\b/i.test(text)) hits.push(relative);
    }
    assert.deepEqual(hits, []);
  });

  it("keeps the client and server patient-link base on the same constant", async () => {
    const { PATIENT_LINK_PUBLIC_BASE_URL: serverBase } = await import("./patient-link-token.ts");
    const { PATIENT_LINK_PUBLIC_BASE_URL: clientBase } = await import("../src/lib/patientLinkPublicBase.ts");
    assert.equal(serverBase, clientBase);
    assert.equal(serverBase, "https://www.mylumera.in");
    const hep = fs.readFileSync(
      path.join(root, "src/components/specialty-rx/PhysioProgressTracker.tsx"),
      "utf8"
    );
    assert.match(hep, /patientLinkPublicBase/);
    assert.equal(hep.includes("${uhid}"), false);
  });
});
