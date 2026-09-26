#!/usr/bin/env python3
"""Live HTTP validation of auth, CSRF, RBAC and business endpoints.

Runs against the production server started by scripts/serve_production.py.
Uses only the standard library so it has no dependency on the test client -
these are real requests over the network, exactly what a browser makes.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar, DefaultCookiePolicy

BASE = "http://127.0.0.1:8010"
# Password of the local validation administrator. Read from the environment so
# no credential is committed; the default matches the throwaway account this
# harness creates in scripts/serve_production.py's local database.
PASSWORD = os.environ.get("CRM_VALIDATION_ADMIN_PASSWORD", "Valid-Admin-Pw-2026!z")

results: list[tuple[str, str, str]] = []


def record(name: str, expected: str, actual: str) -> None:
    ok = expected == actual
    results.append((name, expected, actual))
    print(f"{'PASS' if ok else 'FAIL'}  {name:<52} expected={expected:<6} got={actual}")


class _AllowSecureOverHttp(DefaultCookiePolicy):
    """DefaultCookiePolicy, but Secure cookies may travel over plain HTTP.

    Used only by this local harness; the server-side configuration is
    untouched and remains correct for a TLS-terminated deployment.
    """

    def return_ok_secure(self, cookie, request):
        return True


class Session:
    def __init__(self) -> None:
        # The application sets Secure cookies outside DEBUG (correct for
        # production behind TLS). This harness talks plain HTTP to a local
        # server, so it must opt in to sending Secure cookies the way a browser
        # would once the connection is TLS-terminated at the proxy.
        self.jar = CookieJar()
        self.jar.set_policy(_AllowSecureOverHttp())
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def request(self, method: str, path: str, *, data=None, csrf=True, headers=None):
        body = None
        hdrs = {"Accept": "application/json"}
        if headers:
            hdrs.update(headers)
        if data is not None:
            body = json.dumps(data).encode()
            hdrs["Content-Type"] = "application/json"
        if csrf and method not in {"GET", "HEAD"}:
            token = self.csrf_token()
            if token:
                hdrs["X-CSRFToken"] = token
                hdrs["Referer"] = BASE
        req = urllib.request.Request(BASE + path, data=body, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=20) as resp:
                raw = resp.read().decode()
                return resp.status, raw
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode()

    def csrf_token(self) -> str | None:
        for c in self.jar:
            if c.name == "csrftoken":
                return c.value
        return None


print("=" * 78)
print("LIVE AUTH / CSRF / RBAC VALIDATION (production server, PostgreSQL)")
print("=" * 78)

anon = Session()
code, _ = anon.request("GET", "/api/auth/csrf", csrf=False)
record("anon GET /api/auth/csrf", "200", str(code))

code, body = anon.request("GET", "/api/students/")
record("anon GET /api/students/ (denied)", "403", str(code))

code, body = anon.request("GET", "/api/auth/me")
record("anon GET /api/auth/me (denied)", "403", str(code))

code, body = anon.request(
    "POST", "/api/auth/login", data={"username": "valadmin", "password": "wrong-password"}
)
record("login with wrong password", "401", str(code))

# --- admin session -----------------------------------------------------------
admin = Session()
admin.request("GET", "/api/auth/csrf", csrf=False)

# Prove CSRF is actually enforced: POST without the token must be rejected.
code, body = admin.request(
    "POST", "/api/auth/login", data={"username": "valadmin", "password": PASSWORD}, csrf=False
)
record("login WITHOUT csrf token (enforced)", "403", str(code))

code, body = admin.request(
    "POST", "/api/auth/login", data={"username": "valadmin", "password": PASSWORD}
)
record("login WITH csrf token", "200", str(code))
admin_user = json.loads(body) if code == 200 else {}
record("login response has navigation", "True", str("navigation" in admin_user))
record("login response has permission_codes", "True", str("permission_codes" in admin_user))

code, body = admin.request("GET", "/api/auth/me")
record("admin GET /api/auth/me", "200", str(code))

SESSION_BEFORE = admin.csrf_token()

for path in [
    "/api/students/",
    "/api/groups/",
    "/api/teachers/",
    "/api/courses/",
    "/api/dashboard",
    "/api/audit/",
    "/api/users/",
    "/api/roles/",
    "/api/notifications/",
    "/api/payments/",
    "/api/payroll/",
]:
    code, _ = admin.request("GET", path)
    record(f"admin GET {path}", "200", str(code))

# --- teacher session: RBAC must deny finance/reports/users -------------------
teacher = Session()
teacher.request("GET", "/api/auth/csrf", csrf=False)
code, body = teacher.request(
    "POST", "/api/auth/login", data={"username": "valteacher", "password": PASSWORD}
)
record("teacher login", "200", str(code))

code, _ = teacher.request("GET", "/api/students/")
record("teacher GET /api/students/", "200", str(code))

for path, expect in [
    ("/api/users/", "403"),
    ("/api/roles/", "403"),
    ("/api/payroll/", "403"),
    ("/api/audit/", "403"),
]:
    code, _ = teacher.request("GET", path)
    record(f"teacher GET {path} (must deny)", expect, str(code))

# --- logout ------------------------------------------------------------------
code, _ = admin.request("POST", "/api/auth/logout")
record("admin POST /api/auth/logout", "200", str(code))
code, _ = admin.request("GET", "/api/students/")
record("admin after logout (denied)", "403", str(code))

failed = [r for r in results if r[1] != r[2]]
print()
print(f"TOTAL {len(results)} checks, {len(results) - len(failed)} passed, {len(failed)} failed")
if failed:
    print("\nFAILURES:")
    for name, expected, actual in failed:
        print(f"  - {name}: expected {expected}, got {actual}")
sys.exit(1 if failed else 0)
