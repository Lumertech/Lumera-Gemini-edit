import path from "node:path";
import { scanBuiltBundle } from "./banned-user-copy.ts";

const dist = path.join(process.cwd(), "dist");
const hits = scanBuiltBundle(dist);
if (!hits.length) {
  console.log("built bundle copy scan passed");
  process.exit(0);
}
console.error(
  hits.map((hit) => `${path.relative(process.cwd(), hit.file)}:${hit.line} ${hit.label}`).join("\n")
);
process.exit(1);
