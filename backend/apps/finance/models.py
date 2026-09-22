"""Finance models: invoices (student billing), payments, income, expenses.

Business rules implemented here (plan sections 21-27 and rule 54):
- A payment is NOT an invoice: one billing period can carry many transactions.
- Payments are append-only. Corrections use ``is_void`` + reason, never deletion.
- Money is ``Decimal`` in every column; the database refuses negative amounts.
- One invoice per student per billing period (unique constraint).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.academics.models import Group, Student
from apps.core.money import ZERO, money_field


class InvoiceStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PARTIAL = "partial", "Partial"
    PAID = "paid", "Paid"
    OVERDUE = "overdue", "Overdue"
    WAIVED = "waived", "Waived"
    CANCELLED = "cancelled", "Cancelled"


class BillingPeriod(models.Model):
    """A named billing period (e.g. September 2026) that invoices belong to."""

    label = models.CharField(max_length=32, unique=True)
    period_start = models.DateField()
    period_end = models.DateField()
    due_date = models.DateField()
    is_closed = models.BooleanField(default=False, help_text="Closed periods are not re-billed")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-period_start",)
        constraints = [
            models.CheckConstraint(condition=Q(period_end__gte=models.F("period_start")),
                                   name="billing_period_valid_range"),
        ]

    def __str__(self) -> str:
        return self.label

    @classmethod
    def label_for(cls, period_start: date) -> str:
        return period_start.strftime("%B %Y")


class StudentInvoice(models.Model):
    """Amount owed by one student for one billing period."""

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="invoices")
    group = models.ForeignKey(
        Group, null=True, blank=True, on_delete=models.SET_NULL, related_name="invoices"
    )
    period = models.ForeignKey(
        BillingPeriod, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices"
    )
    period_start = models.DateField(db_index=True)
    period_end = models.DateField()
    period_label = models.CharField(max_length=32, db_index=True)
    amount_due = money_field()
    due_date = models.DateField()
    status = models.CharField(
        max_length=16, choices=InvoiceStatus.choices, default=InvoiceStatus.UNPAID, db_index=True
    )
    waived_reason = models.CharField(max_length=255, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="invoices_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-period_start", "student__first_name")
        indexes = [
            models.Index(fields=["status", "due_date"]),
            models.Index(fields=["student", "-period_start"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "period_start"], name="unique_invoice_per_student_period"
            ),
            models.CheckConstraint(condition=Q(period_end__gte=models.F("period_start")),
                                   name="invoice_valid_period"),
        ]

    def __str__(self) -> str:
        return f"{self.student.full_name} {self.period_label}"

    # ------------------------------------------------------------------ #
    # Derived amounts (always aggregated from payment rows, never stored)
    # ------------------------------------------------------------------ #
    @property
    def amount_paid(self) -> Decimal:
        aggregate = self.payments.filter(is_void=False).aggregate(total=models.Sum("amount"))
        return aggregate["total"] or ZERO

    @property
    def remaining(self) -> Decimal:
        remaining = self.amount_due - self.amount_paid
        return remaining if remaining > ZERO else ZERO

    @property
    def credit(self) -> Decimal:
        """Overpayment, if any."""
        credit = self.amount_paid - self.amount_due
        return credit if credit > ZERO else ZERO

    @property
    def is_settled(self) -> bool:
        return self.remaining <= ZERO or self.status in {InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED}

    @property
    def days_overdue(self) -> int:
        if self.is_settled or self.due_date >= timezone.localdate():
            return 0
        return (timezone.localdate() - self.due_date).days

    @property
    def display_status(self) -> str:
        """Status including the derived 'overdue' state."""
        if self.status in {InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED}:
            return self.status
        if self.remaining <= ZERO:
            return InvoiceStatus.PAID
        if self.due_date < timezone.localdate():
            return InvoiceStatus.OVERDUE
        return InvoiceStatus.PARTIAL if self.amount_paid > ZERO else InvoiceStatus.UNPAID


class Payment(models.Model):
    """An immutable money-in transaction against a student (optionally an invoice)."""

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        BANK_TRANSFER = "bank_transfer", "Bank Transfer"
        CARD = "card", "Card"
        ONLINE = "online", "Online"
        OTHER = "other", "Other"

    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="payments")
    invoice = models.ForeignKey(
        StudentInvoice, null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )
    amount = money_field()
    paid_at = models.DateField(default=timezone.localdate, db_index=True)
    method = models.CharField(max_length=24, choices=Method.choices, default=Method.CASH)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payments_received",
    )
    reference = models.CharField(max_length=64, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    is_void = models.BooleanField(default=False, db_index=True)
    void_reason = models.CharField(max_length=255, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payments_voided",
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-paid_at", "-id")
        indexes = [
            models.Index(fields=["student", "-paid_at"]),
            models.Index(fields=["paid_at", "is_void"]),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=ZERO), name="payment_amount_positive"),
            models.CheckConstraint(
                condition=Q(is_void=False) | ~Q(void_reason=""),
                name="voided_payment_requires_reason",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student.full_name} {self.amount} on {self.paid_at}"

    @property
    def receipt_number(self) -> str:
        return f"PAY-{self.pk:06d}"

    def save(self, *args, **kwargs):
        if self.amount is None or self.amount <= ZERO:
            from django.core.exceptions import ValidationError

            raise ValidationError({"amount": "A payment must be greater than zero."})
        super().save(*args, **kwargs)


class Income(models.Model):
    """Non-fee income (registration, exam fees, other)."""

    class Category(models.TextChoices):
        STUDENT_FEES = "student_fees", "Student Fees"
        REGISTRATION_FEES = "registration_fees", "Registration Fees"
        EXAM_FEES = "exam_fees", "Exam Fees"
        OTHER = "other", "Other"

    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHER, db_index=True)
    category_label = models.CharField(max_length=80, blank=True, help_text="Free-text category override")
    amount = money_field()
    date = models.DateField(default=timezone.localdate, db_index=True)
    description = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=24, choices=Payment.Method.choices, default=Payment.Method.CASH)
    reference = models.CharField(max_length=64, blank=True)
    student = models.ForeignKey(
        Student, null=True, blank=True, on_delete=models.SET_NULL, related_name="incomes"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="incomes_created",
    )
    is_void = models.BooleanField(default=False)
    void_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-date", "-id")
        indexes = [models.Index(fields=["date", "category"])]
        constraints = [models.CheckConstraint(condition=Q(amount__gte=ZERO), name="income_amount_non_negative")]

    def __str__(self) -> str:
        return f"{self.get_category_display()} {self.amount} on {self.date}"

    @property
    def display_category(self) -> str:
        return self.category_label or self.get_category_display()


class Expense(models.Model):
    """Money out: salaries, rent, utilities, marketing and so on."""

    class Category(models.TextChoices):
        TEACHER_SALARIES = "teacher_salaries", "Teacher Salaries"
        RENT = "rent", "Rent"
        UTILITIES = "utilities", "Utilities"
        INTERNET = "internet", "Internet"
        MARKETING = "marketing", "Marketing"
        EQUIPMENT = "equipment", "Equipment"
        OFFICE_SUPPLIES = "office_supplies", "Office Supplies"
        MAINTENANCE = "maintenance", "Maintenance"
        SOFTWARE = "software", "Software"
        OTHER = "other", "Other"

    category = models.CharField(
        max_length=32, choices=Category.choices, default=Category.OTHER, db_index=True
    )
    category_label = models.CharField(max_length=80, blank=True)
    amount = money_field()
    date = models.DateField(default=timezone.localdate, db_index=True)
    description = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=24, choices=Payment.Method.choices, default=Payment.Method.CASH)
    reference = models.CharField(max_length=64, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="expenses_created",
    )
    is_void = models.BooleanField(default=False)
    void_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-date", "-id")
        indexes = [models.Index(fields=["date", "category"])]
        constraints = [models.CheckConstraint(condition=Q(amount__gte=ZERO), name="expense_amount_non_negative")]

    def __str__(self) -> str:
        return f"{self.get_category_display()} {self.amount} on {self.date}"

    @property
    def display_category(self) -> str:
        return self.category_label or self.get_category_display()
