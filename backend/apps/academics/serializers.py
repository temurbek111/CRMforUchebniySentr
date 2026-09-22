"""Serializers for the academic domain."""

from __future__ import annotations

from django.db.models import Count, Q
from rest_framework import serializers

from .models import (
    Course,
    CourseStatus,
    Group,
    GroupMembership,
    Guardian,
    Room,
    Student,
    StudentLifecycle,
    StudentNote,
    Teacher,
)
from .services import get_or_create_guardian


class CourseSerializer(serializers.ModelSerializer):
    groups_count = serializers.IntegerField(source="groups.count", read_only=True)

    class Meta:
        model = Course
        fields = (
            "id", "code", "name", "description", "level", "default_monthly_fee",
            "duration_months", "status", "groups_count", "created_at",
        )
        read_only_fields = ("created_at",)

    def validate_code(self, value: str) -> str:
        return value.strip().upper()


class RoomSerializer(serializers.ModelSerializer):
    groups_count = serializers.IntegerField(source="groups.count", read_only=True)

    class Meta:
        model = Room
        fields = ("id", "name", "capacity", "location", "equipment", "status", "groups_count")
        read_only_fields = ("groups_count",)

    def validate_capacity(self, value: int) -> int:
        if value <= 0:
            raise serializers.ValidationError("Capacity must be greater than zero.")
        return value


class GuardianSerializer(serializers.ModelSerializer):
    students_count = serializers.IntegerField(source="students.count", read_only=True)

    class Meta:
        model = Guardian
        fields = ("id", "full_name", "phone", "email", "relation", "address", "notes", "students_count")


class TeacherSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    groups_count = serializers.IntegerField(source="groups.count", read_only=True)
    has_account = serializers.SerializerMethodField()

    class Meta:
        model = Teacher
        fields = (
            "id", "first_name", "last_name", "full_name", "phone", "email", "photo",
            "specialization", "employment_type", "start_date", "end_date", "status",
            "notes", "user", "has_account", "groups_count", "created_at",
        )
        read_only_fields = ("created_at",)

    def get_has_account(self, obj) -> bool:
        return obj.user_id is not None


class TeacherWriteSerializer(serializers.ModelSerializer):
    """Creates the teacher row and, optionally, a linked login account."""

    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Teacher
        fields = (
            "id", "first_name", "last_name", "phone", "email", "photo",
            "specialization", "employment_type", "start_date", "end_date", "status",
            "notes", "user", "username", "password",
        )

    def validate(self, attrs):
        username = (attrs.get("username") or "").strip().lower()
        password = attrs.get("password") or ""
        if username or password:
            if not username or not password:
                raise serializers.ValidationError(
                    {"username": "Both a username and a password are required to create a login account."}
                )
            from apps.accounts.models import User

            if User.objects.filter(username=username).exists():
                raise serializers.ValidationError({"username": "That username is already taken."})
            attrs["_account"] = (username, password)
        return attrs

    def create(self, validated_data):
        account = validated_data.pop("_account", None)
        validated_data.pop("username", None)
        validated_data.pop("password", None)
        teacher = super().create(validated_data)
        if account:
            teacher.user = self._make_user(*account, teacher=teacher)
            teacher.save(update_fields=["user"])
        return teacher

    def update(self, instance, validated_data):
        account = validated_data.pop("_account", None)
        validated_data.pop("username", None)
        validated_data.pop("password", None)
        teacher = super().update(instance, validated_data)
        if account and teacher.user_id is None:
            teacher.user = self._make_user(*account, teacher=teacher)
            teacher.save(update_fields=["user"])
        return teacher

    @staticmethod
    def _make_user(username: str, password: str, *, teacher: Teacher):
        from apps.accounts.models import Role, User

        role = Role.objects.filter(code="teacher").first()
        user = User(
            username=username,
            first_name=teacher.first_name,
            last_name=teacher.last_name,
            email=teacher.email,
            phone=teacher.phone,
            role=role,
        )
        user.set_password(password)
        user.save()
        return user


class StudentListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    age = serializers.IntegerField(read_only=True)
    group_name = serializers.SerializerMethodField()
    course_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    monthly_fee = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    parent_name = serializers.CharField(read_only=True)
    parent_phone = serializers.CharField(read_only=True)

    class Meta:
        model = Student
        fields = (
            "id", "code", "first_name", "last_name", "full_name", "photo", "status",
            "phone", "email", "age", "gender", "registered_at", "group_name",
            "course_name", "teacher_name", "monthly_fee", "parent_name", "parent_phone",
        )

    def get_group_name(self, obj) -> str:
        group = self._group(obj)
        return group.name if group else ""

    def get_course_name(self, obj) -> str:
        group = self._group(obj)
        return group.course.name if group and group.course else ""

    def get_teacher_name(self, obj) -> str:
        group = self._group(obj)
        return group.teacher.full_name if group and group.teacher else ""

    @staticmethod
    def _group(obj):
        cache = getattr(obj, "_prefetched_current_group", None)
        if cache is not None:
            return cache
        return obj.current_group()


