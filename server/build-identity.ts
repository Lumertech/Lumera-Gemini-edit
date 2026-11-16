/**
 * Deploy truth: the image records the git commit it was built from.
 * A missing or different LUMERA_COMMIT_SHA is a loud log line only. The process
 * keeps listening so a founder publish (AI Studio / --source) cannot crash-loop
 * Cloud Run. Traffic enforcement is the deploy check of /build.json.
 */
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

export const LUMERA_COMMIT_HEADER = "X-Lumera-Commit";
export const BUILD_JSON_NAME = "build.json";

export const COMMIT_STAMP_MISSING_MESSAGE =
  "[Lumera] BOOT WARNING: LUMERA_COMMIT_SHA is missing. Listening anyway so a founder publish cannot crash-loop Cloud Run. Traffic enforcement is the deploy check of /build.json, not this process.";

export const COMMIT_STAMP_MISMATCH_MESSAGE =
  "[Lumera] BOOT WARNING: LUMERA_COMMIT_SHA does not match dist/build.json. Listening anyway so a founder publish cannot crash-loop Cloud Run. Traffic enforcement is the deploy check of /build.json, not this process.";

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
 * Cloud Run sets K_SERVICE. Anywhere else (tests, laptops) this is a no-op.
 * On Cloud Run a missing LUMERA_COMMIT_SHA, or one that differs from
 * dist/build.json, is logged and ignored. The deploy step is what fails
 * the GitHub check when /build.json is not this commit.
 */
export function assertCloudRunCommitStamp(
  env: NodeJS.ProcessEnv,
  stamped?: string,
  warn: (message: string) => void = (message) => {
    console.error(message);
  }
): void {
  if (!String(env.K_SERVICE || "").trim()) return;
  const onDisk = stamped ?? readStampedCommit();
  const claimed = String(env.LUMERA_COMMIT_SHA || "").trim();
  if (!claimed) {
    warn(`${COMMIT_STAMP_MISSING_MESSAGE} stamped=${onDisk || "(empty)"}`);
    return;
  }
  if (!isFullCommitSha(onDisk) || onDisk !== claimed) {
    warn(`${COMMIT_STAMP_MISMATCH_MESSAGE} stamped=${onDisk || "(empty)"} claimed=${claimed}`);
  }
}

export function lumeraCommitHeaderMiddleware(commit: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(LUMERA_COMMIT_HEADER, commit);
    next();
  };
}
