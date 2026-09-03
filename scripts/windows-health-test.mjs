/**
 * Minimal HTTP health check for Windows Git Bash / Node 24 isolation.
 *
 * Usage (from repo root):
 *   node scripts/windows-health-test.mjs
 *   curl http://127.0.0.1:3001/healthz
 *
 * If this works but Lumera does not, the bug is in Lumera startup/middleware.
 * If this also returns curl (52), suspect Node 24, port reservation, or firewall.
 */
import http from "node:http";

const PORT = Number(process.env.TEST_PORT) || 3001;

function requestPath(url) {
  return (url ?? "/").split("?")[0] || "/";
}

const server = http.createServer((req, res) => {
  process.stdout.write(
    `[test] ${new Date().toISOString()} ${req.method ?? "?"} ${req.url ?? "/"}\n`
  );
  const path = requestPath(req.url);
  if (path === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "ok");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.on("error", (err) => {
  console.error("Test server error:", err);
  process.exit(1);
});

const host = process.platform === "win32" ? "0.0.0.0" : "127.0.0.1";
server.listen(PORT, host, () => {
  console.log(`Test server listening on http://127.0.0.1:${PORT}/healthz`);
  console.log(`Platform: ${process.platform}, Node: ${process.version}`);
  console.log(`Try: curl http://127.0.0.1:${PORT}/healthz`);
});
