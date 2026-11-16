/**
 * Write dist/build.json during docker build.
 * COMMIT_SHA is a 40-char hex git sha, or "unknown" for a local image.
 * Cloud Run still listens if LUMERA_COMMIT_SHA is unset; deploy checks /build.json.
 */
import fs from "node:fs";

const sha = String(process.argv[2] || "").trim();
const out = String(process.argv[3] || "").trim();

if (!out) {
  console.error("usage: node scripts/stamp-build-json.mjs <sha> <outfile>");
  process.exit(2);
}
if (sha !== "unknown" && !/^[0-9a-f]{40}$/.test(sha)) {
  console.error("COMMIT_SHA must be 40 lowercase hex or unknown");
  process.exit(1);
}

fs.mkdirSync(out.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ commit: sha })}\n`);
