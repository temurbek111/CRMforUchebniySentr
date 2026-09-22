"""Finance services.

Every monetary figure in this module is computed from database rows with
aggregate queries. Nothing is trusted from the client (plan sections 27, 50, 54).
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.academics.models import Group, Student
from apps.core.audit import log_action
from apps.core.models import AuditLog, SystemSettings
from apps.core.money import ZERO, quantize

from .models import (
    BillingPeriod,
    Expense,
    Income,
    InvoiceStatus,
    Payment,
    StudentInvoice,
)

OVERDUE_BUCKETS = ((1, 7, "1-7 days"), (8, 30, "8-30 days"), (31, None, "30+ days"))


# --------------------------------------------------------------------------- #
# Billing periods & invoices
# --------------------------------------------------------------------------- #
def period_dates(year: int, month: int) -> tuple[date, date]:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def get_or_create_billing_period(period_start: date, due_date: date | None = None) -> BillingPeriod:
    settings_obj = SystemSettings.get_solo()
    _, period_end = period_dates(period_start.year, period_start.month)
    due_date = due_date or date(
        period_start.year, period_start.month,
        min(settings_obj.default_billing_day, calendar.monthrange(period_start.year, period_start.month)[1]),
    )
    period, _ = BillingPeriod.objects.get_or_create(
        label=BillingPeriod.label_for(period_start),
        defaults={"period_start": period_start, "period_end": period_end, "due_date": due_date},
    )
    return period


@transaction.atomic
def ensure_invoice(
    student: Student,
    period_start: date,
    *,
    period_end: date | None = None,
    amount_due: Decimal | None = None,
    due_date: date | None = None,
    group: Group | None = None,
    actor=None,
    notes: str = "",
) -> StudentInvoice:
    """Create the invoice for a student/period if it does not exist yet (idempotent)."""
    _, default_end = period_dates(period_start.year, period_start.month)
    period = get_or_create_billing_period(period_start, due_date)
    defaults = {
        "period_end": period_end or default_end,
        "amount_due": quantize(amount_due if amount_due is not None else student.monthly_fee),
        "due_date": due_date or period.due_date,
        "group": group or student.current_group(),
        "period": period,
        "notes": notes,
        "created_by": actor,
    }
    invoice, created = StudentInvoice.objects.get_or_create(
        student=student, period_start=period_start, defaults=defaults
    )
    if created:
        log_action(
            AuditLog.Action.CREATE, invoice, actor=actor,
            new={"student": student.pk, "period": invoice.period_label,
                 "amount_due": str(invoice.amount_due)},
            summary=f"Invoice {invoice.period_label} for {student.full_name}: {invoice.amount_due}",
        )
    return invoice


@transaction.atomic
def generate_monthly_invoices(
    *, year: int, month: int, actor=None, due_date: date | None = None, group: Group | None = None
) -> dict:
    """Bill every active student that has a fee. Safe to run more than once."""
    period_start, _ = period_dates(year, month)
    students = Student.objects.filter(status="active").select_related("guardian")
    if group is not None:
        students = students.filter(
            group_memberships__group=group, group_memberships__left_at__isnull=True
        ).distinct()

    created, skipped, zero_fee = [], 0, 0
    for student in students:
        fee = student.monthly_fee
        if fee <= ZERO:
            zero_fee += 1
            continue
        if StudentInvoice.objects.filter(student=student, period_start=period_start).exists():
            skipped += 1
            continue
        invoice = ensure_invoice(
            student, period_start, amount_due=fee, due_date=due_date,
            group=group or student.current_group(), actor=actor,
        )
        created.append(invoice)
    return {
        "period": BillingPeriod.label_for(period_start),
        "period_start": period_start,
        "created": len(created),
        "skipped_existing": skipped,
        "skipped_no_fee": zero_fee,
        "invoices": [invoice_summary(inv) for inv in created],
    }


def recalculate_invoice_status(invoice: StudentInvoice) -> StudentInvoice:
    """Refresh the stored status after payments change. Waived/cancelled are preserved."""
    if invoice.status in {InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED}:
        return invoice
    paid = invoice.amount_paid
    if paid <= ZERO:
        new_status = InvoiceStatus.OVERDUE if invoice.due_date < timezone.localdate() else InvoiceStatus.UNPAID
    elif paid < invoice.amount_due:
        new_status = InvoiceStatus.PARTIAL
    else:
        new_status = InvoiceStatus.PAID
    if invoice.status != new_status:
        invoice.status = new_status
        invoice.save(update_fields=["status", "updated_at"])
    return invoice


def invoice_summary(invoice: StudentInvoice) -> dict:
    paid = invoice.amount_paid
    return {
        "id": invoice.pk,
        "student": invoice.student_id,
        "student_name": invoice.student.full_name,
        "student_code": invoice.student.code,
        "group": invoice.group_id,
        "group_name": invoice.group.name if invoice.group else "",
        "period": invoice.period_label,
        "period_start": invoice.period_start,
        "period_end": invoice.period_end,
        "amount_due": str(invoice.amount_due),
        "amount_paid": str(paid),
        "remaining": str(invoice.remaining),
        "credit": str(invoice.credit),
        "status": invoice.display_status,
        "status_label": InvoiceStatus(invoice.display_status).label,
        "due_date": invoice.due_date,
        "days_overdue": invoice.days_overdue,
        "notes": invoice.notes,
    }


# --------------------------------------------------------------------------- #
# Payments (append-only)
# --------------------------------------------------------------------------- #
@transaction.atomic
def record_payment(
    *,
    student: Student,
    amount: Decimal,
    invoice: StudentInvoice | None = None,
    method: str = Payment.Method.CASH,
    paid_at: date | None = None,
    received_by=None,
    reference: str = "",
    notes: str = "",
    actor=None,
    allow_overpayment: bool = False,
) -> Payment:
    """Record a payment transaction. Partial payments are first-class."""
    amount = quantize(amount)
    if amount <= ZERO:
        raise ValidationError({"amount": "A payment must be greater than zero."})
    valid_methods = set(Payment.Method.values)
    if method not in valid_methods:
        raise ValidationError({"method": f"Unknown payment method {method!r}."})
    if invoice is not None and invoice.student_id != student.pk:
        raise ValidationError({"invoice": "That invoice belongs to a different student."})
    if invoice is not None and invoice.status in {InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED}:
        raise ValidationError({"invoice": f"This invoice is {invoice.get_status_display().lower()}."})
    if invoice is not None and invoice.remaining <= ZERO and not allow_overpayment:
        raise ValidationError({"amount": "This invoice is already fully paid."})
    if invoice is not None and invoice.remaining > ZERO and amount > invoice.remaining and not allow_overpayment:
        raise ValidationError({
            "amount": f"Amount exceeds the outstanding balance of {invoice.remaining}. "
                      f"Prepayment requires an explicit override."
        })

    payment = Payment.objects.create(
        student=student, invoice=invoice, amount=amount, paid_at=paid_at or timezone.localdate(),
        method=method, received_by=received_by or actor, reference=reference, notes=notes,
        created_by=actor,
    )
    if invoice is not None:
        log_action(
            AuditLog.Action.PAY, invoice, actor=actor,
            old={"status": InvoiceStatus(invoice.status).label},
            new={"paid": str(invoice.amount_paid), "remaining": str(invoice.remaining)},
            summary=(
                f"Payment {payment.amount} from {student.full_name} for {invoice.period_label} "
                f"(remaining {invoice.remaining})"
            ),
        )
        recalculate_invoice_status(invoice)
    else:
        log_action(
            AuditLog.Action.PAY, payment, actor=actor,
            new={"student": student.pk, "amount": str(amount), "method": method},
            summary=f"Unallocated payment {amount} from {student.full_name}",
        )
    return payment


@transaction.atomic
def void_payment(payment: Payment, reason: str, *, actor=None) -> Payment:
    """Financial records are never deleted; they are voided with a reason."""
    if payment.is_void:
        raise ValidationError({"payment": "This payment is already void."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "A void reason is required."})
    payment.is_void = True
    payment.void_reason = reason.strip()[:255]
    payment.voided_by = actor
    payment.voided_at = timezone.now()
    payment.save(update_fields=["is_void", "void_reason", "voided_by", "voided_at"])
    if payment.invoice_id:
        recalculate_invoice_status(payment.invoice)
    log_action(
        AuditLog.Action.VOID, payment, actor=actor,
        old={"amount": str(payment.amount)}, new={"void_reason": payment.void_reason},
        summary=f"Voided payment {payment.receipt_number} ({payment.amount}): {payment.void_reason}",
    )
    return payment


# --------------------------------------------------------------------------- #
# Student / group balances
# --------------------------------------------------------------------------- #
def student_balance(student: Student) -> dict:
    aggregates = student.invoices.aggregate(
        due=Sum("amount_due"), count=Count("id")
    )
    paid = Payment.objects.filter(student=student, is_void=False).aggregate(total=Sum("amount"))["total"] or ZERO
    due = aggregates["due"] or ZERO
    outstanding = due - paid
    open_invoices = [inv for inv in student.invoices.all() if not inv.is_settled]
    worst = max((inv.days_overdue for inv in open_invoices), default=0)
    if open_invoices:
        status = InvoiceStatus.OVERDUE if worst else (
            "partial" if paid > ZERO else "unpaid"
        )
    else:
        status = "paid" if due > ZERO or paid > ZERO else "no_invoices"
    return {
        "student": student.pk,
        "student_name": student.full_name,
        "total_due": str(quantize(due)),
        "total_paid": str(quantize(paid)),
        "outstanding": str(quantize(outstanding if outstanding > ZERO else ZERO)),
        "credit": str(quantize(-outstanding if outstanding < ZERO else ZERO)),
        "status": status,
        "invoice_count": aggregates["count"] or 0,
        "open_invoices": len(open_invoices),
        "days_overdue": worst,
        "monthly_fee": str(student.monthly_fee),
    }


def student_financial_history(student: Student) -> dict:
    invoices = [invoice_summary(inv) for inv in student.invoices.select_related("group").all()]
    payments = [
        {
            "id": payment.pk,
            "receipt": payment.receipt_number,
            "amount": str(payment.amount),
            "paid_at": payment.paid_at,
            "method": payment.method,
            "method_label": payment.get_method_display(),
            "period": payment.invoice.period_label if payment.invoice_id else "",
            "invoice": payment.invoice_id,
            "reference": payment.reference,
            "received_by": payment.received_by.full_name if payment.received_by_id else "",
            "is_void": payment.is_void,
            "void_reason": payment.void_reason,
            "notes": payment.notes,
            "created_at": payment.created_at,
        }
        for payment in student.payments.select_related("invoice", "received_by").order_by("-paid_at", "-id")
    ]
    return {"balance": student_balance(student), "invoices": invoices, "payments": payments}


def group_billing_summary(group: Group, period_start: date | None = None) -> dict:
    """Outstanding money per student in a group for one billing period."""
    period_start = period_start or timezone.localdate().replace(day=1)
    invoices = group.invoices.filter(period_start=period_start).select_related("student")
    rows = [invoice_summary(inv) for inv in invoices]
    due = sum((inv.amount_due for inv in invoices), ZERO)
    paid = sum((inv.amount_paid for inv in invoices), ZERO)
    return {
        "group": group.pk,
        "group_name": group.name,
        "period_start": period_start,
        "students": rows,
        "amount_due": str(quantize(due)),
        "amount_paid": str(quantize(paid)),
        "outstanding": str(quantize(due - paid if due > paid else ZERO)),
        "paid_count": sum(1 for inv in invoices if inv.remaining <= ZERO),
        "unpaid_count": sum(1 for inv in invoices if inv.remaining > ZERO),
    }


# --------------------------------------------------------------------------- #
# Centre-wide figures & overdue analysis
# --------------------------------------------------------------------------- #
def student_fee_revenue(date_from: date, date_to: date) -> Decimal:
    return (
        Payment.objects.filter(is_void=False, paid_at__range=(date_from, date_to))
        .aggregate(total=Sum("amount"))["total"] or ZERO
    )


def other_income(date_from: date, date_to: date) -> Decimal:
    return (
        Income.objects.filter(is_void=False, date__range=(date_from, date_to))
        .exclude(category=Income.Category.STUDENT_FEES)
        .aggregate(total=Sum("amount"))["total"] or ZERO
    )


def total_expenses(date_from: date, date_to: date, *, exclude_payroll: bool = False) -> Decimal:
    queryset = Expense.objects.filter(is_void=False, date__range=(date_from, date_to))
    if exclude_payroll:
        queryset = queryset.exclude(category=Expense.Category.TEACHER_SALARIES)
    return queryset.aggregate(total=Sum("amount"))["total"] or ZERO


def payroll_expenses(date_from: date, date_to: date) -> Decimal:
    return (
        Expense.objects.filter(
            is_void=False, date__range=(date_from, date_to),
            category=Expense.Category.TEACHER_SALARIES,
        ).aggregate(total=Sum("amount"))["total"] or ZERO
    )


def outstanding_receivables(as_of: date | None = None) -> dict:
    as_of = as_of or timezone.localdate()
    invoices = StudentInvoice.objects.exclude(
        status__in=[InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED]
    ).select_related("student", "group")
    rows, total, buckets = [], ZERO, {label: {"count": 0, "amount": ZERO} for *_, label in OVERDUE_BUCKETS}
    unpaid_rows = []
    for invoice in invoices:
        remaining = invoice.remaining
        if remaining <= ZERO:
            continue
        total += remaining
        days = invoice.days_overdue
        summary = invoice_summary(invoice) | {"remaining_amount": str(remaining)}
        unpaid_rows.append(summary)
        if days > 0:
            for low, high, label in OVERDUE_BUCKETS:
                if days >= low and (high is None or days <= high):
                    buckets[label]["count"] += 1
                    buckets[label]["amount"] += remaining
                    break
    unpaid_rows.sort(key=lambda row: (-row["days_overdue"], row["student_name"]))
    overdue = [row for row in unpaid_rows if row["days_overdue"] > 0]
    return {
        "as_of": as_of,
        "count": len(unpaid_rows),
        "amount": str(quantize(total)),
        "overdue_count": len(overdue),
        "overdue_amount": str(quantize(sum((Decimal(r["remaining_amount"]) for r in overdue), ZERO))),
        "buckets": {label: {"count": data["count"], "amount": str(quantize(data["amount"]))}
                    for label, data in buckets.items()},
        "invoices": unpaid_rows,
        "overdue_invoices": overdue,
    }


def finance_summary(date_from: date, date_to: date) -> dict:
    """The single source of financial truth for a date range (plan section 27)."""
    fees = student_fee_revenue(date_from, date_to)
    other = other_income(date_from, date_to)
    payroll = payroll_expenses(date_from, date_to)
    other_expenses = total_expenses(date_from, date_to, exclude_payroll=True)
    gross_income = fees + other
    total_out = payroll + other_expenses
    receivables = outstanding_receivables(date_to)
    return {
        "from": date_from,
        "to": date_to,
        "student_fees": str(quantize(fees)),
        "other_income": str(quantize(other)),
        "gross_income": str(quantize(gross_income)),
        "payroll": str(quantize(payroll)),
        "other_expenses": str(quantize(other_expenses)),
        "total_expenses": str(quantize(total_out)),
        "net_result": str(quantize(gross_income - total_out)),
        "outstanding": receivables["amount"],
        "overdue_count": receivables["overdue_count"],
        "collection_rate": str(
            quantize(gross_income / (gross_income + Decimal(receivables["amount"])) * 100)
            if (gross_income + Decimal(receivables["amount"])) > ZERO else ZERO
        ),
    }


def monthly_financial_summary(year: int, month: int) -> dict:
    start, end = period_dates(year, month)
    summary = finance_summary(start, end)
    return summary | {"label": BillingPeriod.label_for(start)}


def monthly_financial_series(year: int) -> list[dict]:
    """Twelve months of income/expense/net for the dashboard chart (real data)."""
    series = []
    for month in range(1, 13):
        start, end = period_dates(year, month)
        income = student_fee_revenue(start, end) + other_income(start, end)
        expenses = total_expenses(start, end)
        series.append({
            "label": start.strftime("%b"),
            "month": month,
            "income": str(quantize(income)),
            "expenses": str(quantize(expenses)),
            "net": str(quantize(income - expenses)),
        })
    return series


def income_breakdown(date_from: date, date_to: date) -> list[dict]:
    rows = [
        {"category": "Student Fees", "amount": str(quantize(student_fee_revenue(date_from, date_to)))},
        *[
            {"category": row["category_label"] or dict(Income.Category.choices)[row["category"]],
             "amount": str(quantize(row["total"]))}
            for row in Income.objects.filter(is_void=False, date__range=(date_from, date_to))
            .exclude(category=Income.Category.STUDENT_FEES)
            .values("category", "category_label")
            .annotate(total=Sum("amount"))
        ],
    ]
    return [row for row in rows if Decimal(row["amount"]) > ZERO]


def expense_breakdown(date_from: date, date_to: date) -> list[dict]:
    rows = (
        Expense.objects.filter(is_void=False, date__range=(date_from, date_to))
        .values("category", "category_label")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("-total")
    )
    return [
        {
            "category": row["category_label"] or dict(Expense.Category.choices)[row["category"]],
            "category_code": row["category"],
            "amount": str(quantize(row["total"])),
            "count": row["count"],
        }
        for row in rows
    ]


def revenue_by_course(date_from: date, date_to: date) -> list[dict]:
    rows = (
        Payment.objects.filter(is_void=False, paid_at__range=(date_from, date_to))
        .values("student__group_memberships__group__course__name")
        .annotate(total=Sum("amount"), payments=Count("id"))
        .order_by("-total")
    )
    seen: dict[str, dict] = {}
    for row in rows:
        name = row["student__group_memberships__group__course__name"] or "Unassigned"
        bucket = seen.setdefault(name, {"course": name, "amount": ZERO, "payments": 0})
        bucket["amount"] += row["total"] or ZERO
        bucket["payments"] += row["payments"]
    return [
        {"course": name, "amount": str(quantize(data["amount"])), "payments": data["payments"]}
        for name, data in sorted(seen.items(), key=lambda item: -item[1]["amount"])
    ]


# --------------------------------------------------------------------------- #
# Income & expense entry
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_income(*, category: str, amount: Decimal, actor=None, **fields) -> Income:
    amount = quantize(amount)
    if amount <= ZERO:
        raise ValidationError({"amount": "Income must be greater than zero."})
    if category not in set(Income.Category.values):
        raise ValidationError({"category": f"Unknown income category {category!r}."})
    income = Income.objects.create(category=category, amount=amount, created_by=actor, **fields)
    log_action(
        AuditLog.Action.CREATE, income, actor=actor,
        new={"category": category, "amount": str(amount)},
        summary=f"Income recorded: {income.display_category} {amount}",
    )
    return income


@transaction.atomic
def create_expense(*, category: str, amount: Decimal, actor=None, **fields) -> Expense:
    amount = quantize(amount)
    if amount <= ZERO:
        raise ValidationError({"amount": "An expense must be greater than zero."})
    if category not in set(Expense.Category.values):
        raise ValidationError({"category": f"Unknown expense category {category!r}."})
    expense = Expense.objects.create(category=category, amount=amount, created_by=actor, **fields)
    log_action(
        AuditLog.Action.CREATE, expense, actor=actor,
        new={"category": category, "amount": str(amount)},
        summary=f"Expense recorded: {expense.display_category} {amount}",
    )
    return expense


@transaction.atomic
def void_income(income: Income, reason: str, *, actor=None) -> Income:
    if income.is_void:
        raise ValidationError({"income": "This record is already void."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "A void reason is required."})
    income.is_void = True
    income.void_reason = reason.strip()[:255]
    income.save(update_fields=["is_void", "void_reason"])
    log_action(AuditLog.Action.VOID, income, actor=actor, new={"void_reason": income.void_reason},
               summary=f"Voided income {income.amount}: {income.void_reason}")
    return income


@transaction.atomic
def void_expense(expense: Expense, reason: str, *, actor=None) -> Expense:
    if expense.is_void:
        raise ValidationError({"expense": "This record is already void."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "A void reason is required."})
    expense.is_void = True
    expense.void_reason = reason.strip()[:255]
    expense.save(update_fields=["is_void", "void_reason"])
    log_action(AuditLog.Action.VOID, expense, actor=actor, new={"void_reason": expense.void_reason},
               summary=f"Voided expense {expense.amount}: {expense.void_reason}")
    return expense


# --------------------------------------------------------------------------- #
# Reporting entries used by the dashboard and reports module
# --------------------------------------------------------------------------- #
def recent_payments(limit: int = 8) -> list[dict]:
    payments = (
        Payment.objects.filter(is_void=False)
        .select_related("student", "received_by", "invoice")
        .order_by("-created_at")[:limit]
    )
    return [
        {
            "id": payment.pk,
            "student": payment.student_id,
            "student_name": payment.student.full_name,
            "student_code": payment.student.code,
            "amount": str(payment.amount),
            "method": payment.get_method_display(),
            "date": payment.paid_at,
            "received_by": payment.received_by.full_name if payment.received_by_id else "",
            "period": payment.invoice.period_label if payment.invoice_id else "",
        }
        for payment in payments
    ]


def payment_status_breakdown(period_start: date | None = None) -> dict:
    """Paid / partial / unpaid / overdue counts for the dashboard widget."""
    period_start = period_start or timezone.localdate().replace(day=1)
    invoices = StudentInvoice.objects.filter(period_start=period_start)
    counts = {"paid": 0, "partial": 0, "unpaid": 0, "overdue": 0, "waived": 0}
    amounts = {"paid": ZERO, "partial": ZERO, "unpaid": ZERO, "overdue": ZERO, "waived": ZERO}
    for invoice in invoices:
        status = invoice.display_status
        counts[status] = counts.get(status, 0) + 1
        amounts[status] = amounts.get(status, ZERO) + invoice.remaining
    return {
        "period_start": period_start,
        "counts": counts,
        "amounts": {key: str(quantize(value)) for key, value in amounts.items()},
    }


def todays_collections(day: date | None = None) -> Decimal:
    day = day or timezone.localdate()
    return (
        Payment.objects.filter(is_void=False, paid_at=day).aggregate(total=Sum("amount"))["total"] or ZERO
    )


def payroll_payable() -> Decimal:
    """Amount still owed to teachers: approved but unpaid payroll runs."""
    try:
        from apps.payroll.models import PayrollRun, PayrollStatus

        return (
            PayrollRun.objects.filter(status__in=[PayrollStatus.CALCULATED, PayrollStatus.APPROVED])
            .aggregate(total=Sum("net_total"))["total"] or ZERO
        )
    except Exception:  # pragma: no cover - payroll app not installed
        return ZERO


def range_last_days(days: int, *, end: date | None = None) -> tuple[date, date]:
    end = end or timezone.localdate()
    return end - timedelta(days=days - 1), end
