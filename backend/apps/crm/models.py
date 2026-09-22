"""CRM models: leads, their activity trail, and the link to the student record.

Business rules implemented here (plan sections 7 and 33):

- A lead becomes exactly one student. ``converted_student`` is a ``OneToOneField``
  with its own database uniqueness, so a conversion can never create a duplicate
  person even if the endpoint is called twice or concurrently.
- ``source`` is deliberately *not* a choices field: the list of sources is an
  administrator setting (``SystemSettings.lead_sources``) read at request time
  (plan section 55).
- Every status change is dated (``status_changed_at``) and mirrored in
  :class:`LeadActivity`, so the pipeline is reconstructable after the fact.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.academics.models import Course, Student


class LeadStatus(models.TextChoices):
    NEW = "new", "New"
    CONTACTED = "contacted", "Contacted"
    TRIAL_SCHEDULED = "trial_scheduled", "Trial scheduled"
    TRIAL_COMPLETED = "trial_completed", "Trial completed"
    INTERESTED = "interested", "Interested"
    REGISTERED = "registered", "Registered"
    LOST = "lost", "Lost"


class LeadActivityKind(models.TextChoices):
    NOTE = "note", "Note"
    CALL = "call", "Call"
    MESSAGE = "message", "Message"
    TRIAL_SCHEDULED = "trial_scheduled", "Trial scheduled"
    TRIAL_COMPLETED = "trial_completed", "Trial completed"
    STATUS_CHANGE = "status_change", "Status change"


#: Statuses that close a lead: no further follow-up is expected.
CLOSED_STATUSES = (LeadStatus.REGISTERED, LeadStatus.LOST)


class LeadQuerySet(models.QuerySet):
    def open(self):
        return self.exclude(status__in=CLOSED_STATUSES)

    def registered(self):
        return self.filter(status=LeadStatus.REGISTERED)

    def with_trial(self):
        return self.filter(trial_date__isnull=False)

    def between(self, date_from=None, date_to=None):
        queryset = self
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        return queryset


class Lead(models.Model):
    """A prospective student moving through the admissions pipeline."""

    #: Nested alias so ``Lead.Status`` reads like ``AuditLog.Action``.
    Status = LeadStatus

    full_name = models.CharField(max_length=160, db_index=True)
    phone = models.CharField(max_length=32, db_index=True)
    email = models.EmailField(blank=True)
    source = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Chosen from SystemSettings.lead_sources at runtime, never hard-coded.",
    )
    interested_course = models.ForeignKey(
        Course, null=True, blank=True, on_delete=models.SET_NULL, related_name="leads"
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_leads",
    )
    status = models.CharField(
        max_length=24, choices=LeadStatus.choices, default=LeadStatus.NEW, db_index=True
    )
    trial_date = models.DateField(null=True, blank=True, db_index=True)
    lost_reason = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    converted_student = models.OneToOneField(
        Student,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lead_conversion",
        help_text="Set on conversion, guaranteeing one student per lead.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leads_created",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    status_changed_at = models.DateTimeField(null=True, blank=True)

    objects = LeadQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["assigned_to", "status"]),
            models.Index(fields=["source", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.phone})"

    @property
    def is_converted(self) -> bool:
        return self.converted_student_id is not None

    @property
    def has_trial(self) -> bool:
        return self.trial_date is not None

    @property
    def is_open(self) -> bool:
        return self.status not in CLOSED_STATUSES

    def name_parts(self) -> tuple[str, str]:
        """``full_name`` split into (first_name, last_name) for the student record."""
        parts = (self.full_name or "").strip().split()
        if not parts:
            return "", ""
        if len(parts) == 1:
            return parts[0], ""
        return parts[0], " ".join(parts[1:])


class LeadActivity(models.Model):
    """Append-only follow-up trail for a lead (calls, notes, trials, status moves)."""

    #: Nested alias so ``LeadActivity.Kind`` reads like ``AuditLog.Action``.
    Kind = LeadActivityKind

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="activities")
    kind = models.CharField(
        max_length=24, choices=LeadActivityKind.choices, default=LeadActivityKind.NOTE
    )
    note = models.TextField(blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lead_activities",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [models.Index(fields=["lead", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} — {self.lead_id}"
