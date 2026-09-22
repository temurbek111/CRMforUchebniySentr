"""Payroll services: calculation for every compensation model, approval, payment.

The calculation engine is deliberately testable without HTTP: each model is a
pure function of the policy, the lesson count and the group revenue for the
period (plan sections 29, 30, 50).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.academics.models import Teacher
from apps.attendance.models import AttendanceSession
from apps.core.audit import log_action
from apps.core.models import AuditLog
from apps.core.money import ZERO, quantize

from .models import (
    PayrollItem,
    PayrollRun,
    PayrollStatus,
    SalaryModel,
    SalaryPolicy,
)

PERCENT = Decimal("0.01")


# --------------------------------------------------------------------------- #
# Policies
# --------------------------------------------------------------------------- #
def policy_for(teacher: Teacher, on_date: date) -> SalaryPolicy | None:
    """The policy in force for a teacher on a given date."""
    return (
        SalaryPolicy.objects.filter(teacher=teacher, effective_from__lte=on_date)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=on_date))
        .order_by("-effective_from")
        .first()
    )


@transaction.atomic
def set_salary_policy(
    *,
    teacher: Teacher,
    model: str,
    effective_from: date,
    base_amount: Decimal = ZERO,
    per_lesson_rate: Decimal = ZERO,
    revenue_share_pct: Decimal = Decimal("0"),
    lesson_bonus: Decimal = ZERO,
    note: str = "",
    actor=None,
) -> SalaryPolicy:
    """Create a new versioned policy, closing the previous one the day before."""
    if model not in set(SalaryModel.values):
        raise ValidationError({"model": f"Unknown salary model {model!r}."})
    if model == SalaryModel.FIXED and base_amount <= ZERO:
        raise ValidationError({"base_amount": "A fixed salary must be greater than zero."})
    if model == SalaryModel.PER_CLASS and per_lesson_rate <= ZERO:
        raise ValidationError({"per_lesson_rate": "A per-lesson rate must be greater than zero."})
    if model == SalaryModel.PERCENTAGE and not (Decimal("0") < revenue_share_pct <= Decimal("100")):
        raise ValidationError({"revenue_share_pct": "A revenue share must be between 0 and 100."})
    if model == SalaryModel.HYBRID and (base_amount <= ZERO and lesson_bonus <= ZERO):
        raise ValidationError({"base_amount": "A hybrid policy needs a base amount or a lesson bonus."})

    previous = (
        SalaryPolicy.objects.filter(teacher=teacher, effective_to__isnull=True,
                                    effective_from__lt=effective_from)
        .order_by("-effective_from")
        .first()
    )
    if previous is not None:
        previous.effective_to = effective_from - timedelta(days=1)
        previous.save(update_fields=["effective_to"])

    policy = SalaryPolicy.objects.create(
        teacher=teacher, model=model, base_amount=quantize(base_amount),
        per_lesson_rate=quantize(per_lesson_rate),
        revenue_share_pct=Decimal(revenue_share_pct).quantize(PERCENT, rounding=ROUND_HALF_UP),
        lesson_bonus=quantize(lesson_bonus), effective_from=effective_from, note=note[:255],
        created_by=actor,
    )
    log_action(
        AuditLog.Action.CREATE, policy, actor=actor,
        new=policy.snapshot(),
        summary=f"Salary policy set for {teacher.full_name}: {policy.get_model_display()}",
    )
    return policy


# --------------------------------------------------------------------------- #
# Inputs to the calculation
# --------------------------------------------------------------------------- #
def lessons_taught(teacher: Teacher, period_start: date, period_end: date) -> int:
    """Distinct class meetings taught (or attributed to) this teacher."""
    return (
        AttendanceSession.objects.filter(date__range=(period_start, period_end))
        .filter(Q(teacher=teacher) | Q(group__teacher=teacher))
        .values("group_id", "date", "slot_id")
        .distinct()
        .count()
    )


def group_revenue(teacher: Teacher, period_start: date, period_end: date) -> Decimal:
    """Fees collected in the period from students of this teacher's groups."""
    from apps.finance.models import Payment

    total = (
        Payment.objects.filter(
            is_void=False, paid_at__range=(period_start, period_end),
            student__group_memberships__group__teacher=teacher,
            student__group_memberships__left_at__isnull=True,
        )
        .distinct()
        .aggregate(total=Sum("amount"))["total"]
    )
    return total or ZERO


