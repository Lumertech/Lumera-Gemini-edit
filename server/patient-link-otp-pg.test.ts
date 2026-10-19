import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { incrementPatientLinkOtpAttempts } from "./patient-document-links.ts";
import { createPgShim } from "./pg-shim.ts";

/**
 * Real Postgres through the pg shim. node:sqlite's .get() on UPDATE RETURNING
 * is not the Cloud SQL path.
 */
function postgresTestUrl(): string | null {
  const fromEnv = String(process.env.SUNRISE_TEST_DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    return "postgres://lumera:ci-only-db@127.0.0.1:5432/lumera_sunrise_test";
  }
  return null;
}

describe("patient-link OTP attempts on Postgres", () => {
  it("reads attempts from UPDATE ... RETURNING through the pg adapter", () => {
    const url = postgresTestUrl();
    if (!url) {
      if (process.env.GITHUB_ACTIONS === "true") {
        throw new Error("SUNRISE_TEST_DATABASE_URL is required so CI can increment patient-link OTP attempts on Postgres");
      }
      return;
    }
    const db = createPgShim(url);
    db.exec(`
      CREATE TABLE IF NOT EXISTS patient_link_otps (
        token_hash TEXT PRIMARY KEY,
        otp_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        send_count INTEGER NOT NULL DEFAULT 0,
        recent_sends TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )
    `);
    const tokenHash = `probe-${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO patient_link_otps (token_hash, otp_hash, expires_at, attempts, send_count, recent_sends, created_at)
         VALUES (?, 'hash', ?, 0, 1, '[]', ?)`
      ).run(tokenHash, now, now);
      const first = incrementPatientLinkOtpAttempts(db, tokenHash);
      const second = incrementPatientLinkOtpAttempts(db, tokenHash);
      const stored = db.prepare(`SELECT attempts FROM patient_link_otps WHERE token_hash = ?`).get(tokenHash) as {
        attempts?: number | string;
      };
      assert.equal(first, 1);
      assert.equal(second, 2);
      assert.equal(Number(stored?.attempts), 2);
    } finally {
      db.prepare(`DELETE FROM patient_link_otps WHERE token_hash = ?`).run(tokenHash);
    }
  });
});
