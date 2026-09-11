import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Firebase Hosting → Cloud Run config (#26)", () => {
  it("pins the AI Studio Firebase project and rewrites ** to Cloud Run", () => {
    const rc = JSON.parse(readRepo(".firebaserc")) as { projects: { default: string } };
    assert.equal(rc.projects.default, "gen-lang-client-0108182367");

    const cfg = JSON.parse(readRepo("firebase.json")) as {
      hosting: {
        public: string;
        rewrites: Array<{ source: string; run?: { serviceId: string; region: string }; destination?: string }>;
      };
    };
    assert.equal(cfg.hosting.public, "hosting");
    const catchAll = cfg.hosting.rewrites.find((r) => r.source === "**");
    assert.ok(catchAll?.run, "missing ** rewrite to Cloud Run");
    assert.equal(catchAll!.run!.serviceId, "lumera-gemini-edit");
    assert.equal(catchAll!.run!.region, "asia-south1");
    assert.equal(catchAll!.destination, undefined);
  });

  it("Dockerfile is Node 22 and honors npm start / PORT", () => {
    const docker = readRepo("Dockerfile");
    assert.match(docker, /FROM node:22/);
    assert.match(docker, /npm run build/);
    assert.match(docker, /CMD \["npm", "start"\]/);
    assert.match(docker, /ENV PORT=8080/);
    assert.match(docker, /Cloud Run may probe PORT=3000/);
    assert.doesNotMatch(docker, /ENV PORT=3000/);
  });

  it("cloudbuild deploy updates APP_URL/NODE_ENV only and does not wipe JWT_SECRET", () => {
    const yaml = readRepo("cloudbuild.yaml");
    const withoutComments = yaml.replace(/#.*$/gm, "");
    assert.match(yaml, /--update-env-vars=NODE_ENV=production,APP_URL=https:\/\/www\.mylumera\.in/);
    assert.doesNotMatch(withoutComments, /--set-env-vars/);
    assert.doesNotMatch(withoutComments, /--update-env-vars=[^\n]*JWT_SECRET/);
    assert.match(yaml, /JWT_SECRET must already exist/);
    assert.match(readRepo("deploy/CLOUD_RUN_BOOT_CHECK.md"), /JWT_SECRET is required/);
  });

  it("runbook is Firebase Hosting + Cloud Run, not Hostinger purchase", () => {
    assert.equal(fs.existsSync(path.join(root, "docs/HOSTINGER_NODE_DEPLOY.md")), false);
    const runbook = readRepo("docs/FIREBASE_CLOUD_RUN_DEPLOY.md");
    assert.match(runbook, /Firebase Hosting/);
    assert.match(runbook, /Cloud Run/);
    assert.match(runbook, /Do not buy Hostinger/i);
    assert.match(runbook, /Do not remove Firebase DNS/i);
    assert.match(runbook, /lumera-gemini-edit/);
    assert.match(runbook, /asia-south1/);
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/auth\/facebook\/callback/);
    assert.match(runbook, /https:\/\/www\.mylumera\.in\/api\/meta\/webhook/);
    assert.equal(/do not (point the domain at|leave Gemini).*(Firebase|AI Studio)/i.test(runbook), false);
    const retired = JSON.parse(readRepo("deploy/hostinger-webapp.settings.json")) as { status: string };
    assert.equal(retired.status, "retired");
  });
});
