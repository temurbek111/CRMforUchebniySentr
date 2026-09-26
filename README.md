# Learning Centre CRM

An operating system for a private learning centre: CRM pipeline, students,
groups, attendance, exams, scheduling, billing, payments, payroll and
management reporting — on one shared data model, with role-based access control
and a full audit trail.

- **Backend:** Django 5.2 + Django REST Framework
- **Frontend:** React 18 + TypeScript, built with Vite
- **Database:** PostgreSQL in production, SQLite for local development and tests
- **Serving:** one process — Gunicorn serves the API, the admin, the built SPA
  and the static files. No CORS, no second origin.

---

## Architecture

```
Browser
   │  HTTPS (terminated by Cloudflare / nginx / your proxy)
   ▼
Gunicorn + Django                    ← single origin
   ├── /api/*        REST API (session auth + CSRF)
   ├── /admin/*      Django admin
   ├── /static/*     WhiteNoise — collected static + the built SPA bundle
   ├── /media/*      user uploads (persistent volume)
   └── /*            SPA entry point (every non-API route)
   ▼
PostgreSQL
```

The frontend calls the API with **relative** URLs (`/api/...`) and
`credentials: 'include'`. Session cookies are same-origin, and the CSRF cookie
is echoed in `X-CSRFToken`. There is deliberately no CORS configuration.

Full details: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
`docs/PERMISSIONS.md`.

---

## Features

| Area | What works |
|---|---|
| Auth | Session login/logout, CSRF-enforced login, password change, admin password reset (revokes target sessions), self-deactivation guards |
| RBAC | 43 permissions across 5 system roles; enforced server-side on every endpoint, plus a role-filtered navigation payload |
| Students | List/search/filter/paginate, create/edit, contact + enrolment data, per-student attendance, exams, payments, notes and activity tabs |
| Groups | CRUD, membership, teacher/course/room assignment, timetable slots, active/inactive, five detail tabs |
| Teachers | CRUD, profile, assigned groups, schedule, salary view for authorised roles only |
| Courses | CRUD, levels, pricing, activate/deactivate |
| Attendance | Group → lesson/date → students → status (present/absent/late/excused), duplicate-protected, reporting |
| Exams & results | Exam creation across 7 types, component-based scoring, validated ranges, progress and history |
| Schedule | Timetable, calendar, rooms; teacher/room/group double-booking prevented; timezone-aware (`Asia/Tashkent`) |
| CRM | Lead → trial → admission → student pipeline, sources, notes, follow-ups, conversion |
| Finance | Payments, invoices, income, expenses, ledger, balances, outstanding/overdue, all in `Decimal` |
| Payroll | Salary periods, calculation, approval and payment workflow, history |
| Reports | Students, attendance, exams, payments, income, expenses, payroll, CRM pipeline; server-computed, CSV export |
| Notifications | Per-user list, unread count, mark read / mark all read |
| Audit | Who did what, when, with before/after diffs; read-only through the API |
| Settings | System settings, users, roles (permission matrix editor), courses, rooms |

---

## Requirements

- Python 3.13
- Node 20+ and npm (frontend builds)
- Docker + Docker Compose (production path), **or** a PostgreSQL 14+ server
- `uv` is used to create the venv in the examples below; plain `venv` works too

---

## Local development

```bash
make install          # create .venv and install backend dependencies
make migrate          # apply migrations
make rbac             # sync permissions and roles
make seed             # optional: realistic demo data
make run              # Django on 127.0.0.1:8000

make frontend-install # in another terminal
make frontend-dev     # Vite on :5173 — BROWSE THIS
```

`make dev-check` reports whether both servers are up. **Browse `localhost:5173`**
(the Vite dev server, which proxies `/api` to Django). `:8000` is the engine
room — it serves the built bundle, not live-reloading sources.

> Local development uses SQLite (`backend/db.sqlite3`) when `DATABASE_URL` is
> unset. Nothing about production is SQLite.

---

## Demo data (development only)

`make seed` (`manage.py seed_demo_data`) builds a complete, coherent centre:
courses, rooms, teachers with login accounts, ~90 students with real enrolment
history, five months of invoices and payments (paid, partial, overdue),
attendance, exams with results, a lead pipeline with trials and conversions,
expenses, a paid payroll run plus one awaiting approval, notifications and audit
history.

**It creates demo logins — all with the password `Demo12345!`:**

| Role | Username |
|---|---|
| Super Admin | `admin` |
| Manager | `manager` |
| Accountant | `accountant` |
| Receptionist | `reception` |
| Teacher | `teacher.john` |

> ⚠️ These are seed accounts for development. **Never run `seed_demo_data`
> against a production database, and never ship these credentials.** Production
> uses `manage.py create_admin` (below).

---

## Environment variables

Copy `.env.example` to `.env`. `.env` is gitignored and must never be committed.

| Variable | Required | Purpose |
|---|---|---|
| `DJANGO_DEBUG` | — | `true` (default) locally; **must be `false`** in production |
| `DJANGO_SECRET_KEY` | **production** | Random secret. The app refuses to start in production without it, and refuses known placeholder values |
| `DJANGO_ALLOWED_HOSTS` | **production** | Comma-separated hostnames. The app refuses to start in production while it is still the localhost default |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | behind a proxy | Comma-separated `https://` origins |
| `DJANGO_TIME_ZONE` | — | Default `Asia/Tashkent` |
| `DATABASE_URL` | production | `postgres://user:pass@host:5432/dbname`. Unset ⇒ SQLite |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `docker compose` | Build the `db` service **and** the web `DATABASE_URL`; there is no default password |
| `DJANGO_SECURE_PROXY` | behind TLS | `true` enables HSTS, SSL redirect and the `X-Forwarded-Proto` header |
| `DJANGO_SECURE_SSL_REDIRECT` | — | Default `true` when `DJANGO_SECURE_PROXY=true` |
| `DJANGO_HSTS_SECONDS` | — | Default `31536000` (1 year) |
| `WEB_PORT` | — | Host port for the web container (default `8000`) |

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## Docker

