"use strict";

/**
 * Persistent worker that runs node-postgres queries so the main thread can
 * expose DatabaseSync-style prepare().run/get/all() (sync) against Cloud SQL.
 *
 * Do not bundle this file with esbuild — it is copied to dist/ as CJS and
 * `require("pg")` resolves from node_modules at runtime.
 */
const { workerData, parentPort } = require("node:worker_threads");
const { Pool, types } = require("pg");

if (!parentPort) {
  throw new Error("pg-sync-worker must run as a worker thread");
}

// COUNT(*) / SUM return int8; node-pg otherwise yields strings.
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

const signal = new Int32Array(workerData.sab);
const pool = new Pool({
  connectionString: workerData.connectionString,
  max: 5,
  connectionTimeoutMillis: 15000,
});

pool.on("error", (err) => {
  console.error("[Lumera] Unexpected pg pool error in worker:", err);
});

parentPort.on("message", async (msg) => {
  const port = msg.port;
  try {
    if (msg.type === "query") {
      const result = await pool.query(msg.sql, msg.params || []);
      port.postMessage({ rows: result.rows, rowCount: result.rowCount ?? 0 });
    } else if (msg.type === "exec") {
      const statements = msg.statements || [];
      const client = await pool.connect();
      try {
        if (statements.length > 1 && !msg.skipTransaction) {
          await client.query("BEGIN");
        }
        let rowCount = 0;
        let rows = [];
        for (const s of statements) {
          const r = await client.query(s.sql, s.params || []);
          rowCount += r.rowCount ?? 0;
          rows = r.rows;
        }
        if (statements.length > 1 && !msg.skipTransaction) {
          await client.query("COMMIT");
        }
        port.postMessage({ rows, rowCount });
      } catch (err) {
        if (statements.length > 1 && !msg.skipTransaction) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore rollback failure */
          }
        }
        throw err;
      } finally {
        client.release();
      }
    } else if (msg.type === "close") {
      await pool.end();
      port.postMessage({ ok: true });
    } else {
      port.postMessage({ error: `unknown worker message type ${msg.type}` });
    }
  } catch (err) {
    port.postMessage({
      error: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined,
    });
  } finally {
    try {
      port.close();
    } catch {
      /* ignore */
    }
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
});
