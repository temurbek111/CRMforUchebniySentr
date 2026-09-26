"""Permission matrix and API enforcement tests (plan section 51)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
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


def test_creating_a_user_with_extra_permissions_succeeds():
    """Regression: user creation used to 500 when extra_permissions was sent.

    `UserWriteSerializer.create` passed the many-to-many `extra_permissions`
    straight into `User(**validated_data)`, which Django rejects with
    "Direct assignment to the forward side of a many-to-many set is
    prohibited" -> an unhandled TypeError -> HTTP 500. The Users screen sends
    this field, so creating a user from the UI crashed the server.
    """
    from apps.accounts.models import Permission

    admin_client = APIClient()
    admin_client.force_authenticate(make_user("root.probe", None, is_superuser=True))

    role = Role.objects.filter(code="teacher").first()
    permission = Permission.objects.filter(code=Perm.AUDIT_VIEW).first()
    if permission is None:
        # Permission rows only exist after sync_rbac; create the one we need.
        permission = Permission.objects.create(
            code=Perm.AUDIT_VIEW, name="View audit log", module="Audit"
        )

    payload = {
        "username": "with.extra.perms",
        "first_name": "Extra",
        "last_name": "Perms",
        "role": role.pk if role else None,
        "is_active": True,
        "password": "Extra-Perms-Pw-2026!",
        "extra_permissions": [permission.pk],
    }
    response = admin_client.post("/api/users/", payload, format="json")
    assert response.status_code == 201, response.content
    # The write endpoint answers with the write serializer, which does not carry
    # the computed permission list - assert against the persisted row instead.
    created = User.objects.get(username="with.extra.perms")
    assert Perm.AUDIT_VIEW in created.extra_permission_codes()


def test_updating_a_users_extra_permissions_succeeds():
    """The same many-to-many handling must work on update, not just create."""
    from apps.accounts.models import Permission

    admin_client = APIClient()
    admin_client.force_authenticate(make_user("root.probe2", None, is_superuser=True))
    target = make_user("edit.target", "teacher")

    permission, _ = Permission.objects.get_or_create(
        code=Perm.AUDIT_VIEW, defaults={"name": "View audit log", "module": "Audit"}
    )
    response = admin_client.patch(
        f"/api/users/{target.pk}/", {"extra_permissions": [permission.pk]}, format="json"
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    assert Perm.AUDIT_VIEW in target.extra_permission_codes()

    # Removing them again must also work (same many-to-many path).
    response = admin_client.patch(
        f"/api/users/{target.pk}/", {"extra_permissions": []}, format="json"
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    assert target.extra_permission_codes() == set()


def test_health_endpoint_is_public():
    client = APIClient()
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_role_permission_edits_actually_change_enforcement():
    """The Roles screen is authoritative, not decorative.

    This test used to be a CHARACTERISATION test pinning a real inconsistency:
    `PATCH /api/roles/{id}/` stored a role's permission set faithfully, but
    authorisation read `ROLE_MATRIX` from rbac.py and never the database rows, so
    a saved role edit changed nothing and the admin screen was a convincing lie.

    `permissions_for_role` now reads the role rows (cached, invalidated on
    write), so editing a role changes what its users may do. These assertions
    replace the old ones on purpose - they fail if the two sources ever drift
    apart again.
    """
    from django.core.management import call_command

    from apps.accounts.rbac import Perm, effective_permissions

    # Seed the rows the way production does, so the role actually holds a set.
    call_command("sync_rbac", verbosity=0)
    role = Role.objects.get(code="manager")
    assert Perm.STUDENTS_VIEW in role.permission_codes()

    manager = make_user("mgr.edited", "manager")
    assert Perm.STUDENTS_VIEW in effective_permissions(manager)

    # Revoke exactly one permission through the role row.
    role.permissions.remove(role.permissions.get(code=Perm.STUDENTS_VIEW))
    role.refresh_from_db()
    manager.refresh_from_db()

    assert Perm.STUDENTS_VIEW not in effective_permissions(manager)

    client = APIClient()
    client.force_authenticate(manager)
    assert client.get("/api/students/").status_code == 403
    # Everything else the role still holds is untouched.
    assert client.get("/api/dashboard").status_code == 200


def test_granting_a_permission_the_matrix_denies_takes_effect():
    """An extra grant on a role is honoured, not silently ignored."""
    from django.core.management import call_command

    from apps.accounts.rbac import Perm, effective_permissions
    from apps.accounts.models import Permission

    call_command("sync_rbac", verbosity=0)
    role = Role.objects.get(code="receptionist")

    receptionist = make_user("rec.edited", "receptionist")
    assert Perm.PAYROLL_VIEW not in effective_permissions(receptionist)

    role.permissions.add(Permission.objects.get(code=Perm.PAYROLL_VIEW))
    role.refresh_from_db()
    receptionist.refresh_from_db()

    assert Perm.PAYROLL_VIEW in effective_permissions(receptionist)


def test_an_unseeded_role_still_falls_back_to_the_matrix():
    """A migrated-but-unseeded role must not lock everybody out.

    The test database has Role rows with no permissions unless `sync_rbac` is
    run. Reading the rows naively would grant nothing and turn every request
    into a 403, so an entirely empty role falls back to the canonical matrix.
    """
    from apps.accounts.rbac import Perm, effective_permissions

    role, _ = Role.objects.get_or_create(code="teacher", defaults={"name": "Teacher"})
    role.permissions.clear()
    role.refresh_from_db()
    assert role.permission_codes() == set()

    teacher = make_user("t.unseeded", "teacher")
    assert Perm.ATTENDANCE_VIEW in effective_permissions(teacher)
