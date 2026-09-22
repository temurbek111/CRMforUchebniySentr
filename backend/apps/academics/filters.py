"""Filters for academic list endpoints."""

from __future__ import annotations

import django_filters as filters
from django.db.models import F

from .models import Group, GroupMembership, Student, Teacher


class StudentFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    group = filters.NumberFilter(field_name="group_memberships__group_id",
                                 lookup_expr="exact", distinct=True)
    course = filters.NumberFilter(field_name="group_memberships__group__course_id",
                                  lookup_expr="exact", distinct=True)
    teacher = filters.NumberFilter(field_name="group_memberships__group__teacher_id",
                                   lookup_expr="exact", distinct=True)
    active_only = filters.BooleanFilter(method="filter_active_only")
    registered_from = filters.DateFilter(field_name="registered_at", lookup_expr="gte")
    registered_to = filters.DateFilter(field_name="registered_at", lookup_expr="lte")

    class Meta:
        model = Student
        fields = ["status", "group", "course", "teacher"]

    def filter_active_only(self, queryset, name, value):
        if value:
            return queryset.filter(status="active")
        return queryset


class GroupFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    course = filters.NumberFilter(field_name="course_id")
    teacher = filters.NumberFilter(field_name="teacher_id")
    room = filters.NumberFilter(field_name="room_id")
    has_seats = filters.BooleanFilter(method="filter_has_seats")

    class Meta:
        model = Group
        fields = ["status", "course", "teacher", "room"]

    def filter_has_seats(self, queryset, name, value):
        if value:
            return queryset.filter(active_student_count__lt=F("capacity"))
        return queryset


class TeacherFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    employment_type = filters.CharFilter(field_name="employment_type", lookup_expr="iexact")
    has_account = filters.BooleanFilter(method="filter_has_account")

    class Meta:
        model = Teacher
        fields = ["status", "employment_type"]

    def filter_has_account(self, queryset, name, value):
        if value:
            return queryset.filter(user__isnull=False)
        if value is False:
            return queryset.filter(user__isnull=True)
        return queryset


class MembershipFilter(filters.FilterSet):
    group = filters.NumberFilter(field_name="group_id")
    student = filters.NumberFilter(field_name="student_id")
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    active = filters.BooleanFilter(method="filter_active")
    joined_from = filters.DateFilter(field_name="joined_at", lookup_expr="gte")
    joined_to = filters.DateFilter(field_name="joined_at", lookup_expr="lte")

    class Meta:
        model = GroupMembership
        fields = ["group", "student", "status"]

    def filter_active(self, queryset, name, value):
        if value:
            return queryset.filter(left_at__isnull=True)
        if value is False:
            return queryset.filter(left_at__isnull=False)
        return queryset
