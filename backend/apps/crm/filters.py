"""Filters for CRM list endpoints."""

from __future__ import annotations

import django_filters as filters

from .models import Lead


class CharInFilter(filters.BaseInFilter, filters.CharFilter):
    """Comma-separated multi-value equality: ``?status_in=a,b``.

    django-filter's documented idiom for an "in" filter over a text column.
    ``status`` itself stays single-valued because the pipeline browser sends one
    status at a time; this exists for the scoped queue views (see
    ``status_in`` below).
    """


class LeadFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    #: The admissions conversion queue, e.g.
    #: ``?status_in=trial_completed,interested`` (apps/crm/models.LeadStatus).
    #: A single ``status`` cannot express a two-status queue.
    status_in = CharInFilter(field_name="status", lookup_expr="in")
    source = filters.CharFilter(field_name="source", lookup_expr="iexact")
    assigned_to = filters.NumberFilter(field_name="assigned_to_id")
    interested_course = filters.NumberFilter(field_name="interested_course_id")
    #: ``?has_trial=true`` is the trials listing (no separate trials endpoint).
    has_trial = filters.BooleanFilter(method="filter_has_trial")
    converted = filters.BooleanFilter(method="filter_converted")
    open = filters.BooleanFilter(method="filter_open")
    trial_from = filters.DateFilter(field_name="trial_date", lookup_expr="gte")
    trial_to = filters.DateFilter(field_name="trial_date", lookup_expr="lte")
    created_from = filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    created_to = filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = Lead
        fields = ["status", "source", "assigned_to", "interested_course"]

    def filter_has_trial(self, queryset, name, value):
        if value:
            return queryset.filter(trial_date__isnull=False)
        if value is False:
            return queryset.filter(trial_date__isnull=True)
        return queryset

    def filter_converted(self, queryset, name, value):
        if value:
            return queryset.filter(converted_student__isnull=False)
        if value is False:
            return queryset.filter(converted_student__isnull=True)
        return queryset

    def filter_open(self, queryset, name, value):
        if value:
            return queryset.open()
        if value is False:
            return queryset.exclude(pk__in=queryset.open().values("pk"))
        return queryset
