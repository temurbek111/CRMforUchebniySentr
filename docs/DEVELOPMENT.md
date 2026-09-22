# Development

## Requirements

- Python 3.13 (the project venv is created by `uv`)
- Node 20+ and npm
- Docker (only for the Postgres production path)

## First-time setup

```bash
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
cd backend && ../.venv/bin/python manage.py migrate
```

Local development and tests use SQLite and need no database server. PostgreSQL is
used when `DATABASE_URL` is set (see `docker-compose.yml` for a working example).

## Roles and permissions

The permission matrix lives in code (`apps/accounts/rbac.py`); the database rows
exist so roles can be inspected and granted:

```bash
cd backend
../.venv/bin/python manage.py sync_rbac
../.venv/bin/python manage.py sync_rbac --reset-permissions   # force canonical sets
```

## Migrations

```bash
cd backend
../.venv/bin/python manage.py makemigrations <app>
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py makemigrations --check --dry-run   # CI guard: must be clean
```

## Demo data

```bash
cd backend
../.venv/bin/python manage.py seed_demo_data            # adds data, skips what exists
../.venv/bin/python manage.py seed_demo_data --reset    # wipes centre data first
```

The seeder builds a complete, coherent centre: courses, rooms, teachers (with
login accounts), groups with timetable slots, ~90 students whose enrolment
history is real, five months of invoices and payments (paid, partial and
overdue), submitted attendance with realistic absences, exams with IELTS-style
components and results, lead pipeline with trials and conversions, expenses, an
approved-and-paid payroll run plus one awaiting approval, notifications and
audit history. Names are realistic but fictional.

## Running

```bash
make run            # Django on :8000
make frontend-dev   # Vite on :5173, proxying /api → :8000
```

The Vite dev server proxies `/api` and `/media` so the session cookie stays
same-origin and CSRF works without CORS configuration.

For a single-process production-style run: build the SPA (`make frontend-build`)
and start Django — it serves `frontend/dist` for any non-API route.

## Testing

```bash
cd backend
../.venv/bin/python -m pytest                       # everything
../.venv/bin/python -m pytest apps/finance -q       # one app
../.venv/bin/python -m pytest -k payroll -vv        # one topic
```

Tests use `pytest-django` with an in-memory SQLite database, so they run in
seconds and never touch your development data.

### Live API verification

`scripts/smoke_api.sh` exercises a running server over real HTTP with real
sessions: it logs in as each role, asserts what each role may and may not reach,
opens an attendance sheet, records a payment, and prints the dashboard figures
so you can see they come from the database.

```bash
cd backend && ../.venv/bin/python manage.py runserver 127.0.0.1:8000 &
cd ..
PY=.venv/bin/python bash scripts/smoke_api.sh     # expect: RESULT: 57 passed, 0 failed
```

## PostgreSQL

SQLite is the default for local work. PostgreSQL is production, and it has been
**verified**, not merely configured — migrations, the seed, the whole test suite
and the live smoke harness all run against Postgres with identical results.

```bash
# 1. create the database (Homebrew Postgres 15 here)
/opt/homebrew/opt/postgresql@15/bin/createdb -h 127.0.0.1 -U temurbek uchebniycrm

# 2. point the app at it (parsed by config.settings.build_databases - no extra package)
export DATABASE_URL="postgres://temurbek@127.0.0.1:5432/uchebniycrm"

cd backend
../.venv/bin/python manage.py migrate --noinput     # applies all 10 apps
../.venv/bin/python manage.py sync_rbac             # 43 permissions, 5 roles
../.venv/bin/python manage.py seed_demo_data --reset

# 3. prove it: the same 83 tests, on Postgres
../.venv/bin/python -c "import os,django;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');django.setup();from django.db import connection;print(connection.vendor, connection.settings_dict['NAME'])"
# → postgresql uchebniycrm
../.venv/bin/python -m pytest -q

# 4. live HTTP against the Postgres-backed server
../.venv/bin/python manage.py runserver 127.0.0.1:8000 &
cd .. && PY=.venv/bin/python bash scripts/smoke_api.sh   # → RESULT: 57 passed, 0 failed
```

