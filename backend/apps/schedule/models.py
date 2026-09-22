"""Timetable model. One row per recurring weekly class slot."""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.academics.models import Group, Room, Teacher


class Weekday(models.IntegerChoices):
    MONDAY = 0, "Monday"
    TUESDAY = 1, "Tuesday"
    WEDNESDAY = 2, "Wednesday"
    THURSDAY = 3, "Thursday"
    FRIDAY = 4, "Friday"
    SATURDAY = 5, "Saturday"
    SUNDAY = 6, "Sunday"


class ScheduleSlot(models.Model):
    """A recurring class: group + teacher + room + weekday + time window."""

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="slots")
    teacher = models.ForeignKey(
        Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="slots"
    )
    room = models.ForeignKey(
        Room, null=True, blank=True, on_delete=models.SET_NULL, related_name="slots"
    )
    weekday = models.IntegerField(
        choices=Weekday.choices, validators=[MinValueValidator(0), MaxValueValidator(6)], db_index=True
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    effective_from = models.DateField(default=date.today)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("weekday", "start_time")
        indexes = [
            models.Index(fields=["weekday", "start_time", "end_time"]),
            models.Index(fields=["teacher", "weekday"]),
            models.Index(fields=["room", "weekday"]),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(end_time__gt=models.F("start_time")),
                                   name="slot_end_after_start"),
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gte=models.F("effective_from")),
                name="slot_valid_date_range",
            ),
            models.UniqueConstraint(
                fields=["group", "weekday", "start_time"], name="unique_group_slot_start"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.group.name} {self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M}"

    @property
    def duration_minutes(self) -> int:
        start = self.start_time.hour * 60 + self.start_time.minute
        end = self.end_time.hour * 60 + self.end_time.minute
        return max(end - start, 0)

    @property
    def effective_teacher(self) -> Teacher | None:
        return self.teacher or self.group.teacher

    @property
    def effective_room(self) -> Room | None:
        return self.room or self.group.room

    def occurs_on(self, day: date) -> bool:
        """Whether this recurring slot falls on a concrete date."""
        if not self.is_active:
            return False
        if self.weekday != day.weekday():
            return False
        if day < self.effective_from:
            return False
        if self.effective_to and day > self.effective_to:
            return False
        return True

    def next_occurrence(self, after: date | None = None) -> date:
        """First date on or after ``after`` on which this slot occurs."""
        candidate = after or timezone.localdate()
        for _ in range(14):
            if self.occurs_on(candidate):
                return candidate
            candidate += timedelta(days=1)
        return candidate
