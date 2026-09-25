import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { attachUser } from "./auth.ts";
import { createApiRouter } from "./api.ts";
import { wrapAbdmRegistryJson } from "./abdm-registry-public.ts";
import { getDb, initDatabase } from "./db.ts";
import {
  abdmHasRealCreds,
  isAbdmPlaceholderRegistryMode,
  resolveAbdmMode,
} from "./abdm-mode.ts";
import {
  ABDM_REGISTRY_PENDING_NOTE,
  CONFIRMED_ABDM_REGISTRY_CLAIM,
} from "../src/lib/abdmRegistryLabel.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function lineCount(rel: string): number {
  return readRepo(rel).split(/\n/).length;
}

async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function assertNoConfirmedRegistryClaim(text: string, label: string) {
  assert.equal(
    CONFIRMED_ABDM_REGISTRY_CLAIM.test(text),
    false,
    `${label} claimed a confirmed NHA registry ID: ${text}`
  );
  assert.equal(/ABDM Compliant/i.test(text), false, `${label} used ABDM Compliant`);
}

const ENV_KEYS = ["ABDM_MODE", "ABDM_CLIENT_ID", "ABDM_CLIENT_SECRET", "ABDM_GATEWAY_URL"] as const;

describe("ABDM placeholder-ID copy (registration + surfaces)", () => {
  let port = 0;
  let server: Server | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-abdm-placeholder-copy";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const app = express();
    app.use(express.json());
    app.use(attachUser);
    // Labels live at the JSON edge: MCP cannot safely replace 100KB api.ts/db.ts.
    app.use("/api", wrapAbdmRegistryJson(createApiRouter()));

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
    port = addr.port;
  });

  after(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("treats stub and sandbox-without-credentials as placeholder registry mode", () => {
    assert.equal(isAbdmPlaceholderRegistryMode({}), true);
    assert.equal(isAbdmPlaceholderRegistryMode({ ABDM_MODE: "stub" }), true);
    assert.equal(
      isAbdmPlaceholderRegistryMode({
        ABDM_MODE: "sandbox",
        ABDM_CLIENT_ID: "SBX_LUMERA_HEALTH_2026",
        ABDM_CLIENT_SECRET: "lumera_abdm_sandbox_sec",
        ABDM_GATEWAY_URL: "https://sandbox.abdm.gov.in/api/v3",
      }),
      true
    );
    const credentialed = {
      ABDM_MODE: "sandbox",
      ABDM_CLIENT_ID: "live-client-not-placeholder",
      ABDM_CLIENT_SECRET: "live-secret-not-placeholder",
      ABDM_GATEWAY_URL: "https://sandbox.abdm.gov.in/api/v3",
    };
    assert.equal(resolveAbdmMode(credentialed), "sandbox");
    assert.equal(abdmHasRealCreds(credentialed), true);
    assert.equal(isAbdmPlaceholderRegistryMode(credentialed), false);
  });

  it("stub register-practice never presents IN-HFR/IN-HPR as confirmed NHA IDs", async () => {
    delete process.env.ABDM_MODE;
    delete process.env.ABDM_CLIENT_ID;
    delete process.env.ABDM_CLIENT_SECRET;
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `stub.hfr.${stamp}@abdm-copy-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "Pending Registry Clinic",
      specialty: "General Medicine",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 97000 ${stamp.slice(0, 5)}`,
      name: "Asha Pending",
      email,
      password: "Lumera@2026",
    });
    assert.equal(res.status, 200, String(res.json.error || "register failed"));
    const hfrId = String(res.json.hfrId || "");
    const hprId = String(res.json.hprId || "");
    assert.match(hfrId, /^IN-HFR-\d+$/);
    assert.match(hprId, /^IN-HPR-\d+$/);
    assert.equal(res.json.registryIdsPlaceholder, true);
    assert.equal(res.json.abdmMode, "stub");
    const hfrLabel = String(res.json.hfrLabel || "");
    const hprLabel = String(res.json.hprLabel || "");
    assert.equal(hfrLabel, `HFR: ${hfrId} (${ABDM_REGISTRY_PENDING_NOTE})`);
    assert.equal(hprLabel, `HPR: ${hprId} (${ABDM_REGISTRY_PENDING_NOTE})`);
    const serialized = JSON.stringify(res.json);
    assert.match(serialized, /pending — not yet verified with the National Health Authority/);
    assertNoConfirmedRegistryClaim(serialized, "register-practice stub JSON");
    assert.equal(/has been activated/.test(serialized), false);

    const demoOtp = String(res.json.demoOtp || "");
    const verificationId = String(res.json.verificationId || "");
    assert.ok(demoOtp && verificationId, "expected SANDBOX OTP echo");
    const verify = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId,
      otp: demoOtp,
    });
    assert.equal(verify.status, 200, String(verify.json.error || "verify failed"));
    const welcome = String(verify.json.message || "");
    assert.match(welcome, /local placeholders/);
    assert.match(welcome, /pending — not yet verified with the National Health Authority/);
    assert.equal(/has been activated/.test(welcome), false);
    assertNoConfirmedRegistryClaim(welcome, "OTP verify stub welcome");
    const user = (verify.json.user || {}) as Record<string, unknown>;
    assert.equal(user.registryIdsPlaceholder, true);
    assert.match(String(user.hfrLabel || ""), /pending — not yet verified with the National Health Authority/);
  });

  it("credentialed sandbox registration keeps activated framing and omits pending labels", async () => {
    process.env.ABDM_MODE = "sandbox";
    process.env.ABDM_CLIENT_ID = "live-client-not-placeholder";
    process.env.ABDM_CLIENT_SECRET = "live-secret-not-placeholder";
    process.env.ABDM_GATEWAY_URL = "https://sandbox.abdm.gov.in/api/v3";
    assert.equal(isAbdmPlaceholderRegistryMode(), false);

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `live.hfr.${stamp}@abdm-copy-test.example`;
    const res = await jsonRequest(port, "POST", "/api/auth/register-practice", {
      clinicName: "Activated Registry Clinic",
      specialty: "General Medicine",
      country: "India",
      timezone: "IST (UTC+5:30)",
      phone: `+91 97100 ${stamp.slice(0, 5)}`,
      name: "Ravi Activated",
      email,
      password: "Lumera@2026",
    });
    assert.equal(res.status, 200, String(res.json.error || "register failed"));
    assert.equal(res.json.registryIdsPlaceholder, false);
    assert.equal(res.json.abdmMode, "sandbox");
    const hfrId = String(res.json.hfrId || "");
    assert.match(hfrId, /^IN-HFR-\d+$/);
    assert.equal(res.json.hfrLabel, `HFR: ${hfrId}`);
    assert.equal(String(res.json.hfrLabel).includes(ABDM_REGISTRY_PENDING_NOTE), false);

    const verify = await jsonRequest(port, "POST", "/api/auth/whatsapp/verify-otp", {
      verificationId: String(res.json.verificationId || ""),
      otp: String(res.json.demoOtp || ""),
    });
    assert.equal(verify.status, 200, String(verify.json.error || "verify failed"));
    const welcome = String(verify.json.message || "");
    assert.match(welcome, /has been activated with 500 AI Scribe minutes/);
    assert.equal(welcome.includes(ABDM_REGISTRY_PENDING_NOTE), false);
    const user = (verify.json.user || {}) as Record<string, unknown>;
    assert.equal(user.registryIdsPlaceholder, false);
    delete process.env.ABDM_MODE;
    delete process.env.ABDM_CLIENT_ID;
    delete process.env.ABDM_CLIENT_SECRET;
    delete process.env.ABDM_GATEWAY_URL;
  });

  it("sandbox without real credentials still uses pending labels (not activated HFR framing)", () => {
    const env = {
      ABDM_MODE: "sandbox",
      ABDM_CLIENT_ID: "",
      ABDM_CLIENT_SECRET: "",
      ABDM_GATEWAY_URL: "https://sandbox.abdm.gov.in/api/v3",
    };
    assert.equal(isAbdmPlaceholderRegistryMode(env), true);
  });

  it("user-facing surfaces inventory: pending copy present; large files not truncated", () => {
    const onboarding = readRepo("src/pages/OnboardingWizard.tsx");
    const edge = readRepo("server/abdm-registry-public.ts");
    const welcome = readRepo("src/components/WelcomeSetupDashboard.tsx");
    const dhis = readRepo("src/components/dhis/DhisMeter.tsx");
    const doctorModal = readRepo("src/components/DoctorProfileModal.tsx");
    const landing = readRepo("src/components/LandingPage.tsx");
    const adminMeta = readRepo("src/components/admin/AdminMetaTechProvider.tsx");
    const fhir = readRepo("server/fhir.ts");
    const abdm = readRepo("server/abdm.ts");
    const abdmIdentity = readRepo("server/abdm-identity-routes.ts");
    const abdmConsent = readRepo("server/abdm-consent-routes.ts");

    assert.match(onboarding, /hfrLabel/);
    assert.match(onboarding, /formatAbdmRegistryLabel/);
    assert.match(edge, /practiceRegisteredWelcomeMessage/);
    assert.match(edge, /abdmRegistryPublicFields/);
    assert.match(welcome, /hfrLabel/);
    assert.match(welcome, /formatAbdmRegistryLabel/);
    assert.match(dhis, /pending — not yet verified with the National Health Authority/);
    assert.match(doctorModal, /pending — not yet verified with the National Health Authority/);
    assert.match(doctorModal, /ravee@lumer\.me/);
    assert.match(fhir, /createPrescriptionBundle/);
    assert.match(fhir, /ABDM_REGISTRY_PENDING_NOTE/);
    assert.match(abdm, /export function createAbdmRouter/);
    assert.match(abdmIdentity, /handleBridgeSession/);
    assert.match(abdmConsent, /persistCallbackArtefact/);

    assert.ok(lineCount("src/pages/OnboardingWizard.tsx") >= 860, "OnboardingWizard.tsx truncated");
    const apiSrc = readRepo("server/api.ts");
    assert.match(apiSrc, /createClinicBranchesRouter/);
    const apiLines = lineCount("server/api.ts") + lineCount("server/clinic-branches.ts");
    assert.ok(apiLines >= 2370, `server/api.ts truncated (${apiLines} with clinic-branches.ts)`);
    assert.ok(lineCount("server/fhir.ts") >= 1000, "server/fhir.ts truncated");
    assert.ok(lineCount("src/components/LandingPage.tsx") >= 970, "LandingPage.tsx truncated");
    assert.ok(lineCount("src/components/admin/AdminMetaTechProvider.tsx") >= 1160, "AdminMetaTechProvider.tsx truncated");
    const gatewayLines =
      lineCount("server/abdm-internal.ts") +
      lineCount("server/abdm-identity-routes.ts") +
      lineCount("server/abdm-consent-routes.ts");
    assert.ok(gatewayLines >= 1100, `ABDM gateway split truncated (${gatewayLines} lines)`);

    assert.equal(/ABDM Compliant/i.test(onboarding), false);
    assert.equal(/Official Tech Provider/i.test(landing), false);
    assert.equal(/HIPAA/i.test(landing), false);
    assert.equal(/Official Tech Provider/i.test(adminMeta), false);

    for (const [rel, src] of [
      ["src/pages/OnboardingWizard.tsx", onboarding],
      ["src/components/WelcomeSetupDashboard.tsx", welcome],
      ["src/components/DoctorProfileModal.tsx", doctorModal],
    ] as const) {
      assertNoConfirmedRegistryClaim(src, rel);
    }
  });
});
