"""Shared view mixins: audit logging and teacher object-scoping."""

from __future__ import annotations

from .audit import diff, log_action, snapshot


class AuditedViewSetMixin:
    """Logs create/update/destroy for a ModelViewSet with sensible defaults.

    Set ``audit_entity`` (defaults to the model name) and optionally
    ``audit_fields`` to limit the snapshot to meaningful columns.
    """

    audit_entity: str | None = None
    audit_fields: list[str] | None = None

    def _entity_name(self) -> str:
        if self.audit_entity:
            return self.audit_entity
        return self.get_queryset().model.__name__.lower()

    def _label(self, instance) -> str:
        return str(instance)[:255]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_action(
            "create",
            self._entity_name(),
            entity_id=instance.pk,
            actor=getattr(self.request, "user", None),
            new=snapshot(instance, self.audit_fields),
            summary=f"Created {self._entity_name()}: {self._label(instance)}",
            request=self.request,
        )
        return instance

    def perform_update(self, serializer):
        before = snapshot(serializer.instance, self.audit_fields)
        instance = serializer.save()
        after = snapshot(instance, self.audit_fields)
        changed = diff(before, after)
        if changed:
            log_action(
                "update",
                self._entity_name(),
                entity_id=instance.pk,
                actor=getattr(self.request, "user", None),
                old=before,
                new=after,
                summary=f"Updated {self._entity_name()}: {self._label(instance)} ({', '.join(changed)})",
                request=self.request,
            )
        return instance

    def perform_destroy(self, instance):
        before = snapshot(instance, self.audit_fields)
        log_action(
            "delete",
            self._entity_name(),
            entity_id=instance.pk,
            actor=getattr(self.request, "user", None),
            old=before,
            summary=f"Deleted {self._entity_name()}: {self._label(instance)}",
            request=self.request,
        )
        return super().perform_destroy(instance)


class TeacherGroupGuardMixin:
    """Object-level guard for endpoints that take a group from the request payload.

    List/detail querysets already hide other teachers' records, but a POST body
    can name any group. Any view that accepts a group explicitly must call
    ``assert_group_access`` before acting on it (plan sections 4 and 46).
    """

    def assert_group_access(self, group, message: str | None = None) -> None:
        user = getattr(self.request, "user", None)
        if user is None or getattr(user, "role_code", None) != "teacher":
            return
        teacher = getattr(user, "teacher_profile", None)
        if teacher is None or getattr(group, "teacher_id", None) != teacher.pk:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied(
                message or "You can only work with your own groups."
            )


class TeacherScopeMixin:
    """Restricts a queryset to the calling teacher's own groups and students.

    Object-level enforcement happens server-side; the frontend never decides
    this (plan sections 4 and 46).
    """

    teacher_field: str | None = None        # e.g. "teacher" on Group
    teacher_via_membership = False          # e.g. Student through GroupMembership

    def scope_to_teacher(self, queryset, user):
        teacher = getattr(user, "teacher_profile", None)
        if teacher is None:
            return queryset.none()
        if self.teacher_via_membership:
            return queryset.filter(
                group_memberships__group__teacher=teacher,
                group_memberships__left_at__isnull=True,
            ).distinct()
        if self.teacher_field:
            return queryset.filter(**{self.teacher_field: teacher})
        return queryset.none()
