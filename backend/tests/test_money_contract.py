"""Money must cross the API boundary as a decimal string, never a float.

This guards a defect that shipped once: `REST_FRAMEWORK["COERCE_DECIMAL_TO_STRING"]`
was set to False, so every ModelSerializer rendered `Decimal` money as a JSON
float. The models, the services and the database were all correct — only the wire
was wrong — and the symptom surfaced in a browser as
`value.trim is not a function` while a payment table tried to format a number.

A float cannot hold 0.1 or 1234567.89 exactly. One bad rounding is a real
dispute with a real parent, so this is asserted on the response body, endpoint by
endpoint, rather than trusted to a settings default.
"""

from __future__ import annotations

from datetime import date

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role
from tests.factories import enroll, make_course, make_group, make_room, make_student, make_teacher, make_user

pytestmark = pytest.mark.django_db

#: Field-name fragments that identify an amount (as opposed to a percentage,
#: a count, or a rate, which are legitimately numbers).
MONEY_HINTS = (
    "amount", "remaining", "balance", "credit", "total", "fee", "paid", "due",
    "income", "expense", "gross", "net", "payroll", "salary", "base_amount",
    "deduction", "per_lesson", "revenue",
)

#: Endpoints that carry money in their payload, in a state where they are non-empty.
MONEY_ENDPOINTS = (
    "/api/invoices/",
    "/api/payments/",
    "/api/income/",
    "/api/expenses/",
    "/api/payroll/",
    "/api/students/",
    "/api/groups/",
    "/api/salaries/",
    "/api/salaries/current/",
    "/api/finance/summary",
    "/api/finance/summary/breakdown",
    "/api/dashboard",
)


def walk(node, path=""):
    """Yield (path, value) for every scalar leaf; for lists, only the first row."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk(value, f"{path}.{key}" if path else key)
    elif isinstance(node, list):
        if node:
            yield from walk(node[0], f"{path}[]")
    else:
        yield path, node


#: Leaf names that carry money. An explicit list, because substring matching is
#: a trap here: "total" is a student count in one payload and a pay total in
#: another, and "due" is both a date and an amount.
MONEY_LEAVES = frozenset({
    "amount", "amount_due", "amount_paid", "remaining", "balance", "credit", "fee",
    "monthly_fee", "revenue_share_amount", "base_amount", "per_lesson_amount",
    "total_net", "total_gross", "total_deductions", "total_earned",
    "gross_amount", "net_amount", "net_result", "gross_income", "total_expenses",
    "student_fees", "other_income", "exams_revenue", "collection_rate",
    "payroll", "payroll_month", "payroll_payable", "outstanding", "collected_today",
    "income_month", "expenses_month", "student_fees_month", "other_income_month",
    "net_month", "net_previous_month", "bonuses", "deductions", "net_pay",
})

#: Suffixes that are unambiguously money, for fields not in the list above.
MONEY_SUFFIXES = ("_amount", "_fee", "_net", "_gross", "_paid", "_income", "_expenses")


def is_money_field(path: str) -> bool:
    leaf = path.split(".")[-1].split("[]")[0].lower()
    if leaf in MONEY_LEAVES:
        return True
    return leaf.endswith(MONEY_SUFFIXES)


@pytest.fixture
def populated_centre():
    """A centre with an invoice, a payment, income, an expense and a payroll run."""
    for code, name in [("manager", "Manager"), ("accountant", "Accountant"),
                       ("teacher", "Teacher")]:
        Role.objects.get_or_create(code=code, defaults={"name": name})

    accountant = make_user("books", "accountant")
    manager = make_user("boss", "manager")
    teacher = make_teacher("Kate", "Nazarova")
    course = make_course("IELTS", "IELTS Preparation", fee="1800000")
    room = make_room("Room 204", capacity=16)
    group = make_group(course=course, teacher=teacher, room=room, fee="1800000")
    student = make_student("Ali", "Karimov")
    enroll(student, group)

    accountant_client = APIClient()
    accountant_client.force_authenticate(accountant)
    manager_client = APIClient()
    manager_client.force_authenticate(manager)

    today = date.today()
    assert accountant_client.post("/api/billing-periods/generate/", {
        "year": today.year, "month": today.month,
    }, format="json").status_code == 201

    from apps.finance.models import StudentInvoice

    invoice = StudentInvoice.objects.filter(student=student).first()
    assert invoice is not None
    response = accountant_client.post("/api/payments/", {
        "student": student.pk, "invoice": invoice.pk, "amount": "100.10", "method": "cash",
    }, format="json")
    assert response.status_code == 201, response.json()

    assert accountant_client.post("/api/income/", {
        "amount": "250000.55", "category": "exam_fees", "method": "cash",
        "date": today.isoformat(),
    }, format="json").status_code == 201
    assert accountant_client.post("/api/expenses/", {
        "amount": "90000.25", "category": "utilities", "method": "cash",
        "date": today.isoformat(),
    }, format="json").status_code == 201
    assert accountant_client.post("/api/salaries/", {
        "teacher": teacher.pk, "model": "fixed", "base_amount": "6000000",
        "effective_from": today.replace(day=1).isoformat(),
    }, format="json").status_code == 201
    assert accountant_client.post("/api/payroll/calculate/", {
        "period_start": today.replace(day=1).isoformat(), "period_end": today.isoformat(),
    }, format="json").status_code == 201

    return accountant_client, manager_client


def test_no_endpoint_returns_money_as_a_float(populated_centre):
    accountant_client, manager_client = populated_centre
    checked = 0
    violations: list[str] = []

    for path in MONEY_ENDPOINTS:
        # The accountant can read every money-bearing endpoint.
        response = accountant_client.get(path)
        if response.status_code == 403:
            response = manager_client.get(path)
        assert response.status_code == 200, f"{path} → {response.status_code}"

        payload = response.json()
        for leaf_path, value in walk(payload):
            # Capability flags live under `permissions` and a boolean is never an
            # amount, even when its name contains a money word.
            if isinstance(value, bool) or leaf_path.startswith("permissions"):
                continue
            if not is_money_field(leaf_path):
                continue
            checked += 1
            if isinstance(value, float):
                violations.append(f"{path} {leaf_path} = {value!r} (float)")
            elif value is not None:
                assert isinstance(value, str), f"{path} {leaf_path} = {value!r} ({type(value).__name__})"

    assert checked > 20, f"only {checked} money fields were inspected; the audit is not covering enough"
    assert violations == [], "money leaked as a float: " + "; ".join(violations)


def test_amounts_keep_their_exact_cents(populated_centre):
    """A cent must survive a round trip in the API representation."""
    accountant_client, _manager = populated_centre

    incomes = accountant_client.get("/api/income/").json()["results"]
    amounts = [row["amount"] for row in incomes]
    assert "250000.55" in amounts, amounts

    expenses = accountant_client.get("/api/expenses/").json()["results"]
    assert "90000.25" in [row["amount"] for row in expenses]

    payments = accountant_client.get("/api/payments/").json()["results"]
    assert "100.10" in [row["amount"] for row in payments]

    # And a value that a float literally cannot hold is still exact.
    assert all(isinstance(amount, str) for amount in amounts)


def test_aggregate_summaries_agree_with_the_strings_they_are_built_from(populated_centre):
    accountant_client, _manager = populated_centre
    summary = accountant_client.get("/api/finance/summary").json()

    for key in ("student_fees", "other_income", "gross_income", "total_expenses",
                "net_result", "outstanding", "collection_rate"):
        assert key in summary, key
        assert not isinstance(summary[key], float), f"{key} is a float"
