# API

Base path: `/api`. Session authentication (Django session cookie + `X-CSRFToken`
header read from the `csrftoken` cookie). All writes require a valid session.

List responses share one envelope:

```json
{ "count": 128, "page": 1, "page_size": 25, "total_pages": 6,
  "next": "...", "previous": null, "results": [ ... ] }
```

Errors are uniform:

```json
{ "detail": "Validation failed.", "errors": { "amount": ["A payment must be greater than zero."] } }
```

Common query parameters on list endpoints: `page`, `page_size`,
`search`, `ordering`, plus per-domain filters (`?group=`, `?status=`, `?from=`, `?to=`).

## Authentication — `/api/auth`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/auth/csrf` | public | Issue the CSRF cookie |
| POST | `/auth/login` | public | `{username, password}` → user, permissions, navigation |
| POST | `/auth/logout` | session | End the session (audited) |
| GET | `/auth/me` | session | Current user + permissions + navigation |
| PATCH | `/auth/me` | session | Update own name/email/phone |
| POST | `/auth/password` | session | Change own password |
| GET | `/auth/navigation` | session | Role-filtered navigation alone |

## Core — `/api`

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness probe |
| GET/PATCH | `/settings` | `settings.view` / `settings.manage` | Runtime business configuration |
| GET | `/notifications` | session | Notification centre (filters: `unread`, `kind`, `severity`) |
| POST | `/notifications/{id}/read`, `/notifications/read-all` | session | Mark as read |
| GET | `/notifications/unread-count` | session | Badge count |
| GET | `/audit` | `audit.view` | Audit trail (filters: `entity`, `action`, `actor`, `search`, `date_from`, `date_to`) |
| GET | `/audit/filter-options` | `audit.view` | Distinct entities/actions for the UI dropdowns |

## Students & academics

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/students` | `students.view` / `students.manage` | List/create students (filters: `status`, `group`, `course`, `teacher`, `registered_from/to`) |
| GET/PATCH/DELETE | `/students/{id}` | `students.view` / `students.manage` | Detail/update; DELETE archives |
| GET | `/students/{id}/overview` | `students.view` | Profile header: group, teacher, fee, balance, attendance %, latest score, trend |
| GET | `/students/{id}/attendance` | `students.view` | Monthly breakdown + session rows + calendar map |
| GET | `/students/{id}/exams` | `students.view` | Exam history with progress summary |
| GET | `/students/{id}/payments` | `students.view` | Invoices + payment transactions + balance |
| GET | `/students/{id}/balance` | `students.view` | Outstanding balance summary |
| GET/POST | `/students/{id}/notes` | view / `students.manage` | Internal notes |
| POST | `/students/{id}/change-status` | `students.manage` | Lifecycle change (audited, stamps `left_at`) |
| POST | `/students/{id}/transfer` | `students.manage` | Move to another group, preserving history |
| GET | `/students/{id}/activity` | `students.view` | Merged timeline: enrolments, payments, audit events |
| GET/POST | `/groups` | `groups.view` / `groups.manage` | Groups with live student counts |
| GET | `/groups/{id}/students`, `/memberships` | `groups.view` | Current roster / full history |
| POST | `/groups/{id}/enroll` | `groups.manage` | Enrol (capacity-checked; override needs `groups.override_capacity`) |
| POST | `/groups/{id}/remove-student`, `/transfer`, `/change-teacher` | `groups.manage` | Membership operations |
| GET | `/groups/{id}/capacity`, `/attendance-summary`, `/performance`, `/schedule`, `/finance-summary` | `groups.view` | Group dashboards |
| GET/POST | `/courses`, `/rooms`, `/teachers`, `/guardians`, `/memberships`, `/student-notes` | per module | CRUD; teachers DELETE archives; teacher creation can also create a login account |

## Schedule

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/schedule` | `schedule.view` / `schedule.manage` | Timetable slots (filters: `group`, `teacher`, `room`, `weekday`) |
| GET | `/schedule/today`, `/schedule/week?week_start=` | `schedule.view` | Day/week views |
| PATCH/DELETE | `/schedule/{id}` | `schedule.manage` | Update/remove a slot |

Conflicts (teacher, room, group) are detected server-side; the response is a
400 with `errors` naming the resource that clashes.

