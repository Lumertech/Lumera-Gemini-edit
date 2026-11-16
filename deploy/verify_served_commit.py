#!/usr/bin/env python3
"""Fail a Cloud Build deploy when the live URL is not this git commit.

The GitHub check `lumera-gemini-edit-main-deploy` used to go green when the
build steps exited 0, even if a later revision (or a pinned traffic split)
was what browsers received. This script reads /build.json and X-Lumera-Commit
after deploy and exits non-zero on a mismatch.

It also decides whether this build may take traffic: a revision already
serving a newer LUMERA_COMMIT_UNIX must keep it.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

HEADER = "X-Lumera-Commit"
SHA = "abc56f2898c48e090bcade7212f506c960c9b0a8"


def should_shift(our_unix: int, serving_unix: Optional[int]) -> bool:
    """True when this build may move traffic onto its revision."""
    if serving_unix is None or serving_unix <= 0:
        return True
    return our_unix >= serving_unix


def _traffic_entries(service: dict) -> list:
    status = (service.get("status") or {}).get("traffic") or []
    spec = (service.get("spec") or {}).get("traffic") or []
    return list(status) + list(spec)


def tag_url(service: dict, tag: str) -> str:
    """Direct URL of a --no-traffic revision tag.

    `describe` sometimes lists the tag before it fills `url`. The public form
    is https://TAG---<service-host>, derived from status.url, but only when a
    traffic entry actually has this tag. A missing tag stays empty so Cloud
    Build aborts before traffic moves. An HTTP check of a returned URL is
    still required.
    """
    if not tag:
        return ""
    found = False
    for entry in _traffic_entries(service):
        if entry.get("tag") != tag:
            continue
        found = True
        if entry.get("url"):
            return str(entry["url"])
    if not found:
        return ""
    base = str((service.get("status") or {}).get("url") or "").strip()
    if not base.startswith("https://"):
        return ""
    host = base[len("https://") :].split("/")[0]
    return f"https://{tag}---{host}"


def tagged_revision_name(service: dict, tag: str) -> str:
    """Revision name Cloud Run attached to this tag, if describe has it."""
    for entry in _traffic_entries(service):
        if entry.get("tag") == tag and entry.get("revisionName"):
            return str(entry["revisionName"])
    return ""


def serving_revision_name(service: dict) -> str:
    """Revision that currently receives user traffic (highest percent)."""
    traffic = (service.get("status") or {}).get("traffic") or []
    best_name = ""
    best_pct = 0
    for entry in traffic:
        try:
            pct = int(entry.get("percent") or 0)
        except (TypeError, ValueError):
            pct = 0
        if pct > best_pct and entry.get("revisionName"):
            best_pct = pct
            best_name = str(entry["revisionName"])
    return best_name


def revision_commit_unix(revision: dict) -> Optional[int]:
    containers = (revision.get("spec") or {}).get("containers") or []
    for container in containers:
        for item in container.get("env") or []:
            if item.get("name") != "LUMERA_COMMIT_UNIX":
                continue
            raw = str(item.get("value") or "").strip()
            if not raw:
                return None
            try:
                return int(raw)
            except ValueError:
                return None
    return None


def _join(base: str, leaf: str) -> str:
    return base.rstrip("/") + "/" + leaf.lstrip("/")


def cache_bust_token(expect: str, attempt: int) -> str:
    """A new query value on every try.

    Firebase Hosting caches origin 404s for about ten minutes, keyed by the
    full URL. Reusing ``?v=<sha>`` replays an early miss for the rest of this
    window and for a later build of the same commit.
    """
    return f"{expect}.{attempt}.{time.time_ns()}"


def fetch_identity(base_url: str, timeout: float = 20.0, cache_bust: str = "") -> tuple[int, str, str]:
    """GET /build.json. Returns (status, commit or '', header or '').

    The query string is not part of the file lookup. A fresh value keeps
    Firebase Hosting from replaying a cached 404 (www 404s were max-age=600).
    """
    leaf = "build.json"
    if cache_bust:
        leaf += "?v=" + urllib.parse.quote(cache_bust, safe="")
    req = urllib.request.Request(
        _join(base_url, leaf),
        headers={"User-Agent": "lumera-deploy-verify", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200) or 200
            header = resp.headers.get(HEADER, "") or ""
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        header = err.headers.get(HEADER, "") if err.headers else ""
        body = err.read().decode("utf-8", "replace")
        status = err.code
    commit = ""
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            commit = str(parsed.get("commit") or "").strip()
    except json.JSONDecodeError:
        commit = ""
    return status, commit, header.strip()


def check_url(
    base_url: str,
    expect: str,
    *,
    require_header: bool,
    attempts: int,
    sleep_s: float,
) -> None:
    last = "no response"
    for attempt in range(1, attempts + 1):
        try:
            status, commit, header = fetch_identity(
                base_url, cache_bust=cache_bust_token(expect, attempt)
            )
        except Exception as err:  # noqa: BLE001 — network failures are retries
            last = f"{type(err).__name__}: {err}"
            status, commit, header = 0, "", ""
        header_ok = (not require_header and (header == "" or header == expect)) or header == expect
        if status == 200 and commit == expect and header_ok:
            print(f"OK {base_url} serves {expect}")
            return
        last = f"status={status} commit={commit or '(missing)'} header={header or '(missing)'}"
        print(f"attempt {attempt}/{attempts} {base_url} {last}", file=sys.stderr)
        if attempt < attempts:
            time.sleep(sleep_s)
    raise SystemExit(f"FAIL {base_url} did not serve {expect} ({last})")


def self_test() -> None:
    assert should_shift(200, None)
    assert should_shift(200, 0)
    assert should_shift(200, 200)
    assert should_shift(200, 100)
    assert not should_shift(100, 200)

    service = {
        "status": {
            "traffic": [
                {"revisionName": "old", "percent": 100},
                {"revisionName": "tagged", "percent": 0, "tag": "babc"},
            ]
        }
    }
    assert serving_revision_name(service) == "old"
    assert serving_revision_name({"status": {"traffic": []}}) == ""
    tagged = {
        "status": {
            "traffic": [
                {"revisionName": "old", "percent": 100},
                {"tag": "babc56f2", "percent": 0, "url": "https://babc56f2---lumera.a.run.app"},
            ]
        }
    }
    assert tag_url(tagged, "babc56f2") == "https://babc56f2---lumera.a.run.app"
    assert tag_url(tagged, "missing") == ""
    host_only = {
        "status": {
            "url": "https://lumera-gemini-edit-v6kfnpsifq-el.a.run.app",
            "traffic": [{"revisionName": "old", "percent": 100}],
        }
    }
    assert tag_url(host_only, "b7ca4c2d") == ""
    bare = {
        "status": {
            "url": "https://lumera-gemini-edit-v6kfnpsifq-el.a.run.app",
            "traffic": [
                {"tag": "b7ca4c2d", "percent": 0, "revisionName": "lumera-gemini-edit-00051-abc"}
            ],
        }
    }
    assert (
        tag_url(bare, "b7ca4c2d")
        == "https://b7ca4c2d---lumera-gemini-edit-v6kfnpsifq-el.a.run.app"
    )
    assert tagged_revision_name(bare, "b7ca4c2d") == "lumera-gemini-edit-00051-abc"
    assert tagged_revision_name(bare, "missing") == ""
    revision = {
        "spec": {
            "containers": [
                {"env": [{"name": "NODE_ENV", "value": "production"}, {"name": "LUMERA_COMMIT_UNIX", "value": "1794799925"}]}
            ]
        }
    }
    assert revision_commit_unix(revision) == 1794799925
    assert revision_commit_unix({"spec": {"containers": [{"env": []}]}}) is None
    first = cache_bust_token(SHA, 1)
    again = cache_bust_token(SHA, 1)
    nxt = cache_bust_token(SHA, 2)
    assert first != again and first != nxt and SHA in first

    seen: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen.append(self.path)
            if self.path.split("?", 1)[0] != "/build.json":
                self.send_response(404)
                self.end_headers()
                return
            # First hit is a 404, the way Firebase would cache an early miss.
            if len(seen) == 1:
                self.send_response(404)
                self.send_header("Cache-Control", "max-age=600")
                self.end_headers()
                self.wfile.write(b"missing")
                return
            body = json.dumps({"commit": SHA}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header(HEADER, SHA)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        check_url(base, SHA, require_header=True, attempts=2, sleep_s=0.01)
        queries = [path.split("?", 1)[1] for path in seen if path.startswith("/build.json?")]
        assert len(queries) >= 2 and len(set(queries)) == len(queries), queries
        try:
            check_url(base, "0" * 40, require_header=True, attempts=1, sleep_s=0)
        except SystemExit as err:
            if not str(err).startswith("FAIL"):
                raise
        else:
            raise SystemExit("self-test expected a mismatch to fail")
    finally:
        server.shutdown()
    print("self-test ok")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description="Verify the served Lumera commit")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--expect", default="")
    parser.add_argument("--url", action="append", default=[])
    parser.add_argument("--require-header", action="store_true")
    parser.add_argument("--attempts", type=int, default=12)
    parser.add_argument("--sleep", type=float, default=5.0)
    parser.add_argument("--decide", action="store_true")
    parser.add_argument("--our-unix", type=int, default=0)
    parser.add_argument("--serving-unix", default="")
    parser.add_argument("--serving-revision", default="")
    parser.add_argument("--revision-unix", default="")
    parser.add_argument("--tag-url", default="")
    parser.add_argument("--tag", default="")
    parser.add_argument("--tagged-revision", default="")
    args = parser.parse_args(argv)

    if args.self_test:
        self_test()
        return

    if args.tag_url:
        if not args.tag:
            parser.error("--tag-url requires --tag")
        print(tag_url(json.load(open(args.tag_url, encoding="utf-8")), args.tag))
        return

    if args.tagged_revision:
        if not args.tag:
            parser.error("--tagged-revision requires --tag")
        print(tagged_revision_name(json.load(open(args.tagged_revision, encoding="utf-8")), args.tag))
        return

    if args.serving_revision:
        print(serving_revision_name(json.load(open(args.serving_revision, encoding="utf-8"))))
        return

    if args.revision_unix:
        unix = revision_commit_unix(json.load(open(args.revision_unix, encoding="utf-8")))
        print("" if unix is None else str(unix))
        return

    if args.decide:
        serving: Optional[int]
        raw = args.serving_unix.strip()
        serving = int(raw) if raw else None
        if should_shift(args.our_unix, serving):
            print("shift")
            return
        print("refuse", file=sys.stderr)
        raise SystemExit(
            f"FAIL refusing to move traffic: serving revision unix {serving} is newer than this build {args.our_unix}"
        )

    if not args.expect or not args.url:
        parser.error("--expect and at least one --url are required")
    for url in args.url:
        check_url(
            url,
            args.expect,
            require_header=args.require_header,
            attempts=args.attempts,
            sleep_s=args.sleep,
        )


if __name__ == "__main__":
    main(sys.argv[1:])
