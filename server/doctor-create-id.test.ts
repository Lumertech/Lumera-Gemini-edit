import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";

describe("POST /api/doctors id", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  it("generates the doctor id on the server and ignores b.id", async () => {
    const login = await jsonRequest(port, "POST", "/api/auth/login", {
      email: "admin@lumera.me",
      password: "Lumera@2026",
    });
    assert.equal(login.status, 200, String(login.json.error || "login failed"));
    const headers = { Authorization: `Bearer ${String(login.json.token || "")}` };
    const clientId = "client-chosen-doctor-id";
    const created = await jsonRequest(
      port,
      "POST",
      "/api/doctors",
      { id: clientId, name: "Server Id Doctor", specialty: "General Medicine" },
      headers
    );
    assert.equal(created.status, 201, String(created.json.error || "create failed"));
    const doctor = created.json.doctor as { id?: string; name?: string };
    assert.match(String(doctor.id), /^doc-[0-9a-f]{8}$/);
    assert.notEqual(doctor.id, clientId);
    assert.equal(
      getDb().prepare("SELECT id FROM doctors WHERE id = ?").get(clientId),
      undefined
    );
    assert.equal(
      (getDb().prepare("SELECT name FROM doctors WHERE id = ?").get(String(doctor.id)) as { name: string }).name,
      "Server Id Doctor"
    );

    const again = await jsonRequest(
      port,
      "POST",
      "/api/doctors",
      { id: clientId, name: "Server Id Doctor Two", specialty: "General Medicine" },
      headers
    );
    assert.equal(again.status, 201, String(again.json.error || "second create failed"));
    const second = again.json.doctor as { id?: string };
    assert.match(String(second.id), /^doc-[0-9a-f]{8}$/);
    assert.notEqual(second.id, doctor.id);
    assert.notEqual(second.id, clientId);
  });
});