## Attendance

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/attendance` | `attendance.manage` | Open (or fetch) a sheet for `{group, date, slot?}` — idempotent |
| GET | `/attendance/{id}` | `attendance.view` | Full roster + current marks + statistics |
| POST | `/attendance/{id}/mark` | `attendance.manage` | Bulk marking: `{records: [{student, status, reason?}], submit?}` |
| POST | `/attendance/{id}/mark-all-present`, `/submit` | `attendance.manage` | Fast paths |
| GET | `/attendance/today`, `/incomplete`, `/summary`, `/absences` | `attendance.view` | Daily totals, missing sheets, centre summary, repeated-absence list |
| GET | `/attendance-records` | `attendance.view` | Raw records (filters: `student`, `session`, `status`, `date_from/to`) |

## Exams

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/exams` | `exams.view` / `exams.manage` | Exams; `components` can be supplied at creation |
| GET | `/exams/{id}/components` | `exams.view` | Component definition |
| POST | `/exams/{id}/results` | `results.enter` | Record results (simple or per-component) |
| GET | `/exams/{id}/results` | `exams.view` | Full result sheet with statistics |
| POST | `/exams/{id}/publish` | `exams.manage` | Publish results and raise one notification |
| GET | `/results`, `/results/...` | `exams.view` | Result listings and performance views |

## Finance

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/invoices` | `invoices.view` / `invoices.manage` | Student invoices (`?overdue=1`, `?student=`, `?period_start=`) |
| POST | `/invoices/{id}/waive`, `/cancel` | `invoices.manage` | Waive or cancel (both need a reason) |
| GET/POST | `/payments` | `invoices.view` / `payments.manage` | Payment transactions |
| POST | `/payments/{id}/void` | `payments.manage` | Void with a reason (balance recomputed) |
| GET/POST/PATCH | `/income`, `/expenses` | `finance.view` + `income.manage`/`expenses.manage` | Non-fee income and expenses |
| POST | `/income/{id}/void`, `/expenses/{id}/void` | same | Void with a reason |
| GET/POST | `/billing-periods` | `invoices.view` / `invoices.manage` | Periods |
| POST | `/billing-periods/generate` | `invoices.manage` | Monthly billing run `{year, month, due_date?, group?}` — idempotent |
| GET | `/finance/summary` | `finance.view` | Income, expenses, net, outstanding for a range |
| GET | `/finance/summary/outstanding` | `finance.view` | Receivables with 1-7 / 8-30 / 30+ buckets |
| GET | `/finance/summary/breakdown`, `/revenue-by-course` | `finance.view` | Category and course breakdowns |
| GET | `/finance/summary/monthly?year=&month=`, `/series?year=` | `finance.view` | Monthly figures and the 12-month series |

## Payroll

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/salaries` | `payroll.view` / `payroll.manage` | Salary policies (POST creates a new version) |
| GET | `/salaries/current` | `payroll.view` | Policy in force per teacher + lessons this month |
| GET | `/payroll`, `/payroll/{id}` | `payroll.view` | Runs and the full run sheet |
| POST | `/payroll/calculate` | `payroll.manage` | Calculate a period `{period_start, period_end, deductions?}` |
| POST | `/payroll/{id}/approve` | `payroll.approve` | Freeze the run |
| POST | `/payroll/{id}/pay` | `payroll.manage` | Pay it (books a Teacher Salaries expense) |
| GET | `/payroll/payable` | `payroll.view` | Amount owed to teachers + pending runs |
| GET | `/payroll-items` | `payroll.view` | Individual lines |
| GET | `/teachers/{id}/earnings` | `payroll.view` | Compensation history for one teacher |

## CRM

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/leads` | `leads.view` / `leads.manage` | Pipeline (filters: `status`, `source`, `assigned_to`, `has_trial`) |
| POST | `/leads/{id}/activities` | `leads.manage` | Log a call, message or note |
| POST | `/leads/{id}/status`, `/schedule-trial`, `/trial-completed` | `leads.manage` | Pipeline moves |
| POST | `/leads/{id}/convert` | `admissions.manage` | Convert to a student (reuses an existing person by phone instead of duplicating) |
| GET | `/leads/pipeline` | `leads.view` | Conversion metrics by source and assignee |

## Reporting

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/dashboard` | `dashboard.view` | KPIs, widgets, alerts and at-risk students in one payload — **shaped by the caller's role**: a teacher receives `kpis.finance: null`, no financial widgets, no money-related alerts, and an at-risk list limited to their own students |
| GET/POST | `/alerts` | `dashboard.view` (POST also needs `reports.view`/`reports.finance`) | Current alerts / materialise them into notifications |
| GET | `/at-risk` | `reports.view` | At-risk students with the reasons that flagged them |
| GET | `/reports/{name}` | `reports.view` (`reports.finance` for `finance`, `management`) | `students`, `attendance`, `academic`, `finance`, `management`, `groups`, `at-risk` |
| GET | `/reports/{name}/export.csv` | same | CSV download |
| GET | `/search?q=` | session | Global search (teachers are scoped to their own students/groups) |

Note: `/dashboard`, `/search`, `/alerts`, `/at-risk` and `/reports/...` are declared
without a trailing slash; the router-generated resources (`/students/`, `/payments/`, …)
require one.

### Scheduled maintenance

`manage.py refresh_alerts` materialises the current alerts into the notification
centre with per-day dedupe keys, and `--dry-run` lists what is currently active.
Run it daily from cron or a systemd timer.