def calculate_amounts(policy: SalaryPolicy, *, lessons: int, revenue: Decimal) -> dict:
    """Pure calculation for one teacher. All four models live here."""
    zero = ZERO
    base = per_lesson = share = bonus = zero
    breakdown: dict[str, str] = {}

    if policy.model == SalaryModel.FIXED:
        base = policy.base_amount
        breakdown["fixed"] = f"{policy.base_amount} fixed monthly"
    elif policy.model == SalaryModel.PER_CLASS:
        per_lesson = quantize(policy.per_lesson_rate * lessons)
        breakdown["per_lesson"] = f"{policy.per_lesson_rate} x {lessons} lessons"
    elif policy.model == SalaryModel.PERCENTAGE:
        share = quantize(revenue * policy.revenue_share_pct / Decimal("100"))
        breakdown["percentage"] = f"{policy.revenue_share_pct}% of {quantize(revenue)} revenue"
    elif policy.model == SalaryModel.HYBRID:
        base = policy.base_amount
        bonus = quantize(policy.lesson_bonus * lessons)
        breakdown["hybrid"] = (
            f"{policy.base_amount} base + {policy.lesson_bonus} x {lessons} lessons"
        )

    gross = quantize(base + per_lesson + share + bonus)
    return {
        "lessons": lessons,
        "base_amount": base,
        "per_lesson_amount": per_lesson,
        "revenue_share_amount": share,
        "revenue_base": quantize(revenue),
        "bonuses": bonus,
        "gross_amount": gross,
        "breakdown": breakdown,
    }


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #
@transaction.atomic
def calculate_payroll_run(
    *,
    period_start: date,
    period_end: date,
    actor=None,
    teachers=None,
    deductions: dict[int, Decimal] | None = None,
    label: str | None = None,
) -> PayrollRun:
    """Create or recalculate a run. Locked runs are never recalculated."""
    if period_end < period_start:
        raise ValidationError({"period_end": "The period cannot end before it starts."})

    run = PayrollRun.objects.filter(period_start=period_start, period_end=period_end).first()
    if run is None:
        run = PayrollRun.objects.create(
            label=label or period_start.strftime("%B %Y"),
            period_start=period_start, period_end=period_end,
            status=PayrollStatus.DRAFT, created_by=actor,
        )
    elif run.is_locked:
        raise ValidationError({
            "run": f"Payroll for {run.label} is already {run.get_status_display().lower()} "
                   f"and cannot be recalculated."
        })

    deductions = deductions or {}
    staff = teachers if teachers is not None else list(
        Teacher.objects.filter(status="active")
    )
    if not staff:
        raise ValidationError({"teachers": "No active teachers to calculate payroll for."})

    for teacher in staff:
        policy = policy_for(teacher, period_end)
        lessons = lessons_taught(teacher, period_start, period_end)
        revenue = group_revenue(teacher, period_start, period_end) if policy and policy.model in {
            SalaryModel.PERCENTAGE,
        } else ZERO
        if policy is None:
            amounts = {
                "lessons": lessons, "base_amount": ZERO, "per_lesson_amount": ZERO,
                "revenue_share_amount": ZERO, "revenue_base": ZERO, "bonuses": ZERO,
                "gross_amount": ZERO, "breakdown": {},
            }
            snapshot = {"model": None, "note": "No salary policy in force for this period"}
        else:
            amounts = calculate_amounts(policy, lessons=lessons, revenue=revenue)
            snapshot = policy.snapshot()

        deduction = quantize(deductions.get(teacher.pk, ZERO))
        net = amounts["gross_amount"] - deduction
        if net < ZERO:
            raise ValidationError({
                "deductions": f"Deductions for {teacher.full_name} exceed the gross amount."
            })

        PayrollItem.objects.update_or_create(
            run=run, teacher=teacher,
            defaults={
                "lessons_count": amounts["lessons"],
                "base_amount": amounts["base_amount"],
                "per_lesson_amount": amounts["per_lesson_amount"],
                "revenue_share_amount": amounts["revenue_share_amount"],
                "revenue_base": amounts["revenue_base"],
                "bonuses": amounts["bonuses"],
                "deductions": deduction,
                "gross_amount": amounts["gross_amount"],
                "net_amount": net,
                "policy_snapshot": snapshot,
                "breakdown": amounts["breakdown"],
            },
        )

    run.status = PayrollStatus.CALCULATED
    run.calculated_at = timezone.now()
    run.refresh_totals(save=False)
    run.save(update_fields=["status", "calculated_at", "total_gross", "total_deductions",
                            "total_net", "updated_at"])
    log_action(
        AuditLog.Action.UPDATE, run, actor=actor,
        new={"status": run.status, "items": run.items.count(), "net": str(run.total_net)},
        summary=f"Payroll calculated for {run.label}: net {run.total_net}",
    )
    return run


