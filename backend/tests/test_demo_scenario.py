"""End-to-end: the full operational lifecycle from the product brief (section 53).

A new lead contacts the centre → receptionist creates the lead → trial is
scheduled and completed → the lead registers and becomes a student → the student
is enrolled in a group → the teacher marks attendance → an exam with components
is created and marked → the student pays part of the fee and then the rest →
payroll is calculated, approved and paid → the dashboard and the management
report reflect all of it, and every step is in the audit trail.

Everything here goes through the HTTP API as the role that would really do it.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role
from apps.academics.models import Group, Student
from apps.core.models import AuditLog
from apps.finance.models import Expense, Payment, StudentInvoice
from apps.payroll.models import PayrollRun
from tests.factories import (
    enroll,
    make_course,
    make_group,
    make_room,
    make_student,
    make_teacher,
    make_user,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def centre():
    """A centre with one course, room, teacher (with a login) and group."""
    for code, name in [("manager", "Manager"), ("accountant", "Accountant"),
                       ("receptionist", "Receptionist"), ("teacher", "Teacher")]:
        Role.objects.get_or_create(code=code, defaults={"name": name})

    teacher_user = make_user("teacher.kate", "teacher", first_name="Kate", last_name="Nazarova")
    teacher = make_teacher("Kate", "Nazarova", user=teacher_user)
    course = make_course("IELTS", "IELTS Preparation", fee="1800000")
    room = make_room("Room 204", capacity=16)
    group = make_group(course=course, teacher=teacher, room=room, name="IELTS Evening A",
                       fee="1800000", capacity=16)

    users = {
        "reception": make_user("front.desk", "receptionist"),
        "accountant": make_user("books", "accountant"),
        "manager": make_user("boss", "manager"),
        "teacher": teacher_user,
    }
    clients = {}
    for key, user in users.items():
        client = APIClient()
        client.force_authenticate(user)
        clients[key] = client
    return {"clients": clients, "group": group, "course": course, "teacher": teacher,
            "users": users}


def test_full_lifecycle_from_lead_to_payroll_and_dashboard(centre):
    clients = centre["clients"]
    group: Group = centre["group"]
    today = date.today()

    # ---------------------------------------------------------------- CRM
    response = clients["reception"].post("/api/leads/", {
        "full_name": "Aziza Karimova",
        "phone": "+998901234567",
        "source": "Instagram",
        "interested_course": centre["course"].pk,
        "notes": "Wants the evening IELTS group",
    }, format="json")
    assert response.status_code == 201, response.json()
    lead_id = response.json()["id"]

    response = clients["reception"].post(
        f"/api/leads/{lead_id}/schedule-trial/",
        {"trial_date": (today + timedelta(days=3)).isoformat()}, format="json",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "trial_scheduled"

    response = clients["reception"].post(
        f"/api/leads/{lead_id}/trial-completed/",
        {"attended": True, "note": "Liked the group"}, format="json",
    )
    assert response.status_code == 200, response.json()

    response = clients["reception"].post(f"/api/leads/{lead_id}/convert/", {
        "group": group.pk,
        "start_date": today.isoformat(),
        "payment_terms": "Monthly, due on the 5th",
    }, format="json")
    assert response.status_code in (200, 201), response.json()
    student_id = response.json().get("id") or response.json().get("student", {}).get("id")
    assert student_id, response.json()

    student = Student.objects.get(pk=student_id)
    assert student.phone == "+998901234567"
    assert student.status == "active"
    assert student.group_memberships.filter(group=group, left_at__isnull=True).exists()

    # Converting twice must not create a second person.
    again = clients["reception"].post(f"/api/leads/{lead_id}/convert/", {}, format="json")
    assert again.status_code in (200, 201)
    assert Student.objects.filter(phone="+998901234567").count() == 1

    # Give the group a little company so group-level figures are meaningful.
    for index in range(3):
        enroll(make_student(f"Classmate{index}", "Karimov"), group)

    # ----------------------------------------------------------- Attendance
    response = clients["teacher"].post("/api/attendance/", {
        "group": group.pk, "date": today.isoformat(),
    }, format="json")
    assert response.status_code == 200, response.json()
    session_id = response.json()["session"]["id"]
    roster = response.json()["roster"]
    assert len(roster) == 4

    entries = []
    for index, row in enumerate(roster):
        status = "present" if index != 1 else "absent"
        entries.append({"student": row["student"], "status": status,
                        **({"reason": "sick"} if status == "absent" else {})})
    response = clients["teacher"].post(f"/api/attendance/{session_id}/mark/",
                                      {"records": entries, "submit": True}, format="json")
    assert response.status_code == 200, response.json()
    stats = response.json()["statistics"]
    assert stats["present"] == 3
    assert stats["absent"] == 1
    assert stats["percentage"] == "75.00"
    assert response.json()["session"]["state"] == "submitted"

    # ---------------------------------------------------------------- Exams
    response = clients["teacher"].post("/api/exams/", {
        "group": group.pk,
        "name": "Mock Exam September",
        "exam_type": "mock_exam",
        "date": today.isoformat(),
        "course": centre["course"].pk,
        "max_score": "9",
        "passing_score": "5.5",
        "components": [
            {"name": "Listening", "max_score": "9", "order": 1},
            {"name": "Reading", "max_score": "9", "order": 2},
            {"name": "Writing", "max_score": "9", "order": 3},
            {"name": "Speaking", "max_score": "9", "order": 4},
        ],
    }, format="json")
    assert response.status_code == 201, response.json()
    exam_id = response.json()["id"]

    components = clients["teacher"].get(f"/api/exams/{exam_id}/components/").json()
    component_list = components.get("results", components) if isinstance(components, dict) else components
    assert len(component_list) == 4

    scores = [Decimal("7.5"), Decimal("6.0"), Decimal("5.0"), Decimal("7.0")]
    entries = [
        {"student": student_id, "component": component_list[index]["id"], "score": str(score),
         "teacher_comment": "Solid effort"}
        for index, score in enumerate(scores)
    ]
    response = clients["teacher"].post(f"/api/exams/{exam_id}/results/",
                                       {"entries": entries}, format="json")
    assert response.status_code == 200, response.json()

    summary = clients["teacher"].get(f"/api/exams/{exam_id}/results/").json()
    assert summary["statistics"]["average_percentage"] is not None
    assert summary["statistics"]["pass_rate"] is not None

    # --------------------------------------------------------------- Finance
    response = clients["accountant"].post("/api/billing-periods/generate/", {
        "year": today.year, "month": today.month,
    }, format="json")
    assert response.status_code == 201, response.json()
    assert response.json()["created"] >= 1

    invoice = StudentInvoice.objects.filter(student_id=student_id).first()
    assert invoice is not None
    full_amount = invoice.amount_due
    assert full_amount == Decimal("1800000.00")

    # Partial payment: the invoice must stay open with a real balance.
    half = (full_amount / 2).quantize(Decimal("1"))
    response = clients["accountant"].post("/api/payments/", {
        "student": student_id, "invoice": invoice.pk, "amount": str(half), "method": "cash",
        "reference": "CASH-001",
    }, format="json")
    assert response.status_code == 201, response.json()
    invoice.refresh_from_db()
    assert invoice.amount_paid == half
    assert invoice.remaining == full_amount - half
    assert invoice.status == "partial"

    # Remainder: the invoice settles, and both transactions survive.
    response = clients["accountant"].post("/api/payments/", {
        "student": student_id, "invoice": invoice.pk, "amount": str(full_amount - half),
        "method": "card", "reference": "CARD-002",
    }, format="json")
    assert response.status_code == 201, response.json()
    invoice.refresh_from_db()
    assert invoice.remaining == Decimal("0.00")
    assert invoice.status == "paid"
    assert Payment.objects.filter(student_id=student_id, is_void=False).count() == 2

    # Overpaying without an explicit override is refused.
    over = clients["accountant"].post("/api/payments/", {
        "student": student_id, "invoice": invoice.pk, "amount": "100000", "method": "cash",
    }, format="json")
    assert over.status_code == 400

    # ---------------------------------------------------------------- Payroll
    response = clients["accountant"].post("/api/salaries/", {
        "teacher": centre["teacher"].pk,
        "model": "per_class",
        "effective_from": (today - timedelta(days=30)).isoformat(),
        "per_lesson_rate": "90000",
    }, format="json")
    assert response.status_code == 201, response.json()

    period_start = today.replace(day=1)
    response = clients["accountant"].post("/api/payroll/calculate/", {
        "period_start": period_start.isoformat(), "period_end": today.isoformat(),
    }, format="json")
    assert response.status_code == 201, response.json()
    run_id = response.json()["id"]
    assert Decimal(response.json()["total_net"]) > 0

    # A manager approves; the accountant cannot approve on their own.
    assert clients["accountant"].post(f"/api/payroll/{run_id}/approve/", {},
                                      format="json").status_code == 403
    response = clients["manager"].post(f"/api/payroll/{run_id}/approve/", {}, format="json")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "approved"

    # Once approved, recalculation is refused: history is frozen.
    recalc = clients["accountant"].post("/api/payroll/calculate/", {
        "period_start": period_start.isoformat(), "period_end": today.isoformat(),
    }, format="json")
    assert recalc.status_code == 400

    response = clients["accountant"].post(f"/api/payroll/{run_id}/pay/",
                                          {"method": "bank_transfer"}, format="json")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "paid"

    run = PayrollRun.objects.get(pk=run_id)
    assert run.expense_id is not None
    assert Expense.objects.get(pk=run.expense_id).category == Expense.Category.TEACHER_SALARIES

    # -------------------------------------------------------------- Dashboard
    dashboard = clients["manager"].get("/api/dashboard").json()
    kpis = dashboard["kpis"]
    assert kpis["students"]["active"] >= 4
    assert kpis["students"]["new_this_month"] >= 4
    assert Decimal(kpis["finance"]["student_fees_month"]) >= full_amount
    assert Decimal(kpis["finance"]["payroll_month"]) > 0
    assert kpis["attendance"]["month"]["present"] >= 3
    assert kpis["academic"]["exams_this_month"] >= 1
    assert any(alert["key"] for alert in dashboard["alerts"])
    # The dashboard must not invent figures: the seeded payment is traceable.
    assert Decimal(kpis["finance"]["collected_today"]) >= full_amount

    # ------------------------------------------------------------- Reporting
    report = clients["manager"].get(
        f"/api/reports/management?from={period_start.isoformat()}&to={today.isoformat()}"
    ).json()
    assert "students" in report and "finance" in report and "payroll" in report
    assert report["finance"]["student_fees"] == str(full_amount)

    csv_response = clients["manager"].get("/api/reports/students/export.csv")
    assert csv_response.status_code == 200
    assert "text/csv" in csv_response["Content-Type"]

    # -------------------------------------------------------- Auditability
    entities = set(AuditLog.objects.values_list("entity", flat=True))
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert "lead" in entities
    assert "student" in entities
    assert "payment" in entities or "studentinvoice" in entities
    assert "payrollrun" in entities
    assert {"create", "update", "approve", "pay"} <= actions
    # Financial and permission-relevant changes carry an actor.
    payment_entries = AuditLog.objects.filter(action="pay").exclude(actor=None)
    assert payment_entries.exists()


def test_teacher_cannot_see_the_finance_or_payroll_modules(centre):
    clients = centre["clients"]
    assert clients["teacher"].get("/api/payments/").status_code == 403
    assert clients["teacher"].get("/api/payroll/").status_code == 403
    assert clients["teacher"].get("/api/income/").status_code == 403
    assert clients["teacher"].get("/api/expenses/").status_code == 403
    assert clients["teacher"].get("/api/audit/").status_code == 403
    assert clients["teacher"].get("/api/dashboard").status_code == 200
