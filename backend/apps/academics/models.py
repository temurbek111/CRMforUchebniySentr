"""Academic domain models: courses, rooms, students, teachers, groups.

Historical integrity rules implemented here:
- Students are never hard-deleted; status and archived_at carry lifecycle.
- Group membership is historical: leaving a group stamps ``left_at`` instead of
  deleting the row (plan sections 10, 38).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.money import ZERO, money_field


class Status(models.TextChoices):
    ACTIVE = "active", "Active"
    PAUSED = "paused", "Paused"
    GRADUATED = "graduated", "Graduated"
    DROPPED = "dropped", "Dropped"
    ARCHIVED = "archived", "Archived"


class CourseStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"
    ARCHIVED = "archived", "Archived"


class StudentLifecycle(models.TextChoices):
    """Full CRM lifecycle of a person (plan section 7)."""

    LEAD = "lead", "Lead"
    TRIAL = "trial", "Trial"
    ACTIVE = "active", "Active"
    PAUSED = "paused", "Paused"
    GRADUATED = "graduated", "Graduated"
    DROPPED = "dropped", "Dropped"
    ARCHIVED = "archived", "Archived"


class Gender(models.TextChoices):
    MALE = "male", "Male"
    FEMALE = "female", "Female"
    UNSPECIFIED = "unspecified", "Not specified"


class EmploymentType(models.TextChoices):
    FULL_TIME = "full_time", "Full Time"
    PART_TIME = "part_time", "Part Time"
    CONTRACT = "contract", "Contract"
    FREELANCE = "freelance", "Freelance"


class Course(models.Model):
    """A teachable subject, reusable across groups (plan section 9)."""

    code = models.CharField(max_length=24, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    level = models.CharField(max_length=64, blank=True)
    default_monthly_fee = money_field()
    duration_months = models.PositiveSmallIntegerField(default=0, help_text="0 means open-ended")
    status = models.CharField(max_length=16, choices=CourseStatus.choices, default=CourseStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Room(models.Model):
    """A physical room. Capacity is enforced when scheduling (plan section 19)."""

    name = models.CharField(max_length=80, unique=True)
    capacity = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(500)])
    location = models.CharField(max_length=120, blank=True)
    equipment = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=CourseStatus.choices, default=CourseStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Guardian(models.Model):
    """Parent or guardian contact, shared by siblings."""

    class Relation(models.TextChoices):
        MOTHER = "mother", "Mother"
        FATHER = "father", "Father"
        GUARDIAN = "guardian", "Guardian"
        OTHER = "other", "Other"

    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=32, db_index=True)
    email = models.EmailField(blank=True)
    relation = models.CharField(max_length=16, choices=Relation.choices, default=Relation.GUARDIAN)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("full_name",)

    def __str__(self) -> str:
        return f"{self.full_name} ({self.phone})"


class Teacher(models.Model):
    """Teaching staff. Optionally linked to a login account."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="teacher_profile",
    )
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    photo = models.ImageField(upload_to="teachers/", blank=True, null=True)
    specialization = models.CharField(max_length=160, blank=True)
    employment_type = models.CharField(
        max_length=16, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )
    start_date = models.DateField(default=date.today)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("first_name", "last_name")
        indexes = [models.Index(fields=["status"])]

    def __str__(self) -> str:
        return self.full_name

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def is_active(self) -> bool:
        return self.status == Status.ACTIVE


class StudentQuerySet(models.QuerySet):
    def active(self):
        return self.filter(status=StudentLifecycle.ACTIVE)

    def not_archived(self):
        return self.exclude(status=StudentLifecycle.ARCHIVED)

    def in_group(self, group):
        return self.filter(
            group_memberships__group=group, group_memberships__left_at__isnull=True
        ).distinct()

    def taught_by(self, teacher):
        return self.filter(
            group_memberships__group__teacher=teacher,
            group_memberships__left_at__isnull=True,
        ).distinct()


