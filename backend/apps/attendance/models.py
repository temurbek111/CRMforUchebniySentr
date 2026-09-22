"""Attendance models.

Integrity rules (plan section 11 and business rule "attendance rule"):
- One session per group per date (and per timetable slot when one is referenced).
- One record per student per session - enforced by a DB unique constraint, so a
  double submission cannot create duplicate attendance.
- Edits are traceable: ``modified_by`` and ``updated_at`` are stamped by the
  service layer.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.academics.models import Group, Student, Teacher
from apps.schedule.models import ScheduleSlot


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Present"
    ABSENT = "absent", "Absent"
    LATE = "late", "Late"
    EXCUSED = "excused", "Excused"


class AbsenceReason(models.TextChoices):
    SICK = "sick", "Sick"
    PERSONAL = "personal", "Personal"
    UNKNOWN = "unknown", "Unknown"
    OTHER = "other", "Other"


class SessionState(models.TextChoices):
    OPEN = "open", "Open"
    SUBMITTED = "submitted", "Submitted"


class AttendanceSession(models.Model):
    """One class meeting for a group on a date."""

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="attendance_sessions")
    date = models.DateField(default=timezone.localdate, db_index=True)
    slot = models.ForeignKey(
        ScheduleSlot, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions"
    )
    teacher = models.ForeignKey(
        Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="attendance_sessions"
    )
    state = models.CharField(max_length=16, choices=SessionState.choices, default=SessionState.OPEN)
    submitted_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="attendance_sessions_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-date", "group__name")
        indexes = [
            models.Index(fields=["group", "-date"]),
            models.Index(fields=["date", "state"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["group", "date", "slot"], name="unique_session_per_group_date_slot"
            ),
            models.UniqueConstraint(
                fields=["group", "date"],
                condition=Q(slot__isnull=True),
                name="unique_session_per_group_date_no_slot",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.group.name} {self.date}"

    @property
    def is_submitted(self) -> bool:
        return self.state == SessionState.SUBMITTED


class AttendanceRecordQuerySet(models.QuerySet):
    def attended(self):
        return self.filter(status__in=[AttendanceStatus.PRESENT, AttendanceStatus.LATE])

    def counted(self):
        """Records that count towards the attendance denominator (excused excluded)."""
        return self.exclude(status=AttendanceStatus.EXCUSED)


class AttendanceRecord(models.Model):
    session = models.ForeignKey(
        AttendanceSession, on_delete=models.CASCADE, related_name="records"
    )
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="attendance_records")
    status = models.CharField(
        max_length=16, choices=AttendanceStatus.choices, default=AttendanceStatus.PRESENT, db_index=True
    )
    reason = models.CharField(max_length=16, choices=AbsenceReason.choices, blank=True)
    note = models.CharField(max_length=255, blank=True)
    marked_at = models.DateTimeField(default=timezone.now)
    modified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="attendance_records_modified",
    )
    objects = AttendanceRecordQuerySet.as_manager()

    class Meta:
        ordering = ("student__first_name", "student__last_name")
        indexes = [
            models.Index(fields=["student", "-marked_at"]),
            models.Index(fields=["session", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "student"], name="unique_attendance_record_per_session"
            )
        ]

    def __str__(self) -> str:
        return f"{self.student.full_name}: {self.get_status_display()}"
