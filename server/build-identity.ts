/**
 * Deploy truth: the image records the git commit it was built from, and
 * Cloud Run refuses to listen when that stamp does not match LUMERA_COMMIT_SHA.
 * An AI Studio / `--source` image that omits the build-arg therefore stays
 * unhealthy and cannot take traffic off the last good revision.
 */
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

export const LUMERA_COMMIT_HEADER = "X-Lumera-Commit";
export const BUILD_JSON_NAME = "build.json";

export const COMMIT_STAMP_MISMATCH_MESSAGE =
  "LUMERA_COMMIT_SHA does not match dist/build.json. Refusing to listen so an image that was not built from this commit cannot take traffic. This process exits before listen(0.0.0.0, PORT); Cloud Run will report a PORT timeout even though bind is not the bug, and the previous healthy revision keeps serving.";

export function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

export function readStampedCommit(cwd = process.cwd()): string {
  const candidates = [path.join(cwd, "dist", BUILD_JSON_NAME), path.join(cwd, BUILD_JSON_NAME)];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { commit?: unknown };
      const commit = String(parsed.commit ?? "").trim();
      if (commit) return commit;
    } catch {
      /* try the next location */
    }
  }
  return "unknown";
}

/**
 * Cloud Run sets K_SERVICE. Anywhere else (tests, laptops) a missing stamp
 * must not block boot. On Cloud Run the baked file and the deploy env have
 * to be the same 40-char sha.
 */
export function assertCloudRunCommitStamp(env: NodeJS.ProcessEnv, stamped?: string): void {
  if (!String(env.K_SERVICE || "").trim()) return;
  const onDisk = stamped ?? readStampedCommit();
  const claimed = String(env.LUMERA_COMMIT_SHA || "").trim();
  if (!isFullCommitSha(onDisk) || onDisk !== claimed) {
    throw new Error(
      `${COMMIT_STAMP_MISMATCH_MESSAGE} stamped=${onDisk || "(empty)"} claimed=${claimed || "(empty)"}`
    );
  }
}

export function lumeraCommitHeaderMiddleware(commit: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(LUMERA_COMMIT_HEADER, commit);
    next();
  };
}
