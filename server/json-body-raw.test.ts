import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { describe, it } from "node:test";
import { globalJsonParser } from "./json-body.ts";

describe("globalJsonParser rawBody", () => {
  it("leaves a pre-set rawBody Buffer unchanged", async () => {
    const preset = Buffer.from("preset-raw-body");
    const app = express();
    app.use((req, _res, next) => {
      req.rawBody = preset;
      next();
    });
    app.use(globalJsonParser());
    app.post("/json", (req, res) => {
      res.json({
        unchanged: req.rawBody === preset,
        text: req.rawBody?.toString("utf8"),
        name: (req.body as { name?: string } | undefined)?.name,
      });
    });
    const server: Server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
      const res = await fetch(`http://127.0.0.1:${addr.port}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "parsed" }),
      });
      const json = (await res.json()) as { unchanged?: boolean; text?: string; name?: string };
      assert.equal(res.status, 200);
      assert.equal(json.unchanged, true);
      assert.equal(json.text, "preset-raw-body");
      assert.equal(json.name, "parsed");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
