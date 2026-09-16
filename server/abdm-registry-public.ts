/**
 * JSON-edge labels for locally generated ABDM HFR/HPR IDs.
 *
 * GitHub MCP cannot safely replace ~100KB server/api.ts or server/db.ts
 * (full-file pushes truncate). Keep those files at main and annotate
 * register-practice / OTP-verify / publicUser-shaped JSON here.
 *
 * Copy only — raw ID values are unchanged. Honesty: ravee@lumer.me.
 * No ABDM Compliant / HIPAA / Official TP claims.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import {
  abdmRegistryPublicFields,
  isAbdmPlaceholderRegistryMode,
  onboardingCompleteMessage,
  practiceRegisteredWelcomeMessage,
} from "./abdm-mode.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function annotateAbdmRegistryJson(body: unknown): unknown {
  if (!isPlainObject(body)) return body;

  const placeholder = isAbdmPlaceholderRegistryMode();
  const hfrId = typeof body.hfrId === "string" ? body.hfrId : "";
  const hprId = typeof body.hprId === "string" ? body.hprId : "";
  if (hfrId || hprId) {
    Object.assign(body, abdmRegistryPublicFields(hfrId, hprId));
  }

  if (isPlainObject(body.user)) {
    const userHfr = typeof body.user.hfrId === "string" ? body.user.hfrId : "";
    const userHpr = typeof body.user.hprId === "string" ? body.user.hprId : "";
    Object.assign(body.user, abdmRegistryPublicFields(userHfr, userHpr));
  }

  if (typeof body.message === "string") {
    const activated = body.message.match(
      /^Welcome to Lumera! (.+) has been activated with 500 AI Scribe minutes and 100 monthly DHIS transactions\.\$/
    );
    if (activated) {
      body.message = practiceRegisteredWelcomeMessage(activated[1], placeholder);
    } else if (body.message === "Clinical profile verified & practice suite activated successfully.") {
      body.message = onboardingCompleteMessage(placeholder);
    }
  }

  return body;
}

export function attachAbdmRegistryPublicJson(_req: Request, res: Response, next: NextFunction): void {
  const orig = res.json.bind(res);
  res.json = ((payload?: unknown) => orig(annotateAbdmRegistryJson(payload))) as typeof res.json;
  next();
}

/** Wrap createApiRouter() so tests and server.ts pick up labels without patching api.ts. */
export function wrapAbdmRegistryJson(router: Router): Router {
  const outer = createRouter();
  outer.use(attachAbdmRegistryPublicJson);
  outer.use(router);
  return outer;
}
