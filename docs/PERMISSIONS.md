# Permissions

One matrix, in one file: `backend/apps/accounts/rbac.py`. It defines the
permission codes, the role → permission map, and the role-filtered navigation.
Views, object scoping and the sidebar all read from it, so a permission change
cannot leave the UI and the API disagreeing.

## Roles

| Role | Code | Intent |
|---|---|---|
| Super Admin | `super_admin` | Everything, including users, roles, settings and the audit log. |
| Manager | `manager` | Runs the centre: students, groups, teachers, attendance, exams, finance, reports, CRM. Approves payroll. Cannot change roles or system settings. |
| Accountant | `accountant` | Payments, income, expenses, payroll execution, financial reports. No academic write access, no user administration. |
| Receptionist | `receptionist` | Leads, trials, registrations, students, groups, basic payment collection, attendance visibility. |
| Teacher | `teacher` | Own groups only: attendance, exams, results, timetable. No financial data at all. |

## Permission codes

Grouped as `<module>.<action>`:

- `dashboard.view`
- `students.view`, `students.manage`
- `leads.view`, `leads.manage`, `trials.view`, `trials.manage`, `admissions.manage`
- `groups.view`, `groups.manage`, `groups.override_capacity`
- `courses.view`, `courses.manage`
- `rooms.view`, `rooms.manage`
- `teachers.view`, `teachers.manage`
- `attendance.view`, `attendance.manage`
- `exams.view`, `exams.manage`, `results.enter`
- `schedule.view`, `schedule.manage`
- `finance.view`, `finance.manage`
- `invoices.view`, `invoices.manage`, `payments.manage`, `income.manage`, `expenses.manage`
- `payroll.view`, `payroll.manage`, `payroll.approve`
- `reports.view`, `reports.finance`
- `notifications.view`
- `settings.view`, `settings.manage`
- `users.view`, `users.manage`, `roles.manage`
- `audit.view`

## How enforcement works

1. **Endpoint level.** Every viewset declares `permission_classes =
   [RequirePerms(Perm.X)]`. `RequirePerms` is a factory that returns a DRF
   permission class; it resolves the caller's effective codes and answers
   accordingly. Note: an overridden `get_permissions()` must return
   *instances* (`[RequirePerms(Perm.X)()]`) because DRF only auto-instantiates
   the entries of `permission_classes`.
2. **Object level.** Teachers are scoped to their own records inside
   `get_queryset()` — their groups, students, attendance sheets, exams and
   timetable. A teacher who asks for another teacher's group receives 404, not
   the data.
3. **Field level.** Teacher responses never include financial payloads, because
   the endpoints that carry them are unreachable for that role in the first
   place.
4. **Navigation.** `GET /api/auth/me` returns `navigation` already filtered by
   the matrix; `GET /api/auth/navigation` returns it alone. The SPA renders the
   sidebar from that server description, so a new module cannot leak into a menu
   it does not belong to.
5. **Frontend.** `hasPerm(code)` exists in the SPA for convenience (hiding an
   action the user cannot perform). It is never the enforcement — the server
   check is.

## Payload shaping, not just endpoint gating

Some endpoints return data that is legitimate for one role and sensitive for
another, so they filter their *content* as well as their access:

- `GET /api/dashboard` returns `kpis.finance: null`, no financial widgets, no
  payment/payroll alerts, `kpis.crm: null` and an at-risk list restricted to
  their own students when the caller is a teacher. Otherwise every teacher login
  would be a side door into the finance module.
- `GET /api/alerts` applies the same scoping (`reporting.services.alert_scope_for`).
- `GET /api/search?q=` restricts a teacher to their own students and groups.
- `POST /api/alerts` (the centre-wide refresh) needs `reports.view` or
  `reports.finance`, because it writes a single row set for everyone.

Regression tests for these live in `backend/tests/test_teacher_scoping.py`.

## Object-level guards for payload-supplied relations

Scoping a queryset is not enough when the request body names a relation. Any
endpoint that accepts a `group` from the client must call
`TeacherGroupGuardMixin.assert_group_access(group)` before acting:

- `POST /api/attendance/` (opening a sheet)
- `POST /api/exams/` and `PATCH /api/exams/{id}/` (creating or editing an exam)

Without that guard a teacher can open a sheet for — or create an exam in —
another teacher's group while still passing every endpoint-level permission
check. Tests: `backend/tests/test_teacher_scoping.py`.

## Effective permissions of a user

```
superuser                → every permission
otherwise                → role permissions ∪ per-user extra_permissions
```

Extra grants are additive and individually auditable (`AuditLog.Action.PERMISSION`
records the before/after permission sets of any user or role change).

## Changing the matrix

1. Edit `rbac.py` (add the code to `PERMISSION_CATALOG` and to the relevant role
   sets).
2. Run `manage.py sync_rbac`. New codes are added to existing roles without
   discarding custom grants; `--reset-permissions` forces system roles back to
   the canonical sets.
3. To restore one role: `POST /api/roles/{id}/reset-to-default/`.

## Verifying it holds

`backend/apps/accounts/tests/test_permissions.py` asserts the invariants that
matter: teachers hold no financial or audit permission, accountants hold no
academic write permission, managers may approve payroll but not edit roles,
navigation is role-filtered, and the API returns 403 when a role reaches for an
endpoint outside its remit.
