import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AI_SCRIBE_LIVE_LABEL } from "../src/lib/pricingCopy.ts";
import { publicPlansResponse } from "./pricing-catalog.ts";
import {
  VERTEX_DEFAULT_GEMINI_MODEL,
  VERTEX_REQUIRED_LOCATION,
  vertexClientOptions,
  vertexGeminiModel,
} from "./vertex-gemini.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("shipped scribe model and region", () => {
  it("uses Vertex gemini-3.5-flash-lite in asia-south1 with no API key", () => {
    assert.equal(VERTEX_DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
    assert.equal(VERTEX_REQUIRED_LOCATION, "asia-south1");
    assert.equal(vertexGeminiModel({}), "gemini-3.5-flash-lite");
    assert.equal(vertexGeminiModel({ VERTEX_GEMINI_MODEL: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
    const options = vertexClientOptions({ project: "gen-lang-client-0108182367", location: "asia-south1" });
    assert.equal(options.vertexai, true);
    assert.equal(options.location, "asia-south1");
    assert.equal(Object.prototype.hasOwnProperty.call(options, "apiKey"), false);

    const clinical = fs.readFileSync(path.join(root, "server/gemini-clinical.ts"), "utf8");
    const vertex = fs.readFileSync(path.join(root, "server/vertex-gemini.ts"), "utf8");
    assert.match(clinical, /getVertexClient\(/);
    assert.match(clinical, /vertexGeminiModel\(/);
    assert.match(clinical, /asia-south1/);
    assert.equal(clinical.includes("GEMINI_API_KEY"), false);
    assert.equal(clinical.includes("generativelanguage.googleapis.com"), false);
    assert.equal(vertex.includes("GEMINI_API_KEY"), false);
    assert.match(vertex, /gemini-3\.5-flash-lite/);
    assert.match(vertex, /asia-south1/);
  });

  it("publishes the live scribe on both plans", () => {
    const plans = publicPlansResponse();
    assert.equal(plans.plans.length, 2);
    for (const plan of plans.plans) {
      const row = plan.includes.find((item) => item.label === AI_SCRIBE_LIVE_LABEL);
      assert.ok(row, plan.code);
      assert.equal(row.status, "live");
    }
  });
});
