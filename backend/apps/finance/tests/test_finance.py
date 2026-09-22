"""Finance rules: invoices, partial payments, overdue handling, voiding."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.finance.models import InvoiceStatus, Payment, StudentInvoice
from apps.finance.services import (
    ensure_invoice,
    finance_summary,
    generate_monthly_invoices,
    monthly_financial_summary,
    outstanding_receivables,
    record_payment,
    student_balance,
    void_payment,
)
from tests.factories import enroll, make_group, make_student

pytestmark = pytest.mark.django_db


@pytest.fixture
def student_in_group():
    group = make_group(fee="1200000")
    student = make_student("Ali", "Karimov")
    enroll(student, group)
    return student, group


def test_invoice_amount_uses_the_group_fee(student_in_group):
    student, group = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    assert invoice.amount_due == Decimal("1200000.00")
    assert invoice.amount_paid == Decimal("0.00")
    assert invoice.remaining == Decimal("1200000.00")
    assert invoice.status == InvoiceStatus.UNPAID


def test_invoice_creation_is_idempotent_for_a_period(student_in_group):
    student, _ = student_in_group
    period = date.today().replace(day=1)
    first = ensure_invoice(student, period)
    second = ensure_invoice(student, period)
    assert first.pk == second.pk
    assert StudentInvoice.objects.filter(student=student).count() == 1


def test_monthly_generation_skips_existing_invoices(student_in_group):
    student, _ = student_in_group
    today = date.today()
    first = generate_monthly_invoices(year=today.year, month=today.month)
    assert first["created"] == 1
    second = generate_monthly_invoices(year=today.year, month=today.month)
    assert second["created"] == 0
    assert second["skipped_existing"] == 1


def test_full_payment_settles_the_invoice(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    record_payment(student=student, amount=Decimal("1200000"), invoice=invoice)
    invoice.refresh_from_db()
    assert invoice.remaining == Decimal("0.00")
    assert invoice.status == InvoiceStatus.PAID
    assert invoice.display_status == "paid"


def test_partial_payments_accumulate_and_never_overwrite(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    first = record_payment(student=student, amount=Decimal("600000"), invoice=invoice)
    invoice.refresh_from_db()
    assert invoice.amount_paid == Decimal("600000.00")
    assert invoice.remaining == Decimal("600000.00")
    assert invoice.status == InvoiceStatus.PARTIAL

    second = record_payment(student=student, amount=Decimal("600000"), invoice=invoice)
    invoice.refresh_from_db()
    assert invoice.amount_paid == Decimal("1200000.00")
    assert invoice.status == InvoiceStatus.PAID
    # both transactions remain as separate rows
    assert Payment.objects.filter(student=student).count() == 2
    assert first.pk != second.pk
    assert Payment.objects.filter(student=student, is_void=False).count() == 2


def test_overpayment_is_blocked_without_an_explicit_override(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    with pytest.raises(ValidationError):
        record_payment(student=student, amount=Decimal("2000000"), invoice=invoice)
    payment = record_payment(student=student, amount=Decimal("2000000"), invoice=invoice,
                             allow_overpayment=True)
    assert payment.amount == Decimal("2000000.00")
    invoice.refresh_from_db()
    assert invoice.credit == Decimal("800000.00")


def test_payment_must_be_positive(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    with pytest.raises(ValidationError):
        record_payment(student=student, amount=Decimal("0"), invoice=invoice)


def test_voiding_a_payment_requires_a_reason_and_restores_the_balance(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    payment = record_payment(student=student, amount=Decimal("1200000"), invoice=invoice)
    with pytest.raises(ValidationError):
        void_payment(payment, "", actor=None)
    void_payment(payment, "Recorded against the wrong student")
    invoice.refresh_from_db()
    payment.refresh_from_db()
    assert payment.is_void is True
    assert payment.void_reason == "Recorded against the wrong student"
    assert invoice.amount_paid == Decimal("0.00")
    assert invoice.remaining == Decimal("1200000.00")
    # The stored status reflects an unpaid invoice; whether it renders as
    # "overdue" depends on the configured billing day, so assert on the facts.
    assert invoice.status in {InvoiceStatus.UNPAID, InvoiceStatus.OVERDUE}
    assert invoice.display_status in {InvoiceStatus.UNPAID, InvoiceStatus.OVERDUE}


def test_overdue_detection_and_buckets(student_in_group):
    student, _ = student_in_group
    period = (date.today() - timedelta(days=45)).replace(day=1)
    invoice = ensure_invoice(student, period, due_date=date.today() - timedelta(days=40))
    receivables = outstanding_receivables()
    assert receivables["overdue_count"] == 1
    assert receivables["amount"] == "1200000.00"
    assert receivables["buckets"]["30+ days"]["count"] == 1
    invoice.refresh_from_db()
    assert invoice.display_status == "overdue"
    assert invoice.days_overdue >= 30


def test_balance_summary_aggregates_invoices_and_payments(student_in_group):
    student, _ = student_in_group
    today = date.today()
    this_month = today.replace(day=1)
    previous_month = (this_month - timedelta(days=1)).replace(day=1)
    ensure_invoice(student, this_month)
    ensure_invoice(student, previous_month)
    record_payment(student=student, amount=Decimal("500000"))

    balance = student_balance(student)
    assert balance["total_due"] == "2400000.00"
    assert balance["total_paid"] == "500000.00"
    assert balance["outstanding"] == "1900000.00"
    assert balance["invoice_count"] == 2


def test_financial_summary_separates_income_expenses_and_net(student_in_group):
    from apps.finance.services import create_expense

    student, _ = student_in_group
    today = date.today()
    invoice = ensure_invoice(student, today.replace(day=1))
    record_payment(student=student, amount=Decimal("1200000"), invoice=invoice)
    create_expense(category="rent", amount=Decimal("400000"), date=today,
                   description="September rent")

    summary = monthly_financial_summary(today.year, today.month)
    assert summary["student_fees"] == "1200000.00"
    assert summary["total_expenses"] == "400000.00"
    assert summary["net_result"] == "800000.00"


def test_money_is_decimal_not_float(student_in_group):
    student, _ = student_in_group
    invoice = ensure_invoice(student, date.today().replace(day=1))
    payment = record_payment(student=student, amount=Decimal("0.10"), invoice=invoice)
    assert isinstance(payment.amount, Decimal)
    assert isinstance(invoice.amount_due, Decimal)
    # 0.10 + 0.20 must be exactly 0.30 in Decimal arithmetic
    record_payment(student=student, amount=Decimal("0.20"), invoice=invoice)
    invoice.refresh_from_db()
    assert invoice.amount_paid == Decimal("0.30")
