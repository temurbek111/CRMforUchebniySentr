"""Filters for audit log and notifications."""

from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import AuditLog, Notification


class AuditLogFilter(filters.FilterSet):
    entity = filters.CharFilter(field_name="entity", lookup_expr="iexact")
    action = filters.CharFilter(field_name="action", lookup_expr="iexact")
    actor = filters.NumberFilter(field_name="actor_id")
    search = filters.CharFilter(method="filter_search")
    date_from = filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = AuditLog
        fields = ["entity", "action", "actor"]

    def filter_search(self, queryset, name, value):
        return queryset.filter(
            Q(summary__icontains=value)
            | Q(actor_label__icontains=value)
            | Q(entity_id__iexact=value)
        )


class NotificationFilter(filters.FilterSet):
    kind = filters.CharFilter(field_name="kind", lookup_expr="iexact")
    severity = filters.CharFilter(field_name="severity", lookup_expr="iexact")
    unread = filters.BooleanFilter(method="filter_unread")
    role_scope = filters.CharFilter(field_name="role_scope", lookup_expr="iexact")

    class Meta:
        model = Notification
        fields = ["kind", "severity", "role_scope"]

    def filter_unread(self, queryset, name, value):
        if value:
            return queryset.filter(read_at__isnull=True)
        if value is False:
            return queryset.filter(read_at__isnull=False)
        return queryset
