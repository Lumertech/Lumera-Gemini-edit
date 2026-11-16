import { getDb } from "./db.ts";
import type { SqlDatabase } from "./sql-engine.ts";

/** A call stays with the gateway that first claimed it. After this, another VM may take a new call. */
export const VOICE_CALL_GATEWAY_TTL_MS = 20 * 60 * 1000;

export type VoiceCallGatewayClaim =
  | { status: "unscoped" }
  | { status: "owner"; gatewayKey: string; sdpAnswer: string }
  | { status: "foreign"; gatewayKey: string; sdpAnswer: string };

type GatewayRow = {
  gateway_key?: string;
  sdp_answer?: string;
  updated_at?: string;
  last_seen_at?: string;
};

function ensureVoiceCallGatewayTables(db: SqlDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_call_gateways (
      call_id TEXT PRIMARY KEY,
      gateway_key TEXT NOT NULL,
      sdp_answer TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_gateway_registry (
      gateway_key TEXT PRIMARY KEY,
      last_seen_at TEXT NOT NULL
    );
  `);
}

export function normalizeGatewayKey(value: string): string {
  let key = String(value || "").trim().toLowerCase();
  if (key.startsWith("::ffff:")) key = key.slice("::ffff:".length);
  return key;
}

export function voiceGatewayKeyFromRequest(req: { ip?: string; socket?: { remoteAddress?: string | null } }): string {
  return normalizeGatewayKey(req.ip || req.socket?.remoteAddress || "");
}

function fresh(updatedAt: string, now: number): boolean {
  const then = Date.parse(updatedAt);
  return Number.isFinite(then) && now - then < VOICE_CALL_GATEWAY_TTL_MS;
}

function readClaim(callId: string, db: SqlDatabase): GatewayRow | undefined {
  return db.prepare(
    "SELECT gateway_key, sdp_answer, updated_at FROM voice_call_gateways WHERE call_id = ?"
  ).get(callId) as GatewayRow | undefined;
}

/**
 * First gateway to present a call id owns it. A second instance is ignored so its
 * empty history cannot make Maya ask for the name again. The same gateway, or a
 * claim older than the TTL, may continue.
 */
export function claimVoiceCallGateway(
  callId: string,
  gatewayKey: string,
  now = Date.now(),
  db: SqlDatabase = getDb()
): VoiceCallGatewayClaim {
  const id = String(callId || "").trim();
  const key = normalizeGatewayKey(gatewayKey);
  if (!id || !key) return { status: "unscoped" };
  ensureVoiceCallGatewayTables(db);
  const iso = new Date(now).toISOString();
  const existing = readClaim(id, db);
  if (existing && fresh(String(existing.updated_at || ""), now)) {
    const owner = normalizeGatewayKey(String(existing.gateway_key || ""));
    if (owner === key) {
      db.prepare("UPDATE voice_call_gateways SET updated_at = ? WHERE call_id = ?").run(iso, id);
      return { status: "owner", gatewayKey: key, sdpAnswer: String(existing.sdp_answer || "") };
    }
    return { status: "foreign", gatewayKey: owner, sdpAnswer: String(existing.sdp_answer || "") };
  }
  if (!existing) {
    try {
      db.prepare(
        `INSERT INTO voice_call_gateways (call_id, gateway_key, sdp_answer, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`
      ).run(id, key, iso, iso);
      return { status: "owner", gatewayKey: key, sdpAnswer: "" };
    } catch {
      const raced = readClaim(id, db);
      const owner = normalizeGatewayKey(String(raced?.gateway_key || ""));
      if (owner && owner !== key) {
        return { status: "foreign", gatewayKey: owner, sdpAnswer: String(raced?.sdp_answer || "") };
      }
      return { status: "owner", gatewayKey: key, sdpAnswer: String(raced?.sdp_answer || "") };
    }
  }
  const taken = db.prepare(
    `UPDATE voice_call_gateways
     SET gateway_key = ?, sdp_answer = '', updated_at = ?
     WHERE call_id = ? AND updated_at = ?`
  ).run(key, iso, id, String(existing.updated_at || ""));
  if (Number(taken.changes) > 0) return { status: "owner", gatewayKey: key, sdpAnswer: "" };
  const current = readClaim(id, db);
  const owner = normalizeGatewayKey(String(current?.gateway_key || ""));
  if (owner === key) return { status: "owner", gatewayKey: key, sdpAnswer: String(current?.sdp_answer || "") };
  return { status: "foreign", gatewayKey: owner, sdpAnswer: String(current?.sdp_answer || "") };
}

export function saveCallGatewaySdp(
  callId: string,
  gatewayKey: string,
  sdpAnswer: string,
  now = Date.now(),
  db: SqlDatabase = getDb()
): void {
  const id = String(callId || "").trim();
  const key = normalizeGatewayKey(gatewayKey);
  const sdp = String(sdpAnswer || "");
  if (!id || !key || !sdp.trim()) return;
  ensureVoiceCallGatewayTables(db);
  db.prepare(
    "UPDATE voice_call_gateways SET sdp_answer = ?, updated_at = ? WHERE call_id = ? AND gateway_key = ?"
  ).run(sdp, new Date(now).toISOString(), id, key);
}

export function loadCallGatewaySdp(callId: string, now = Date.now(), db: SqlDatabase = getDb()): string {
  const id = String(callId || "").trim();
  if (!id) return "";
  ensureVoiceCallGatewayTables(db);
  const row = readClaim(id, db);
  if (!row || !fresh(String(row.updated_at || ""), now)) return "";
  return String(row.sdp_answer || "");
}

export function noteVoiceGatewaySeen(gatewayKey: string, now = Date.now(), db: SqlDatabase = getDb()): void {
  const key = normalizeGatewayKey(gatewayKey);
  if (!key) return;
  ensureVoiceCallGatewayTables(db);
  const iso = new Date(now).toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO voice_gateway_registry (gateway_key, last_seen_at) VALUES (?, ?)"
  ).run(key, iso);
}

export function recentVoiceGateways(now = Date.now(), db: SqlDatabase = getDb()): Array<{ gatewayKey: string; lastSeenAt: string }> {
  ensureVoiceCallGatewayTables(db);
  const rows = db.prepare(
    "SELECT gateway_key, last_seen_at FROM voice_gateway_registry ORDER BY last_seen_at DESC"
  ).all() as GatewayRow[];
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return rows
    .map((row) => ({
      gatewayKey: normalizeGatewayKey(String(row.gateway_key || "")),
      lastSeenAt: String(row.last_seen_at || ""),
    }))
    .filter((row) => row.gatewayKey && Date.parse(row.lastSeenAt) >= dayAgo);
}

export function resetVoiceCallGatewaysForTests(db: SqlDatabase = getDb()): void {
  ensureVoiceCallGatewayTables(db);
  db.prepare("DELETE FROM voice_call_gateways").run();
  db.prepare("DELETE FROM voice_gateway_registry").run();
}
