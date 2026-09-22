"""Exam serializers.

Reads use plain model serializers; writes go through the service layer so the
passing score, components and validation rules live in exactly one place.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import Course, Group, Teacher

from . import services
from .models import DEFAULT_MAX_SCORE, Exam, ExamComponent, ExamResult, ExamType


class ExamComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamComponent
        fields = ("id", "exam", "name", "max_score", "order")
        read_only_fields = ("exam",)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("A component needs a name.")
        return name


class ExamComponentInputSerializer(serializers.Serializer):
    """A component as accepted on exam create/update."""

    name = serializers.CharField(max_length=120)
    max_score = serializers.DecimalField(max_digits=8, decimal_places=2)
    order = serializers.IntegerField(required=False, default=0)


class ExamSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source="group.name", read_only=True)
    course_name = serializers.CharField(source="course.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True, default="")
    exam_type_display = serializers.CharField(source="get_exam_type_display", read_only=True)
    passing_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    components = ExamComponentSerializer(many=True, read_only=True)
    components_count = serializers.IntegerField(source="components.count", read_only=True)
    results_count = serializers.IntegerField(source="results.count", read_only=True)

    class Meta:
        model = Exam
        fields = (
            "id", "group", "group_name", "course", "course_name", "teacher", "teacher_name",
            "name", "exam_type", "exam_type_display", "date", "max_score", "passing_score",
            "passing_percentage", "description", "is_published", "components",
            "components_count", "results_count", "created_at",
        )
        read_only_fields = ("created_at",)


class ExamWriteSerializer(serializers.Serializer):
    """Create an exam through ``services.create_exam``; update via the same rules."""

    group = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all())
    course = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), required=False, allow_null=True
    )
    teacher = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), required=False, allow_null=True
    )
    name = serializers.CharField(max_length=160)
    exam_type = serializers.ChoiceField(choices=ExamType.choices)
    date = serializers.DateField()
    max_score = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, default=DEFAULT_MAX_SCORE
    )
    passing_score = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True
    )
    description = serializers.CharField(required=False, allow_blank=True, default="")
    components = ExamComponentInputSerializer(many=True, required=False)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("An exam needs a name.")
        return name

    def validate(self, attrs):
        max_score = attrs.get("max_score", DEFAULT_MAX_SCORE)
        if max_score is None or max_score <= 0:
            raise serializers.ValidationError({"max_score": "The maximum score must be above zero."})
        passing_score = attrs.get("passing_score")
        if passing_score is not None:
            if passing_score < 0:
                raise serializers.ValidationError(
                    {"passing_score": "A passing score cannot be negative."}
                )
            if passing_score > max_score:
                raise serializers.ValidationError(
                    {"passing_score": "A passing score cannot exceed the maximum score."}
                )
        if self.instance is not None and "components" in attrs and self.instance.results.exists():
            raise serializers.ValidationError(
                {"components": "Results are already recorded, so the components cannot be replaced."}
            )
        return attrs

    def create(self, validated_data):
        components = validated_data.pop("components", None)
        request = self.context.get("request")
        return services.create_exam(
            group=validated_data["group"],
            name=validated_data["name"],
            exam_type=validated_data["exam_type"],
            exam_date=validated_data["date"],
            course=validated_data.get("course"),
            teacher=validated_data.get("teacher"),
            max_score=validated_data.get("max_score", DEFAULT_MAX_SCORE),
            passing_score=validated_data.get("passing_score"),
            description=validated_data.get("description", ""),
            components=components,
            actor=getattr(request, "user", None),
        )

    def update(self, instance: Exam, validated_data):
        components = validated_data.pop("components", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if components is not None:
            services.replace_exam_components(instance, components)
        return instance


class ExamResultEntrySerializer(serializers.Serializer):
    """One row of a mark sheet."""

    student = serializers.IntegerField()
    component = serializers.IntegerField(required=False, allow_null=True)
    score = serializers.DecimalField(max_digits=8, decimal_places=2)
    teacher_comment = serializers.CharField(required=False, allow_blank=True, default="")


class RecordResultsSerializer(serializers.Serializer):
    """POST body for ``/exams/{id}/results`` (a bare list is accepted too)."""

    entries = ExamResultEntrySerializer(many=True)


class ExamResultSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)
    component_name = serializers.CharField(source="component.name", read_only=True, default="")
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_code = serializers.CharField(source="student.code", read_only=True)
    marked_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ExamResult
        fields = (
            "id", "exam", "exam_name", "component", "component_name", "student", "student_name",
            "student_code", "score", "max_score", "percentage", "grade", "teacher_comment",
            "marked_by", "marked_by_name", "created_at",
        )
        read_only_fields = ("percentage", "grade", "created_at")

    def get_marked_by_name(self, obj) -> str:
        return obj.marked_by.full_name if obj.marked_by_id else ""
