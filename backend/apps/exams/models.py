"""Exam models: an exam, its optional components, and per-student results.

Integrity rules (plan section 11 and the exam rules):

- A result is unique per ``(exam, component, student)``; the component-less
  ("overall") result is unique per ``(exam, student)``. Two database constraints
  enforce this so a double submission can never create duplicate marks.
- ``percentage`` and ``grade`` are derived from ``score``/``max_score`` and are
  recomputed on every save, so the stored values can never drift away from the
  raw score.
- Components are ordinary rows (IELTS Listening/Reading/Writing/Speaking, a
  single "Total", or anything else an administrator needs): nothing about the
  shape of an exam is hard-coded.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from apps.academics.models import Course, Group, Student, Teacher
from apps.core.money import ZERO

PERCENT_MIN = Decimal("0.00")
PERCENT_MAX = Decimal("100.00")


def score_field(**kwargs) -> models.DecimalField:
    """A score or maximum-score column: always Decimal, never float, never negative."""
    kwargs.setdefault("max_digits", 8)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("default", ZERO)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


def percentage_field(**kwargs) -> models.DecimalField:
    """A 0-100 percentage column, stored to two decimal places."""
    kwargs.setdefault("max_digits", 5)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("default", ZERO)
    kwargs.setdefault(
        "validators", [MinValueValidator(PERCENT_MIN), MaxValueValidator(PERCENT_MAX)]
    )
    return models.DecimalField(**kwargs)


class ExamType(models.TextChoices):
    QUIZ = "quiz", "Quiz"
    MONTHLY_TEST = "monthly_test", "Monthly test"
    MIDTERM = "midterm", "Midterm"
    FINAL = "final", "Final"
    MOCK_EXAM = "mock_exam", "Mock exam"
    PLACEMENT_TEST = "placement_test", "Placement test"
    CUSTOM = "custom", "Custom"


DEFAULT_MAX_SCORE = Decimal("100.00")


class ExamQuerySet(models.QuerySet):
    def published(self):
        return self.filter(is_published=True)

    def for_teacher(self, teacher):
        return self.filter(group__teacher=teacher)

    def between(self, date_from=None, date_to=None):
        queryset = self
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)
        return queryset


class Exam(models.Model):
    """A graded assessment for one group, optionally split into components."""

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="exams")
    course = models.ForeignKey(Course, on_delete=models.PROTECT, related_name="exams")
    teacher = models.ForeignKey(
        Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="exams"
    )
    name = models.CharField(max_length=160)
    exam_type = models.CharField(
        max_length=24, choices=ExamType.choices, default=ExamType.CUSTOM, db_index=True
    )
    date = models.DateField(db_index=True)
    max_score = score_field(default=DEFAULT_MAX_SCORE)
    passing_score = score_field()
    description = models.TextField(blank=True)
    is_published = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ExamQuerySet.as_manager()

    class Meta:
        ordering = ("-date", "-id")
        indexes = [
            models.Index(fields=["group", "-date"]),
            models.Index(fields=["exam_type", "date"]),
            models.Index(fields=["is_published", "date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(max_score__gt=0), name="exam_max_score_positive"
            ),
            models.CheckConstraint(
                condition=Q(passing_score__gte=0), name="exam_passing_score_non_negative"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.group.name} {self.date})"

    @property
    def passing_percentage(self) -> Decimal:
        from .services import calculate_percentage

        return calculate_percentage(self.passing_score, self.max_score)

    @property
    def is_published_locked(self) -> bool:
        return self.is_published


class ExamComponent(models.Model):
    """A named, separately marked part of an exam (IELTS sections, oral, etc.)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="components")
    name = models.CharField(max_length=120)
    max_score = score_field()
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ("order", "id")
        indexes = [models.Index(fields=["exam", "order"])]
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "name"], name="unique_component_name_per_exam"
            ),
            models.CheckConstraint(
                condition=Q(max_score__gt=0), name="exam_component_max_score_positive"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.max_score})"


class ExamResultQuerySet(models.QuerySet):
    def overall(self):
        """Component-less results: one row per student for the whole exam."""
        return self.filter(component__isnull=True)

    def for_student(self, student):
        return self.filter(student=student)

    def passing(self, threshold):
        return self.filter(percentage__gte=threshold)


class ExamResult(models.Model):
    """One student's mark for an exam, or for one of its components."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="results")
    component = models.ForeignKey(
        ExamComponent,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="results",
        help_text="Null marks the overall result of the exam.",
    )
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="exam_results")
    score = score_field()
    max_score = score_field(null=True, blank=True, default=None)
    percentage = percentage_field()
    grade = models.CharField(max_length=4, blank=True)
    teacher_comment = models.TextField(blank=True)
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="exam_results_marked",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ExamResultQuerySet.as_manager()

    class Meta:
        ordering = ("student__first_name", "student__last_name", "-id")
        indexes = [
            models.Index(fields=["exam", "student"]),
            models.Index(fields=["student", "-created_at"]),
            models.Index(fields=["exam", "component"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "component", "student"], name="unique_result_per_component"
            ),
            models.UniqueConstraint(
                fields=["exam", "student"],
                condition=Q(component__isnull=True),
                name="unique_overall_result_per_exam",
            ),
            models.CheckConstraint(
                condition=Q(score__gte=0), name="exam_result_score_non_negative"
            ),
            models.CheckConstraint(
                condition=Q(percentage__gte=0, percentage__lte=100),
                name="exam_result_percentage_range",
            ),
        ]

    def __str__(self) -> str:
        part = f" — {self.component.name}" if self.component_id else ""
        return f"{self.student.full_name}: {self.score}/{self.max_score}{part}"

    def save(self, *args, **kwargs) -> None:
        """Derived columns are recalculated on every write."""
        from .services import calculate_percentage, grade_for

        self.percentage = calculate_percentage(self.score, self.max_score)
        self.grade = grade_for(self.percentage)
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = list(set(update_fields) | {"percentage", "grade"})
        super().save(*args, **kwargs)

    @property
    def is_overall(self) -> bool:
        return self.component_id is None

    @property
    def effective_max_score(self) -> Decimal:
        if self.max_score is not None:
            return self.max_score
        if self.component_id and self.component is not None:
            return self.component.max_score
        return self.exam.max_score
