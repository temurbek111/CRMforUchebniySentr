"""Exam API.

Teachers only ever see their own groups; that scope is applied here, server-side,
and cannot be widened by the client (plan sections 4 and 46).
"""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Course, Group
from apps.core.audit import log_action, snapshot
from apps.core.mixins import AuditedViewSetMixin, TeacherGroupGuardMixin
from apps.core.models import AuditLog

from . import services
from .filters import ExamFilter, ExamResultFilter
from .models import Exam, ExamResult
from .serializers import (
    ExamComponentSerializer,
    ExamResultEntrySerializer,
    ExamResultSerializer,
    ExamSerializer,
    ExamWriteSerializer,
    RecordResultsSerializer,
)


def _error(field: str, message: str) -> Response:
    return Response(
        {"detail": "Validation failed.", "errors": {field: [message]}},
        status=status.HTTP_400_BAD_REQUEST,
    )


class ExamViewSet(TeacherGroupGuardMixin, AuditedViewSetMixin, viewsets.ModelViewSet):
    """Exams plus their mark sheets, publishing and performance reporting."""

    serializer_class = ExamSerializer
    permission_classes = [RequirePerms(Perm.EXAMS_VIEW)]
    filterset_class = ExamFilter
    search_fields = ["name", "description", "group__name", "course__name"]
    ordering_fields = ["date", "name", "created_at"]
    ordering = ["-date", "-id"]
    audit_entity = "exam"
    audit_fields = [
        "group", "course", "teacher", "name", "exam_type", "date",
        "max_score", "passing_score", "is_published",
    ]

    def get_queryset(self):
        queryset = Exam.objects.select_related("group", "course", "teacher").prefetch_related(
            "components"
        )
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            queryset = queryset.filter(group__teacher=teacher) if teacher else queryset.none()
        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return ExamWriteSerializer
        return ExamSerializer

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "publish"}:
            return [RequirePerms(Perm.EXAMS_MANAGE)()]
        if self.action == "results" and self.request.method == "POST":
            return [RequirePerms(Perm.EXAMS_MANAGE)()]
        return [RequirePerms(Perm.EXAMS_VIEW)()]

    # ------------------------------------------------------------------ #
    # Auditing: the create/update services already write the trail, so the
    # generic mixin hooks are narrowed to avoid duplicate entries.
    # ------------------------------------------------------------------ #
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        exam = self.perform_create(serializer)
        return Response(
            ExamSerializer(exam, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        exam = self.get_object()
        serializer = self.get_serializer(exam, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        exam = self.perform_update(serializer)
        return Response(ExamSerializer(exam, context={"request": request}).data)

    def perform_create(self, serializer):
        # A teacher may only create exams for their own groups; the payload can
        # name any group, so the queryset scoping alone is not enough.
        group = serializer.validated_data.get("group")
        if group is not None:
            self.assert_group_access(group, "You can only create exams for your own groups.")
        return serializer.save()

    def perform_update(self, serializer):
        group = serializer.validated_data.get("group", serializer.instance.group)
        if group is not None:
            self.assert_group_access(group, "You can only edit exams for your own groups.")
        before = snapshot(serializer.instance, self.audit_fields)
        exam = serializer.save()
        after = snapshot(exam, self.audit_fields)
        log_action(
            AuditLog.Action.UPDATE,
            "exam",
            entity_id=exam.pk,
            actor=self.request.user,
            old=before,
            new=after,
            summary=f"Updated exam {exam.name}",
            request=self.request,
        )
        return exam

    def destroy(self, request, *args, **kwargs):
        exam = self.get_object()
        log_action(
            AuditLog.Action.DELETE,
            "exam",
            entity_id=exam.pk,
            actor=request.user,
            old=snapshot(exam, ["name", "group", "date", "exam_type", "is_published"]),
            summary=f"Deleted exam {exam.name}",
            request=request,
        )
        exam.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------ #
    # Mark sheet
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["get", "post"])
    def results(self, request, pk=None):
        """GET the mark sheet summary; POST a batch of marks (idempotent upsert)."""
        exam = self.get_object()
        if request.method == "GET":
            return Response(services.exam_results_summary(exam))

        payload = request.data
        if isinstance(payload, dict):
            wrapper = RecordResultsSerializer(data=payload)
            wrapper.is_valid(raise_exception=True)
            entries = wrapper.validated_data["entries"]
        else:
            entries = payload
        serializer = ExamResultEntrySerializer(data=entries, many=True)
        serializer.is_valid(raise_exception=True)
        summary = services.record_results(exam, serializer.validated_data, actor=request.user)
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def components(self, request, pk=None):
        exam = self.get_object()
        return Response(ExamComponentSerializer(exam.components.all(), many=True).data)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        exam = services.publish_results(self.get_object(), actor=request.user)
        return Response(ExamSerializer(exam, context={"request": request}).data)

    # ------------------------------------------------------------------ #
    # Reporting
    # ------------------------------------------------------------------ #
    @action(detail=False, methods=["get"], url_path="group-performance")
    def group_performance(self, request):
        group = self._object(Group, request.query_params.get("group"))
        if group is None:
            return _error("group", "A valid group is required.")
        return Response(services.group_performance(group))

    @action(detail=False, methods=["get"], url_path="course-performance")
    def course_performance(self, request):
        course = self._object(Course, request.query_params.get("course"))
        if course is None:
            return _error("course", "A valid course is required.")
        return Response(services.course_performance(course))

    @action(detail=False, methods=["get"])
    def trends(self, request):
        date_from, date_to = self._period(request)
        return Response(services.group_performance_trends(date_from, date_to))

    @action(detail=False, methods=["get"], url_path="centre-summary")
    def centre_summary(self, request):
        date_from, date_to = self._period(request)
        return Response(services.centre_exam_summary(date_from, date_to))

    @action(detail=False, methods=["get"], url_path="below-passing")
    def below_passing(self, request):
        date_from, date_to = self._period(request)
        raw_limit = request.query_params.get("limit")
        try:
            limit = int(raw_limit) if raw_limit else None
        except (TypeError, ValueError):
            return _error("limit", "The limit must be a whole number.")
        return Response(services.students_below_passing(date_from, date_to, limit))

    @action(detail=False, methods=["get"])
    def upcoming(self, request):
        raw_days = request.query_params.get("days", "7")
        try:
            days = int(raw_days)
        except (TypeError, ValueError):
            return _error("days", "The number of days must be a whole number.")
        group = self._object(Group, request.query_params.get("group"))
        exams = services.exams_upcoming(days=days, group=group)
        return Response(ExamSerializer(exams, many=True, context={"request": request}).data)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _object(model, value):
        if not value:
            return None
        return model.objects.filter(pk=value).first()

    def _period(self, request) -> tuple:
        """``from``/``to`` query params; defaults to the last 30 days."""
        raw_from = request.query_params.get("from")
        raw_to = request.query_params.get("to")
        date_from = parse_date(raw_from) if raw_from else None
        date_to = parse_date(raw_to) if raw_to else None
        if raw_from and date_from is None:
            raise DjangoValidationError({"from": f"{raw_from!r} is not a valid date."})
        if raw_to and date_to is None:
            raise DjangoValidationError({"to": f"{raw_to!r} is not a valid date."})
        date_to = date_to or timezone.localdate()
        date_from = date_from or (date_to - timedelta(days=29))
        return date_from, date_to


class ExamResultViewSet(viewsets.ReadOnlyModelViewSet):
    """Flat mark listing (``/results``) across every exam."""

    serializer_class = ExamResultSerializer
    permission_classes = [RequirePerms(Perm.EXAMS_VIEW)]
    filterset_class = ExamResultFilter
    search_fields = ["student__first_name", "student__last_name", "student__code", "exam__name"]
    ordering_fields = ["created_at", "score", "percentage"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = ExamResult.objects.select_related(
            "exam", "exam__group", "exam__course", "student", "component", "marked_by"
        )
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            queryset = queryset.filter(exam__group__teacher=teacher) if teacher else queryset.none()
        return queryset
