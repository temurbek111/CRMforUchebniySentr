"""Payroll models.

Rules implemented here (plan sections 29, 30 and business rule 54):
- Compensation is data (SalaryPolicy), never logic buried inside a UI component.
- Policies are versioned by effective date; history is never mutated.
- PayrollItem stores a snapshot of the policy and the computed numbers, so an
  approved run does not change when a future rate changes.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.academics.models import Teacher
from apps.core.money import ZERO, money_field


class SalaryModel(models.TextChoices):
    FIXED = "fixed", "Fixed monthly"
    PER_CLASS = "per_class", "Per lesson"
    PERCENTAGE = "percentage", "Percentage of group revenue"
    HYBRID = "hybrid", "Base + per lesson"


class PayrollStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    CALCULATED = "calculated", "Calculated"
    APPROVED = "approved", "Approved"
    PAID = "paid", "Paid"


class SalaryPolicy(models.Model):
    """A teacher's compensation terms, effective from a date.

    Changing terms means creating a new policy row with a later
    ``effective_from``; existing rows are closed with ``effective_to``.
    """

    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="salary_policies")
    model = models.CharField(max_length=24, choices=SalaryModel.choices, default=SalaryModel.FIXED)
    base_amount = money_field()
    per_lesson_rate = money_field()
    revenue_share_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    lesson_bonus = money_field(help_text="Hybrid model: extra amount paid per lesson")
    currency_note = models.CharField(max_length=120, blank=True)
    effective_from = models.DateField(default=date.today)
    effective_to = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="salary_policies_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-effective_from",)
        indexes = [models.Index(fields=["teacher", "-effective_from"])]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "effective_from"], name="unique_policy_per_teacher_start"
            ),
            models.CheckConstraint(
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=models.F("effective_from")),
                name="policy_valid_date_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.teacher.full_name}: {self.get_model_display()}"

    @property
    def is_open(self) -> bool:
        return self.effective_to is None

    def covers(self, on_date: date) -> bool:
        return self.effective_from <= on_date and (
            self.effective_to is None or on_date <= self.effective_to
        )

    def snapshot(self) -> dict:
        """Frozen copy stored on every payroll item."""
        return {
            "model": self.model,
            "model_label": self.get_model_display(),
            "base_amount": str(self.base_amount),
            "per_lesson_rate": str(self.per_lesson_rate),
            "revenue_share_pct": str(self.revenue_share_pct),
            "lesson_bonus": str(self.lesson_bonus),
            "effective_from": self.effective_from.isoformat(),
            "effective_to": self.effective_to.isoformat() if self.effective_to else None,
        }


class PayrollRun(models.Model):
    """One payroll period for the whole centre."""

    label = models.CharField(max_length=48)
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=16, choices=PayrollStatus.choices,
                              default=PayrollStatus.DRAFT, db_index=True)
    total_gross = money_field()
    total_deductions = money_field()
    total_net = money_field()
    expense = models.ForeignKey(
        "finance.Expense", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payroll_runs",
        help_text="Expense row created when the run is paid",
    )
    calculated_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payroll_runs_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payroll_runs_paid",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="payroll_runs_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-period_start",)
        indexes = [models.Index(fields=["status", "-period_start"])]
        constraints = [
            models.UniqueConstraint(
                fields=["period_start", "period_end"], name="unique_payroll_period"
            ),
            models.CheckConstraint(
                condition=Q(period_end__gte=models.F("period_start")),
                name="payroll_valid_period",
            ),
        ]

    def __str__(self) -> str:
        return self.label

    @property
    def is_locked(self) -> bool:
        """Approved or paid runs are frozen: snapshots must not change."""
        return self.status in {PayrollStatus.APPROVED, PayrollStatus.PAID}

    def refresh_totals(self, *, save: bool = True) -> "PayrollRun":
        aggregates = self.items.aggregate(
            gross=models.Sum("gross_amount"),
            deductions=models.Sum("deductions"),
            net=models.Sum("net_amount"),
        )
        self.total_gross = aggregates["gross"] or ZERO
        self.total_deductions = aggregates["deductions"] or ZERO
        self.total_net = aggregates["net"] or ZERO
        if save:
            self.save(update_fields=["total_gross", "total_deductions", "total_net", "updated_at"])
        return self


class PayrollItem(models.Model):
    """A single teacher's line in a payroll run, with a frozen policy snapshot."""

    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="items")
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="payroll_items")
    lessons_count = models.PositiveIntegerField(default=0)
    base_amount = money_field()
    per_lesson_amount = money_field()
    revenue_share_amount = money_field()
    revenue_base = money_field()
    bonuses = money_field()
    deductions = money_field()
    gross_amount = money_field()
    net_amount = money_field()
    policy_snapshot = models.JSONField(default=dict, blank=True)
    breakdown = models.JSONField(default=dict, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("teacher__first_name", "teacher__last_name")
        constraints = [
            models.UniqueConstraint(fields=["run", "teacher"], name="unique_teacher_per_payroll_run"),
            models.CheckConstraint(condition=Q(net_amount__gte=ZERO), name="payroll_net_non_negative"),
            models.CheckConstraint(condition=Q(gross_amount__gte=ZERO), name="payroll_gross_non_negative"),
        ]

    def __str__(self) -> str:
        return f"{self.teacher.full_name} — {self.net_amount}"
