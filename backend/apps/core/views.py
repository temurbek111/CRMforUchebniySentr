"""Core endpoints: health, runtime settings, notifications, audit trail."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Perm, RequirePerms

from .filters import AuditLogFilter, NotificationFilter
from .models import AuditLog, Notification, SystemSettings
from .serializers import (
    AuditLogSerializer,
    NotificationSerializer,
    SystemSettingsSerializer,
)


class HealthView(APIView):
    """Unauthenticated liveness probe used by scripts, Docker and monitoring."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response(
            {
                "status": "ok",
                "time": timezone.now().isoformat(),
                "centre": SystemSettings.get_solo().centre_name,
            }
        )


class SettingsView(APIView):
    """Read settings for any signed-in user; write requires settings.manage."""

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        # Overriding get_permissions means returning instances (DRF instantiates
        # the classes from `permission_classes` itself in the base implementation).
        return [RequirePerms(Perm.SETTINGS_MANAGE)()]

    def get(self, request):
        return Response(SystemSettingsSerializer(SystemSettings.get_solo()).data)

    def patch(self, request):
        instance = SystemSettings.get_solo()
        before = SystemSettingsSerializer(instance).data
        serializer = SystemSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        from .audit import diff, log_action

        after = serializer.data
        changes = diff(before, after)
        if changes:
            log_action(
                AuditLog.Action.UPDATE,
                "systemsettings",
                entity_id=instance.pk,
                actor=request.user,
                old=before,
                new=after,
                summary=f"System settings changed: {', '.join(changes)}",
                request=request,
            )
        return Response(serializer.data)

    def put(self, request):
        return self.patch(request)


class NotificationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """The caller's notification centre, filtered by role scope when set."""

    serializer_class = NotificationSerializer
    filterset_class = NotificationFilter
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        from django.db.models import Q

        return (
            Notification.objects.select_related("recipient")
            .filter(Q(recipient=user) | Q(recipient__isnull=True, role_scope__in=["", user.role_code]))
            .distinct()
        )

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_read()
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        updated = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked_read": updated})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"unread": count})


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only audit trail. Only holders of audit.view can read it."""

    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    permission_classes = [RequirePerms(Perm.AUDIT_VIEW)]
    ordering_fields = ["created_at", "action", "entity"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return AuditLog.objects.select_related("actor")

    @action(detail=False, methods=["get"], url_path="filter-options")
    def filter_options(self, request):
        """Distinct values so the UI filter dropdowns are data-driven."""
        entities = (
            AuditLog.objects.order_by("entity").values_list("entity", flat=True).distinct()
        )
        actions = (
            AuditLog.objects.order_by("action").values_list("action", flat=True).distinct()
        )
        return Response(
            {
                "entities": list(entities),
                "actions": list(actions),
                "status": status.HTTP_200_OK,
            }
        )
