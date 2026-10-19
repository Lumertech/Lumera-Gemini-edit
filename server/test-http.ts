import type { Server } from "node:http";
import express, { type Express } from "express";
import { attachUser } from "./auth.ts";
import { globalJsonParser } from "./json-body.ts";
import { metaWebhookRawBody } from "./meta-security.ts";

export type TestHttpServer = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Live Express app for HTTP tests — same baseline stack as production `createLumeraApp`
 * (Meta webhook raw body, `globalJsonParser` 10mb + rawBody, `urlencoded`, `attachUser`).
 * cookie-parser is not used in production (`auth.ts` parses `Cookie` itself). Ambient
 * transcription skips this parser and uses its own 11.5mb limit. Callers mount
 * routes after that stack so missing `attachUser` cannot test a different path.
 */
export async function startTestServer(mountRoutes: (app: Express) => void): Promise<TestHttpServer> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(metaWebhookRawBody);
  app.use(globalJsonParser());
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(attachUser);
  mountRoutes(app);

  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server did not bind a port");
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Same request helper as onboarding / admin / billing HTTP tests. */
export async function jsonRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, headers: res.headers };
}
