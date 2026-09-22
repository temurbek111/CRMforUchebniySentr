"""Core models: runtime settings, audit trail, notifications."""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

DEFAULT_PAYMENT_METHODS = ["Cash", "Bank Transfer", "Card", "Online", "Other"]
DEFAULT_LEAD_SOURCES = [
    "Instagram",
    "Telegram",
    "Referral",
    "Website",
    "Walk-in",
    "Advertisement",
    "Other",
]
DEFAULT_INCOME_CATEGORIES = ["Student Fees", "Registration Fees", "Exam Fees", "Other"]
DEFAULT_EXPENSE_CATEGORIES = [
    "Teacher Salaries",
    "Rent",
    "Utilities",
    "Internet",
    "Marketing",
    "Equipment",
    "Office Supplies",
    "Maintenance",
    "Software",
    "Other",
]


class SystemSettings(models.Model):
    """Singleton row of administrator-controlled business configuration.

    Nothing here may be hard-coded elsewhere: thresholds, categories, currency
    and billing behaviour all read from this table (plan section 55).
    """

    SINGLETON_PK = 1

    centre_name = models.CharField(max_length=160, default="Learning Centre")
    logo_url = models.URLField(blank=True)
    currency_code = models.CharField(max_length=8, default="UZS")
    currency_symbol = models.CharField(max_length=8, default="so'm")
    currency_decimals = models.PositiveSmallIntegerField(default=0)
    timezone = models.CharField(max_length=64, default="Asia/Tashkent")
    default_billing_day = models.PositiveSmallIntegerField(
        default=5, validators=[MinValueValidator(1), MaxValueValidator(28)]
    )
    attendance_threshold_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("75.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    absence_alert_count = models.PositiveSmallIntegerField(default=3)
    absence_streak_alert_count = models.PositiveSmallIntegerField(default=3)
    failing_exam_alert_count = models.PositiveSmallIntegerField(default=2)
    default_passing_score_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("60.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    academic_year_start = models.DateField(null=True, blank=True)
    academic_year_end = models.DateField(null=True, blank=True)
    payment_methods = models.JSONField(default=list, blank=True)
    lead_sources = models.JSONField(default=list, blank=True)
    income_categories = models.JSONField(default=list, blank=True)
    expense_categories = models.JSONField(default=list, blank=True)
    notification_channels = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    _cache: "SystemSettings | None" = None

    class Meta:
        verbose_name = "System settings"
        verbose_name_plural = "System settings"

    def __str__(self) -> str:
        return self.centre_name

    def save(self, *args, **kwargs):
        self.pk = self.SINGLETON_PK
        if not self.payment_methods:
            self.payment_methods = list(DEFAULT_PAYMENT_METHODS)
        if not self.lead_sources:
            self.lead_sources = list(DEFAULT_LEAD_SOURCES)
        if not self.income_categories:
            self.income_categories = list(DEFAULT_INCOME_CATEGORIES)
        if not self.expense_categories:
            self.expense_categories = list(DEFAULT_EXPENSE_CATEGORIES)
        if not self.notification_channels:
            self.notification_channels = {
                "internal": True,
                "telegram": False,
                "sms": False,
                "email": False,
            }
        super().save(*args, **kwargs)
        SystemSettings._cache = self

    @classmethod
    def get_solo(cls) -> "SystemSettings":
        if cls._cache is None:
            obj, _ = cls.objects.get_or_create(pk=cls.SINGLETON_PK)
            cls._cache = obj
        return cls._cache

    @classmethod
    def clear_cache(cls) -> None:
        cls._cache = None


class AuditLog(models.Model):
    """Append-only trail of important actions (plan section 36).

    Financial and permission changes are always recorded. Records are never
    edited or deleted through the application.
    """

    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"
        LOGIN = "login", "Login"
        LOGOUT = "logout", "Logout"
        PERMISSION = "permission", "Permission change"
        APPROVE = "approve", "Approve"
        PAY = "pay", "Payment recorded"
        VOID = "void", "Void"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_entries",
    )
    actor_label = models.CharField(max_length=160, blank=True)
    action = models.CharField(max_length=24, choices=Action.choices)
    entity = models.CharField(max_length=64, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=255, blank=True)
    old_value = models.JSONField(default=dict, blank=True)
    new_value = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["entity", "entity_id"]),
            models.Index(fields=["actor", "-created_at"]),
        ]
        verbose_name = "Audit log entry"

    def __str__(self) -> str:
        stamp = timezone.localtime(self.created_at).strftime("%Y-%m-%d %H:%M") if self.created_at else "-"
        return f"{stamp} {self.actor_label or 'system'} {self.action} {self.entity}"


class Notification(models.Model):
    """Internal notification centre (plan section 32).

    Delivery channels are provider-agnostic: this row is the internal channel,
    and external providers consume it later. ``dedupe_key`` guarantees the same
    operational alert is not raised twice (plan section 12).
    """

    class Severity(models.TextChoices):
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    class Kind(models.TextChoices):
        PAYMENT_OVERDUE = "payment_overdue", "Payment overdue"
        ATTENDANCE_WARNING = "attendance_warning", "Attendance warning"
        EXAM_SCHEDULED = "exam_scheduled", "Exam scheduled"
        EXAM_RESULT = "exam_result", "Exam result published"
        PAYROLL_PENDING = "payroll_pending", "Payroll pending"
        SCHEDULE_CONFLICT = "schedule_conflict", "Schedule conflict"
        ATTENDANCE_INCOMPLETE = "attendance_incomplete", "Incomplete attendance"
        SYSTEM = "system", "System"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
        help_text="Null means the notification is addressed to a role/all staff.",
    )
    role_scope = models.CharField(max_length=32, blank=True, db_index=True)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.SYSTEM)
    severity = models.CharField(max_length=16, choices=Severity.choices, default=Severity.INFO)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=300, blank=True, help_text="In-app route the alert points at")
    payload = models.JSONField(default=dict, blank=True)
    dedupe_key = models.CharField(max_length=200, unique=True, null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [models.Index(fields=["recipient", "read_at"])]

    def __str__(self) -> str:
        return self.title

    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    def mark_read(self) -> None:
        if self.read_at is None:
            self.read_at = timezone.now()
            self.save(update_fields=["read_at"])
