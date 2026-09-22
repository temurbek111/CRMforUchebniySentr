# Learning Centre CRM — Architecture & Implementation Plan

Status: PHASES 1–7 COMPLETE AND VERIFIED · PHASE 8 (frontend modules) IN PROGRESS
Created: 2026-09-20
Repo: /Users/temurbek/uchebniycrm (was EMPTY — greenfield build)

## Progress log (verified, not claimed)

- P1–P7 backend: all 10 apps implemented (43 permission codes, 5 roles, 61 tables/constraints).
- Migrations applied; `manage.py check` clean; `makemigrations --check` clean.
- Test suite: **62 passing** (`cd backend && ../.venv/bin/python -m pytest`), covering
  attendance math + duplicate prevention, invoice/partial/overdue/void payments, all four
  payroll models + approval immutability, schedule conflicts, permissions, teacher object
  scoping, and the full lead→payroll→dashboard lifecycle through the API.
- Live HTTP verification: `bash scripts/smoke_api.sh` → **57 checks, 0 failures** against a
  running server with the seeded database.
- Demo data: `manage.py seed_demo_data` → 100 students, 10 groups, 10 teachers, 5 courses,
  316 invoices, 285 payments, 1,299 audit entries, 47 leads (8 converted), 2 payroll runs.
- Security review found and fixed three real defects: teachers could open attendance sheets
  for groups they do not teach; teachers could create exams for foreign groups; and the
  dashboard leaked finance KPIs, at-risk students for the whole centre and money alerts to
  teachers. All three now have regression tests.
- Frontend: shell + design system + API client build clean (`npm run build`); module pages
  in progress.
- **PostgreSQL verified end to end** (not just configured): migrations applied to a real
  Postgres 15 database, `seed_demo_data --reset` produced identical counts to SQLite
  (100 students / 316 invoices / 285 payments / 1,299 audit entries / 47 leads), the full
  83-test suite passes with the engine reporting `postgresql`, and the live smoke harness
  returns 57 passed / 0 failed against the Postgres-backed server.


## 0. Inspection result (ground truth, verified)

- Directory `/Users/temurbek/uchebniycrm` was empty. No git repo. Nothing to reuse.
- Toolchain verified: Python 3.13 (via uv), uv, node, npm, Docker daemon running.
- No local `psql` client on PATH → local dev/tests use SQLite; Postgres is the
  docker-compose production path via `DATABASE_URL`.
- Conclusion: NEW application. Establish clean production-ready structure.

## 1. Stack decision (and why)

| Concern | Choice | Reason |
|---|---|---|
| Backend | Django 5.x + Django REST Framework | Relational domain with money, RBAC, audit. Batteries included; no microservice overhead. Matches user's stack. |
| DB (dev) | SQLite | Zero-daemon, deterministic tests, all constraints expressible. |
| DB (prod) | PostgreSQL 16 (docker-compose, `DATABASE_URL`) | Real target; identical models. |
| Money | `DecimalField(14,2)` + `Decimal` everywhere | Never float. Enforced at model + formatter layer. |
| Server-rendered vs SPA | SPA: React + TS + Vite, served by Django in prod | Section 49 (frontend by domain). Vite proxy in dev → no CORS hack. |
| Auth | Django session auth + CSRF over DRF, httpOnly cookie | No JWT-in-localStorage XSS surface. Server-side authorization is authoritative. |
| Charts | Hand-rolled SVG components, zero deps | No fake charts, no chart-lib bloat; proven pattern in user's ventriloc project. |
| Styling | CSS custom-property design tokens + per-domain CSS | Design system without a 300KB dependency. |
| Tests | pytest + pytest-django | Required by section 51. |

Rejected: microservices, GraphQL, Celery/Redis (nothing in v1 needs async;
payroll/overdue are computed on demand or by management command), UI kit
dependencies (Tailwind/MUI) — unnecessary weight for a fixed internal product.

## 2. Repo layout

