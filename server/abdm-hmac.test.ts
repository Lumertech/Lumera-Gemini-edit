import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decideAbdmCallbackSignature, signAbdmCallback, verifyAbdmCallbackHmac } from "./abdm-hmac.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ABDM callback HMAC hook (NHA sandbox)", () => {
  const secret = "callback-secret-for-tests";
  const body = JSON.stringify({ patientId: "pat-1", consentId: "c-1" });

  it("signs and matches sha256 hex", () => {
    const header = signAbdmCallback(secret, body);
    assert.match(header, /^sha256=[a-f0-9]{64}$/);
    assert.equal(verifyAbdmCallbackHmac(body, header, secret), true);
    assert.equal(verifyAbdmCallbackHmac(body + "x", header, secret), false);
  });

  it("is sandbox-tolerant when secret is unset outside production", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      mode: "stub",
      secret: "",
      production: false,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.matched, false);
      assert.equal(decision.sandboxTolerant, true);
    }
  });

  it("stub path accepts missing signature even when a secret exists", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      mode: "stub",
      secret,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.sandboxTolerant, true);
    }
  });

  it("sandbox mode with a secret rejects a bad signature", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      signatureHeader: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mode: "sandbox",
      secret,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 401);
    }
  });

  it("fails closed in production when the callback secret is unset or a placeholder", () => {
    for (const mode of ["stub", "sandbox"] as const) {
      for (const secret of ["", "lumera_abdm_sandbox_sec_99182", "SBX_LUMERA_HEALTH_2026"]) {
        const decision = decideAbdmCallbackSignature({
          rawBody: body,
          mode,
          secret,
          production: true,
        });
        assert.equal(decision.ok, false, `${mode} ${secret || "(empty)"}`);
        if (!decision.ok) assert.equal(decision.status, 401);
      }
    }
  });

  it("requires a callback secret whenever mode is not stub, even outside production", () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const decision = decideAbdmCallbackSignature({
        rawBody: body,
        mode: "sandbox",
        secret: "",
        production: false,
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.status, 401);
      assert.match(lines.join("\n"), /ABDM_CALLBACK_SECRET is required when ABDM_MODE is not stub/);
      assert.match(lines.join("\n"), /Listening continues/);
      const placeholder = "lumera_abdm_sandbox_sec_99182";
      const placeholderDecision = decideAbdmCallbackSignature({
        rawBody: body,
        mode: "sandbox",
        secret: placeholder,
        production: false,
      });
      assert.equal(placeholderDecision.ok, false);
      assert.equal(lines.join("\n").includes(placeholder), false);
    } finally {
      console.error = orig;
    }
  });

  it("stub mode fails closed in production when the signature is missing, even if a secret is set", () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const decision = decideAbdmCallbackSignature({
        rawBody: body,
        mode: "stub",
        secret,
        production: true,
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) {
        assert.equal(decision.status, 401);
        assert.equal(decision.error, "Missing X-ABDM-Signature");
      }
      assert.match(lines.join("\n"), /stub mode fails closed in production/);
      assert.equal(lines.join("\n").includes(secret), false);
    } finally {
      console.error = orig;
    }
  });

  it("does not exit or throw when a non-stub mode has no callback secret", () => {
    assert.equal(/process\.exit/.test(fs.readFileSync(path.join(root, "server/abdm-hmac.ts"), "utf8")), false);
    assert.equal(fs.readFileSync(path.join(root, "server/runtime.ts"), "utf8").includes("ABDM_CALLBACK_SECRET"), false);
    assert.doesNotThrow(() => {
      const decision = decideAbdmCallbackSignature({
        rawBody: body,
        mode: "sandbox",
        secret: "",
        production: true,
      });
      assert.equal(decision.ok, false);
    });
  });

  it("sandbox mode with a secret accepts a matching signature", () => {
    const decision = decideAbdmCallbackSignature({
      rawBody: body,
      signatureHeader: signAbdmCallback(secret, body),
      mode: "sandbox",
      secret,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.matched, true);
    }
  });
});
