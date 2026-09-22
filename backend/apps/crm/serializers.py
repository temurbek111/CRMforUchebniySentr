"""CRM serializers.

The lead ``source`` list is injected from ``SystemSettings`` when the serializer
is instantiated, so it follows the administrator's configuration instead of
being frozen into the code (plan section 55).
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import Course, Group

from . import services
from .models import Lead, LeadActivity, LeadActivityKind, LeadStatus


class LeadActivitySerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = LeadActivity
        fields = ("id", "lead", "kind", "kind_label", "note", "actor", "actor_name", "created_at")
        read_only_fields = ("lead", "actor", "created_at")

    def get_actor_name(self, obj) -> str:
        return obj.actor.full_name if obj.actor_id else "system"


class LeadActivityWriteSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=LeadActivityKind.choices, default=LeadActivityKind.NOTE)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class LeadSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    interested_course_name = serializers.CharField(
        source="interested_course.name", read_only=True, default=""
    )
    assigned_to_name = serializers.SerializerMethodField()
    converted_student_code = serializers.CharField(
        source="converted_student.code", read_only=True, default=""
    )
    converted_student_name = serializers.CharField(
        source="converted_student.full_name", read_only=True, default=""
    )
    created_by_name = serializers.SerializerMethodField()
    activities_count = serializers.IntegerField(source="activities.count", read_only=True)
    is_converted = serializers.BooleanField(read_only=True)
    has_trial = serializers.BooleanField(read_only=True)

    class Meta:
        model = Lead
        fields = (
            "id", "full_name", "phone", "email", "source", "interested_course",
            "interested_course_name", "assigned_to", "assigned_to_name", "status",
            "status_label", "trial_date", "lost_reason", "notes", "converted_student",
            "converted_student_code", "converted_student_name", "is_converted", "has_trial",
            "created_by", "created_by_name", "activities_count", "created_at", "updated_at",
            "status_changed_at",
        )
        read_only_fields = ("created_at", "updated_at", "status_changed_at")

    def get_assigned_to_name(self, obj) -> str:
        return obj.assigned_to.full_name if obj.assigned_to_id else ""

    def get_created_by_name(self, obj) -> str:
        return obj.created_by.full_name if obj.created_by_id else ""


class LeadWriteSerializer(serializers.ModelSerializer):
    """Create/update a lead. Creation goes through ``services.create_lead``."""

    class Meta:
        model = Lead
        fields = (
            "id", "full_name", "phone", "email", "source", "interested_course",
            "assigned_to", "notes",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["source"] = serializers.ChoiceField(
            choices=services.lead_source_choices(), required=False, allow_blank=True
        )

    def validate_full_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("A lead needs a name.")
        return name

    def validate_phone(self, value: str) -> str:
        phone = (value or "").strip()
        if not phone:
            raise serializers.ValidationError("A lead needs a phone number.")
        return phone

    def create(self, validated_data):
        request = self.context.get("request")
        return services.create_lead(
            full_name=validated_data.get("full_name", ""),
            phone=validated_data.get("phone", ""),
            email=validated_data.get("email", ""),
            source=validated_data.get("source") or "",
            interested_course=validated_data.get("interested_course"),
            assigned_to=validated_data.get("assigned_to"),
            notes=validated_data.get("notes", ""),
            actor=getattr(request, "user", None),
        )


class LeadStatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=LeadStatus.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ScheduleTrialSerializer(serializers.Serializer):
    trial_date = serializers.DateField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TrialCompletedSerializer(serializers.Serializer):
    attended = serializers.BooleanField(default=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ConvertLeadSerializer(serializers.Serializer):
    """Body for ``POST /leads/{id}/convert``."""

    group = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), required=False, allow_null=True
    )
    course = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), required=False, allow_null=True
    )
    monthly_fee = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    start_date = serializers.DateField(required=False, allow_null=True)
    payment_terms = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_monthly_fee(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("A monthly fee cannot be negative.")
        return value