class StudentWriteSerializer(serializers.ModelSerializer):
    """Accepts flat guardian fields and resolves them to a Guardian record."""

    guardian_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    guardian_phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    guardian_relation = serializers.ChoiceField(
        write_only=True, required=False, choices=Guardian.Relation.choices, default="guardian"
    )

    class Meta:
        model = Student
        fields = (
            "id", "code", "first_name", "last_name", "photo", "date_of_birth", "gender",
            "phone", "email", "address", "status", "registered_at", "left_at",
            "leave_reason", "monthly_fee_override", "notes", "guardian",
            "guardian_name", "guardian_phone", "guardian_relation",
        )
        read_only_fields = ("code",)

    def validate(self, attrs):
        if attrs.get("status") == StudentLifecycle.ARCHIVED:
            attrs.setdefault("left_at", attrs.get("left_at"))
        if attrs.get("date_of_birth"):
            from django.utils import timezone

            if attrs["date_of_birth"] > timezone.localdate():
                raise serializers.ValidationError({"date_of_birth": "Date of birth cannot be in the future."})
        return attrs

    def _resolve_guardian(self, validated_data):
        """Pop flat guardian_* fields and resolve them to a Guardian instance."""
        name = validated_data.pop("guardian_name", "")
        phone = validated_data.pop("guardian_phone", "")
        relation = validated_data.pop("guardian_relation", "guardian")
        if name or phone:
            return get_or_create_guardian(name, phone, relation)
        return None

    def create(self, validated_data):
        guardian = self._resolve_guardian(validated_data)
        if guardian is not None:
            validated_data["guardian"] = guardian
        return super().create(validated_data)

    def update(self, instance, validated_data):
        guardian = self._resolve_guardian(validated_data)
        if guardian is not None:
            validated_data["guardian"] = guardian
        return super().update(instance, validated_data)


class StudentNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = StudentNote
        fields = ("id", "student", "author", "author_name", "body", "is_pinned", "created_at")
        read_only_fields = ("author", "created_at")

    def get_author_name(self, obj) -> str:
        return obj.author.full_name if obj.author_id else "system"

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A note cannot be empty.")
        return value.strip()


class GroupSerializer(serializers.ModelSerializer):
    course_name = serializers.CharField(source="course.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True, default="")
    room_name = serializers.CharField(source="room.name", read_only=True, default="")
    student_count = serializers.SerializerMethodField()
    seats_available = serializers.SerializerMethodField()
    schedule_summary = serializers.CharField(read_only=True)

    class Meta:
        model = Group
        fields = (
            "id", "name", "course", "course_name", "teacher", "teacher_name", "room",
            "room_name", "capacity", "level", "monthly_fee", "start_date", "end_date",
            "status", "notes", "student_count", "seats_available", "schedule_summary",
            "created_at",
        )
        read_only_fields = ("created_at",)

    def _count(self, obj) -> int:
        annotated = getattr(obj, "active_student_count", None)
        if annotated is not None:
            return annotated
        return obj.student_count

    def get_student_count(self, obj) -> int:
        return self._count(obj)

    def get_seats_available(self, obj) -> int:
        return max(obj.capacity - self._count(obj), 0)

    def validate(self, attrs):
        capacity = attrs.get("capacity", getattr(self.instance, "capacity", 15))
        room = attrs.get("room", getattr(self.instance, "room", None))
        instance = self.instance
        enrolled = instance.student_count if instance else 0
        if room and capacity and enrolled > room.capacity:
            raise serializers.ValidationError(
                {"room": f"Room {room.name} holds {room.capacity} but the group already has {enrolled} students."}
            )
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date cannot be before the start date."})
        return attrs


class GroupMembershipSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_code = serializers.CharField(source="student.code", read_only=True)
    student_photo = serializers.ImageField(source="student.photo", read_only=True)
    group_name = serializers.CharField(source="group.name", read_only=True)
    effective_fee = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = GroupMembership
        fields = (
            "id", "student", "student_name", "student_code", "student_photo", "group",
            "group_name", "joined_at", "left_at", "status", "monthly_fee", "effective_fee",
            "is_active", "note", "created_at",
        )
        read_only_fields = ("created_at", "status")


class EnrollStudentSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    fee = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    joined_at = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)
    allow_over_capacity = serializers.BooleanField(required=False, default=False)


class RemoveStudentSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True)
    left_at = serializers.DateField(required=False, allow_null=True)


class TransferStudentSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    from_group = serializers.IntegerField(required=False, allow_null=True)
    to_group = serializers.IntegerField()
    effective_date = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True)
    allow_over_capacity = serializers.BooleanField(required=False, default=False)


class StudentGroupSerializer(serializers.ModelSerializer):
    """Compact group representation used inside the student profile."""

    course_name = serializers.CharField(source="course.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True, default="")
    room_name = serializers.CharField(source="room.name", read_only=True, default="")
    student_count = serializers.IntegerField(read_only=True)
    schedule_summary = serializers.CharField(read_only=True)

    class Meta:
        model = Group
        fields = (
            "id", "name", "course_name", "teacher_name", "room_name", "status",
            "monthly_fee", "student_count", "schedule_summary", "capacity",
        )


def annotate_active_counts(queryset):
    """Single-query student counts for group lists (avoids N+1)."""
    return queryset.annotate(
        active_student_count=Count(
            "group_memberships",
            filter=Q(group_memberships__left_at__isnull=True),
            distinct=True,
        )
    )
