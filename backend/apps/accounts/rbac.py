"""Single source of truth for roles, permission codes and navigation.

Every server-side authorisation decision and every navigational item on the
frontend is derived from this module. Frontend hiding is cosmetic; the checks
here are authoritative (plan sections 4 and 46).
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

# --------------------------------------------------------------------------- #
# Permission codes
# --------------------------------------------------------------------------- #
class Perm:
    DASHBOARD_VIEW = "dashboard.view"

    STUDENTS_VIEW = "students.view"
    STUDENTS_MANAGE = "students.manage"

    LEADS_VIEW = "leads.view"
    LEADS_MANAGE = "leads.manage"
    TRIALS_VIEW = "trials.view"
    TRIALS_MANAGE = "trials.manage"
    ADMISSIONS_MANAGE = "admissions.manage"

    GROUPS_VIEW = "groups.view"
    GROUPS_MANAGE = "groups.manage"
    GROUPS_OVERRIDE_CAPACITY = "groups.override_capacity"

    COURSES_VIEW = "courses.view"
    COURSES_MANAGE = "courses.manage"

    ROOMS_VIEW = "rooms.view"
    ROOMS_MANAGE = "rooms.manage"

    TEACHERS_VIEW = "teachers.view"
    TEACHERS_MANAGE = "teachers.manage"

    ATTENDANCE_VIEW = "attendance.view"
    ATTENDANCE_MANAGE = "attendance.manage"

    EXAMS_VIEW = "exams.view"
    EXAMS_MANAGE = "exams.manage"
    RESULTS_ENTER = "results.enter"

    SCHEDULE_VIEW = "schedule.view"
    SCHEDULE_MANAGE = "schedule.manage"

    FINANCE_VIEW = "finance.view"
    FINANCE_MANAGE = "finance.manage"
    INVOICES_VIEW = "invoices.view"
    INVOICES_MANAGE = "invoices.manage"
    PAYMENTS_MANAGE = "payments.manage"
    INCOME_MANAGE = "income.manage"
    EXPENSES_MANAGE = "expenses.manage"

    PAYROLL_VIEW = "payroll.view"
    PAYROLL_MANAGE = "payroll.manage"
    PAYROLL_APPROVE = "payroll.approve"

    REPORTS_VIEW = "reports.view"
    REPORTS_FINANCE = "reports.finance"

    NOTIFICATIONS_VIEW = "notifications.view"

    SETTINGS_VIEW = "settings.view"
    SETTINGS_MANAGE = "settings.manage"

    USERS_VIEW = "users.view"
    USERS_MANAGE = "users.manage"
    ROLES_MANAGE = "roles.manage"

    AUDIT_VIEW = "audit.view"


PERMISSION_CATALOG: list[tuple[str, str, str]] = [
    # (code, human name, module)
    (Perm.DASHBOARD_VIEW, "View dashboard", "Dashboard"),
    (Perm.STUDENTS_VIEW, "View students", "Students"),
    (Perm.STUDENTS_MANAGE, "Create and edit students", "Students"),
    (Perm.LEADS_VIEW, "View leads", "CRM"),
    (Perm.LEADS_MANAGE, "Create and edit leads", "CRM"),
    (Perm.TRIALS_VIEW, "View trials", "CRM"),
    (Perm.TRIALS_MANAGE, "Schedule and record trials", "CRM"),
    (Perm.ADMISSIONS_MANAGE, "Register (convert) leads into students", "CRM"),
    (Perm.GROUPS_VIEW, "View groups", "Academic"),
    (Perm.GROUPS_MANAGE, "Create and edit groups and memberships", "Academic"),
    (Perm.GROUPS_OVERRIDE_CAPACITY, "Enrol beyond a group's capacity", "Academic"),
    (Perm.COURSES_VIEW, "View courses", "Academic"),
    (Perm.COURSES_MANAGE, "Create and edit courses", "Academic"),
    (Perm.ROOMS_VIEW, "View rooms", "Schedule"),
    (Perm.ROOMS_MANAGE, "Create and edit rooms", "Schedule"),
    (Perm.TEACHERS_VIEW, "View teachers", "Teachers"),
    (Perm.TEACHERS_MANAGE, "Create and edit teachers", "Teachers"),
    (Perm.ATTENDANCE_VIEW, "View attendance", "Academic"),
    (Perm.ATTENDANCE_MANAGE, "Mark and edit attendance", "Academic"),
    (Perm.EXAMS_VIEW, "View exams", "Academic"),
    (Perm.EXAMS_MANAGE, "Create and edit exams", "Academic"),
    (Perm.RESULTS_ENTER, "Enter exam results", "Academic"),
    (Perm.SCHEDULE_VIEW, "View timetable", "Schedule"),
    (Perm.SCHEDULE_MANAGE, "Create and edit timetable slots", "Schedule"),
    (Perm.FINANCE_VIEW, "View finance summary", "Finance"),
    (Perm.FINANCE_MANAGE, "Manage financial records", "Finance"),
    (Perm.INVOICES_VIEW, "View invoices and balances", "Finance"),
    (Perm.INVOICES_MANAGE, "Create and edit invoices", "Finance"),
    (Perm.PAYMENTS_MANAGE, "Record payments", "Finance"),
    (Perm.INCOME_MANAGE, "Manage income records", "Finance"),
    (Perm.EXPENSES_MANAGE, "Manage expense records", "Finance"),
    (Perm.PAYROLL_VIEW, "View payroll", "Payroll"),
    (Perm.PAYROLL_MANAGE, "Calculate and pay payroll", "Payroll"),
    (Perm.PAYROLL_APPROVE, "Approve payroll", "Payroll"),
    (Perm.REPORTS_VIEW, "View operational reports", "Reports"),
    (Perm.REPORTS_FINANCE, "View financial reports", "Reports"),
    (Perm.NOTIFICATIONS_VIEW, "View notifications", "System"),
    (Perm.SETTINGS_VIEW, "View system settings", "Settings"),
    (Perm.SETTINGS_MANAGE, "Change system settings", "Settings"),
    (Perm.USERS_VIEW, "View users", "Settings"),
    (Perm.USERS_MANAGE, "Create and edit users", "Settings"),
    (Perm.ROLES_MANAGE, "Change roles and permissions", "Settings"),
    (Perm.AUDIT_VIEW, "View audit log", "Audit"),
]

ALL_PERMISSIONS: frozenset[str] = frozenset(code for code, _, _ in PERMISSION_CATALOG)

# --------------------------------------------------------------------------- #
# Roles
# --------------------------------------------------------------------------- #
ROLE_SUPER_ADMIN = "super_admin"
ROLE_MANAGER = "manager"
ROLE_ACCOUNTANT = "accountant"
ROLE_RECEPTIONIST = "receptionist"
ROLE_TEACHER = "teacher"

ROLE_CHOICES: list[tuple[str, str]] = [
    (ROLE_SUPER_ADMIN, "Super Admin"),
    (ROLE_MANAGER, "Manager"),
    (ROLE_ACCOUNTANT, "Accountant"),
    (ROLE_RECEPTIONIST, "Receptionist"),
    (ROLE_TEACHER, "Teacher"),
]

_MANAGER_PERMS = {
    Perm.DASHBOARD_VIEW,
    Perm.STUDENTS_VIEW, Perm.STUDENTS_MANAGE,
    Perm.LEADS_VIEW, Perm.LEADS_MANAGE, Perm.TRIALS_VIEW, Perm.TRIALS_MANAGE,
    Perm.ADMISSIONS_MANAGE,
    Perm.GROUPS_VIEW, Perm.GROUPS_MANAGE, Perm.GROUPS_OVERRIDE_CAPACITY,
    Perm.COURSES_VIEW, Perm.COURSES_MANAGE,
    Perm.ROOMS_VIEW, Perm.ROOMS_MANAGE,
    Perm.TEACHERS_VIEW, Perm.TEACHERS_MANAGE,
    Perm.ATTENDANCE_VIEW, Perm.ATTENDANCE_MANAGE,
    Perm.EXAMS_VIEW, Perm.EXAMS_MANAGE, Perm.RESULTS_ENTER,
    Perm.SCHEDULE_VIEW, Perm.SCHEDULE_MANAGE,
    Perm.FINANCE_VIEW, Perm.FINANCE_MANAGE,
    Perm.INVOICES_VIEW, Perm.INVOICES_MANAGE, Perm.PAYMENTS_MANAGE,
    Perm.INCOME_MANAGE, Perm.EXPENSES_MANAGE,
    Perm.PAYROLL_VIEW, Perm.PAYROLL_APPROVE,
    Perm.REPORTS_VIEW, Perm.REPORTS_FINANCE,
    Perm.NOTIFICATIONS_VIEW,
    Perm.SETTINGS_VIEW,
    Perm.USERS_VIEW,
    Perm.AUDIT_VIEW,
}

_ACCOUNTANT_PERMS = {
    Perm.DASHBOARD_VIEW,
    Perm.STUDENTS_VIEW,
    Perm.GROUPS_VIEW, Perm.COURSES_VIEW,
    Perm.FINANCE_VIEW, Perm.FINANCE_MANAGE,
    Perm.INVOICES_VIEW, Perm.INVOICES_MANAGE, Perm.PAYMENTS_MANAGE,
    Perm.INCOME_MANAGE, Perm.EXPENSES_MANAGE,
    Perm.PAYROLL_VIEW, Perm.PAYROLL_MANAGE,
    Perm.REPORTS_VIEW, Perm.REPORTS_FINANCE,
    Perm.NOTIFICATIONS_VIEW,
    Perm.SETTINGS_VIEW,
    Perm.AUDIT_VIEW,
}

_RECEPTIONIST_PERMS = {
    Perm.DASHBOARD_VIEW,
    Perm.STUDENTS_VIEW, Perm.STUDENTS_MANAGE,
    Perm.LEADS_VIEW, Perm.LEADS_MANAGE, Perm.TRIALS_VIEW, Perm.TRIALS_MANAGE,
    Perm.ADMISSIONS_MANAGE,
    Perm.GROUPS_VIEW,
    Perm.COURSES_VIEW,
    Perm.ROOMS_VIEW,
    Perm.ATTENDANCE_VIEW,
    Perm.SCHEDULE_VIEW,
    Perm.FINANCE_VIEW,
    Perm.INVOICES_VIEW, Perm.PAYMENTS_MANAGE,
    Perm.NOTIFICATIONS_VIEW,
    Perm.SETTINGS_VIEW,
}

_TEACHER_PERMS = {
    Perm.DASHBOARD_VIEW,
    Perm.STUDENTS_VIEW,
    Perm.GROUPS_VIEW,
    Perm.COURSES_VIEW,
    Perm.ROOMS_VIEW,
    Perm.ATTENDANCE_VIEW, Perm.ATTENDANCE_MANAGE,
    Perm.EXAMS_VIEW, Perm.EXAMS_MANAGE, Perm.RESULTS_ENTER,
    Perm.SCHEDULE_VIEW,
    Perm.NOTIFICATIONS_VIEW,
}
# Note: teachers deliberately hold no settings.view. They get courses/rooms as
# reference data for pickers, but the Settings section is not theirs to enter.

ROLE_MATRIX: dict[str, frozenset[str]] = {
    ROLE_SUPER_ADMIN: ALL_PERMISSIONS,
    ROLE_MANAGER: frozenset(_MANAGER_PERMS),
    ROLE_ACCOUNTANT: frozenset(_ACCOUNTANT_PERMS),
    ROLE_RECEPTIONIST: frozenset(_RECEPTIONIST_PERMS),
    ROLE_TEACHER: frozenset(_TEACHER_PERMS),
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    ROLE_SUPER_ADMIN: "Full access to every module, user, permission and setting.",
    ROLE_MANAGER: "Runs day-to-day operations: students, groups, teachers, attendance, exams, finance and reports.",
    ROLE_ACCOUNTANT: "Owns student payments, income, expenses, payroll execution and financial reporting.",
    ROLE_RECEPTIONIST: "Front desk: leads, trials, registrations, students, groups and basic payment collection.",
    ROLE_TEACHER: "Own groups only: attendance, exams, results and their timetable. No financial access.",
}


def permissions_for_role(role_code: str | None) -> frozenset[str]:
    if not role_code:
        return frozenset()
    return ROLE_MATRIX.get(role_code, frozenset())


def effective_permissions(user) -> frozenset[str]:
    """Union of role permissions and per-user grants. Superusers hold everything."""
    if user is None or not getattr(user, "is_authenticated", False):
        return frozenset()
    if getattr(user, "is_superuser", False):
        return ALL_PERMISSIONS
    codes = set(permissions_for_role(getattr(user, "role_code", None)))
    extra = getattr(user, "extra_permission_codes", None)
    if extra:
        codes.update(extra())
    return frozenset(codes)


def has_perm_code(user, code: str) -> bool:
    return code in effective_permissions(user)


class RequirePerms(BasePermission):
    """Factory returning a DRF permission class.

    Usage (note: NOT instantiated, DRF instantiates permission classes)::

        permission_classes = [RequirePerms(Perm.STUDENTS_VIEW)]
        permission_classes = [RequirePerms(Perm.A, Perm.B, any_of=True)]
    """

    def __new__(cls, *codes: str, any_of: bool = False):
        required = tuple(codes)

        class _RequiredPerms(BasePermission):
            message = "You do not have permission to perform this action."
            required_codes = required
            any_of_mode = any_of

            def has_permission(self, request, view):
                user = getattr(request, "user", None)
                if user is None or not user.is_authenticated:
                    return False
                granted = effective_permissions(user)
                if self.any_of_mode:
                    return any(code in granted for code in self.required_codes)
                return all(code in granted for code in self.required_codes)

        _RequiredPerms.__name__ = f"RequirePerms[{','.join(required)}{'|any' if any_of else ''}]"
        return _RequiredPerms


# --------------------------------------------------------------------------- #
# Navigation (server-described, role-filtered)
# --------------------------------------------------------------------------- #
NAVIGATION: list[dict] = [
    {
        "key": "dashboard", "label": "Dashboard", "path": "/", "icon": "dashboard",
        "perms": [Perm.DASHBOARD_VIEW],
    },
    {
        "key": "crm", "label": "CRM", "icon": "crm",
        "children": [
            {"key": "leads", "label": "Leads", "path": "/leads", "perms": [Perm.LEADS_VIEW]},
            {"key": "trials", "label": "Trials", "path": "/trials", "perms": [Perm.TRIALS_VIEW]},
            {"key": "admissions", "label": "Admissions", "path": "/admissions", "perms": [Perm.ADMISSIONS_MANAGE]},
        ],
    },
    {
        "key": "students", "label": "Students", "icon": "students",
        "children": [
            {"key": "students-list", "label": "Students", "path": "/students", "perms": [Perm.STUDENTS_VIEW]},
            {"key": "groups", "label": "Groups", "path": "/groups", "perms": [Perm.GROUPS_VIEW]},
        ],
    },
    {
        "key": "academic", "label": "Academic", "icon": "academic",
        "children": [
            {"key": "attendance", "label": "Attendance", "path": "/attendance", "perms": [Perm.ATTENDANCE_VIEW]},
            {"key": "exams", "label": "Exams", "path": "/exams", "perms": [Perm.EXAMS_VIEW]},
            {"key": "results", "label": "Results", "path": "/results", "perms": [Perm.EXAMS_VIEW]},
            {"key": "progress", "label": "Progress", "path": "/progress", "perms": [Perm.EXAMS_VIEW]},
        ],
    },
    {
        "key": "schedule", "label": "Schedule", "icon": "schedule",
        "children": [
            {"key": "timetable", "label": "Timetable", "path": "/timetable", "perms": [Perm.SCHEDULE_VIEW]},
            {"key": "calendar", "label": "Calendar", "path": "/calendar", "perms": [Perm.SCHEDULE_VIEW]},
            {"key": "rooms", "label": "Rooms", "path": "/rooms", "perms": [Perm.ROOMS_VIEW]},
        ],
    },
    {
        "key": "finance", "label": "Finance", "icon": "finance",
        "children": [
            {"key": "payments", "label": "Payments", "path": "/payments", "perms": [Perm.INVOICES_VIEW]},
            {"key": "income", "label": "Income", "path": "/income", "perms": [Perm.FINANCE_VIEW]},
            {"key": "expenses", "label": "Expenses", "path": "/expenses", "perms": [Perm.FINANCE_VIEW]},
            {"key": "payroll", "label": "Payroll", "path": "/payroll", "perms": [Perm.PAYROLL_VIEW]},
        ],
    },
    {
        "key": "teachers", "label": "Teachers", "icon": "teachers",
        "children": [
            {"key": "teachers-list", "label": "Teachers", "path": "/teachers", "perms": [Perm.TEACHERS_VIEW]},
            {"key": "salaries", "label": "Salaries", "path": "/salaries", "perms": [Perm.PAYROLL_VIEW]},
        ],
    },
    {
        "key": "reports", "label": "Reports", "path": "/reports", "icon": "reports",
        "perms": [Perm.REPORTS_VIEW],
    },
    {
        "key": "settings", "label": "Settings", "icon": "settings",
        "perms": [Perm.SETTINGS_VIEW],
        "children": [
            {"key": "users", "label": "Users", "path": "/settings/users", "perms": [Perm.USERS_VIEW]},
            {"key": "roles", "label": "Roles", "path": "/settings/roles", "perms": [Perm.ROLES_MANAGE]},
            {"key": "courses", "label": "Courses", "path": "/settings/courses", "perms": [Perm.COURSES_VIEW]},
            {"key": "rooms", "label": "Rooms", "path": "/settings/rooms", "perms": [Perm.ROOMS_VIEW]},
            {"key": "system", "label": "System Settings", "path": "/settings/system", "perms": [Perm.SETTINGS_VIEW]},
        ],
    },
    {
        "key": "audit", "label": "Audit Log", "path": "/audit", "icon": "audit",
        "perms": [Perm.AUDIT_VIEW],
    },
]


def navigation_for(user) -> list[dict]:
    """Role-filtered navigation tree. Items the user cannot use are omitted.

    A section's own ``perms`` gate the whole section; each child is then judged
    on its own requirements (plan section 4).
    """
    granted = effective_permissions(user)

    def allowed(item: dict) -> bool:
        return all(code in granted for code in item.get("perms", []))

    result: list[dict] = []
    for item in NAVIGATION:
        if not allowed(item):
            continue
        if "children" in item:
            children = [child for child in item["children"] if allowed(child)]
            if children:
                result.append(
                    {k: v for k, v in item.items() if k != "perms"} | {"children": children}
                )
            continue
        result.append({k: v for k, v in item.items() if k != "perms"})
    return result
