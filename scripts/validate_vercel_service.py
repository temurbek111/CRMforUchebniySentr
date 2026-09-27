#!/usr/bin/env python3
"""Simulate the Vercel backend service locally and prove it serves correctly.

Copies ONLY backend/ to a temporary directory (mirroring Vercel Services
isolating each service to its own root), points the storage paths inside that
root exactly as the deployment must, then runs the real production server and
checks the API, the health endpoint and the /static/ asset route.

The SPA is intentionally absent from the copy, so this also proves the backend
boots and serves its API without a sibling frontend/dist.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PORT = 8099


def free_port(port: int) -> int:
    while True:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1


def wait_ready(url: str, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="vercel_svc_"))
    svc_root = tmp / "backend"
    shutil.copytree(
        REPO / "backend", svc_root,
        ignore=shutil.ignore_patterns(
            "__pycache__", "*.pyc", ".pytest_cache", "db.sqlite3", "staticfiles", "media"
        ),
    )
    # No sibling frontend/ directory exists in this simulation, by design.
    (tmp / "frontend").mkdir(exist_ok=True)
    (tmp / "frontend" / "dist").exists() and shutil.rmtree(tmp / "frontend")

    port = free_port(PORT)
    env = dict(os.environ)
    env.update({
        "DJANGO_DEBUG": "false",
        "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
        # Exactly what the Vercel deployment sets: storage inside the service.
        "DJANGO_STATIC_ROOT": "staticfiles",
        "DJANGO_MEDIA_ROOT": "media",
        "DJANGO_SETTINGS_MODULE": "config.settings",
    })

    print(f"service root : {svc_root}")
    print(f"frontend dir : exists={ (tmp/'frontend').exists() } (dist deliberately absent)")
    print(f"port         : {port}\n")

    # A real deployment runs migrations before serving. Do the same here so the
    # fresh, isolated database has its schema.
    migrate = subprocess.run(
        [sys.executable, "manage.py", "migrate", "--noinput"],
        cwd=svc_root, env=env, capture_output=True, text=True,
    )
    if migrate.returncode != 0:
        print("migrate failed:\n", migrate.stdout[-2000:], migrate.stderr[-2000:])
        return 1
    print("migrations applied in the isolated service root\n")

    # Vercel runs collectstatic automatically when STATIC_ROOT is set; mirror
    # that here so the static route is exercised against collected files.
    collect = subprocess.run(
        [sys.executable, "manage.py", "collectstatic", "--noinput"],
        cwd=svc_root, env=env, capture_output=True, text=True,
    )
    if collect.returncode != 0:
        print("collectstatic failed:\n", collect.stdout[-2000:], collect.stderr[-2000:])
        return 1
    print(collect.stdout.strip().splitlines()[-1] if collect.stdout.strip() else "collected")
    print()

    proc = subprocess.Popen(
        [sys.executable, "-m", "gunicorn", "config.wsgi:application",
         "--bind", f"127.0.0.1:{port}", "--workers", "1", "--timeout", "60",
         "--access-logfile", "-", "--error-logfile", "-"],
        cwd=svc_root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )

    results: list[tuple[str, str, str]] = []
    try:
        if not wait_ready(f"http://127.0.0.1:{port}/api/health"):
            print("server did not become ready; output follows:")
            proc.send_signal(signal.SIGTERM)
            out, _ = proc.communicate(timeout=10)
            print(out[-3000:])
            return 1

        def check(name, expected, actual):
            ok = str(expected) == str(actual)
            results.append((name, str(expected), str(actual)))
            print(f"{'PASS' if ok else 'FAIL'}  {name:<46} expected={expected} got={actual}")

        def get(path):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                return e.code, e.read()

        code, body = get("/api/health")
        check("api/health reachable", 200, code)
        check("health payload is JSON ok", "ok", json.loads(body).get("status"))

        code, _ = get("/api/students/")
        check("anonymous API denied (auth enforced)", 403, code)

        code, _ = get("/api/auth/csrf")
        check("auth/csrf reachable", 200, code)

        # The SPA is absent here, so its route must explain itself, not 500.
        code, body = get("/students")
        check("SPA route without a build is a clear 503", 503, code)
        check("503 explains how to build the bundle",
              "frontend" in body.decode().lower(), "True")

        # Static: collected admin assets must be servable from the in-service root.
        code, _ = get("/static/admin/css/base.css")
        check("/static/ served from the in-service root", 200, code)

        check("no write escaped the service root",
              "True", str(not (tmp / "staticfiles").exists()))
        check("staticfiles created INSIDE the service root",
              "True", str((svc_root / "staticfiles").exists()))
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    failed = [r for r in results if r[1] != r[2]]
    print(f"\nTOTAL {len(results)} checks, {len(results)-len(failed)} passed, {len(failed)} failed")
    for n, e, a in failed:
        print(f"  FAIL {n}: expected {e}, got {a}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