Any `postgres://` / `postgresql://` URL works; other schemes raise
`ValueError: Unsupported DATABASE_URL scheme` at startup rather than silently
falling back to SQLite. With no `DATABASE_URL`, the app uses `backend/db.sqlite3`
with `transaction_mode=IMMEDIATE` (needed so concurrent writers do not trip over
SQLite's locking).

## Verifying the interface in a real browser

A green build proves the code compiles. It does not prove a page works. This
project ships a browser harness that does:

```bash
scripts/ui-verify/run.sh                        # typecheck + build + full sweep
ROUTES=/payments,/attendance scripts/ui-verify/run.sh    # quick iteration
SKIP_BUILD=1 scripts/ui-verify/run.sh           # skip compile, sweep only
BASE_URL=http://localhost:5199 scripts/ui-verify/run.sh
```

It drives Chromium over every navigation route at three viewports (desktop
1440×900, tablet 834×1112, mobile 390×844) and fails on console errors, runtime
errors, failed requests, horizontal overflow, controls with no accessible name,
missing skip links, and broken interactive states (auth redirect, invalid-credential
error, form sign-in, global search, tab focus). Screenshots land in
`/tmp/uiverify/shots`.

Playwright is installed into `/tmp/ui-verify` on first run — deliberately **not**
in `frontend/package.json`, so the verification tool never becomes a dependency of
the application.

### Start the servers it needs

```bash
cd backend  && ../.venv/bin/python manage.py runserver 127.0.0.1:8000   # API
cd frontend && npm run dev -- --port 5199 --strictPort                  # SPA (port 5199 is deliberate)
```

Port 5199 matters: **5173 is frequently held by another project's dev server on
this machine**, and the harness refuses to run unless the served page contains the
expected title. A harness pointed at the wrong application produces a confident
report about the wrong application.

### Reading its output honestly

- It filters out `net::ERR_ABORTED`. React StrictMode (dev only) mounts effects
  twice, so the first pass's fetches are aborted by their cleanup — superseded,
  not failed. A real failure shows up as a 4xx/5xx response.
- Verify a claim in the DOM before acting on it. A probe that reads the wrong
  element reports a defect that does not exist (this happened: a due-date check
  read the "Overdue ageing" strip instead of the invoice table and produced three
  false failures).

## Scheduled jobs

Alerts are materialised into the notification centre by a command designed for a
daily timer:

```bash
cd backend
../.venv/bin/python manage.py refresh_alerts --dry-run   # show what is active
../.venv/bin/python manage.py refresh_alerts             # create, deduplicated per day
```

Add it to cron (e.g. `0 7 * * *`). External delivery channels (Telegram, SMS,
email) are declared in `SystemSettings.notification_channels` but are not wired
to a provider — the notification centre is the integration seam.

## Seeding a fresh database from scratch

```bash
make reset-db      # drop db.sqlite3, migrate, sync_rbac, seed
```

## Deployment

```bash
cd frontend && npm run build
docker compose up --build -d
```

Checklist for production:

1. `DJANGO_DEBUG=false`
2. Set a real `DJANGO_SECRET_KEY` and keep it out of the image.
3. Set `DJANGO_ALLOWED_HOSTS` and, behind a proxy, `DJANGO_CSRF_TRUSTED_ORIGINS`.
4. Point `DATABASE_URL` at managed Postgres and run `manage.py migrate` +
   `sync_rbac` as a release step.
5. Serve over HTTPS — session and CSRF cookies become `Secure` automatically
   once `DEBUG` is false.
6. Take database backups. Financial history matters more than uptime.

## Conventions

- Business rules in `services.py`, never in views or components.
- Money always `Decimal`; use `apps/core/money.py` helpers.
- One permission matrix (`rbac.py`) — no ad-hoc role checks in views.
- Every important change writes an `AuditLog` row.
- Add a test for any rule that touches money, attendance, payroll or permissions.
