#!/usr/bin/env python3
"""Live proof that the Roles screen actually changes enforcement.

The application defines exactly five system roles (Role.code has a fixed choice
set), so the Roles screen edits the permission set of an existing role rather
than creating new ones. This harness does the same through the real HTTP API:

  1. sign in as an administrator
  2. create a throwaway user in the `receptionist` role
  3. confirm that user cannot reach /api/payroll/
  4. grant `payroll.view` to the receptionist role via PATCH /api/roles/{id}/
  5. confirm the same user, same session, now CAN reach /api/payroll/
  6. restore the role and deactivate the throwaway user

Step 5 is the point: before rbac.py was reconciled with the database rows,
editing a role changed nothing and this step failed.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar, DefaultCookiePolicy

BASE = "http://127.0.0.1:8010"
# Read from the environment so no credential is committed; the defaults match
# the throwaway accounts this harness works with on a local validation database.
ADMIN_PASSWORD = os.environ.get("CRM_VALIDATION_ADMIN_PASSWORD", "Valid-Admin-Pw-2026!z")
USER_PASSWORD = os.environ.get("CRM_VALIDATION_PROBE_PASSWORD", "Probe-Person-Pw-2026!")

# Users are deactivated rather than hard-deleted, so a fixed username would
# collide on the second run. A unique name keeps the probe repeatable.
USERNAME = f"probe{int(time.time())}"

results: list[tuple[str, str, str]] = []


def check(name: str, expected, actual) -> None:
    ok = str(expected) == str(actual)
    results.append((name, str(expected), str(actual)))
    print(f"{'PASS' if ok else 'FAIL'}  {name:<58} expected={expected} got={actual}")


class _AllowSecureOverHttp(DefaultCookiePolicy):
    """Send Secure cookies over plain HTTP.

    The server sets Secure cookies when DEBUG is false - correct for a
    TLS-terminated production deployment. This harness talks plain HTTP to a
    local server, so it opts in the way a browser would once TLS is present.
    """

    def return_ok_secure(self, cookie, request):
        return True


class Session:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.jar.set_policy(_AllowSecureOverHttp())
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def token(self) -> str | None:
        return next((c.value for c in self.jar if c.name == "csrftoken"), None)

    def request(self, method, path, data=None, csrf=True):
        body, hdrs = None, {"Accept": "application/json"}
        if data is not None:
            body = json.dumps(data).encode()
            hdrs["Content-Type"] = "application/json"
        if csrf and method not in {"GET", "HEAD"}:
            # Re-read the cookie per request: Django rotates the CSRF token when
            # the session is established, so a pre-login value is stale. The real
            # client does the same (frontend/src/api/client.ts).
            token = self.token()
            if token:
                hdrs["X-CSRFToken"] = token
                hdrs["Referer"] = BASE
        req = urllib.request.Request(BASE + path, data=body, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=20) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()


def main() -> int:
    admin = Session()
    admin.request("GET", "/api/auth/csrf")
    code, _ = admin.request("POST", "/api/auth/login",
                            {"username": "valadmin", "password": ADMIN_PASSWORD})
    if code != 200:
        print("could not sign in as valadmin:", code)
        return 1
    check("administrator signs in", "200", code)

    roles = json.loads(admin.request("GET", "/api/roles/")[1])["results"]
    role = next((r for r in roles if r["code"] == "receptionist"), None)
    if role is None:
        print("receptionist role not found")
        return 1
    role_id = role["id"]
    canonical = sorted(role["permission_codes"])
    check("receptionist role present", "True", "True")
    check("receptionist lacks payroll.view initially", "False",
          str("payroll.view" in canonical))

    # /api/permissions/ has pagination_class = None, so it returns a bare list.
    payload = json.loads(admin.request("GET", "/api/permissions/")[1])
    all_perms = payload["results"] if isinstance(payload, dict) else payload
    payroll = next(p for p in all_perms if p["code"] == "payroll.view")

    code, body = admin.request("POST", "/api/users/", {
        "username": USERNAME,
        "first_name": "Probe",
        "last_name": "Person",
        "role": role_id,
        "is_active": True,
        "password": USER_PASSWORD,
        "extra_permissions": [],
    })
    check("create probe user in receptionist role", "201", code)
    if code != 201:
        print("create failed:", body[:300])
        return 1
    users = json.loads(admin.request("GET", f"/api/users/?search={USERNAME}")[1])["results"]
    user = next((u for u in users if u["username"] == USERNAME), None)
    if user is None:
        print("probe user not found after create")
        return 1

    person = Session()
    person.request("GET", "/api/auth/csrf")
    code, _ = person.request("POST", "/api/auth/login",
                             {"username": USERNAME, "password": USER_PASSWORD})
    check("probe user signs in", "200", code)

    check("probe is DENIED /api/payroll/ before the grant", "403",
          person.request("GET", "/api/payroll/")[0])

    # --- the thing under test: edit the role through the API ---
    code, _ = admin.request("PATCH", f"/api/roles/{role_id}/",
                            {"permissions": [payroll["id"]]}, csrf=True)
    check("PATCH receptionist permissions via API", "200", code)

    check("probe is ALLOWED /api/payroll/ after the grant", "200",
          person.request("GET", "/api/payroll/")[0])

    canonical_ids = [p["id"] for p in all_perms if p["code"] in set(canonical)]
    code, _ = admin.request("PATCH", f"/api/roles/{role_id}/",
                            {"permissions": canonical_ids}, csrf=True)
    check("restore canonical receptionist permissions", "200", code)
    check("probe is DENIED /api/payroll/ again after restore", "403",
          person.request("GET", "/api/payroll/")[0])

    # Deactivate the throwaway user (the app deactivates rather than deletes).
    code, _ = admin.request("DELETE", f"/api/users/{user['id']}/")
    check("deactivate the throwaway user", "204", code)

    failed = [r for r in results if r[1] != r[2]]
    print()
    print(f"TOTAL {len(results)} checks, {len(results)-len(failed)} passed, {len(failed)} failed")
    for name, exp, act in failed:
        print(f"  FAIL {name}: expected {exp}, got {act}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
