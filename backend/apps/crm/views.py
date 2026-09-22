"""CRM API: leads, their activity timeline, trials and the pipeline dashboard."""

from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Student
from apps.core.audit import log_action, snapshot
from apps.core.mixins import AuditedViewSetMixin
from apps.core.models import AuditLog

from . import services
from .filters import LeadFilter
from .models import Lead, LeadActivityKind
from .serializers import (
    ConvertLeadSerializer,
    LeadActivitySerializer,
    LeadActivityWriteSerializer,
    LeadSerializer,
    LeadStatusChangeSerializer,
    LeadWriteSerializer,
    ScheduleTrialSerializer,
    TrialCompletedSerializer,
)

MANAGE_ACTIONS = {
    "create", "update", "partial_update", "destroy",
    "status", "schedule_trial", "trial_completed",
}


class LeadViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """The admissions pipeline.

    ``?status=trial_scheduled`` (or ``?has_trial=true``) is the trials listing;
    ``convert`` additionally requires ``Perm.ADMISSIONS_MANAGE``.
    """

    serializer_class = LeadSerializer
    permission_classes = [RequirePerms(Perm.LEADS_VIEW)]
    filterset_class = LeadFilter
    search_fields = ["full_name", "phone", "email"]
    ordering_fields = ["created_at", "updated_at", "full_name", "status", "trial_date"]
    ordering = ["-created_at"]
    audit_entity = "lead"
    audit_fields = [
        "full_name", "phone", "email", "source", "status", "assigned_to",
        "interested_course", "trial_date",
    ]

    def get_queryset(self):
        return Lead.objects.select_related(
            "interested_course", "assigned_to", "converted_student", "created_by"
        ).prefetch_related("activities")

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return LeadWriteSerializer
        return LeadSerializer

    def get_permissions(self):
        if self.action == "convert":
            return [RequirePerms(Perm.ADMISSIONS_MANAGE)()]
        if self.action in MANAGE_ACTIONS:
            return [RequirePerms(Perm.LEADS_MANAGE)()]
        if self.action == "activities" and self.request.method == "POST":
            return [RequirePerms(Perm.LEADS_MANAGE)()]
        return [RequirePerms(Perm.LEADS_VIEW)()]

    # ------------------------------------------------------------------ #
    # Auditing: the create service writes the trail itself, so only updates
    # and deletions are logged here to keep one entry per event.
    # ------------------------------------------------------------------ #
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = self.perform_create(serializer)
        return Response(
            LeadSerializer(lead, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        lead = self.get_object()
        serializer = self.get_serializer(lead, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        lead = self.perform_update(serializer)
        return Response(LeadSerializer(lead, context={"request": request}).data)

    def perform_create(self, serializer):
        return serializer.save()

    def perform_update(self, serializer):
        before = snapshot(serializer.instance, self.audit_fields)
        lead = serializer.save()
        log_action(
            AuditLog.Action.UPDATE,
            "lead",
            entity_id=lead.pk,
            actor=self.request.user,
            old=before,
            new=snapshot(lead, self.audit_fields),
            summary=f"Updated lead {lead.full_name}",
            request=self.request,
        )
        return lead

    def destroy(self, request, *args, **kwargs):
        lead = self.get_object()
        log_action(
            AuditLog.Action.DELETE,
            "lead",
            entity_id=lead.pk,
            actor=request.user,
            old=snapshot(lead, ["full_name", "phone", "status", "source"]),
            summary=f"Deleted lead {lead.full_name}",
            request=request,
        )
        lead.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------ #
    # Follow-up trail
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["get", "post"])
    def activities(self, request, pk=None):
        lead = self.get_object()
        if request.method == "GET":
            activities = lead.activities.select_related("actor")
            return Response(LeadActivitySerializer(activities, many=True).data)

        serializer = LeadActivityWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = services.log_activity(
            lead,
            serializer.validated_data["kind"],
            serializer.validated_data.get("note", ""),
            actor=request.user,
        )
        return Response(LeadActivitySerializer(activity).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        lead = self.get_object()
        raw_limit = request.query_params.get("limit")
        limit = None
        if raw_limit:
            try:
                limit = int(raw_limit)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "Validation failed.", "errors": {"limit": ["Must be a whole number."]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return Response({"lead": lead.pk, "events": services.lead_timeline(lead, limit)})

    # ------------------------------------------------------------------ #
    # Pipeline moves
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["post"])
    def status(self, request, pk=None):
        lead = self.get_object()
        serializer = LeadStatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = services.change_lead_status(
            lead,
            serializer.validated_data["status"],
            actor=request.user,
            note=serializer.validated_data.get("note", ""),
        )
        return Response(LeadSerializer(lead, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="schedule-trial")
    def schedule_trial(self, request, pk=None):
        lead = self.get_object()
        serializer = ScheduleTrialSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data.get("note", "")
        lead = services.schedule_trial(
            lead, serializer.validated_data["trial_date"], actor=request.user
        )
        if note:
            services.log_activity(lead, LeadActivityKind.NOTE, note, actor=request.user)
        return Response(LeadSerializer(lead, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="trial-completed")
    def trial_completed(self, request, pk=None):
        lead = self.get_object()
        serializer = TrialCompletedSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = services.record_trial_completed(
            lead,
            attended=serializer.validated_data["attended"],
            note=serializer.validated_data.get("note", ""),
            actor=request.user,
        )
        return Response(LeadSerializer(lead, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        """Register the lead. A repeat call returns the same student."""
        lead = self.get_object()
        serializer = ConvertLeadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Worked out before the service runs so the response can say whether an
        # existing student was matched by phone instead of a new one created.
        already_converted = lead.converted_student_id is not None
        matched_existing = bool(
            not already_converted
            and lead.phone
            and Student.objects.filter(phone=lead.phone).exists()
        )

        student = services.convert_lead_to_student(
            lead,
            group=data.get("group"),
            course=data.get("course"),
            monthly_fee=data.get("monthly_fee"),
            start_date=data.get("start_date"),
            actor=request.user,
            payment_terms=data.get("payment_terms", ""),
        )
        return Response(
            {
                "lead": LeadSerializer(lead, context={"request": request}).data,
                "student": {
                    "id": student.pk,
                    "code": student.code,
                    "full_name": student.full_name,
                    "status": student.status,
                    "phone": student.phone,
                    "monthly_fee": str(student.monthly_fee),
                },
                "already_converted": already_converted,
                "reused_existing_student": matched_existing,
            },
            status=status.HTTP_201_CREATED,
        )

    # ------------------------------------------------------------------ #
    # Reporting
    # ------------------------------------------------------------------ #
    @action(detail=False, methods=["get"])
    def pipeline(self, request):
        return Response(
            services.pipeline_metrics(
                date_from=request.query_params.get("from"),
                date_to=request.query_params.get("to"),
            )
        )
