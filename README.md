# Learning Centre CRM

An operating system for a private learning centre: CRM pipeline, students,
groups, attendance, exams, scheduling, billing, payments, payroll and
management reporting — on one shared data model, with role-based access and a
full audit trail.

Backend: Django 5.2 + Django REST Framework. Frontend: React + TypeScript
(Vite), served by Django in production. Money is `Decimal` everywhere; every
figure on every screen is computed from database rows.

---

## Quick start (development)

```bash
# 1. Backend
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py sync_rbac        # creates roles + permissions
../.venv/bin/python manage.py seed_demo_data   # realistic demo centre
../.venv/bin/python manage.py createsuperuser  # optional
../.venv/bin/python manage.py runserver 0.0.0.0:8000
```

```bash
# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api to :8000)
```

Or in one step each: `make install && make migrate && make rbac && make seed`
and `make frontend-install && make frontend-dev`.

### Demo accounts (created by `seed_demo_data`)

| Role | Username | Password |
|---|---|---|
| Super Admin | `admin` | `Demo12345!` |
| Manager | `manager` | `Demo12345!` |
| Accountant | `accountant` | `Demo12345!` |
| Receptionist | `reception` | `Demo12345!` |
| Teacher | `teacher.john` | `Demo12345!` |

Change these before any real deployment.

---

## Production

```bash
cd frontend && npm run build      # writes frontend/dist
docker compose up --build -d      # Postgres + Django (serving the built SPA)
```

`docker compose` sets `DATABASE_URL`; the same image runs on any host that
provides Postgres. Without `DATABASE_URL` the application falls back to SQLite,
which is what local development and the test suite use.

Environment variables (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DJANGO_DEBUG` | `false` in production |
| `DJANGO_SECRET_KEY` | required in production |
| `DATABASE_URL` | `postgres://user:pass@host:5432/uchebniycrm` |
| `DJANGO_ALLOWED_HOSTS` | comma-separated host names |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | comma-separated origins when behind a proxy |
| `DJANGO_TIME_ZONE` | default `Asia/Tashkent` |

---

## Testing

```bash
cd backend && ../.venv/bin/python -m pytest        # full suite
make test
```

The suite covers the rules that carry money and trust: duplicate-attendance
prevention, attendance percentages, invoice/partial-payment arithmetic, overdue
buckets, payment voiding, all four payroll models, payroll immutability after
approval, schedule conflicts (teacher/room/group), and role enforcement on the
API.

---

## Behaviour worth knowing

- **Billing is idempotent.** `POST /api/billing-periods/generate` creates one
  invoice per active student per period and skips the ones that already exist.
- **Payments are append-only.** Corrections void a payment with a reason; the
  invoice balance is then recomputed from the remaining transactions.
- **Payroll freezes on approval.** Recalculating an approved or paid run is
  refused, and every item stores a snapshot of the policy that produced it.
- **Attendance cannot be duplicated.** One session per group per date and one
  record per student per session, enforced by database constraints.
- **Teachers see only their own groups, students and timetable**, and never any
  financial data. This is enforced server-side, not by hiding buttons.
- **Alerts are deduplicated per day** and always link to the records that
  caused them.

---

## Documentation

- `docs/ARCHITECTURE.md` — layers, modules, and how a request flows
- `docs/DATABASE.md` — entity reference and the integrity constraints
- `docs/API.md` — every endpoint, grouped by domain
- `docs/PERMISSIONS.md` — the role matrix and how it is enforced
- `docs/DEVELOPMENT.md` — setup, migrations, seeding, deployment
- `scripts/smoke_api.sh` — live end-to-end HTTP verification harness
- `.hermes/plans/2026-09-20-learning-centre-crm.md` — the build plan
