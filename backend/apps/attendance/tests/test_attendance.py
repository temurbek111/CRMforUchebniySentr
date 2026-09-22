"""Attendance rules: duplicate prevention, calculations, monthly percentages."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from apps.attendance.models import AttendanceRecord, AttendanceSession, AttendanceStatus
from apps.attendance.services import (
    active_students,
    get_or_create_session,
    group_attendance_summary,
    mark_all_present,
    mark_attendance,
    session_payload,
    student_attendance_detail,
    student_attendance_summary,
)
from tests.factories import enroll, make_group, make_session, make_student, mark

pytestmark = pytest.mark.django_db


@pytest.fixture
def group_with_students():
    group = make_group()
    students = [
        make_student("Ali", "Karimov"),
        make_student("Bekzod", "Tursunov"),
        make_student("Madina", "Yusupova"),
        make_student("Sardor", "Aliyev"),
    ]
    for student in students:
        enroll(student, group)
    return group, students


def test_duplicate_attendance_record_is_rejected_by_the_database(group_with_students):
    group, students = group_with_students
    session = make_session(group)
    mark(session, students[0], AttendanceStatus.PRESENT)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            mark(session, students[0], AttendanceStatus.ABSENT)


def test_one_session_per_group_per_date(group_with_students):
    group, _ = group_with_students
    day = date.today()
    get_or_create_session(group, day)
    get_or_create_session(group, day)
    assert AttendanceSession.objects.filter(group=group, date=day).count() == 1


def test_bulk_marking_and_percentage(group_with_students):
    group, students = group_with_students
    session = get_or_create_session(group, date.today())
    mark_attendance(session, [
        {"student": students[0].pk, "status": AttendanceStatus.PRESENT},
        {"student": students[1].pk, "status": AttendanceStatus.PRESENT},
        {"student": students[2].pk, "status": AttendanceStatus.ABSENT, "reason": "sick"},
        {"student": students[3].pk, "status": AttendanceStatus.LATE},
    ])
    payload = session_payload(session)
    stats = payload["statistics"]
    assert stats["present"] == 2
    assert stats["absent"] == 1
    assert stats["late"] == 1
    # attended = present + late = 3 of 4 counted
    assert stats["percentage"] == "75.00"
    assert len(payload["roster"]) == 4


def test_remark_updates_instead_of_duplicating(group_with_students):
    group, students = group_with_students
    session = get_or_create_session(group, date.today())
    mark_attendance(session, [{"student": students[0].pk, "status": AttendanceStatus.ABSENT}])
    mark_attendance(session, [{"student": students[0].pk, "status": AttendanceStatus.PRESENT}])
    assert session.records.filter(student=students[0]).count() == 1
    assert session.records.get(student=students[0]).status == AttendanceStatus.PRESENT


def test_marking_a_non_member_is_rejected(group_with_students):
    from django.core.exceptions import ValidationError

    group, _ = group_with_students
    outsider = make_student("Outsider", "Person")
    session = get_or_create_session(group, date.today())
    with pytest.raises(ValidationError):
        mark_attendance(session, [{"student": outsider.pk, "status": AttendanceStatus.PRESENT}])


def test_excused_records_are_excluded_from_the_denominator(group_with_students):
    group, students = group_with_students
    session = get_or_create_session(group, date.today())
    mark_attendance(session, [
        {"student": students[0].pk, "status": AttendanceStatus.PRESENT},
        {"student": students[1].pk, "status": AttendanceStatus.EXCUSED, "reason": "sick"},
    ])
    stats = session_payload(session)["statistics"]
    assert stats["excused"] == 1
    assert stats["percentage"] == "100.00"


def test_mark_all_present_marks_the_whole_roster(group_with_students):
    group, _ = group_with_students
    session = get_or_create_session(group, date.today())
    mark_all_present(session, submit=True)
    assert session.records.count() == active_students(group).count()
    assert session.state == "submitted"
    assert session.submitted_at is not None


def test_student_monthly_percentage_across_months(group_with_students):
    group, students = group_with_students
    student = students[0]
    this_month = date.today().replace(day=1)
    last_month = (this_month - timedelta(days=1)).replace(day=1)

    first = make_session(group, this_month)
    mark(first, student, AttendanceStatus.PRESENT)
    second = make_session(group, this_month + timedelta(days=1))
    mark(second, student, AttendanceStatus.ABSENT, "sick")
    third = make_session(group, last_month)
    mark(third, student, AttendanceStatus.PRESENT)

    detail = student_attendance_detail(student)
    assert detail["summary"]["total"] == 3
    assert detail["summary"]["percentage"] == "66.67"
    keys = list(detail["monthly"].keys())
    assert len(keys) == 2
    assert detail["monthly"][this_month.strftime("%Y-%m")]["present"] == 1
    assert detail["calendar"][first.date.isoformat()] == AttendanceStatus.PRESENT


def test_group_summary_reports_unmarked_and_totals(group_with_students):
    group, students = group_with_students
    session = get_or_create_session(group, date.today())
    mark(session, students[0], AttendanceStatus.PRESENT)
    summary = group_attendance_summary(group)
    assert summary["group_name"] == group.name
    assert summary["totals"]["present"] == 1
    assert summary["sessions"][0]["unmarked"] == 3
    assert summary["students"][0]["student"] in [student.pk for student in students]
