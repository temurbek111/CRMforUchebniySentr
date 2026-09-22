"""Payroll rules: all four compensation models, approval freezing, payment."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.attendance.services import get_or_create_session, mark_all_present
from apps.finance.models import Expense
from apps.finance.services import ensure_invoice, record_payment
from apps.payroll.models import PayrollStatus, SalaryModel, SalaryPolicy
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    group_revenue,
    lessons_taught,
    mark_payroll_paid,
    policy_for,
    run_summary,
    set_salary_policy,
    teacher_earnings_history,
)
from tests.factories import enroll, make_group, make_student, make_teacher

pytestmark = pytest.mark.django_db


@pytest.fixture
def period():
    today = date.today()
    start = today.replace(day=1)
    return start, today


def _teach(teacher, group, days: int):
    """Create submitted attendance sessions so lessons are counted for payroll."""
    from apps.attendance.models import AttendanceSession

    if not group.student_count:
        enroll(make_student("Payroll", "Student"), group)
    for offset in range(days):
        day = date.today().replace(day=1) + timedelta(days=offset)
        session = AttendanceSession.objects.create(group=group, date=day, teacher=teacher,
                                                  state="submitted")
        mark_all_present(session, submit=True)


def test_fixed_salary_is_flat_regardless_of_lessons(period):
    start, end = period
    teacher = make_teacher("Fixed", "Salary")
    group = make_group(teacher=teacher)
    _teach(teacher, group, 3)
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED,
                      effective_from=start, base_amount=Decimal("7000000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    item = run.items.get(teacher=teacher)
    assert item.lessons_count == 3
    assert item.base_amount == Decimal("7000000.00")
    assert item.net_amount == Decimal("7000000.00")


def test_per_class_salary_multiplies_lessons_by_rate(period):
    start, end = period
    teacher = make_teacher("Per", "Class")
    group = make_group(teacher=teacher)
    _teach(teacher, group, 4)
    set_salary_policy(teacher=teacher, model=SalaryModel.PER_CLASS,
                      effective_from=start, per_lesson_rate=Decimal("80000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    item = run.items.get(teacher=teacher)
    assert item.lessons_count == 4
    assert item.per_lesson_amount == Decimal("320000.00")
    assert item.net_amount == Decimal("320000.00")


def test_percentage_salary_uses_collected_group_revenue(period):
    start, end = period
    teacher = make_teacher("Share", "Holder")
    group = make_group(teacher=teacher, fee="1000000")
    student = make_student("Paying", "Student")
    enroll(student, group)
    invoice = ensure_invoice(student, start)
    record_payment(student=student, amount=Decimal("1000000"), invoice=invoice)

    set_salary_policy(teacher=teacher, model=SalaryModel.PERCENTAGE,
                      effective_from=start, revenue_share_pct=Decimal("30"))
    assert group_revenue(teacher, start, end) == Decimal("1000000.00")

    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    item = run.items.get(teacher=teacher)
    assert item.revenue_share_amount == Decimal("300000.00")
    assert item.net_amount == Decimal("300000.00")


def test_hybrid_salary_adds_base_and_lesson_bonus(period):
    start, end = period
    teacher = make_teacher("Hy", "Brid")
    group = make_group(teacher=teacher)
    _teach(teacher, group, 5)
    set_salary_policy(teacher=teacher, model=SalaryModel.HYBRID, effective_from=start,
                      base_amount=Decimal("2000000"), lesson_bonus=Decimal("50000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    item = run.items.get(teacher=teacher)
    assert item.base_amount == Decimal("2000000.00")
    assert item.bonuses == Decimal("250000.00")
    assert item.net_amount == Decimal("2250000.00")


def test_deductions_reduce_net_but_not_gross(period):
    start, end = period
    teacher = make_teacher("Deduct", "Ion")
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED,
                      effective_from=start, base_amount=Decimal("3000000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher],
                               deductions={teacher.pk: Decimal("200000")})
    item = run.items.get(teacher=teacher)
    assert item.gross_amount == Decimal("3000000.00")
    assert item.deductions == Decimal("200000.00")
    assert item.net_amount == Decimal("2800000.00")


def test_deductions_cannot_exceed_gross(period):
    start, end = period
    teacher = make_teacher("Too", "Much")
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED,
                      effective_from=start, base_amount=Decimal("100000"))
    with pytest.raises(ValidationError):
        calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher],
                              deductions={teacher.pk: Decimal("500000")})


def test_run_totals_reflect_items(period):
    start, end = period
    a = make_teacher("Aaa", "One")
    b = make_teacher("Bbb", "Two")
    set_salary_policy(teacher=a, model=SalaryModel.FIXED, effective_from=start,
                      base_amount=Decimal("1000000"))
    set_salary_policy(teacher=b, model=SalaryModel.FIXED, effective_from=start,
                      base_amount=Decimal("2500000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[a, b])
    assert run.total_gross == Decimal("3500000.00")
    assert run.total_net == Decimal("3500000.00")
    assert run.items.count() == 2
    assert run.status == PayrollStatus.CALCULATED


def test_approved_run_cannot_be_recalculated(period):
    """Historical payroll must stay stable once approved."""
    start, end = period
    teacher = make_teacher("Stable", "History")
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED, effective_from=start,
                      base_amount=Decimal("1000000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    approve_payroll_run(run, actor=None)

    # A later policy change must not touch the approved run.
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED,
                      effective_from=date.today() + timedelta(days=1),
                      base_amount=Decimal("9000000"))
    run.refresh_from_db()
    assert run.items.get(teacher=teacher).net_amount == Decimal("1000000.00")

    with pytest.raises(ValidationError):
        calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])


def test_paying_a_run_books_a_teacher_salaries_expense(period):
    start, end = period
    teacher = make_teacher("Paid", "Out")
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED, effective_from=start,
                      base_amount=Decimal("1500000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])

    with pytest.raises(ValidationError):
        mark_payroll_paid(run, actor=None)          # cannot pay before approval

    approve_payroll_run(run, actor=None)
    mark_payroll_paid(run, actor=None, method="bank_transfer")
    run.refresh_from_db()
    assert run.status == PayrollStatus.PAID
    assert run.expense_id is not None
    expense = Expense.objects.get(pk=run.expense_id)
    assert expense.category == Expense.Category.TEACHER_SALARIES
    assert expense.amount == Decimal("1500000.00")


def test_policy_versions_close_the_previous_one(period):
    start, _ = period
    teacher = make_teacher("Version", "Two")
    first = set_salary_policy(teacher=teacher, model=SalaryModel.FIXED,
                              effective_from=start, base_amount=Decimal("1000000"))
    second = set_salary_policy(teacher=teacher, model=SalaryModel.PER_CLASS,
                               effective_from=start + timedelta(days=15),
                               per_lesson_rate=Decimal("70000"))
    first.refresh_from_db()
    assert first.effective_to == second.effective_from - timedelta(days=1)
    assert SalaryPolicy.objects.filter(teacher=teacher).count() == 2
    assert policy_for(teacher, start).pk == first.pk
    assert policy_for(teacher, start + timedelta(days=20)).pk == second.pk


def test_teacher_without_policy_yields_zero_but_is_listed(period):
    start, end = period
    teacher = make_teacher("No", "Policy")
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    item = run.items.get(teacher=teacher)
    assert item.net_amount == Decimal("0.00")
    assert "No salary policy" in item.policy_snapshot["note"]


def test_earnings_history_lists_items_and_policies(period):
    start, end = period
    teacher = make_teacher("Hist", "Ory")
    set_salary_policy(teacher=teacher, model=SalaryModel.FIXED, effective_from=start,
                      base_amount=Decimal("800000"))
    run = calculate_payroll_run(period_start=start, period_end=end, teachers=[teacher])
    approve_payroll_run(run, actor=None)
    mark_payroll_paid(run, actor=None)

    history = teacher_earnings_history(teacher)
    assert history["teacher"] == teacher.pk
    assert history["total_earned"] == "800000.00"
    assert len(history["policies"]) == 1
    assert history["items"][0]["run_status"] == PayrollStatus.PAID
    assert "net_amount" in run_summary(run)["items"][0]
