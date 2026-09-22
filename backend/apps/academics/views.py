"""Academic API: courses, rooms, teachers, students, groups, memberships."""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.rbac import Perm, RequirePerms
from apps.core.audit import log_action
from apps.core.mixins import AuditedViewSetMixin
from apps.core.models import AuditLog

from . import services
from .filters import GroupFilter, MembershipFilter, StudentFilter, TeacherFilter
from .models import (
    Course,
    Group,
    GroupMembership,
    Guardian,
    Room,
    Student,
    StudentNote,
    Teacher,
)
from .serializers import (
    CourseSerializer,
    EnrollStudentSerializer,
    GroupMembershipSerializer,
    GroupSerializer,
    GuardianSerializer,
    RemoveStudentSerializer,
    RoomSerializer,
    StudentListSerializer,
    StudentNoteSerializer,
    StudentWriteSerializer,
    TeacherSerializer,
    TeacherWriteSerializer,
    TransferStudentSerializer,
    annotate_active_counts,
)


class CourseViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    permission_classes = [RequirePerms(Perm.COURSES_VIEW)]
    filterset_fields = ["status", "level"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["name", "created_at"]
    audit_fields = ["code", "name", "level", "default_monthly_fee", "status"]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [RequirePerms(Perm.COURSES_MANAGE)()]
        return [RequirePerms(Perm.COURSES_VIEW)()]


class RoomViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer
    permission_classes = [RequirePerms(Perm.ROOMS_VIEW)]
    filterset_fields = ["status"]
    search_fields = ["name", "location", "equipment"]
    ordering_fields = ["name", "capacity"]
    audit_fields = ["name", "capacity", "location", "status"]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [RequirePerms(Perm.ROOMS_MANAGE)()]
        return [RequirePerms(Perm.ROOMS_VIEW)()]


class TeacherViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Teacher.objects.select_related("user").all()
    permission_classes = [RequirePerms(Perm.TEACHERS_VIEW)]
    filterset_class = TeacherFilter
    search_fields = ["first_name", "last_name", "phone", "email", "specialization"]
    ordering_fields = ["first_name", "last_name", "start_date"]
    audit_fields = ["first_name", "last_name", "employment_type", "status", "specialization"]

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return TeacherWriteSerializer
        return TeacherSerializer

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "deactivate"}:
            return [RequirePerms(Perm.TEACHERS_MANAGE)()]
        return [RequirePerms(Perm.TEACHERS_VIEW)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "list":
            return queryset.annotate(groups_count=Count("groups", distinct=True))
        return queryset

    def destroy(self, request, *args, **kwargs):
        """Teachers are archived, never deleted: payroll and history point at them."""
        teacher = self.get_object()
        if teacher.groups.exists():
            return Response(
                {"detail": "Reassign this teacher's groups before archiving.",
                 "errors": {"non_field_errors": [f"{teacher.groups.count()} group(s) still assigned."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        teacher.status = "archived"
        teacher.save(update_fields=["status", "updated_at"])
        log_action(
            AuditLog.Action.UPDATE, teacher, actor=request.user,
            new={"status": "archived"}, summary=f"Archived teacher {teacher.full_name}",
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def groups(self, request, pk=None):
        teacher = self.get_object()
        queryset = annotate_active_counts(
            Group.objects.filter(teacher=teacher).select_related("course", "room")
        ).order_by("name")
        return Response(GroupSerializer(queryset, many=True, context={"request": request}).data)


class StudentViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    permission_classes = [RequirePerms(Perm.STUDENTS_VIEW)]
    filterset_class = StudentFilter
    search_fields = ["first_name", "last_name", "code", "phone", "email"]
    ordering_fields = ["first_name", "last_name", "code", "registered_at", "status"]
    ordering = ["first_name", "last_name"]
    audit_fields = ["code", "first_name", "last_name", "status", "phone", "email"]

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return StudentWriteSerializer
        if self.action == "list":
            return StudentListSerializer
        return StudentListSerializer

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy",
                           "change_status", "archive", "notes", "delete_note", "transfer"}:
            return [RequirePerms(Perm.STUDENTS_MANAGE)()]
        return [RequirePerms(Perm.STUDENTS_VIEW)()]

    def get_queryset(self):
        queryset = Student.objects.select_related("guardian").prefetch_related(
            "group_memberships__group__course",
            "group_memberships__group__teacher",
            "group_memberships__group__room",
        )
        status_filter = self.request.query_params.get("status")
        if self.action == "list" and (not status_filter or status_filter.lower() == "active"):
            queryset = queryset.filter(status="active") if status_filter else queryset
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            queryset = queryset.taught_by(teacher) if teacher else queryset.none()
        return queryset

    def destroy(self, request, *args, **kwargs):
        student = self.get_object()
        services.change_student_status(student, "archived", actor=request.user,
                                       reason="Archived by staff")
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        student = serializer.save(created_by=self.request.user)
        log_action(
            AuditLog.Action.CREATE, student, actor=self.request.user,
            new={"code": student.code, "name": student.full_name, "status": student.status},
            summary=f"Created student {student.full_name} ({student.code})",
            request=self.request,
        )

    def perform_update(self, serializer):
        before = {"status": serializer.instance.status, "name": serializer.instance.full_name,
                  "phone": serializer.instance.phone}
        student = serializer.save()
        log_action(
            AuditLog.Action.UPDATE, student, actor=self.request.user, old=before,
            new={"status": student.status, "name": student.full_name, "phone": student.phone},
            summary=f"Updated student {student.full_name} ({student.code})",
            request=self.request,
        )

    # ------------------------------------------------------------------ #
    # Profile tabs
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        from apps.attendance.services import student_attendance_summary
        from apps.exams.services import student_exam_summary
        from apps.finance.services import student_balance

        student = self.get_object()
        membership = student.current_membership()
        group = membership.group if membership else None
        balance = student_balance(student)
        attendance = student_attendance_summary(student)
        exams = student_exam_summary(student)
        return Response({
            "student": StudentListSerializer(student, context={"request": request}).data,
            "group": (
                {
                    "id": group.pk, "name": group.name,
                    "course": group.course.name if group.course else "",
                    "teacher": group.teacher.full_name if group.teacher else "",
                    "room": group.room.name if group.room else "",
                    "schedule": group.schedule_summary,
                    "joined_at": membership.joined_at if membership else None,
                }
                if group else None
            ),
            "monthly_fee": str(student.monthly_fee),
            "payment_status": balance["status"],
            "outstanding_balance": str(balance["outstanding"]),
            "attendance_pct": attendance["percentage"],
            "latest_exam_score": exams["latest_score"],
            "exam_average_pct": exams["average_percentage"],
            "performance_trend": exams["trend"],
        })

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        student = self.get_object()
        return Response({"results": services.student_activity(student)})

    @action(detail=True, methods=["get", "post"])
    def notes(self, request, pk=None):
        student = self.get_object()
        if request.method == "POST":
            if not request.user.has_perm_code(Perm.STUDENTS_MANAGE):
                return Response(
                    {"detail": "You cannot add notes.", "errors": {"non_field_errors": ["Permission denied."]}},
                    status=status.HTTP_403_FORBIDDEN,
                )
            serializer = StudentNoteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            note = services.add_student_note(
                student, serializer.validated_data["body"], actor=request.user,
                is_pinned=serializer.validated_data.get("is_pinned", False),
            )
            return Response(StudentNoteSerializer(note).data, status=status.HTTP_201_CREATED)
        notes = student.notes_entries.select_related("author")
        return Response(StudentNoteSerializer(notes, many=True).data)

    @action(detail=True, methods=["post"], url_path="notes/(?P<note_id>[^/.]+)/delete")
    def delete_note(self, request, pk=None, note_id=None):
        student = self.get_object()
        note = student.notes_entries.filter(pk=note_id).first()
        if note is None:
            return Response({"detail": "Note not found.", "errors": {"non_field_errors": ["Not found."]}},
                            status=status.HTTP_404_NOT_FOUND)
        log_action(AuditLog.Action.DELETE, "studentnote", entity_id=note.pk, actor=request.user,
                   old={"student": student.pk, "body": note.body[:120]},
                   summary=f"Deleted note on {student.full_name}", request=request)
        note.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="change-status")
    def change_status(self, request, pk=None):
        student = self.get_object()
        new_status = request.data.get("status")
        reason = request.data.get("reason", "")
        services.change_student_status(student, new_status, actor=request.user, reason=reason)
        return Response(StudentListSerializer(student, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        student = self.get_object()
        serializer = TransferStudentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        to_group = Group.objects.filter(pk=data["to_group"]).first()
        if to_group is None:
            raise DjangoValidationError({"to_group": "Destination group not found."})
        from_group = None
        if data.get("from_group"):
            from_group = Group.objects.filter(pk=data["from_group"]).first()
        membership = services.transfer_student(
            student=student, to_group=to_group, from_group=from_group, actor=request.user,
            effective_date=data.get("effective_date"), reason=data.get("reason") or "Transferred",
            allow_over_capacity=bool(data.get("allow_over_capacity"))
            and request.user.has_perm_code(Perm.GROUPS_OVERRIDE_CAPACITY),
        )
        return Response(GroupMembershipSerializer(membership, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def attendance(self, request, pk=None):
        from apps.attendance.services import student_attendance_detail

        student = self.get_object()
        return Response(student_attendance_detail(
            student,
            date_from=request.query_params.get("from"),
            date_to=request.query_params.get("to"),
        ))

    @action(detail=True, methods=["get"])
    def exams(self, request, pk=None):
        from apps.exams.services import student_exam_history

        student = self.get_object()
        return Response(student_exam_history(student))

    @action(detail=True, methods=["get"])
    def payments(self, request, pk=None):
        from apps.finance.services import student_financial_history

        student = self.get_object()
        return Response(student_financial_history(student))

    @action(detail=True, methods=["get"])
    def balance(self, request, pk=None):
        from apps.finance.services import student_balance

        student = self.get_object()
        return Response(student_balance(student))


class GroupViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = GroupSerializer
    permission_classes = [RequirePerms(Perm.GROUPS_VIEW)]
    filterset_class = GroupFilter
    search_fields = ["name", "level", "course__name", "teacher__first_name", "teacher__last_name"]
    ordering_fields = ["name", "start_date", "monthly_fee"]
    ordering = ["name"]
    audit_fields = ["name", "course", "teacher", "room", "capacity", "monthly_fee", "status"]

    def get_queryset(self):
        queryset = annotate_active_counts(
            Group.objects.select_related("course", "teacher", "room")
        )
        user = self.request.user
        if user.role_code == "teacher":
            teacher = getattr(user, "teacher_profile", None)
            queryset = queryset.filter(teacher=teacher) if teacher else queryset.none()
        return queryset

    def get_permissions(self):
        manage_actions = {"create", "update", "partial_update", "destroy", "enroll",
                          "remove_student", "transfer", "change_teacher"}
        if self.action in manage_actions:
            return [RequirePerms(Perm.GROUPS_MANAGE)()]
        return [RequirePerms(Perm.GROUPS_VIEW)()]

    def destroy(self, request, *args, **kwargs):
        group = self.get_object()
        if group.active_memberships.exists():
            return Response(
                {"detail": "Remove the active students before archiving this group.",
                 "errors": {"non_field_errors": [f"{group.student_count} student(s) still enrolled."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        group.status = "archived"
        group.save(update_fields=["status", "updated_at"])
        log_action(AuditLog.Action.UPDATE, group, actor=request.user, new={"status": "archived"},
                   summary=f"Archived group {group.name}", request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def students(self, request, pk=None):
        group = self.get_object()
        memberships = group.group_memberships.filter(left_at__isnull=True).select_related(
            "student", "student__guardian"
        ).order_by("student__first_name", "student__last_name")
        return Response(GroupMembershipSerializer(memberships, many=True, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def memberships(self, request, pk=None):
        """Full membership history including past students (never erased)."""
        group = self.get_object()
        memberships = group.group_memberships.select_related("student").order_by("-joined_at")
        return Response(GroupMembershipSerializer(memberships, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None):
        group = self.get_object()
        serializer = EnrollStudentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        student = Student.objects.filter(pk=data["student"]).first()
        if student is None:
            raise DjangoValidationError({"student": "Student not found."})
        membership = services.enroll_student(
            student=student, group=group, actor=request.user, fee=data.get("fee"),
            joined_at=data.get("joined_at"), note=data.get("note", ""),
            allow_over_capacity=bool(data.get("allow_over_capacity"))
            and request.user.has_perm_code(Perm.GROUPS_OVERRIDE_CAPACITY),
        )
        return Response(
            GroupMembershipSerializer(membership, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="remove-student")
    def remove_student(self, request, pk=None):
        group = self.get_object()
        serializer = RemoveStudentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        student = Student.objects.filter(pk=data["student"]).first()
        if student is None:
            raise DjangoValidationError({"student": "Student not found."})
        membership = services.remove_student_from_group(
            student=student, group=group, actor=request.user,
            reason=data.get("reason", ""), left_at=data.get("left_at"),
        )
        return Response(GroupMembershipSerializer(membership, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        """Transfer a student out of this group into another one."""
        source = self.get_object()
        serializer = TransferStudentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        student = Student.objects.filter(pk=data["student"]).first()
        to_group = Group.objects.filter(pk=data["to_group"]).first()
        if student is None or to_group is None:
            raise DjangoValidationError({"student": "Student or destination group not found."})
        membership = services.transfer_student(
            student=student, to_group=to_group, from_group=source, actor=request.user,
            effective_date=data.get("effective_date"), reason=data.get("reason") or "Transferred",
            allow_over_capacity=bool(data.get("allow_over_capacity"))
            and request.user.has_perm_code(Perm.GROUPS_OVERRIDE_CAPACITY),
        )
        return Response(GroupMembershipSerializer(membership, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="change-teacher")
    def change_teacher(self, request, pk=None):
        group = self.get_object()
        teacher_id = request.data.get("teacher")
        teacher = Teacher.objects.filter(pk=teacher_id).first() if teacher_id else None
        if teacher_id and teacher is None:
            raise DjangoValidationError({"teacher": "Teacher not found."})
        services.change_group_teacher(group=group, teacher=teacher, actor=request.user)
        return Response(GroupSerializer(group, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def capacity(self, request, pk=None):
        return Response(services.group_capacity_state(self.get_object()))

    @action(detail=True, methods=["get"], url_path="attendance-summary")
    def attendance_summary(self, request, pk=None):
        from apps.attendance.services import group_attendance_summary

        group = self.get_object()
        return Response(group_attendance_summary(group, date_from=request.query_params.get("from"),
                                                date_to=request.query_params.get("to")))

    @action(detail=True, methods=["get"])
    def performance(self, request, pk=None):
        from apps.exams.services import group_performance

        group = self.get_object()
        return Response(group_performance(group))

    @action(detail=True, methods=["get"])
    def schedule(self, request, pk=None):
        group = self.get_object()
        slots = group.slots.select_related("teacher", "room").order_by("weekday", "start_time")
        return Response([
            {
                "id": slot.pk,
                "weekday": slot.weekday,
                "weekday_name": slot.get_weekday_display(),
                "start_time": slot.start_time.strftime("%H:%M"),
                "end_time": slot.end_time.strftime("%H:%M"),
                "teacher": slot.teacher.full_name if slot.teacher else (group.teacher.full_name if group.teacher else ""),
                "room": slot.room.name if slot.room else (group.room.name if group.room else ""),
                "effective_from": slot.effective_from,
                "effective_to": slot.effective_to,
            }
            for slot in slots
        ])

    @action(detail=True, methods=["get"], url_path="finance-summary")
    def finance_summary(self, request, pk=None):
        from apps.finance.services import group_billing_summary

        group = self.get_object()
        return Response(group_billing_summary(group))


class GroupMembershipViewSet(viewsets.ReadOnlyModelViewSet):
    """Historical and current memberships across the centre."""

    queryset = GroupMembership.objects.select_related("student", "group", "group__course")
    serializer_class = GroupMembershipSerializer
    permission_classes = [RequirePerms(Perm.GROUPS_VIEW)]
    filterset_class = MembershipFilter
    search_fields = ["student__first_name", "student__last_name", "student__code", "group__name"]
    ordering_fields = ["joined_at", "left_at"]


class StudentNoteViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = StudentNote.objects.select_related("student", "author")
    serializer_class = StudentNoteSerializer
    permission_classes = [RequirePerms(Perm.STUDENTS_MANAGE)]
    filterset_fields = ["student"]
    audit_entity = "studentnote"

    def perform_create(self, serializer):
        note = serializer.save(author=self.request.user)
        log_action(AuditLog.Action.CREATE, "studentnote", entity_id=note.pk, actor=self.request.user,
                   new={"student": note.student_id}, summary=f"Note added to {note.student.full_name}",
                   request=self.request)
        return note


class GuardianViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    permission_classes = [RequirePerms(Perm.STUDENTS_VIEW)]
    search_fields = ["full_name", "phone", "email"]
    audit_fields = ["full_name", "phone", "email", "relation"]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [RequirePerms(Perm.STUDENTS_MANAGE)()]
        return [RequirePerms(Perm.STUDENTS_VIEW)()]
