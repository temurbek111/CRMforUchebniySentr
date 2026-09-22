"""Filters for exam list endpoints."""

from __future__ import annotations

import django_filters as filters

from .models import Exam, ExamResult


class ExamFilter(filters.FilterSet):
    group = filters.NumberFilter(field_name="group_id")
    course = filters.NumberFilter(field_name="course_id")
    teacher = filters.NumberFilter(field_name="teacher_id")
    exam_type = filters.CharFilter(field_name="exam_type", lookup_expr="iexact")
    # ``?type=`` is the friendlier alias the frontend uses for the exam type.
    type = filters.CharFilter(field_name="exam_type", lookup_expr="iexact")
    date = filters.DateFilter(field_name="date")
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    is_published = filters.BooleanFilter(field_name="is_published")

    class Meta:
        model = Exam
        fields = ["group", "course", "teacher", "exam_type", "date", "is_published"]


class ExamResultFilter(filters.FilterSet):
    exam = filters.NumberFilter(field_name="exam_id")
    student = filters.NumberFilter(field_name="student_id")
    component = filters.NumberFilter(field_name="component_id")
    group = filters.NumberFilter(field_name="exam__group_id")
    course = filters.NumberFilter(field_name="exam__course_id")
    exam_type = filters.CharFilter(field_name="exam__exam_type", lookup_expr="iexact")
    grade = filters.CharFilter(field_name="grade", lookup_expr="iexact")
    overall_only = filters.BooleanFilter(method="filter_overall_only")
    passed = filters.BooleanFilter(method="filter_passed")
    date_from = filters.DateFilter(field_name="exam__date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="exam__date", lookup_expr="lte")

    class Meta:
        model = ExamResult
        fields = ["exam", "student", "component"]

    def filter_overall_only(self, queryset, name, value):
        if value:
            return queryset.filter(component__isnull=True)
        if value is False:
            return queryset.filter(component__isnull=False)
        return queryset

    def filter_passed(self, queryset, name, value):
        """Compare each mark against its own exam's passing percentage."""
        from django.db.models import DecimalField, ExpressionWrapper, F

        if value is None:
            return queryset
        threshold = ExpressionWrapper(
            F("exam__passing_score") * 100 / F("exam__max_score"),
            output_field=DecimalField(max_digits=8, decimal_places=2),
        )
        passing = queryset.filter(percentage__gte=threshold)
        if value:
            return passing
        return queryset.exclude(pk__in=passing.values("pk"))
