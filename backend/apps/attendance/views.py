"""Attendance API. Marking is a single request per sheet (plan section 11)."""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Group
from apps.core import params
from apps.core.mixins import TeacherGroupGuardMixin
from apps.schedule.models import ScheduleSlot

from . import services
from .models import AttendanceRecord, AttendanceSession, AttendanceStatus
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceSessionSerializer,
    MarkAttendanceSerializer,
    OpenSessionSerializer,
)


class TeacherScopedAttendanceMixin:
    def scope_queryset(self, queryset):
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            if teacher is None:
                return queryset.none()
            return queryset.filter(Q(group__teacher=teacher) | Q(teacher=teacher))
        return queryset


class AttendanceSessionViewSet(TeacherGroupGuardMixin, TeacherScopedAttendanceMixin,
                               viewsets.ModelViewSet):
    serializer_class = AttendanceSessionSerializer
    permission_classes = [RequirePerms(Perm.ATTENDANCE_VIEW)]
    filterset_fields = ["group", "date", "state", "teacher"]
    ordering_fields = ["date", "group__name"]
    ordering = ["-date"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        queryset = AttendanceSession.objects.select_related(
            "group", "group__course", "teacher"
        ).annotate(records_count=Count("records"))
        queryset = self.scope_queryset(queryset)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            queryset = queryset.filter(date__gte=params.query_date(date_from, field="date_from"))
        if date_to:
            queryset = queryset.filter(date__lte=params.query_date(date_to, field="date_to"))
        return queryset

    def get_permissions(self):
        if self.action in {"create", "mark", "mark_all_present", "partial_update",
                           "submit", "destroy"}:
            return [RequirePerms(Perm.ATTENDANCE_MANAGE)()]
        return [RequirePerms(Perm.ATTENDANCE_VIEW)()]

    def create(self, request, *args, **kwargs):
        """Open (or fetch) the attendance sheet for a group/date. Idempotent."""
        serializer = OpenSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = Group.objects.filter(pk=data["group"]).first()
        if group is None:
            raise DjangoValidationError({"group": "Group not found."})
        self.assert_group_access(group)
        slot = None
        if data.get("slot"):
            slot = ScheduleSlot.objects.filter(pk=data["slot"]).first()
            if slot is None:
                raise DjangoValidationError({"slot": "Schedule slot not found."})
        session = services.get_or_create_session(
            group, data["date"], slot=slot, actor=request.user
        )
        if data.get("note"):
            session.note = data["note"]
            session.save(update_fields=["note"])
        return Response(
            services.session_payload(session),
            status=status.HTTP_200_OK if session.pk else status.HTTP_201_CREATED,
        )

    def retrieve(self, request, *args, **kwargs):
        """Detail returns the full roster so the UI can render marking instantly."""
        session = self.get_object()
        return Response(services.session_payload(session))

    @action(detail=True, methods=["get"], url_path="records")
    def records(self, request, pk=None):
        return Response(services.session_payload(self.get_object()))

    @action(detail=True, methods=["post"])
    def mark(self, request, pk=None):
        """Bulk attendance marking - the primary teacher workflow."""
        session = self.get_object()
        serializer = MarkAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = services.mark_attendance(
            session, serializer.validated_data["records"],
            actor=request.user, submit=serializer.validated_data.get("submit", False),
        )
        return Response(services.session_payload(session))

    @action(detail=True, methods=["post"], url_path="mark-all-present")
    def mark_all_present(self, request, pk=None):
        session = self.get_object()
        session = services.mark_all_present(
            session, actor=request.user, submit=bool(request.data.get("submit", False))
        )
        return Response(services.session_payload(session))

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        session = self.get_object()
        session.state = "submitted"
        session.submitted_at = timezone.now()
        session.save(update_fields=["state", "submitted_at", "updated_at"])
        from apps.core.audit import log_action
        from apps.core.models import AuditLog

        log_action(AuditLog.Action.UPDATE, session, actor=request.user,
                   new={"state": "submitted"},
                   summary=f"Attendance submitted for {session.group.name} on {session.date}",
                   request=request)
        return Response(services.session_payload(session))

    @action(detail=False, methods=["get"])
    def today(self, request):
        day = timezone.localdate()
        sessions = self.get_queryset().filter(date=day)
        return Response({
            "date": day,
            "totals": services.daily_totals(day),
            "sessions": AttendanceSessionSerializer(sessions, many=True).data,
            "incomplete": services.incomplete_sessions(day),
        })

    @action(detail=False, methods=["get"])
    def incomplete(self, request):
        day = params.query_date(request.query_params.get("date"), field="date") \
            or timezone.localdate()
        return Response({"date": day, "results": services.incomplete_sessions(day)})

    @action(detail=False, methods=["get"])
    def summary(self, request):
        date_to = params.query_date(request.query_params.get("date_to"), field="date_to") \
            or timezone.localdate()
        date_from = params.query_date(request.query_params.get("date_from"),
                                      field="date_from") \
            or date_to - timedelta(days=29)
        return Response(services.centre_attendance_summary(date_from, date_to))

    @action(detail=False, methods=["get"])
    def absences(self, request):
        """Repeated-absence watch list using the configured thresholds."""
        date_from = params.query_date(request.query_params.get("date_from"),
                                      field="date_from")
        date_to = params.query_date(request.query_params.get("date_to"), field="date_to")
        return Response({"results": services.students_with_repeated_absences(date_from, date_to)})


class AttendanceRecordViewSet(TeacherScopedAttendanceMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [RequirePerms(Perm.ATTENDANCE_VIEW)]
    filterset_fields = ["session", "student", "status"]
    ordering_fields = ["session__date", "student__first_name"]
    ordering = ["-session__date"]

    def get_queryset(self):
        queryset = AttendanceRecord.objects.select_related(
            "student", "session", "session__group", "modified_by"
        )
        queryset = self.scope_queryset(queryset)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            queryset = queryset.filter(session__date__gte=params.query_date(date_from, field="date_from"))
        if date_to:
            queryset = queryset.filter(session__date__lte=params.query_date(date_to, field="date_to"))
        return queryset
