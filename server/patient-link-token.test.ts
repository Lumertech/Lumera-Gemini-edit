import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before, describe, it } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import {
  PATIENT_LINK_DEFAULT_TTL_HOURS,
  PATIENT_LINK_PUBLIC_BASE_URL,
  mintPatientLinkToken,
  resolvePatientLinkToken,
  revokePatientLinkToken,
  revokePatientLinkTokensFor,
} from "./patient-link-token.ts";

describe("patient link tokens", () => {
  before(() => {
    try {
      getDb();
    } catch {
      initDatabase();
    }
  });

  function binding(label: string) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return {
      tenantId: `tenant-link-${label}-${suffix}`,
      patientId: `patient-${label}-${suffix}`,
      resourceId: `resource-${label}-${suffix}`,
    };
  }

  it("mints a 128-bit-or-larger base64url token, stores only the hash, and builds /purpose/v/<token>", async () => {
    const ids = binding("mint");
    const minted = await mintPatientLinkToken({ ...ids, purpose: "rx", createdBy: "user-1" });
    const rawBytes = Buffer.from(minted.token, "base64url");
    assert.ok(rawBytes.length >= 16);
    assert.match(minted.token, /^[A-Za-z0-9_-]+$/);
    assert.equal(minted.url, `${PATIENT_LINK_PUBLIC_BASE_URL}/rx/v/${minted.token}`);
    const ttl = minted.expiresAt.getTime() - Date.now();
    assert.ok(ttl > (PATIENT_LINK_DEFAULT_TTL_HOURS - 1) * 60 * 60 * 1000);
    assert.ok(ttl <= PATIENT_LINK_DEFAULT_TTL_HOURS * 60 * 60 * 1000 + 5000);
    const hash = crypto.createHash("sha256").update(minted.token, "utf8").digest("hex");
    const rows = getDb().prepare(`SELECT token_hash, tenant_id, patient_id, purpose, resource_id FROM patient_link_tokens`).all() as Array<
      Record<string, string>
    >;
    const stored = rows.find((row) => row.token_hash === hash);
    assert.ok(stored);
    assert.equal(stored.tenant_id, ids.tenantId);
    assert.equal(stored.patient_id, ids.patientId);
    assert.equal(stored.purpose, "rx");
    assert.equal(stored.resource_id, ids.resourceId);
    assert.equal(JSON.stringify(rows).includes(minted.token), false);

    const receipt = await mintPatientLinkToken({ ...ids, purpose: "receipt", resourceId: `${ids.resourceId}-pay` });
    assert.equal(receipt.url, `${PATIENT_LINK_PUBLIC_BASE_URL}/pay/v/${receipt.token}`);
  });

  it("resolves a live token and can consume a use", async () => {
    const ids = binding("resolve");
    const minted = await mintPatientLinkToken({ ...ids, purpose: "portal", maxUses: 2 });
    const peeked = await resolvePatientLinkToken(minted.token);
    assert.equal(peeked.ok, true);
    if (peeked.ok) {
      assert.equal(peeked.tenantId, ids.tenantId);
      assert.equal(peeked.patientId, ids.patientId);
      assert.equal(peeked.purpose, "portal");
      assert.equal(peeked.resourceId, ids.resourceId);
    }
    const once = await resolvePatientLinkToken(minted.token, { consume: true });
    assert.equal(once.ok, true);
    const twice = await resolvePatientLinkToken(minted.token, { consume: true });
    assert.equal(twice.ok, true);
  });

  it("rejects an unknown token, the wrong purpose, expiry, revoke, and exhaustion", async () => {
    const missing = await resolvePatientLinkToken("not-a-real-token");
    assert.deepEqual(missing, { ok: false, reason: "not_found" });

    const ids = binding("reject");
    const minted = await mintPatientLinkToken({ ...ids, purpose: "hep", maxUses: 1 });
    const wrong = await resolvePatientLinkToken(minted.token, { purpose: "rx" });
    assert.deepEqual(wrong, { ok: false, reason: "wrong_purpose" });

    const hash = crypto.createHash("sha256").update(minted.token, "utf8").digest("hex");
    getDb()
      .prepare(`UPDATE patient_link_tokens SET expires_at = ? WHERE token_hash = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), hash);
    const expired = await resolvePatientLinkToken(minted.token, { purpose: "hep" });
    assert.deepEqual(expired, { ok: false, reason: "expired" });
    getDb()
      .prepare(`UPDATE patient_link_tokens SET expires_at = ? WHERE token_hash = ?`)
      .run(new Date(Date.now() + 60_000).toISOString(), hash);

    assert.equal(await revokePatientLinkToken(minted.token), true);
    const revoked = await resolvePatientLinkToken(minted.token);
    assert.deepEqual(revoked, { ok: false, reason: "revoked" });
    assert.equal(await revokePatientLinkToken("missing-token-value"), false);

    const limited = await mintPatientLinkToken({ ...binding("uses"), purpose: "rx", maxUses: 1 });
    assert.equal((await resolvePatientLinkToken(limited.token, { consume: true })).ok, true);
    const exhausted = await resolvePatientLinkToken(limited.token, { consume: true });
    assert.deepEqual(exhausted, { ok: false, reason: "exhausted" });
  });

  it("revokes every live token for a tenant resource", async () => {
    const ids = binding("batch");
    const first = await mintPatientLinkToken({ ...ids, purpose: "rx" });
    const second = await mintPatientLinkToken({ ...ids, purpose: "receipt" });
    const revoked = await revokePatientLinkTokensFor({ tenantId: ids.tenantId, resourceId: ids.resourceId, purpose: "rx" });
    assert.equal(revoked, 1);
    assert.equal((await resolvePatientLinkToken(first.token)).ok, false);
    assert.equal((await resolvePatientLinkToken(second.token)).ok, true);
    const rest = await revokePatientLinkTokensFor({ tenantId: ids.tenantId, resourceId: ids.resourceId });
    assert.equal(rest, 1);
    assert.deepEqual(await resolvePatientLinkToken(second.token), { ok: false, reason: "revoked" });
  });
});