@transaction.atomic
def approve_payroll_run(run: PayrollRun, *, actor=None) -> PayrollRun:
    """Approval freezes the run. Only an approver may do this (checked in the API)."""
    if run.status == PayrollStatus.DRAFT:
        raise ValidationError({"run": "Calculate the payroll before approving it."})
    if run.status in {PayrollStatus.APPROVED, PayrollStatus.PAID}:
        raise ValidationError({"run": f"This run is already {run.get_status_display().lower()}."})
    run.status = PayrollStatus.APPROVED
    run.approved_by = actor
    run.approved_at = timezone.now()
    run.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    log_action(
        AuditLog.Action.APPROVE, run, actor=actor,
        new={"status": run.status, "net": str(run.total_net)},
        summary=f"Payroll approved for {run.label}: {run.total_net}",
    )
    return run


@transaction.atomic
def mark_payroll_paid(
    run: PayrollRun, *, actor=None, method: str = "bank_transfer",
    paid_date: date | None = None, reference: str = "",
) -> PayrollRun:
    """Paying a run books a Teacher Salaries expense so finance stays truthful."""
    from apps.finance.models import Expense
    from apps.finance.services import create_expense

    if run.status != PayrollStatus.APPROVED:
        raise ValidationError({"run": "Only an approved payroll run can be paid."})
    if run.total_net <= ZERO:
        raise ValidationError({"run": "This run has nothing to pay."})

    paid_date = paid_date or timezone.localdate()
    from apps.finance.models import Payment

    valid_methods = {value for value, _ in Payment.Method.choices}
    resolved_method = method if method in valid_methods else Payment.Method.BANK_TRANSFER
    expense = create_expense(
        category=Expense.Category.TEACHER_SALARIES, amount=run.total_net, actor=actor,
        date=paid_date, method=resolved_method,
        description=f"Teacher payroll {run.label}",
        reference=reference or f"PAYROLL-{run.pk}",
    )
    run.expense = expense
    run.status = PayrollStatus.PAID
    run.paid_by = actor
    run.paid_at = timezone.now()
    run.save(update_fields=["expense", "status", "paid_by", "paid_at", "updated_at"])
    log_action(
        AuditLog.Action.PAY, run, actor=actor,
        new={"status": run.status, "amount": str(run.total_net), "expense": expense.pk},
        summary=f"Payroll paid for {run.label}: {run.total_net}",
    )
    return run


# --------------------------------------------------------------------------- #
# Read helpers
# --------------------------------------------------------------------------- #
def run_summary(run: PayrollRun) -> dict:
    return {
        "id": run.pk,
        "label": run.label,
        "period_start": run.period_start,
        "period_end": run.period_end,
        "status": run.status,
        "status_label": run.get_status_display(),
        "is_locked": run.is_locked,
        "total_gross": str(run.total_gross),
        "total_deductions": str(run.total_deductions),
        "total_net": str(run.total_net),
        "teachers_count": run.items.count(),
        "calculated_at": run.calculated_at,
        "approved_by": run.approved_by.full_name if run.approved_by_id else "",
        "approved_at": run.approved_at,
        "paid_at": run.paid_at,
        "expense": run.expense_id,
        "notes": run.notes,
        "items": [item_summary(item) for item in run.items.select_related("teacher")],
    }


def item_summary(item: PayrollItem) -> dict:
    return {
        "id": item.pk,
        "run": item.run_id,
        "teacher": item.teacher_id,
        "teacher_name": item.teacher.full_name,
        "lessons_count": item.lessons_count,
        "base_amount": str(item.base_amount),
        "per_lesson_amount": str(item.per_lesson_amount),
        "revenue_share_amount": str(item.revenue_share_amount),
        "revenue_base": str(item.revenue_base),
        "bonuses": str(item.bonuses),
        "deductions": str(item.deductions),
        "gross_amount": str(item.gross_amount),
        "net_amount": str(item.net_amount),
        "policy_snapshot": item.policy_snapshot,
        "breakdown": item.breakdown,
        "note": item.note,
    }


def teacher_earnings_history(teacher: Teacher) -> dict:
    from .models import SalaryPolicy as Policy

    items = teacher.payroll_items.select_related("run").order_by("-run__period_start")
    total = sum((item.net_amount for item in items), ZERO)
    return {
        "teacher": teacher.pk,
        "teacher_name": teacher.full_name,
        "total_earned": str(quantize(total)),
        "payments_count": items.count(),
        "policies": [policy_snapshot_row(policy) for policy in Policy.objects.filter(teacher=teacher)],
        "items": [
            item_summary(item) | {"run_label": item.run.label, "run_status": item.run.status}
            for item in items
        ],
    }


def policy_snapshot_row(policy: SalaryPolicy) -> dict:
    return policy.snapshot() | {"id": policy.pk, "note": policy.note}


def pending_payroll_runs() -> list[dict]:
    runs = PayrollRun.objects.filter(status__in=[PayrollStatus.CALCULATED, PayrollStatus.APPROVED])
    return [run_summary(run) for run in runs]
