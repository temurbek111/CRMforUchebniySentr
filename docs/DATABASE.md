# Database model

Normalised relational schema. Money columns are `Decimal(14,2)`; all foreign
keys are declared with explicit `on_delete` behaviour chosen to preserve history.

## Entity map

```
User ──┬── Role ──── Permission
       └── Teacher ──┬── SalaryPolicy
                     ├── PayrollItem ── PayrollRun ── Expense
                     └── Group ──┬── GroupMembership ── Student ── Guardian
Course ── Group ────────────────┤
Room ──── Group / ScheduleSlot ─┤
                                 └── AttendanceSession ── AttendanceRecord ── Student
                                 └── Exam ── ExamComponent
                                     └── ExamResult ── Student

Student ── StudentInvoice ── BillingPeriod
        └── Payment (append-only) ── StudentInvoice
Lead ── LeadActivity        Lead ── converted_student ── Student
Income / Expense ── created_by ── User
AuditLog ── actor ── User      Notification ── recipient ── User
SystemSettings (singleton)
```

## Core

| Model | Notes |
|---|---|
| `SystemSettings` | Singleton (pk=1, cached). Holds centre name, currency, billing day, attendance threshold, absence/failing thresholds, passing score, academic year, and the configurable payment methods, lead sources, income/expense categories and notification channels. Nothing here is hard-coded elsewhere. |
| `AuditLog` | Append-only: actor, action, entity, entity_id, summary, old/new JSON, IP, user agent. Read-only in the API and admin. |
| `Notification` | Internal notification centre. `dedupe_key` (unique) prevents the same alert being raised twice; `link` makes each alert actionable. |

## Accounts

| Model | Notes |
|---|---|
| `Permission` | One capability, e.g. `finance.manage`. Seeded from `PERMISSION_CATALOG` by `manage.py sync_rbac`. |
| `Role` | Named bundle of permissions. System roles cannot be deleted. |
| `User` | `AbstractUser` + `role`, `phone`, and `extra_permissions` for per-user grants beyond the role. `permission_codes()` unions role + extra grants; a superuser holds everything. |

## Academics

| Model | Notes |
|---|---|
| `Course` | Reusable subject: code, level, default monthly fee, duration, status. |
| `Room` | Name, capacity, location, equipment, status. Capacity is enforced when scheduling. |
| `Guardian` | Parent/guardian contact, shared between siblings, matched by phone. |
| `Student` | `code` (STU-0001), names, photo, dob, gender, contacts, guardian, lifecycle `status` (lead → trial → active → paused → graduated/dropped/archived), `left_at`, `monthly_fee_override`, notes. Never hard-deleted. |
| `Teacher` | Teaching staff, optionally linked to a login account (`user`). Archived, not deleted, when they leave. |
| `Group` | Course + teacher + room + capacity + monthly fee + dates + status. |
| `GroupMembership` | Historical student↔group link with `joined_at`/`left_at`/status. A partial unique index allows only one *active* membership per student per group. |
| `StudentNote` | Internal staff note with author and pin flag. |
| `TeacherGroupAssignment` | Optional co-teacher/substitute assignment beyond the primary teacher. |

## Schedule

| Model | Notes |
|---|---|
| `ScheduleSlot` | group + teacher + room + weekday + start/end time + effective date range. `end_time > start_time` and a date-range check are database constraints; teacher/room/group overlaps are rejected by `schedule.services.validate_slot`. |

## Attendance

| Model | Notes |
|---|---|
| `AttendanceSession` | One class meeting: group + date (+ optional slot) + teacher + state (open/submitted) + submitted_at. Unique per group per date. |
| `AttendanceRecord` | student + status (present/absent/late/excused) + reason + note + marked_at + modified_by. Unique per session per student. |

Percentage definition: `attended = present + late`, denominator excludes excused.

## Exams

| Model | Notes |
|---|---|
| `Exam` | group + course + teacher + name + type (quiz, monthly test, midterm, final, mock, placement, custom) + date + max_score + passing_score + published flag. |
| `ExamComponent` | Flexible components (Listening/Reading/Writing/Speaking for IELTS, or anything else) each with their own maximum score. Nothing is hard-coded to one exam system. |
| `ExamResult` | student + exam + optional component + score + max_score + percentage + grade + teacher comment. Unique per exam/component/student. |

## Finance

| Model | Notes |
|---|---|
| `BillingPeriod` | Named period with start/end/due date and a closed flag. |
| `StudentInvoice` | What one student owes for one period. `amount_paid`, `remaining` and `credit` are always aggregated from payment rows, never stored. Unique per student per period. `display_status` derives `overdue` from the due date. |
| `Payment` | Append-only money-in transaction: amount, date, method, received_by, reference, invoice, and `is_void` + `void_reason` for corrections. Positive-amount and void-reason constraints. |
| `Income` | Non-fee income by category (registration, exam fees, other). |
| `Expense` | Money out by category (teacher salaries, rent, utilities, …). Payroll payment books a row here. |

## Payroll

| Model | Notes |
|---|---|
| `SalaryPolicy` | Versioned compensation terms: model (fixed, per_class, percentage, hybrid), base amount, per-lesson rate, revenue share %, lesson bonus, effective range. Creating a new policy closes the previous one the day before. |
| `PayrollRun` | One period: status draft → calculated → approved → paid, totals, approver, payer, and the `Expense` row created on payment. Unique per period. |
| `PayrollItem` | One teacher's line: lesson count, each component amount, gross, deductions, net, plus a frozen `policy_snapshot` and `breakdown`. Once the run is approved the numbers never move again. |

## CRM

| Model | Notes |
|---|---|
| `Lead` | Prospect with source (from settings), interested course, assignee, pipeline status, trial date, notes and `converted_student` link. |
| `LeadActivity` | Timeline entry (note, call, message, trial scheduled/completed, status change) with actor. |

## Reporting

`reporting` owns no tables. It reads across the other apps to build the
dashboard, alerts, at-risk lists, reports and global search — which is why every
number on the dashboard is traceable to a row somewhere else.
