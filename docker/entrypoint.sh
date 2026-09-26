#!/bin/sh
# Container entrypoint: prepare the database and static files, then hand off to
# the command given in CMD (Gunicorn in production).
#
# Every step here is idempotent, so a container restart is always safe.
# `set -e` stops the boot on any failure instead of starting a half-configured
# server that would answer 500s.
set -e

echo "[entrypoint] waiting for the database..."
# Django cannot migrate before PostgreSQL accepts connections. docker-compose
# gates on the db healthcheck, but that only covers a local compose run; this
# loop also covers Compose-less deployments and slow disks.
python - <<'PY'
import os, sys, time
import django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()
from django.db import connections
from django.db.utils import OperationalError

for attempt in range(1, 31):
    try:
        connections["default"].cursor()
        print(f"[entrypoint] database ready after {attempt} attempt(s)")
        sys.exit(0)
    except OperationalError as exc:
        print(f"[entrypoint] not ready ({exc}); retrying in 2s", flush=True)
        time.sleep(2)
print("[entrypoint] database did not become ready in time", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] applying migrations..."
python manage.py migrate --noinput

echo "[entrypoint] syncing roles and permissions..."
python manage.py sync_rbac

echo "[entrypoint] collecting static files..."
python manage.py collectstatic --noinput

echo "[entrypoint] starting: $*"
exec "$@"
