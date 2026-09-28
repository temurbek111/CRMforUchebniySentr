"""The dashboard must not regress into an N+1 storm.

The defect this guards: `outstanding_receivables` read `StudentInvoice.amount_paid`
(and `remaining`/`days_overdue`/`display_status`, which all call it) once per
invoice, so a 300-invoice centre cost ~849 queries - and the dashboard called that
monster once per finance period. The endpoint never finished inside a request.

Two protections here:

* a query-count ceiling on `/api/dashboard`, so any future loop that starts touching
  per-row properties again fails the build rather than the customer;
* a value-equality check that the optimised aggregates return exactly the same
  figures as the original per-object logic, computed here as the reference.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role
from apps.attendance.models import AttendanceStatus
from apps.attendance.services import get_or_create_session, mark_attendance
from apps.academics.models import GroupMembership
from apps.academics.services import enroll_student
from apps.finance.models import Payment, StudentInvoice
from apps.finance.services import (
    ensure_invoice,
    outstanding_receivables,
    payment_status_breakdown,
    record_payment,
)
from apps.reporting.services import dashboard_payload
from apps.schedule.services import slots_on_date, slots_on_dates
from tests.factories import (
    make_course,
    make_group,
    make_room,
    make_student,
    make_teacher,
    make_user,
)

pytestmark = pytest.mark.django_db

#: The dashboard aggregates many small figures; on a small fixture centre it fires
#: ~53 queries. The pre-fix implementation exceeded 500 on this same fixture. The
#: ceiling sits between them so it fails on a structural regression (a per-row loop
#: creeping back in) without being brittle to a legitimate extra aggregate.
DASHBOARD_QUERY_CEILING = 70


@pytest.fixture
def seeded_centre():
    """A few groups, students, invoices (paid/partial/unpaid), attendance, exams."""
    for code, name in [("manager", "Manager"), ("teacher", "Teacher")]:
        Role.objects.get_or_create(code=code, defaults={"name": name})

    manager = make_user("boss", "manager")
    reception = make_user("desk", "manager")
    teacher = make_teacher("Kate", "Nazarova")
    course = make_course("ENG", "General English", fee="1200000")
    room = make_room("Room 101", capacity=20)

    groups = [
        make_group(course=course, teacher=teacher, room=room, name=f"Group {i}",
                   fee="1200000")
        for i in range(3)
    ]

    today = date.today()
    period_start = today.replace(day=1)
    students = []
    for index in range(12):
        student = make_student(f"Student{index}", "Karimov")
        enroll_student(student=student, group=groups[index % len(groups)])
        students.append(student)
        invoice = ensure_invoice(student, period_start)
        # A spread of paid / partial / unpaid invoices.
        if index % 3 == 0:
            record_payment(student=student, amount=invoice.amount_due, invoice=invoice,
                           method=Payment.Method.CASH)
        elif index % 3 == 1:
            record_payment(student=student, amount=(invoice.amount_due / 2).quantize(Decimal("1")),
                           invoice=invoice, method=Payment.Method.CARD)

    # Submitted attendance for each group's own roster.
    for group in groups:
        roster = list(
            student for student in students
            if GroupMembership.objects.filter(student=student, group=group,
                                              left_at__isnull=True).exists()
        )
        for offset in range(3):
            session = get_or_create_session(group, today - timedelta(days=offset))
            entries = [{"student": s.pk, "status": AttendanceStatus.PRESENT}
                       for s in roster]
            if entries:
                entries[-1]["status"] = AttendanceStatus.ABSENT
            mark_attendance(session, entries, submit=True)
    return manager, reception, teacher, students


def _manager_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_dashboard_query_count_is_bounded(seeded_centre):
    """The whole dashboard is a fixed number of queries, not one per row."""
    manager, _reception, _teacher, _students = seeded_centre
    client = _manager_client(manager)

    with CaptureQueriesContext(connection) as captured:
        response = client.get("/api/dashboard")

    assert response.status_code == 200
    count = len(captured.captured_queries)
    assert count < DASHBOARD_QUERY_CEILING, (
        f"/api/dashboard fired {count} queries (ceiling {DASHBOARD_QUERY_CEILING}); "
        "an aggregate has regressed into a per-row loop"
    )


def test_dashboard_query_count_does_not_grow_with_students(seeded_centre):
    """Adding students must not add dashboard queries - the N+1 signature."""
    manager, _reception, _teacher, students = seeded_centre
    client = _manager_client(manager)

    with CaptureQueriesContext(connection) as before:
        assert client.get("/api/dashboard").status_code == 200
    baseline = len(before.captured_queries)

    # Double the student count; the query count must not move.
    group = make_group(name="Overflow", fee="900000")
    for index in range(len(students)):
        extra = make_student(f"Extra{index}", "Yusupov")
        enroll_student(student=extra, group=group)
        ensure_invoice(extra, date.today().replace(day=1))

    with CaptureQueriesContext(connection) as after:
        assert client.get("/api/dashboard").status_code == 200
    grown = len(after.captured_queries)

    assert grown <= baseline + 2, (
        f"dashboard queries grew from {baseline} to {grown} when students were "
        "added - a per-student query has crept back in"
    )


def test_outstanding_receivables_is_one_query(seeded_centre):
    """The receivables book was 849 queries at 300 invoices; it must be a handful."""
    with CaptureQueriesContext(connection) as captured:
        result = outstanding_receivables()
    assert len(captured.captured_queries) <= 3, (
        f"outstanding_receivables fired {len(captured.captured_queries)} queries"
    )
    assert result["count"] >= 1


def test_receivables_values_match_the_per_object_reference(seeded_centre):
    """The aggregate must return exactly what the per-invoice properties returned."""
    result = outstanding_receivables()

    # Reference: the original per-object logic, recomputed here for the same set.
    reference = []
    for invoice in (
        StudentInvoice.objects.exclude(status__in=["waived", "cancelled"])
        .select_related("student", "group")
    ):
        remaining = invoice.remaining
        if remaining <= 0:
            continue
        reference.append({
            "id": invoice.pk,
            "student": invoice.student_id,
            "remaining": remaining,
            "days_overdue": invoice.days_overdue,
            "status": invoice.display_status,
        })

    got = {
        (row["id"], row["student"], Decimal(row["remaining"]), row["days_overdue"], row["status"])
        for row in result["invoices"]
    }
    want = {
        (row["id"], row["student"], row["remaining"], row["days_overdue"], row["status"])
        for row in reference
    }
    assert got == want

    total = sum((row["remaining"] for row in reference), Decimal("0.00"))
    assert Decimal(result["amount"]) == total


def test_payment_status_breakdown_matches_per_invoice_logic(seeded_centre):
    """The widget counts/amounts must equal a per-invoice classification."""
    period_start = timezone.localdate().replace(day=1)
    breakdown = payment_status_breakdown(period_start)

    counts = {"paid": 0, "partial": 0, "unpaid": 0, "overdue": 0, "waived": 0}
    amounts = {key: Decimal("0.00") for key in counts}
    for invoice in StudentInvoice.objects.filter(period_start=period_start):
        status = invoice.display_status
        counts[status] += 1
        amounts[status] += invoice.remaining

    assert breakdown["counts"] == counts
    assert {k: Decimal(v) for k, v in breakdown["amounts"].items()} == amounts


def test_slots_on_dates_matches_slots_on_date(seeded_centre):
    """The batched schedule query must return exactly what the per-day query did."""
    today = timezone.localdate()
    window = [today + timedelta(days=offset) for offset in range(7)]
    batched = slots_on_dates(window)
    for day in window:
        assert [s.pk for s in batched[day]] == [s.pk for s in slots_on_date(day)]


def test_payload_keeps_its_top_level_shape(seeded_centre):
    """The optimisation must not add or drop any block the frontend reads."""
    manager, _reception, _teacher, _students = seeded_centre
    payload = dashboard_payload(manager)

    assert set(payload) == {
        "generated_at", "date", "centre", "kpis", "widgets", "alerts",
        "at_risk", "permissions",
    }
    assert {"students", "attendance", "finance", "academic", "crm"} <= set(payload["kpis"])
    assert {"attendance_today", "todays_schedule", "upcoming_schedule"} <= set(payload["widgets"])
    assert set(payload["permissions"]) == {"finance", "receivables", "payroll", "crm"}
    # Every schedule row for today carries the exact keys the frontend binds to.
    for row in payload["widgets"]["todays_schedule"]:
        assert set(row) == {
            "id", "group", "group_name", "teacher", "room", "start_time",
            "end_time", "students", "attendance_pending", "link",
        }
    for row in payload["widgets"]["upcoming_schedule"]:
        assert set(row) == {
            "date", "weekday", "group", "group_name", "teacher", "room",
            "start_time", "end_time",
        }
