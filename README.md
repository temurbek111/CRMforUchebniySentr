                    Learning Centre CRM

An operating system for a private learning centre: CRM pipeline, students,
groups, attendance, exams, scheduling, billing, payments, payroll and
management reporting — on one shared data model, with role-based access and a
full audit trail.

Backend: Django+ Django REST. Frontend: React + TypeScript
(Vite),  



Demo accounts and password

 Role  Username  Password 

 Super Admin  admin Demo12345!
 Manager  manager  Demo12345!
Accountant accountant Demo12345! 
Receptionist reception.  Demo12345!
Teacher teacher.john  Demo12345!

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

Environment variables :

 Variable | Purpose 

DJANGO_DEBUG` | `false` in production |
DJANGO_SECRET_KEY` | required in production |
DATABASE_URL` | `postgres://user:pass@host:5432/uchebniycrm` |
DJANGO_ALLOWED_HOSTS` | comma-separated host names |
DJANGO_CSRF_TRUSTED_ORIGINS` | comma-separated origins when behind a proxy |
DJANGO_TIME_ZONE` | default `Asia/Tashkent` |


