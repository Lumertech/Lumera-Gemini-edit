/**
 * Child-process probe for engine-selection tests.
 * Boots via initDatabase()/getDb() — never openConfiguredDatabase() directly.
 */
import { getDb, initDatabase } from "./db.ts";

const mode = String(process.argv[2] || "sqlite");

try {
  const db = initDatabase();
  const viaGetDb = getDb();
  let engine = "sqlite";
  try {
    const pg = viaGetDb.prepare("SELECT current_database() AS db").get() as { db?: string } | undefined;
    if (pg && String(pg.db || "").trim()) engine = "postgres";
  } catch {
    engine = "sqlite";
  }
  const row = viaGetDb.prepare("SELECT 1 AS n").get() as { n?: number } | undefined;
  const n = Number(row?.n);
  const marker = `engine-rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.exec("CREATE TABLE IF NOT EXISTS engine_selection_probe (id TEXT PRIMARY KEY, note TEXT NOT NULL)");
  db.prepare("INSERT INTO engine_selection_probe (id, note) VALUES (?, ?)").run(marker, mode);
  const back = db.prepare("SELECT note FROM engine_selection_probe WHERE id = ?").get(marker) as { note?: string };
  if (n !== 1 || back?.note !== mode) {
    throw new Error(`round-trip mismatch n=${n} note=${back?.note}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, mode, engine, n, note: back.note }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, mode, error: message }));
  process.exit(1);
}
