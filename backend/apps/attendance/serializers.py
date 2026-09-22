"""Attendance serializers."""

from __future__ import annotations

from rest_framework import serializers

from .models import AbsenceReason, AttendanceRecord, AttendanceSession, AttendanceStatus


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_code = serializers.CharField(source="student.code", read_only=True)
    group_name = serializers.CharField(source="session.group.name", read_only=True)
    date = serializers.DateField(source="session.date", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    modified_by_name = serializers.CharField(source="modified_by.full_name", read_only=True, default="")

    class Meta:
        model = AttendanceRecord
        fields = (
            "id", "session", "student", "student_name", "student_code", "group_name",
            "date", "status", "status_label", "reason", "note", "marked_at",
            "modified_by", "modified_by_name",
        )
        read_only_fields = ("marked_at", "modified_by")


class AttendanceEntrySerializer(serializers.Serializer):
    student = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttendanceStatus.choices)
    reason = serializers.ChoiceField(choices=AbsenceReason.choices, required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True)


class MarkAttendanceSerializer(serializers.Serializer):
    records = AttendanceEntrySerializer(many=True, allow_empty=False)
    submit = serializers.BooleanField(required=False, default=False)


class OpenSessionSerializer(serializers.Serializer):
    group = serializers.IntegerField()
    date = serializers.DateField()
    slot = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)


class AttendanceSessionSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source="group.name", read_only=True)
    course_name = serializers.CharField(source="group.course.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True, default="")
    marked = serializers.SerializerMethodField()
    roster = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceSession
        fields = (
            "id", "group", "group_name", "course_name", "date", "slot", "teacher",
            "teacher_name", "state", "submitted_at", "note", "marked", "roster", "created_at",
        )
        read_only_fields = ("state", "submitted_at", "created_at")

    def get_marked(self, obj) -> int:
        prefetched = getattr(obj, "records_count", None)
        return prefetched if prefetched is not None else obj.records.count()

    def get_roster(self, obj) -> int:
        return obj.group.student_count
