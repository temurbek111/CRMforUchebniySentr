"""Permission matrix and API enforcement tests (plan section 51)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role
from apps.accounts.rbac import ALL_PERMISSIONS, Perm, navigation_for
from tests.factories import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def clients():
    return {
        "teacher": APIClient(),
        "accountant": APIClient(),
        "manager": APIClient(),
        "receptionist": APIClient(),
        "admin": APIClient(),
    }


def test_teacher_holds_no_financial_permission():
    teacher = make_user("teacher1", "teacher")
    codes = teacher.permission_codes()
    assert Perm.ATTENDANCE_MANAGE in codes
    assert Perm.RESULTS_ENTER in codes
    for forbidden in (Perm.FINANCE_VIEW, Perm.PAYROLL_VIEW, Perm.INVOICES_VIEW,
                      Perm.AUDIT_VIEW, Perm.USERS_MANAGE):
        assert forbidden not in codes, f"teacher must not hold {forbidden}"


def test_accountant_holds_no_academic_write_permission():
    accountant = make_user("acc1", "accountant")
    codes = accountant.permission_codes()
    assert Perm.PAYMENTS_MANAGE in codes
    assert Perm.EXPENSES_MANAGE in codes
    for forbidden in (Perm.STUDENTS_MANAGE, Perm.GROUPS_MANAGE, Perm.ATTENDANCE_MANAGE,
                      Perm.RESULTS_ENTER, Perm.USERS_MANAGE, Perm.ROLES_MANAGE):
        assert forbidden not in codes, f"accountant must not hold {forbidden}"


def test_manager_approves_payroll_but_does_not_change_roles():
    manager = make_user("mgr1", "manager")
    codes = manager.permission_codes()
    assert Perm.PAYROLL_APPROVE in codes
    assert Perm.SETTINGS_VIEW in codes
    assert Perm.SETTINGS_MANAGE not in codes
    assert Perm.ROLES_MANAGE not in codes


def test_superuser_holds_every_permission():
    admin = make_user("root", None, is_superuser=True)
    assert admin.permission_codes() == set(ALL_PERMISSIONS)


def test_navigation_is_role_filtered():
    teacher_nav = {item["key"] for item in navigation_for(make_user("t2", "teacher"))}
    assert "academic" in teacher_nav
    assert "students" in teacher_nav
    assert "finance" not in teacher_nav
    assert "settings" not in teacher_nav
    assert "audit" not in teacher_nav

    accountant_nav = {item["key"] for item in navigation_for(make_user("a2", "accountant"))}
    assert "finance" in accountant_nav
    assert "settings" in accountant_nav
    assert "crm" not in accountant_nav
    accountant_children = {
        child["key"] for item in navigation_for(make_user("a3", "accountant"))
        if item["key"] == "settings" for child in item["children"]
    }
    assert "roles" not in accountant_children
    assert "users" not in accountant_children


def test_teacher_cannot_read_payments_endpoint():
    client = APIClient()
    client.force_authenticate(make_user("t3", "teacher"))
    response = client.get("/api/payments/")
    assert response.status_code == 403


def test_accountant_cannot_create_students():
    client = APIClient()
    client.force_authenticate(make_user("a3", "accountant"))
    response = client.post("/api/students/", {"first_name": "Nope", "last_name": "Nope"}, format="json")
    assert response.status_code == 403


def test_teacher_only_sees_their_own_groups():
    """Object-level scoping: a teacher's group list contains their classes only."""
    from tests.factories import make_group, make_teacher

    mine_user = make_user("thead", "teacher")
    my_teacher = make_teacher("Mine", "Own", user=mine_user)
    other_teacher = make_teacher("Other", "Teacher")
    my_group = make_group(teacher=my_teacher, name="Mine A")
    make_group(teacher=other_teacher, name="Theirs B")

    client = APIClient()
    client.force_authenticate(mine_user)
    response = client.get("/api/groups/")
    assert response.status_code == 200
    names = [row["name"] for row in response.json()["results"]]
    assert names == [my_group.name]


def test_teacher_without_a_teacher_profile_sees_no_groups():
    client = APIClient()
    client.force_authenticate(make_user("t4", "teacher"))
    response = client.get("/api/groups/")
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_anonymous_access_is_rejected():
    client = APIClient()
    assert client.get("/api/students/").status_code in (401, 403)
    assert client.get("/api/dashboard").status_code in (401, 403)


def test_health_endpoint_is_public():
    client = APIClient()
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_role_permissions_in_the_database_do_not_yet_drive_enforcement():
    """CHARACTERISATION TEST - pins a real inconsistency, found while building
    the /settings/roles admin screen.

    `PATCH /api/roles/{id}/` lets an administrator replace a role's whole
    permission set, and `Role.permissions` stores it faithfully. But
    authorization reads `ROLE_MATRIX` from apps/accounts/rbac.py
    (`permissions_for_role` -> `User.permission_codes` -> `RequirePerms`), and
    never looks at the database rows. So a saved role edit does not change what
    anybody may actually do, and the admin screen would be a convincing lie.

    This test asserts today's behaviour on purpose: stripping every permission
    from a role row leaves the role's access completely intact. When the two
    sources are reconciled, this test MUST start failing - that failure is the
    signal to rewrite it to assert the database is authoritative.
    """
    role, _ = Role.objects.get_or_create(code="manager", defaults={"name": "Manager"})
    role.permissions.clear()          # strip the role row of every permission
    assert role.permission_codes() == set()

    manager = make_user("mgr.stripped", "manager")

    # Enforcement is unaffected, because it never reads the row we just emptied.
    assert Perm.STUDENTS_VIEW in manager.permission_codes()
    client = APIClient()
    client.force_authenticate(manager)
    assert client.get("/api/students/").status_code == 200
    assert client.get("/api/dashboard").status_code == 200
