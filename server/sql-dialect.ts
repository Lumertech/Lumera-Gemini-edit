/**
 * SQLite-style SQL → Postgres for the Epic 0 compatibility shim.
 * Callers keep `prepare("... ? ...").run/get/all()`. This module is pure and
 * unit-tested; it does not talk to a database.
 */

export function convertPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inSingle) {
      out += c;
      if (c === "'" && sql[i + 1] === "'") {
        out += sql[++i];
      } else if (c === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += c;
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      continue;
    }
    if (c === "?") {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += c;
  }
  return out;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inSingle) {
      current += c;
      if (c === "'" && sql[i + 1] === "'") {
        current += sql[++i];
      } else if (c === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      current += c;
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      current += c;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      current += c;
      continue;
    }
    if (c === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += c;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

export function isSqlitePragma(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql);
}

function extractInsertTable(sql: string): string | null {
  const m = sql.match(/^\s*INSERT\s+INTO\s+([a-zA-Z_][\w.]*)/i);
  return m ? m[1] : null;
}

function extractInsertColumns(sql: string): string[] | null {
  const m = sql.match(/^\s*INSERT\s+INTO\s+[a-zA-Z_][\w.]*\s*\(([^)]+)\)/i);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function appendClause(sql: string, clause: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (/\bON CONFLICT\b/i.test(trimmed)) return trimmed;
  return `${trimmed} ${clause}`;
}

export function rewriteSqliteIdioms(sql: string): string {
  let s = sql.trim();
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s);
  const replace = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\b/i.test(s);
  if (ignore || replace) {
    s = s.replace(/^\s*INSERT\s+OR\s+(?:IGNORE|REPLACE)\s+INTO\b/i, "INSERT INTO");
    if (ignore) {
      s = appendClause(s, "ON CONFLICT DO NOTHING");
    } else {
      const cols = extractInsertColumns(s);
      const table = extractInsertTable(s);
      if (cols && cols.length > 1) {
        const pk = cols[0];
        const updates = cols
          .slice(1)
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(", ");
        s = appendClause(s, `ON CONFLICT (${pk}) DO UPDATE SET ${updates}`);
      } else if (cols && cols.length === 1) {
        s = appendClause(s, `ON CONFLICT (${cols[0]}) DO NOTHING`);
      } else if (table) {
        s = appendClause(s, "ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id");
      }
    }
  }
  s = s.replace(/\bON CONFLICT\s*\(\s*/gi, "ON CONFLICT (");
  return s;
}

export function toPostgresSql(sql: string): string {
  return convertPlaceholders(rewriteSqliteIdioms(sql));
}

export function normalizeBindParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}
