import type { Server } from "node:http";
import express, { type Express, type Request } from "express";
import { attachUser } from "./auth.ts";

export type TestHttpServer = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Live Express app for HTTP tests — same baseline stack as production `server.ts`
 * (`express.json` 10mb + rawBody, `urlencoded`, `attachUser`). cookie-parser is
 * not used in production (`auth.ts` parses `Cookie` itself). Callers mount routes
 * after that stack so missing `attachUser` cannot test a different path.
 */
export async function startTestServer(mountRoutes: (app: Express) => void): Promise<TestHttpServer> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    })
  );
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