```
uchebniycrm/
  backend/
    manage.py  pyproject.toml  pytest.ini
    config/            settings.py urls.py wsgi.py asgi.py
    apps/
      core/            SystemSettings, AuditLog, Notification, mixins, money, permissions, pagination
      accounts/        User, Role, UserRole, auth API, /api/me
      academics/       Course, Room, Student, Guardian, Group, GroupMembership
      schedule/        ScheduleSlot (+ conflict validation service)
      attendance/      AttendanceSession, AttendanceRecord
      exams/           Exam, ExamComponent, ExamResult
      finance/         Invoice (billing period), Payment, Income, Expense
      payroll/         SalaryPolicy, PayrollRun, PayrollItem
      crm/             Lead, LeadActivity, admission conversion
      reporting/       dashboard aggregation, reports, alerts, at-risk
    tests/             cross-app integration tests
  frontend/            Vite React TS SPA, domain folders, design tokens
  docs/                ARCHITECTURE.md, DATABASE.md, API.md, PERMISSIONS.md, ...
  .hermes/plans/       this plan
```
Apps live under `backend/apps/` with explicit `app_label`, imported as `apps.<x>`.

## 3. Entities & relationships (normalized)

- accounts: User(role FK, is_staff, ...), Role(code, name, permissions M2M→Permission)
- core: SystemSettings(singleton: currency, threshold, passing score, billing day,
  academic year, categories JSON, providers), AuditLog(actor, action, entity, entity_id,
  old/new JSON, ip, ts), Notification(recipient, kind, severity, title, payload, read_at, dedupe_key UNIQUE)
- academics: Course(code, level, default_fee, status); Room(name, capacity, location, equipment, status);
  Student(code, names, dob, gender, contacts, guardian FK null, status, registered_at);
  Guardian(name, phone, email); Group(course FK, teacher FK, room FK, name, capacity, level, monthly_fee,
  start/end, status); GroupMembership(student, group, joined_at, left_at, status) — history never erased.
- schedule: ScheduleSlot(group FK, teacher FK, room FK, weekday, start_time, end_time, effective_from/to)
- attendance: AttendanceSession(group, date, teacher, submitted_at, slot FK null) UNIQUE(group,date,slot);
  AttendanceRecord(session FK, student FK, status, reason, marked_at, modified_by) UNIQUE(session,student)
- exams: Exam(group, course, teacher, name, type, date, max_score default, passing_score);
  ExamComponent(exam FK, name, max_score, order) — flexible multi-component (IELTS ≠ hardcoded);
  ExamResult(exam, component null, student, score, teacher_comment) UNIQUE(exam,component,student)
- finance: Invoice(student, group null, period_start, period_end, amount_due, status, due_date, notes)
  UNIQUE(student, period_start); Payment(invoice FK null, student, amount, paid_at, method, received_by,
  reference, notes, is_void + void_reason) — payments are append-only, never overwritten;
  Income(category, amount, date, description, method, reference, created_by);
  Expense(category, amount, date, description, method, reference, created_by)
- payroll: SalaryPolicy(teacher, model[fixed|per_class|percentage|hybrid], base_amount, per_lesson_rate,
  revenue_share_pct, effective_from, effective_to) — versioned, never mutated;
  PayrollRun(period_start, period_end, status[draft|calculated|approved|paid], approved_by, paid_at, totals);
  PayrollItem(run, teacher, lessons, base, bonuses, deductions, gross, net, snapshot JSON) — frozen snapshot.
- crm: Lead(name, phone, email, source, interested_course, assigned_to, status, trial_date, notes);
  LeadActivity(lead, kind, note, actor, created_at); conversion Lead→Student keeps lead row + link.

Attendance/payroll/invoice uniqueness and non-negative-money checks are DB CheckConstraints,
not just serializer validation (section 37).

## 4. Roles & permission model (section 3, 46)

