# Contributing to Lumera

Lumera is **not** a certified Meta Tech Provider. Do not add copy that claims HIPAA-grade, Official Tech Provider, certified ABDM M1–M3, or “ABDM Compliant”. Compliance contact: **ravee@lumer.me** only.

## HTTP route tests (standing rule)

Any **new or modified HTTP route** must have at least one test that:

1. Boots a live Express app with `startTestServer()` from `server/test-http.ts` (production baseline middleware: `express.json`, `urlencoded`, `attachUser`).
2. Issues a real HTTP request with `jsonRequest()` from that same helper (`app.listen(0)` + `fetch`).

Unit tests of handlers or helpers **in isolation do not satisfy this**. Compliance logic that is only tested off the wire has repeatedly shipped with missing, unmounted, or 404 routes — the HTTP test is the gate.

```ts
import { jsonRequest, startTestServer } from "./test-http.ts";

const server = await startTestServer((app) => {
  app.use("/api", createApiRouter());
});
const res = await jsonRequest(server.port, "POST", "/api/example", { ok: true });
```
