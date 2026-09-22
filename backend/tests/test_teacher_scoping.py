"""Teacher object-scoping on endpoints that accept a group in the request body.

These tests exist because queryset scoping alone is not enough: a POST body can
name any group, so every such endpoint needs an explicit ownership guard.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from tests.factories import enroll, make_group, make_student, make_teacher, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def two_teachers():
    mine_user = make_user("thead", "teacher", first_name="Mine")
    my_teacher = make_teacher("Mine", "Own", user=mine_user)
    other_teacher = make_teacher("Other", "Teacher")
    my_group = make_group(teacher=my_teacher, name="My Group")
    other_group = make_group(teacher=other_teacher, name="Other Group")
    student = make_student("Scoped", "Student")
    enroll(student, my_group)
    client = APIClient()
    client.force_authenticate(mine_user)
    return client, my_group, other_group, student


def test_teacher_can_open_attendance_for_their_own_group(two_teachers):
    client, my_group, _other, _student = two_teachers
    response = client.post(
        "/api/attendance/", {"group": my_group.pk, "date": date.today().isoformat()},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["session"]["group"] == my_group.pk


def test_teacher_cannot_open_attendance_for_another_group(two_teachers):
    client, _my, other_group, _student = two_teachers
    response = client.post(
        "/api/attendance/", {"group": other_group.pk, "date": date.today().isoformat()},
        format="json",
    )
    assert response.status_code == 403
    assert "own groups" in response.json()["detail"]


def test_teacher_cannot_mark_another_groups_session(two_teachers):
    from apps.attendance.services import get_or_create_session

    client, _my, other_group, student = two_teachers
    session = get_or_create_session(other_group, date.today())
    response = client.post(
        f"/api/attendance/{session.pk}/mark/",
        {"records": [{"student": student.pk, "status": "present"}]},
        format="json",
    )
    # The session is invisible to this teacher, so it is a 404 rather than a leak.
    assert response.status_code == 404


def test_teacher_cannot_create_an_exam_for_another_group(two_teachers):
    client, _my, other_group, _student = two_teachers
    response = client.post(
        "/api/exams/",
        {
            "group": other_group.pk, "name": "Foreign Quiz", "exam_type": "quiz",
            "date": date.today().isoformat(),
        },
        format="json",
    )
    assert response.status_code == 403


def test_teacher_can_create_an_exam_for_their_own_group(two_teachers):
    client, my_group, _other, _student = two_teachers
    response = client.post(
        "/api/exams/",
        {
            "group": my_group.pk, "name": "My Quiz", "exam_type": "quiz",
            "date": date.today().isoformat(),
        },
        format="json",
    )
    assert response.status_code == 201


def test_teacher_student_list_is_scoped_to_their_groups(two_teachers):
    from apps.academics.services import enroll_student

    client, my_group, other_group, my_student = two_teachers
    other_student = make_student("Other", "Person")
    enroll_student(student=other_student, group=other_group)

    response = client.get("/api/students/")
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()["results"]]
    assert my_student.pk in ids
    assert other_student.pk not in ids


def test_teacher_dashboard_carries_no_financial_information(two_teachers):
    """The dashboard must not become a side door around the finance endpoints."""
    client, _my, _other, _student = two_teachers
    payload = client.get("/api/dashboard").json()

    assert payload["kpis"]["finance"] is None
    assert payload["kpis"]["crm"] is None
    assert payload["permissions"]["finance"] is False
    assert payload["permissions"]["payroll"] is False
    for hidden in ("financial_series", "financial_month", "payment_status", "recent_payments"):
        assert hidden not in payload["widgets"], f"{hidden} must not reach a teacher"
    for alert in payload["alerts"]:
        assert alert["key"] not in {"overdue_payments", "payroll_pending"}
    # Attendance and academic context still work for them.
    assert "attendance_today" in payload["widgets"]
    assert "academic" in payload["kpis"]


def test_teacher_dashboard_at_risk_lists_only_their_own_students(two_teachers):
    from apps.attendance.models import AttendanceStatus
    from apps.attendance.services import get_or_create_session, mark_attendance
    from apps.finance.services import ensure_invoice, record_payment
    from apps.academics.services import enroll_student
    from decimal import Decimal

    client, my_group, other_group, my_student = two_teachers
    foreign_student = make_student("Foreign", "Student")
    enroll_student(student=foreign_student, group=other_group)

    # Make BOTH students genuinely at-risk so the filter has something to hide.
    for group, pupil in ((my_group, my_student), (other_group, foreign_student)):
        for offset in range(3):
            session = get_or_create_session(group, date.today() - timedelta(days=offset))
            mark_attendance(session, [{"student": pupil.pk, "status": AttendanceStatus.ABSENT}])

    payload = client.get("/api/dashboard").json()
    listed = {row["student"] for row in payload["at_risk"]}
    assert my_student.pk in listed
    assert foreign_student.pk not in listed
    assert my_student.pk and foreign_student.pk
