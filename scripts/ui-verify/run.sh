#!/usr/bin/env bash
#
# Verify the CRM's user interface in a real browser.
#
# Compiles the SPA, then drives Chromium against a running dev server and
# reports console errors, runtime errors, failed requests, horizontal overflow,
# unnamed controls and structural faults for every route at three viewports.
#
# A green build proves the code compiles. Only this proves a page works.
#
# Usage:
#   scripts/ui-verify/run.sh                       # full sweep
#   ROUTES=/payments,/attendance scripts/ui-verify/run.sh   # quick iteration
#   BASE_URL=http://localhost:5173 scripts/ui-verify/run.sh
#
# Playwright is installed in a throwaway directory (/tmp/ui-verify) so it never
# becomes a dependency of the application.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$REPO_ROOT/frontend"
HARNESS_SRC="$REPO_ROOT/scripts/ui-verify"
HARNESS_RUN="${HARNESS_RUN:-/tmp/ui-verify}"
BASE_URL="${BASE_URL:-http://localhost:5199}"
EXPECTED_TITLE="${EXPECTED_TITLE:-Learning Centre CRM}"
CRM_USER="${CRM_USER:-manager}"
CRM_PASS="${CRM_PASS:-Demo12345!}"

echo "== 1/4  typecheck =="
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "   skipped (SKIP_BUILD=1)"
else
  (cd "$FRONTEND" && npm run typecheck)
fi

echo
echo "== 2/4  production build =="
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "   skipped (SKIP_BUILD=1) — the dev server transpiles on demand, so the"
  echo "   browser sweep below still exercises the real pages."
else
  (cd "$FRONTEND" && npm run build)
fi

echo
echo "== 3/4  harness ($HARNESS_RUN) =="
mkdir -p "$HARNESS_RUN"
if [ ! -d "$HARNESS_RUN/node_modules/playwright" ]; then
  echo "   installing playwright (outside the project, as it must be)"
  (cd "$HARNESS_RUN" && npm init -y >/dev/null 2>&1 && npm i playwright@latest >/dev/null && npx playwright install chromium)
fi
cp "$HARNESS_SRC"/*.mjs "$HARNESS_RUN/"

echo
echo "== 4/4  browser sweep against $BASE_URL =="
if ! curl -sf -o /dev/null "$BASE_URL/"; then
  echo "BLOCKER: nothing is serving $BASE_URL." >&2
  echo "Start the SPA first, e.g.:  cd frontend && npm run dev -- --port 5199 --strictPort" >&2
  echo "and the API:               cd backend && ../.venv/bin/python manage.py runserver 127.0.0.1:8000" >&2
  exit 2
fi

# Identity first: port 5173 is often held by another project's dev server, and a
# harness pointed at the wrong app produces a confident report about the wrong app.
if ! curl -s "$BASE_URL/" | grep -q "$EXPECTED_TITLE"; then
  echo "BLOCKER: $BASE_URL is serving a different application (no '$EXPECTED_TITLE' in its HTML)." >&2
  exit 3
fi

JAR="$(mktemp -d)"
PREFLIGHT_TOKEN="$(curl -s -c "$JAR/j.txt" "$BASE_URL/api/auth/csrf" \
  | "$(command -v python3)" -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])' 2>/dev/null || true)"
LOGIN_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR/j.txt" -c "$JAR/j.txt" \
  -X POST -H 'Content-Type: application/json' -H "X-CSRFToken: $PREFLIGHT_TOKEN" \
  -d "{\"username\":\"$CRM_USER\",\"password\":\"$CRM_PASS\"}" "$BASE_URL/api/auth/login" || echo 000)"
rm -rf "$JAR"
if [ "$LOGIN_CODE" != "200" ]; then
  echo "BLOCKER: login as '$CRM_USER' returned $LOGIN_CODE. Is the database seeded?" >&2
  exit 3
fi
echo "   identity confirmed: '$EXPECTED_TITLE' at $BASE_URL, login as $CRM_USER OK"

command -v node >/dev/null || { echo "BLOCKER: node is not on PATH." >&2; exit 2; }

cd "$HARNESS_RUN"
# ROUTES must be passed as an assignment, not expanded into a bare word: an
# empty value is fine, the harness treats it as "no filter".
ROUTES="${ROUTES:-}" \
BASE_URL="$BASE_URL" EXPECTED_TITLE="$EXPECTED_TITLE" CRM_USER="$CRM_USER" CRM_PASS="$CRM_PASS" \
OUT_DIR="${OUT_DIR:-/tmp/uiverify/shots}" \
node check.mjs
