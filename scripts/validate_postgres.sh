#!/usr/bin/env bash
# Full production-mode validation sequence against a real PostgreSQL database.
# Usage: bash scripts/validate_postgres.sh
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

PY="$REPO_ROOT/.venv/bin/python"
export DATABASE_URL="postgres://temurbek@127.0.0.1:5432/crm_validation"
export DJANGO_DEBUG=false
export DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1"
# Generate a real secret at runtime - never embed one in a script.
export DJANGO_SECRET_KEY="$($PY -c 'import secrets; print(secrets.token_urlsafe(64))')"

echo "=== 1. migrate (already applied check) ==="
$PY manage.py migrate --noinput 2>&1 | tail -3

echo; echo "=== 2. sync_rbac ==="
$PY manage.py sync_rbac 2>&1 | tail -3

echo; echo "=== 3. collectstatic ==="
$PY manage.py collectstatic --noinput 2>&1 | tail -3

echo; echo "=== 4. system check ==="
$PY manage.py check 2>&1 | tail -3

echo; echo "=== 5. deploy check ==="
$PY manage.py check --deploy 2>&1 | tail -25 || true
