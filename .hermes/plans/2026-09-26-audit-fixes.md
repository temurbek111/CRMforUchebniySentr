# Learning Centre CRM — post-audit fixes (2026-09-26)

Three read-only audits ran in parallel (API contract, RBAC/security, DB/query).
Findings that were real, and what was done about them.

## Fixed

1. **docker-compose could not connect to Postgres.** `DATABASE_URL` contained a
   literal `***` password, disagreeing with the `POSTGRES_PASSWORD` default.
   Now interpolated from the same variables the `db` service uses.

2. **Production SPA served HTML in place of its JavaScript.** Vite emitted
   `/assets/...`, which the SPA catch-all answered with index.html (200,
   text/html, 579 bytes) instead of the 651 KB bundle; `/static/assets/...`
   404ed. Fixed with `base: '/static/'` + STATICFILES_DIRS at `dist`; `assets/`
   also excluded from the catch-all. CI asserts the emitted paths.

3. **`UserWriteSerializer.create/update` raised TypeError -> HTTP 500** when
   `extra_permissions` was present: it passed a many-to-many value into
   `User(**kwargs)`. The Users screen sends that field, so creating a user from
   the UI crashed the server. 2 regression tests.

4. **Roles screen was a convincing lie.** Role permission edits were stored but
   authorisation read only `ROLE_MATRIX` in code. `permissions_for_role` now
   reads the role rows (an empty row falls back to the matrix so an unseeded DB
   does not lock everyone out). The old characterisation test was replaced with
   tests asserting the edit takes effect. No cross-request cache: Gunicorn
   workers cannot invalidate each other, and a revocation must not survive in a
   sibling worker.

5. **Login had no CSRF protection.** DRF only enforces CSRF inside
   SessionAuthentication, which fires only for authenticated requests, so an
   anonymous login POST bypassed it (login-CSRF). Added an explicit
   `enforce_csrf(request)`.

6. **`payroll_payable()` always returned 0.00.** It aggregated `net_total`; the
   field is `total_net`. The resulting FieldError was swallowed by a blanket
   `except`, so the dashboard, /payroll/payable and the payable report all
   under-reported teacher liabilities as zero. Verified live: now returns
   5400000.00. 2 tests.

7. **`/api/search` leaked payments and leads.** Gated only by IsAuthenticated;
   student/group results were scoped for teachers but payments and leads were
   not. A teacher could search a student's name and receive receipt numbers,
   amounts and lead contact details. Now gated on `invoices.view` /
   `leads.view`. 6 tests.

8. **Production config failed silently.** SECRET_KEY fell back to a known value
   with DEBUG=false; ALLOWED_HOSTS was never checked. Both now raise
   ImproperlyConfigured. Added opt-in TLS hardening (`DJANGO_SECURE_PROXY`),
   after which `check --deploy` reports zero issues.

9. **Admin password reset / deactivation left live sessions open.** Both now
   flush the target user's sessions.

10. **No secure first-admin path.** Added `manage.py create_admin` (assigns
    `super_admin`; `createsuperuser` alone leaves RBAC unusable). The password is
    never passed as an argument.

## Remaining, deliberately not changed

- **N+1 in the invoice property chain** (the audit measured /api/dashboard at
  roughly 3700 queries). Real, but the fix (annotate Sum over payments) touches
  the finance read path broadly; it deserves its own change with performance
  tests rather than a drive-by edit at the end of an audit.
- **No payment idempotency key** — a double-submitted form records the money
  twice. Needs a product decision on the dedup key.
- **Teachers can read their own students' payment/balance** through the student
  profile endpoints (gated on `students.view`). Scoping is correct, but the
  permission is broader than "teachers hold no financial permission".
- **`ExamResult.percentage`** does not recompute if `Exam.max_score` is edited
  after results exist.

## Not verified

- **The Docker image was never built.** Docker Desktop is not running on this
  machine and the user asked not to use it. The deploy path was validated with
  local PostgreSQL 15 + Gunicorn instead: fresh-database migrations, sync_rbac,
  collectstatic, `check --deploy` (0 issues), and live HTTP auth/RBAC/search.

## Verification commands

```
cd backend && ../.venv/bin/python -m pytest            # 113 passed
cd backend && ../.venv/bin/python manage.py check      # no issues
cd frontend && npm run build                           # tsc + vite, exit 0
bash scripts/validate_postgres.sh                      # migrate/rbac/collectstatic/deploy
.venv/bin/python scripts/serve_production.py &         # then:
.venv/bin/python scripts/validate_live.py              # 28/28
.venv/bin/python scripts/validate_roles_live.py        # 11/11
```
