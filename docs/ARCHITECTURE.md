# Architecture

## Shape of the system

```
React SPA (frontend/)                     Django + DRF (backend/)
  src/api/client.ts  ──HTTP/JSON──▶  config/urls.py → apps/*/views.py
  src/auth/                          apps/*/services.py   ← business rules
  src/layout/                        apps/*/models.py     ← data + constraints
  src/<domain>/                      apps/core/           ← audit, settings, errors
```

One deployable unit. Django serves the built SPA (`frontend/dist`) when the SPA
is not being run by Vite, so a single process can host the whole product.

## Layers and what belongs in each

| Layer | Location | Contains | Must not contain |
|---|---|---|---|
| Models | `apps/<app>/models.py` | fields, relationships, DB constraints, tiny derived properties | workflow orchestration, HTTP concerns |
| Services | `apps/<app>/services.py` | business rules: enrolment, billing, payroll, calculations, alerts | HTTP request/response handling |
| Serializers | `apps/<app>/serializers.py` | validation of external input, representation | business rules that must hold for other callers |
| Views | `apps/<app>/views.py` | permissions, request parsing, calling services, shaping responses | calculations, money arithmetic |
| Core | `apps/core/` | `SystemSettings`, `AuditLog`, `Notification`, money helpers, pagination, error format, audit mixins | domain rules |

The rule of thumb: **if it must be true even when called from a management
command, it lives in a service.** Views only decide *who* may ask.

### Why services instead of fat serializers

`record_payment`, `mark_attendance`, `enroll_student`, `calculate_payroll_run`
and `convert_lead_to_student` are all reachable from the API *and* from
management commands and tests. Putting them in services keeps the rules in one
place and makes them testable without HTTP.

## Request lifecycle (example: recording a payment)

1. `POST /api/payments/` hits `PaymentViewSet.create`.
2. Permissions: `RequirePerms(Perm.PAYMENTS_MANAGE)` reads the role matrix.
3. `PaymentWriteSerializer` validates shape (student exists, amount > 0).
4. `finance.services.record_payment()` enforces the business rules: the invoice
   belongs to the student, the invoice is not waived, the amount does not exceed
   the outstanding balance unless an override was explicitly requested.
5. The payment row is written; `log_action(PAY, …)` appends to the audit trail
   with the old and new balance.
6. `recalculate_invoice_status()` refreshes the stored invoice status.
7. The serializer renders the created payment.

Nothing in that path trusts a figure sent by the browser.

## Modules

| App | Responsibility |
|---|---|
| `core` | runtime settings (currency, thresholds, categories), audit trail, notifications, error format, pagination, file/permission primitives |
| `accounts` | users, roles, permissions, the RBAC matrix, navigation, session auth |
| `academics` | courses, rooms, students, guardians, teachers, groups, historical memberships, student notes |
| `schedule` | recurring timetable slots and server-side conflict detection |
| `attendance` | sessions, records, the fast marking workflow, attendance mathematics |
| `exams` | exams, flexible components, results, grades, performance and trends |
| `finance` | billing periods, invoices, payments, income, expenses, balances, financial summaries |
| `payroll` | versioned salary policies, payroll runs, approval, payment |
| `crm` | leads, activities, trials, admission conversion |
| `reporting` | dashboard, alerts, at-risk detection, reports, CSV export, global search |

Dependencies flow one way: `reporting → (finance, attendance, exams, crm,
academics)`; `payroll → (finance, attendance, academics)`; `finance → academics`;
`attendance → (academics, schedule)`. No circular module imports: cross-app reads
happen inside functions, never at import time.

## Data-integrity strategy

Correctness is pushed down to the database wherever possible, so a bug in a view
or a race between two requests cannot corrupt the ledger:

- `unique_attendance_record_per_session` — no duplicate attendance rows.
- `unique_session_per_group_date_no_slot` — one sheet per group per date.
- `unique_invoice_per_student_period` — one invoice per student per period.
- `unique_teacher_per_payroll_run` — a teacher appears once per run.
- `payment_amount_positive`, `payroll_net_non_negative`, `student_fee_non_negative`
  — negative money is rejected by the database itself.
- `slot_end_after_start`, `membership_left_after_joined`, `policy_valid_date_range`
  — impossible states are unrepresentable.

## Money

Every monetary column is `DecimalField(max_digits=14, decimal_places=2)` and every
arithmetic operation goes through `apps/core/money.py` (`quantize`, `money_field`,
`format_money`) with `ROUND_HALF_UP`. Floats are never used for money, and the
test suite asserts `Decimal` round-tripping.

## Auditability

`apps/core/audit.py` writes append-only `AuditLog` rows with actor, action,
entity, entity id, old value, new value, IP and user agent. Financial and
permission actions are always logged by their services; CRUD viewsets inherit
`AuditedViewSetMixin` to log create/update/delete automatically. The audit log
is read-only in both the API and Django admin.

## Time and timezone

The application runs with `USE_TZ=True`; the display timezone is a setting
(`DJANGO_TIME_ZONE`, default `Asia/Tashkent`). Dates that carry business meaning
(session dates, billing periods, payment dates) are stored as dates, not
datetimes, so a timezone shift can never move a class to the wrong day.

## Frontend structure

`frontend/src` is organised by domain (`students/`, `groups/`, `attendance/`,
`finance/`, …) with a shared component layer (`components/`, `components/charts/`)
and a single typed API client (`api/client.ts`) that owns CSRF handling and error
normalisation. Components render server-computed numbers; they never recalculate
money or attendance.