class Student(models.Model):
    """A person in the learning centre. Records are retained for history."""

    code = models.CharField(max_length=24, unique=True, editable=False)
    first_name = models.CharField(max_length=80, db_index=True)
    last_name = models.CharField(max_length=80, db_index=True)
    photo = models.ImageField(upload_to="students/", blank=True, null=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=16, choices=Gender.choices, default=Gender.UNSPECIFIED)
    phone = models.CharField(max_length=32, blank=True, db_index=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    guardian = models.ForeignKey(
        Guardian, null=True, blank=True, on_delete=models.SET_NULL, related_name="students"
    )
    status = models.CharField(
        max_length=16, choices=StudentLifecycle.choices, default=StudentLifecycle.ACTIVE, db_index=True
    )
    status_changed_at = models.DateTimeField(null=True, blank=True)
    registered_at = models.DateField(default=date.today)
    left_at = models.DateField(null=True, blank=True, help_text="Set when a student drops or graduates")
    leave_reason = models.CharField(max_length=255, blank=True)
    monthly_fee_override = money_field(null=True, blank=True, default=None)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="students_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = StudentQuerySet.as_manager()

    class Meta:
        ordering = ("first_name", "last_name")
        indexes = [
            models.Index(fields=["last_name", "first_name"]),
            models.Index(fields=["status", "registered_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(monthly_fee_override__isnull=True) | Q(monthly_fee_override__gte=ZERO),
                name="student_fee_non_negative",
            )
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self._generate_code()
        super().save(*args, **kwargs)

    @classmethod
    def _generate_code(cls) -> str:
        """Sequential, human-readable code: STU-0001."""
        last = (
            cls.objects.filter(code__startswith="STU-")
            .order_by("-code")
            .values_list("code", flat=True)
            .first()
        )
        number = 1
        if last:
            try:
                number = int(last.split("-")[1]) + 1
            except (IndexError, ValueError):
                number = cls.objects.count() + 1
        return f"STU-{number:04d}"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def age(self) -> int | None:
        if not self.date_of_birth:
            return None
        today = timezone.localdate()
        return today.year - self.date_of_birth.year - (
            (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day)
        )

    @property
    def parent_name(self) -> str:
        return self.guardian.full_name if self.guardian else ""

    @property
    def parent_phone(self) -> str:
        return self.guardian.phone if self.guardian else ""

    @property
    def is_active(self) -> bool:
        return self.status == StudentLifecycle.ACTIVE

    def current_membership(self):
        return (
            self.group_memberships.filter(left_at__isnull=True)
            .select_related("group", "group__course", "group__teacher")
            .order_by("-joined_at")
            .first()
        )

    def current_group(self):
        membership = self.current_membership()
        return membership.group if membership else None

    @property
    def monthly_fee(self) -> Decimal:
        """Student override wins, then the active group's fee, then zero."""
        if self.monthly_fee_override is not None:
            return self.monthly_fee_override
        membership = self.current_membership()
        if membership and membership.monthly_fee is not None:
            return membership.monthly_fee
        if membership:
            return membership.group.monthly_fee
        return ZERO


class GroupQuerySet(models.QuerySet):
    def active(self):
        return self.filter(status=Status.ACTIVE)

    def taught_by(self, teacher):
        return self.filter(teacher=teacher)


class Group(models.Model):
    """A real class: course + teacher + room + schedule (plan section 10)."""

    name = models.CharField(max_length=120, unique=True)
    course = models.ForeignKey(
        Course, on_delete=models.PROTECT, related_name="groups"
    )
    teacher = models.ForeignKey(
        Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="groups"
    )
    room = models.ForeignKey(
        Room, null=True, blank=True, on_delete=models.SET_NULL, related_name="groups"
    )
    capacity = models.PositiveSmallIntegerField(default=15)
    level = models.CharField(max_length=64, blank=True)
    monthly_fee = money_field()
    start_date = models.DateField(default=date.today)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = GroupQuerySet.as_manager()

    class Meta:
        ordering = ("name",)
        indexes = [models.Index(fields=["status", "course"])]

    def __str__(self) -> str:
        return self.name

    @property
    def active_memberships(self):
        return self.group_memberships.filter(left_at__isnull=True)

    @property
    def student_count(self) -> int:
        return self.active_memberships.count()

    @property
    def seats_available(self) -> int:
        return max(self.capacity - self.student_count, 0)

    @property
    def is_full(self) -> bool:
        return self.student_count >= self.capacity

    @property
    def schedule_summary(self) -> str:
        slots = self.slots.order_by("weekday", "start_time")
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        rendered = [
            f"{day_names[slot.weekday]} {slot.start_time:%H:%M}-{slot.end_time:%H:%M}"
            for slot in slots
        ]
        return " / ".join(rendered)


class GroupMembership(models.Model):
    """Historical student↔group link. Never deleted (plan section 10)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        LEFT = "left", "Left"
        TRANSFERRED = "transferred", "Transferred"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="group_memberships")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="group_memberships")
    joined_at = models.DateField(default=date.today)
    left_at = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    monthly_fee = money_field(null=True, blank=True, default=None)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="memberships_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-joined_at", "-id")
        indexes = [
            models.Index(fields=["group", "left_at"]),
            models.Index(fields=["student", "left_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "group"],
                condition=Q(left_at__isnull=True),
                name="unique_active_membership_per_group",
            ),
            models.CheckConstraint(
                condition=Q(left_at__isnull=True) | Q(left_at__gte=models.F("joined_at")),
                name="membership_left_after_joined",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student} in {self.group}"

    @property
    def is_active(self) -> bool:
        return self.left_at is None

    @property
    def effective_fee(self) -> Decimal:
        if self.monthly_fee is not None:
            return self.monthly_fee
        return self.group.monthly_fee


class StudentNote(models.Model):
    """Internal staff note attached to a student (plan section 8, Notes tab)."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="notes_entries")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="student_notes",
    )
    body = models.TextField()
    is_pinned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-is_pinned", "-created_at")
        indexes = [models.Index(fields=["student", "-created_at"])]

    def __str__(self) -> str:
        return f"Note on {self.student_id} by {self.author_id}"


class TeacherGroupAssignment(models.Model):
    """Optional co-teacher or substitute assignments beyond the primary teacher."""

    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="assignments")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="teacher_assignments")
    from_date = models.DateField(default=date.today)
    to_date = models.DateField(null=True, blank=True)
    is_primary = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-from_date",)
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "group", "from_date"], name="unique_teacher_group_assignment"
            )
        ]

    def __str__(self) -> str:
        return f"{self.teacher} → {self.group}"