Permission matrix in ONE place: `apps/accounts/permissions.py` → role sets over domain codes
(`students.view|manage`, `finance.view|manage`, `payroll.approve`, `audit.view`, ...).
- DRF permission classes read the matrix; every viewset declares required codes.
- Object-level: Teacher restricted to own groups/students (`TeacherScopedQuerysetMixin`).
- Teacher never receives finance fields; accountant never receives academic write.
- `GET /api/auth/me` returns the caller's effective permissions → frontend nav visibility
  is derived from the SAME matrix. Frontend hiding is cosmetic, never the enforcement.

## 5. API structure (section 48)

`/api/auth/{login,logout,me}` · `/api/students` · `/api/groups` · `/api/teachers`
`/api/courses` · `/api/rooms` · `/api/schedule` · `/api/attendance` · `/api/exams`
`/api/payments` · `/api/invoices` · `/api/income` · `/api/expenses` · `/api/payroll`
`/api/leads` · `/api/reports/*` · `/api/dashboard` · `/api/notifications` · `/api/audit`
`/api/settings` · `/api/search?q=`
Consistent: DRF pagination envelope, `django-filter` filters, uniform error body
`{"detail": str, "errors": {field: [..]}}` via a custom exception handler, correct status codes.

## 6. Frontend structure (section 49)

Domain folders: `dashboard/ students/ groups/ attendance/ exams/ finance/ teachers/ crm/ reports/ settings/`
Reusable: Table (sort/filter/paginate/column-visibility), Modal, ConfirmDialog, Form fields,
Badge, Card, StatCard, LineChart, BarChart, DonutChart, SearchPalette (Cmd/Ctrl+K), EmptyState,
LoadingState, ErrorState, DatePicker, Pagination.
Domain data hooks wrap a single typed API client (the seam). No business calculations in
components — they render server-computed values (section 27/50).

## 7. Implementation order (sections 60, 63) — actual execution sequence

P1 Foundation: venv, Django project, settings, core app, accounts+RBAC, audit, error format, auth API.
P2 Academics: courses, rooms, students, guardians, groups, memberships.
P3 Operations: schedule + conflict service, attendance + dedupe, exams + components + results.
P4 Finance: invoices/billing, payments (partial/multi), income, expenses, outstanding.
P5 Payroll: policies (4 models), runs, approve, pay, frozen snapshots.
P6 CRM: leads, activities, trial, admission conversion.
P7 Management: dashboard aggregation, alerts, at-risk with reasons, reports, audit UI, global search.
P8 Frontend SPA per module, wired to real endpoints.
P9 Seeds (realistic UZ/RU fictional data), tests, docs, docker, final audit.

Gate per phase: model + service + API + permission + tests green before the next phase.

## 8. Verification plan (sections 7, 51, 65)

- pytest suite: attendance dedupe/% , payments (full/partial/multi/overdue), payroll (all 4 models +
  immutability of approved runs), exams (simple + multi-component + pass rate), schedule conflicts
  (teacher/room/group), permissions (teacher↛finance, accountant↛academic write), lead→student conversion.
- `manage.py check`, `makemigrations --check --dry-run` (no missing migrations).
- Real HTTP verification: runserver + curl every domain endpoint as each role.
- Frontend: `npm run build` must pass; real-browser smoke of dashboard/attendance/students.
- Seed data loaded into a fresh DB to prove the dashboard shows non-fake numbers.

## 9. Explicit non-goals for v1 (stated, not hidden)

No live Telegram/SMS/Email delivery (provider interface only, section 33) — no fake integrations.
No payment-gateway integration. No multi-branch/multi-tenant. No async task queue.
i18n prepared structurally (all copy in one module) but English-only shipped.

## 10. Known risks

- Scope is large; each phase is gated and verified so the repo is never left half-broken.
- SQLite dev vs Postgres prod: mitigated by avoiding SQLite-only constructs; CI/prod path documented
  and Postgres smoke-tested via docker when available.
