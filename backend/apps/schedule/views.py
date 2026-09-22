"""Timetable API."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Course, Group, Room, Teacher
from apps.core.audit import log_action
from apps.core.models import AuditLog

from . import services
from .models import ScheduleSlot
from .serializers import ScheduleSlotSerializer, ScheduleSlotWriteSerializer


class ScheduleSlotViewSet(viewsets.ModelViewSet):
    queryset = ScheduleSlot.objects.select_related("group", "group__course", "teacher", "room")
    serializer_class = ScheduleSlotSerializer
    permission_classes = [RequirePerms(Perm.SCHEDULE_VIEW)]
    filterset_fields = ["group", "teacher", "room", "weekday", "is_active"]
    search_fields = ["group__name", "teacher__first_name", "room__name"]
    ordering_fields = ["weekday", "start_time"]
    ordering = ["weekday", "start_time"]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [RequirePerms(Perm.SCHEDULE_MANAGE)()]
        return [RequirePerms(Perm.SCHEDULE_VIEW)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            queryset = queryset.filter(group__teacher=teacher) if teacher else queryset.none()
        if self.request.query_params.get("course"):
            queryset = queryset.filter(group__course_id=self.request.query_params["course"])
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = ScheduleSlotWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        slot = services.create_slot(
            group=data["group"], weekday=data["weekday"], start_time=data["start_time"],
            end_time=data["end_time"], teacher=data.get("teacher"), room=data.get("room"),
            effective_from=data.get("effective_from"), effective_to=data.get("effective_to"),
            note=data.get("note", ""), actor=request.user,
            allow_capacity_override=bool(data.get("allow_capacity_override"))
            and request.user.has_perm_code(Perm.GROUPS_OVERRIDE_CAPACITY),
        )
        return Response(ScheduleSlotSerializer(slot).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        slot = self.get_object()
        serializer = ScheduleSlotWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        allow_override = bool(data.pop("allow_capacity_override", False)) and request.user.has_perm_code(
            Perm.GROUPS_OVERRIDE_CAPACITY
        )
        slot = services.update_slot(slot, actor=request.user, allow_capacity_override=allow_override, **data)
        return Response(ScheduleSlotSerializer(slot).data)

    def destroy(self, request, *args, **kwargs):
        slot = self.get_object()
        log_action(AuditLog.Action.DELETE, slot, actor=request.user,
                   old={"group": slot.group_id, "weekday": slot.weekday, "start": str(slot.start_time)},
                   summary=f"Removed schedule slot {slot}", request=request)
        slot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"])
    def today(self, request):
        slots = services.slots_on_date(timezone.localdate())
        return Response(ScheduleSlotSerializer(slots, many=True).data)

    @action(detail=False, methods=["get"])
    def week(self, request):
        raw = request.query_params.get("week_start")
        week_start = (
            timezone.datetime.fromisoformat(raw).date() if raw
            else timezone.localdate() - timedelta(days=timezone.localdate().weekday())
        )
        slots = services.week_slots(
            week_start,
            teacher=self._fk(Teacher, request.query_params.get("teacher")),
            room=self._fk(Room, request.query_params.get("room")),
            group=self._fk(Group, request.query_params.get("group")),
            course=self._fk(Course, request.query_params.get("course")),
        )
        return Response({"week_start": week_start, "slots": ScheduleSlotSerializer(slots, many=True).data})

    def _fk(self, model, value):
        if not value:
            return None
        return model.objects.filter(pk=value).first()
