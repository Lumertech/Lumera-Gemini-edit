import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { moduleAnchorUrl } from "./module-anchor.ts";
import {
  isSqlitePragma,
  normalizeBindParams,
  splitSqlStatements,
  toPostgresSql,
} from "./sql-dialect.ts";
import type { SqlDatabase, SqlRunResult, SqlStatement } from "./sql-engine.ts";

type WorkerResponse = {
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
  code?: string;
  ok?: boolean;
};

const QUERY_TIMEOUT_MS = 30_000;

function resolveWorkerPath(): string {
  // Same CJS hole as sqlite-compat: import.meta.url is empty in dist/server.cjs.
  // Anchor on the bundle path so dist/pg-sync-worker.cjs is found beside server.cjs.
  const here = path.dirname(fileURLToPath(moduleAnchorUrl(import.meta.url)));
  const candidates = [
    path.join(here, "pg-sync-worker.cjs"),
    path.join(process.cwd(), "server", "pg-sync-worker.cjs"),
    path.join(process.cwd(), "dist", "pg-sync-worker.cjs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `pg-sync-worker.cjs not found (looked in ${candidates.join(", ")}). Production build must copy it to dist/.`
  );
}

let worker: Worker | null = null;
let signal: Int32Array | null = null;

function ensureWorker(connectionString: string): { worker: Worker; signal: Int32Array } {
  if (worker && signal) return { worker, signal };
  const sab = new SharedArrayBuffer(4);
  signal = new Int32Array(sab);
  worker = new Worker(resolveWorkerPath(), {
    workerData: { connectionString, sab },
  });
  worker.on("error", (err) => {
    console.error("[Lumera] pg sync worker error:", err);
  });
  worker.unref?.();
  return { worker, signal };
}

function callWorker(
  connectionString: string,
  payload: Record<string, unknown>,
  transfer?: import("node:worker_threads").MessagePort
): WorkerResponse {
  const handle = ensureWorker(connectionString);
  const { port1, port2 } = new MessageChannel();
  Atomics.store(handle.signal, 0, 0);
  handle.worker.postMessage({ ...payload, port: port2 }, transfer ? [port2, transfer] : [port2]);
  const wait = Atomics.wait(handle.signal, 0, 0, QUERY_TIMEOUT_MS);
  if (wait === "timed-out") {
    port1.close();
    throw new Error(`Postgres query timed out after ${QUERY_TIMEOUT_MS}ms`);
  }
  const received = receiveMessageOnPort(port1)?.message as WorkerResponse | undefined;
  port1.close();
  if (!received) {
    throw new Error("Postgres worker returned no message");
  }
  if (received.error) {
    const err = new Error(received.error) as Error & { code?: string };
    if (received.code) err.code = received.code;
    throw err;
  }
  return received;
}

function query(connectionString: string, sqliteSql: string, params: unknown[]): WorkerResponse {
  const pgSql = toPostgresSql(sqliteSql);
  return callWorker(connectionString, {
    type: "query",
    sql: pgSql,
    params: normalizeBindParams(params),
  });
}

function isExplicitTxn(sql: string): boolean {
  return /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b/i.test(sql);
}

export function createPgShim(connectionString: string): SqlDatabase {
  const prepare = (sql: string): SqlStatement => {
    return {
      run(...params: unknown[]): SqlRunResult {
        const res = query(connectionString, sql, params);
        return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
      },
      get(...params: unknown[]): unknown {
        const res = query(connectionString, sql, params);
        return res.rows && res.rows.length ? res.rows[0] : undefined;
      },
      all(...params: unknown[]): unknown[] {
        const res = query(connectionString, sql, params);
        return res.rows ?? [];
      },
    };
  };

  const exec = (sql: string): void => {
    const statements = splitSqlStatements(sql).filter((s) => !isSqlitePragma(s));
    if (!statements.length) return;
    const skipTransaction = statements.length < 2 || statements.some(isExplicitTxn);
    callWorker(connectionString, {
      type: "exec",
      skipTransaction,
      statements: statements.map((s) => ({ sql: toPostgresSql(s), params: [] })),
    });
  };

  return { prepare, exec, dialect: "postgres" };
}

export function isPgShimAvailable(): boolean {
  try {
    resolveWorkerPath();
    return true;
  } catch {
    return false;
  }
}
