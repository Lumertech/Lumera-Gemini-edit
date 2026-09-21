import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Absolute file URL safe to pass to `createRequire` or `fileURLToPath`.
 *
 * Production `npm start` runs esbuild `--format=cjs` (`dist/server.cjs`).
 * That format emits `var import_meta = {}` and leaves `import.meta.url`
 * undefined (`empty-import-meta`). `createRequire(undefined)` then throws
 * `ERR_INVALID_ARG_VALUE` (`filename` Received undefined) while the bundle
 * is still evaluating — before listen and before BOOT FATAL.
 *
 * When the URL is missing, anchor on the running script (`process.argv[1]`,
 * which is `dist/server.cjs` in Cloud Run) or `package.json` in `process.cwd()`.
 */
export function moduleAnchorUrl(
  metaUrl: string | undefined,
  opts: { cwd?: string; argv1?: string | null } = {}
): string {
  if (typeof metaUrl === "string" && metaUrl.length > 0) return metaUrl;
  const cwd = opts.cwd ?? process.cwd();
  const argv1 = "argv1" in opts ? opts.argv1 : process.argv[1];
  if (typeof argv1 === "string" && argv1.length > 0) {
    const abs = path.isAbsolute(argv1) ? argv1 : path.resolve(cwd, argv1);
    return pathToFileURL(abs).href;
  }
  return pathToFileURL(path.join(cwd, "package.json")).href;
}