```bash
export POSTGRES_PASSWORD='<a strong unique password>'
export DJANGO_SECRET_KEY='<output of the command above>'
export DJANGO_ALLOWED_HOSTS='crm.example.uz'

docker compose up --build -d
docker compose ps
docker compose logs -f web
```

Then create the first administrator:

```bash
docker compose exec web python manage.py create_admin --username admin
```

What the container does on start (all idempotent, so restarts are safe):
waits for PostgreSQL → `migrate` → `sync_rbac` → `collectstatic` → Gunicorn.

- The image is a **multi-stage build**: the SPA is compiled in a Node stage, the
  Python dependencies are installed into a venv, and the runtime stage carries
  only runtime OS libraries — no compilers. It runs as a **non-root user**.
- `media` and `static` are named volumes, so uploads survive container
  replacement.
- Both `db` and `web` declare healthchecks; `docker compose ps` shows health.

> `docker compose` refuses to start without `POSTGRES_PASSWORD` and
> `DJANGO_SECRET_KEY`. That is intentional — a production stack should not boot
> with an implicit credential.

---

## Creating the first administrator

`createsuperuser` alone is **not** enough: this application drives access from
`User.role`, so a superuser with no role leaves every permission check pointing
at nothing. `create_admin` sets both the superuser flag and the `super_admin`
role.

```bash
cd backend

# interactive — prompts twice, password never enters shell history:
../.venv/bin/python manage.py create_admin --username admin

# non-interactive:
DJANGO_ADMIN_PASSWORD='<a long unique password>' \
  ../.venv/bin/python manage.py create_admin \
    --username admin --email admin@example.uz --no-input
```

The password is validated by Django's validators. The command is idempotent.

---

## Database & migrations

```bash
make migrate                                             # apply
cd backend && ../.venv/bin/python manage.py makemigrations  # generate
cd backend && ../.venv/bin/python manage.py makemigrations --check --dry-run  # CI guard
```

Migrations apply cleanly from an empty database — verified on PostgreSQL 15.
`docs/DATABASE.md` documents the schema.

---

## Testing

```bash
make test        # or: cd backend && ../.venv/bin/python -m pytest -q
make check       # Django system check + makemigrations guard + TypeScript
```

Tests run on in-memory SQLite for speed; CI runs them on **both** SQLite and
PostgreSQL so engine-specific breakage cannot hide.

### Live verification

```bash
# production sequence on a real PostgreSQL database:
bash scripts/validate_postgres.sh

# real HTTP against a running production server (CSRF, login, RBAC, logout):
.venv/bin/python scripts/serve_production.py &
.venv/bin/python scripts/validate_live.py
```

The interface can also be swept in a real browser:

```bash
scripts/ui-verify/run.sh     # Chromium, three viewports, fails on console errors
```

---

## Production deployment

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Set `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`,
   `DJANGO_CSRF_TRUSTED_ORIGINS`.
3. Behind a TLS proxy, set `DJANGO_SECURE_PROXY=true`.
4. `docker compose up --build -d`.
5. `docker compose exec web python manage.py create_admin --username admin`.
6. Verify: `curl https://your-host/api/health`.
7. Schedule a daily `manage.py refresh_alerts` for the notification centre.
8. Back up the database. Financial history matters more than uptime.

The full release checklist is in `docs/DEVELOPMENT.md`.

---

## Health endpoint

```
GET /api/health  →  200  {"status":"ok","time":"...","centre":"..."}
```

No authentication required; safe for load-balancer and container healthchecks.

---

## Static files & media

- `collectstatic` writes to `staticfiles/`; **WhiteNoise** serves it in
  production (gzip + `Vary`, hashed filenames for cache busting).
- The Vite build emits `/static/assets/...` (`base: '/static/'`), which is
  exactly where WhiteNoise serves the bundle from. If a build ever emits
  `/assets/...`, the SPA catch-all answers with HTML and the app silently fails
  to boot — CI asserts against this.
- User uploads live in `media/` and must be a persistent volume in production.

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:8000`** — nothing is listening. Django is not running.
Run `make dev-check`, then `make run`.

**Blank page in a production build** — the SPA loaded but its JavaScript did
not. Check that `frontend/dist/index.html` references `/static/assets/...` and
that `collectstatic` has run. CI guards this.

**`ImproperlyConfigured: DJANGO_SECRET_KEY must be set`** — expected in
production. Set the variable; do not lower `DJANGO_DEBUG` to silence it.

**`ImproperlyConfigured: DJANGO_ALLOWED_HOSTS is still the development
default`** — set it to the real hostname(s).

**Can't log in over plain HTTP in production mode** — session and CSRF cookies
are `Secure` when `DEBUG=false`. Serve over HTTPS (correct) or set
`DJANGO_DEBUG=true` for local HTTP work.

**`docker compose` exits complaining about `POSTGRES_PASSWORD`** — set it in
`.env`. This is deliberate; there is no default.

**Directly refreshing `/students` returns 404** — only possible in the Vite dev
server. Django serves the SPA entry point for all non-API routes.

---

## License

No license file is included in this repository. Unless a license is added
explicitly, the code is **all rights reserved** by its author and may not be
reused or redistributed without permission.
