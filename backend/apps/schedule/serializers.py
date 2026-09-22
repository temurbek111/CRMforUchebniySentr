"""Schedule serializers."""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import Group, Room, Teacher

from .models import ScheduleSlot


class ScheduleSlotSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source="group.name", read_only=True)
    course_name = serializers.CharField(source="group.course.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    weekday_name = serializers.CharField(source="get_weekday_display", read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)
    student_count = serializers.IntegerField(source="group.student_count", read_only=True)
    start_time = serializers.TimeField(format="%H:%M")
    end_time = serializers.TimeField(format="%H:%M")

    class Meta:
        model = ScheduleSlot
        fields = (
            "id", "group", "group_name", "course_name", "teacher", "teacher_name",
            "room", "room_name", "weekday", "weekday_name", "start_time", "end_time",
            "duration_minutes", "effective_from", "effective_to", "is_active", "note",
            "student_count", "created_at",
        )
        read_only_fields = ("created_at",)

    def get_teacher_name(self, obj) -> str:
        teacher = obj.effective_teacher
        return teacher.full_name if teacher else ""

    def get_room_name(self, obj) -> str:
        room = obj.effective_room
        return room.name if room else ""


class ScheduleSlotWriteSerializer(serializers.Serializer):
    """Write path goes through the conflict-checking service, never direct save."""

    group = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all())
    teacher = serializers.PrimaryKeyRelatedField(queryset=Teacher.objects.all(), required=False, allow_null=True)
    room = serializers.PrimaryKeyRelatedField(queryset=Room.objects.all(), required=False, allow_null=True)
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    effective_from = serializers.DateField(required=False, allow_null=True)
    effective_to = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False, default=True)
    allow_capacity_override = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if attrs["end_time"] <= attrs["start_time"]:
            raise serializers.ValidationError({"end_time": "End time must be after the start time."})
        return attrs
