/**
 * NHA sandbox mode contract (#38 / #35 freeze).
 * Default is local stub (zero outbound). sandbox requires real env creds.
 */

import {
  formatAbdmArtefactLabel,
  formatAbdmRegistryLabel,
  onboardingCompleteMessage,
  practiceRegisteredAuditMessage,
  practiceRegisteredWelcomeMessage,
} from "../src/lib/abdmRegistryLabel.ts";

export type AbdmMode = "stub" | "sandbox";

export {
  formatAbdmArtefactLabel,
  formatAbdmRegistryLabel,
  onboardingCompleteMessage,
  practiceRegisteredAuditMessage,
  practiceRegisteredWelcomeMessage,
};

const PLACEHOLDER = /SBX_LUMERA|lumera_abdm_sandbox_sec|replace-with/i;

export function resolveAbdmMode(env: NodeJS.ProcessEnv = process.env): AbdmMode {
  return env.ABDM_MODE === "sandbox" ? "sandbox" : "stub";
}

export function isPlaceholderAbdmSecret(value: string): boolean {
  const trimmed = String(value || "").trim();
  return !trimmed || PLACEHOLDER.test(trimmed);
}

export function abdmHasRealCreds(env: NodeJS.ProcessEnv = process.env): boolean {
  const id = env.ABDM_CLIENT_ID || "";
  const secret = env.ABDM_CLIENT_SECRET || "";
  const url = env.ABDM_GATEWAY_URL || "";
  return !isPlaceholderAbdmSecret(id) && !isPlaceholderAbdmSecret(secret) && Boolean(url.trim());
}

export function getAbdmBridgeStatus(env: NodeJS.ProcessEnv = process.env): {
  abdmMode: AbdmMode;
  bridgeReady: boolean;
} {
  const abdmMode = resolveAbdmMode(env);
  if (abdmMode === "sandbox") {
    return { abdmMode, bridgeReady: abdmHasRealCreds(env) };
  }
  return { abdmMode: "stub", bridgeReady: true };
}

/** Sandbox outbound must not start with placeholder SBX_LUMERA_* defaults. */
export function assertAbdmSandboxCreds(env: NodeJS.ProcessEnv = process.env): void {
  if (resolveAbdmMode(env) === "sandbox" && !abdmHasRealCreds(env)) {
    throw Object.assign(
      new Error(
        "ABDM_MODE=sandbox requires ABDM_CLIENT_ID, ABDM_CLIENT_SECRET, and ABDM_GATEWAY_URL (no placeholder defaults)."
      ),
      { status: 503 }
    );
  }
}

/** Stub, or sandbox without real NHA credentials — locally generated IDs are placeholders. */
export function isAbdmPlaceholderRegistryMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAbdmMode(env) !== "sandbox" || !abdmHasRealCreds(env);
}

export function abdmRegistryPublicFields(
  hfrId?: string | null,
  hprId?: string | null,
  env: NodeJS.ProcessEnv = process.env
): {
  hfrLabel: string;
  hprLabel: string;
  registryIdsPlaceholder: boolean;
  abdmMode: AbdmMode;
} {
  const placeholder = isAbdmPlaceholderRegistryMode(env);
  return {
    hfrLabel: formatAbdmRegistryLabel("HFR", hfrId, placeholder),
    hprLabel: formatAbdmRegistryLabel("HPR", hprId, placeholder),
    registryIdsPlaceholder: placeholder,
    abdmMode: resolveAbdmMode(env),
  };
}
