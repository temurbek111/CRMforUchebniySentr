"""Academic domain services.

All rules about enrolment, capacity, transfer and student lifecycle live here so
they are testable without HTTP and cannot be bypassed by a crafty request
(plan sections 50, 54).
"""

from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.core.audit import log_action
from apps.core.models import AuditLog

from .models import (
    Group,
    GroupMembership,
    Guardian,
    Status,
    Student,
    StudentLifecycle,
    StudentNote,
    Teacher,
)


# --------------------------------------------------------------------------- #
# Guardians
# --------------------------------------------------------------------------- #
def get_or_create_guardian(full_name: str, phone: str, relation: str = "guardian", **extra) -> Guardian | None:
    """Reuse an existing guardian when the phone matches; else create one."""
    full_name = (full_name or "").strip()
    phone = (phone or "").strip()
    if not full_name and not phone:
        return None
    if phone:
        existing = Guardian.objects.filter(phone=phone).first()
        if existing:
            changed = False
            for field, value in (("full_name", full_name), ("relation", relation), *extra.items()):
                if value and getattr(existing, field) != value:
                    setattr(existing, field, value)
                    changed = True
            if changed:
                existing.save()
            return existing
    return Guardian.objects.create(full_name=full_name or "Guardian", phone=phone, relation=relation, **extra)


# --------------------------------------------------------------------------- #
# Students
# --------------------------------------------------------------------------- #
def create_student(*, actor=None, guardian_name: str = "", guardian_phone: str = "",
                   guardian_relation: str = "guardian", **fields) -> Student:
    student = Student(**fields)
    guardian = get_or_create_guardian(guardian_name, guardian_phone, guardian_relation)
    if guardian is not None:
        student.guardian = guardian
    if actor is not None and getattr(actor, "pk", None):
        student.created_by = actor
    student.save()
    log_action(
        AuditLog.Action.CREATE, student, actor=actor,
        new={"code": student.code, "name": student.full_name, "status": student.status},
        summary=f"Created student {student.full_name} ({student.code})",
    )
    return student


def update_student(student: Student, *, actor=None, **fields) -> Student:
    before = {
        "first_name": student.first_name, "last_name": student.last_name,
        "phone": student.phone, "status": student.status,
    }
    for key, value in fields.items():
        setattr(student, key, value)
    student.save()
    log_action(
        AuditLog.Action.UPDATE, student, actor=actor,
        old=before,
        new={"first_name": student.first_name, "last_name": student.last_name,
             "phone": student.phone, "status": student.status},
        summary=f"Updated student {student.full_name} ({student.code})",
    )
    return student


def change_student_status(student: Student, new_status: str, *, actor=None, reason: str = "",
                          left_at: date | None = None) -> Student:
    """Change lifecycle status. Dropping/graduating stamps a leave date."""
    if new_status not in StudentLifecycle.values:
        raise ValidationError({"status": f"Unknown student status {new_status!r}."})
    old_status = student.status
    if old_status == new_status:
        return student

    if new_status in {StudentLifecycle.DROPPED, StudentLifecycle.GRADUATED}:
        student.left_at = left_at or timezone.localdate()
        student.leave_reason = reason or student.leave_reason
    elif new_status in {StudentLifecycle.ACTIVE, StudentLifecycle.PAUSED, StudentLifecycle.TRIAL}:
        student.left_at = None
        if new_status == StudentLifecycle.ACTIVE:
            student.leave_reason = ""

    student.status = new_status
    student.status_changed_at = timezone.now()
    student.save()
    log_action(
        AuditLog.Action.UPDATE, student, actor=actor,
        old={"status": old_status}, new={"status": new_status, "reason": reason},
        summary=f"Student {student.full_name} status {old_status} → {new_status}",
    )
    return student


def add_student_note(student: Student, body: str, *, actor=None, is_pinned: bool = False) -> StudentNote:
    body = (body or "").strip()
    if not body:
        raise ValidationError({"body": "A note cannot be empty."})
    note = StudentNote.objects.create(student=student, author=actor, body=body, is_pinned=is_pinned)
    log_action(
        AuditLog.Action.CREATE, "studentnote", entity_id=note.pk, actor=actor,
        new={"student": student.pk, "note": note.pk},
        summary=f"Note added to {student.full_name}",
    )
    return note


# --------------------------------------------------------------------------- #
# Groups & memberships
# --------------------------------------------------------------------------- #
def _active_membership(student: Student, group: Group) -> GroupMembership | None:
    return GroupMembership.objects.filter(student=student, group=group, left_at__isnull=True).first()


def enroll_student(
    *,
    student: Student,
    group: Group,
    actor=None,
    fee=None,
    joined_at: date | None = None,
    allow_over_capacity: bool = False,
    note: str = "",
) -> GroupMembership:
    """Enrol a student into a group, honouring capacity unless explicitly overridden."""
    if group.status != Status.ACTIVE:
        raise ValidationError({"group": f"Group {group.name} is not active."})
    if student.status in {StudentLifecycle.ARCHIVED, StudentLifecycle.DROPPED}:
        raise ValidationError(
            {"student": f"{student.full_name} is {student.get_status_display().lower()} and cannot be enrolled."}
        )
    if _active_membership(student, group):
        raise ValidationError({"student": f"{student.full_name} is already in {group.name}."})
    if group.is_full and not allow_over_capacity:
        raise ValidationError(
            {"group": f"{group.name} is full ({group.student_count}/{group.capacity}). "
                      f"An explicit capacity override is required."}
        )

    with transaction.atomic():
        membership = GroupMembership.objects.create(
            student=student, group=group, monthly_fee=fee,
            joined_at=joined_at or timezone.localdate(), created_by=actor, note=note,
        )
        if student.status in {StudentLifecycle.LEAD, StudentLifecycle.TRIAL}:
            change_student_status(student, StudentLifecycle.ACTIVE, actor=actor,
                                  reason="Enrolled into a group")
        log_action(
            AuditLog.Action.CREATE, membership, actor=actor,
            new={"student": student.pk, "group": group.pk, "fee": str(membership.effective_fee)},
            summary=f"Enrolled {student.full_name} in {group.name}",
        )
    return membership


def remove_student_from_group(
    *, student: Student, group: Group, actor=None, reason: str = "", left_at: date | None = None
) -> GroupMembership:
    membership = _active_membership(student, group)
    if membership is None:
        raise ValidationError({"student": f"{student.full_name} is not an active member of {group.name}."})
    with transaction.atomic():
        membership.left_at = left_at or timezone.localdate()
        membership.status = GroupMembership.Status.LEFT
        membership.note = (reason or membership.note)[:255]
        membership.save(update_fields=["left_at", "status", "note"])
        log_action(
            AuditLog.Action.UPDATE, membership, actor=actor,
            new={"left_at": str(membership.left_at), "status": membership.status, "reason": reason},
            summary=f"Removed {student.full_name} from {group.name}",
        )
    return membership


def transfer_student(
    *,
    student: Student,
    to_group: Group,
    actor=None,
    from_group: Group | None = None,
    effective_date: date | None = None,
    allow_over_capacity: bool = False,
    reason: str = "Transferred",
) -> GroupMembership:
    """Move a student between groups, keeping the previous membership as history."""
    effective_date = effective_date or timezone.localdate()
    source = from_group or (student.current_group() if student else None)
    if source is None:
        raise ValidationError({"student": f"{student.full_name} has no active group to transfer from."})
    if source.pk == to_group.pk:
        raise ValidationError({"to_group": "The destination group is the current group."})
    if _active_membership(student, to_group):
        raise ValidationError({"to_group": f"{student.full_name} is already in {to_group.name}."})

    with transaction.atomic():
        closing = _active_membership(student, source)
        if closing is not None:
            closing.left_at = effective_date
            closing.status = GroupMembership.Status.TRANSFERRED
            closing.note = reason[:255]
            closing.save(update_fields=["left_at", "status", "note"])
            log_action(
                AuditLog.Action.UPDATE, closing, actor=actor,
                new={"left_at": str(closing.left_at), "status": closing.status},
                summary=f"Closed membership of {student.full_name} in {source.name} (transfer)",
            )
        membership = enroll_student(
            student=student, group=to_group, actor=actor, joined_at=effective_date,
            allow_over_capacity=allow_over_capacity, note=reason,
        )
        log_action(
            AuditLog.Action.UPDATE, student, actor=actor,
            old={"group": source.pk}, new={"group": to_group.pk},
            summary=f"Transferred {student.full_name} from {source.name} to {to_group.name}",
        )
    return membership


def change_group_teacher(*, group: Group, teacher: Teacher | None, actor=None) -> Group:
    previous = group.teacher
    group.teacher = teacher
    group.save(update_fields=["teacher", "updated_at"])
    log_action(
        AuditLog.Action.UPDATE, group, actor=actor,
        old={"teacher": previous.pk if previous else None},
        new={"teacher": teacher.pk if teacher else None},
        summary=(
            f"Group {group.name} teacher changed to {teacher.full_name}"
            if teacher else f"Group {group.name} teacher cleared"
        ),
    )
    return group


def group_capacity_state(group: Group) -> dict:
    count = group.student_count
    return {
        "capacity": group.capacity,
        "enrolled": count,
        "seats_available": max(group.capacity - count, 0),
        "is_full": count >= group.capacity,
        "over_capacity": count > group.capacity,
    }


# --------------------------------------------------------------------------- #
# Activity feed for the student profile (plan section 8, Activity tab)
# --------------------------------------------------------------------------- #
def student_activity(student: Student, limit: int = 60) -> list[dict]:
    """Merge memberships, payments and audit entries into one timeline."""
    events: list[dict] = []

    for membership in student.group_memberships.select_related("group", "group__course"):
        events.append({
            "kind": "enrollment",
            "title": f"Joined {membership.group.name}",
            "detail": membership.group.course.name,
            "at": membership.joined_at.isoformat() if membership.joined_at else None,
            "link": f"/groups/{membership.group_id}",
        })
        if membership.left_at:
            events.append({
                "kind": "membership_ended",
                "title": f"Left {membership.group.name}",
                "detail": membership.get_status_display() + (f" — {membership.note}" if membership.note else ""),
                "at": membership.left_at.isoformat(),
                "link": f"/groups/{membership.group_id}",
            })

    try:
        from apps.finance.models import Payment

        for payment in Payment.objects.filter(student=student, is_void=False).select_related("invoice"):
            events.append({
                "kind": "payment",
                "title": f"Payment recorded: {payment.amount}",
                "detail": f"{payment.get_method_display()} — {payment.invoice.period_label if payment.invoice else 'unallocated'}",
                "at": payment.paid_at.isoformat() if payment.paid_at else None,
                "link": f"/payments?student={student.pk}",
            })
    except Exception:  # pragma: no cover - finance app optional at import time
        pass

    for entry in (
        AuditLog.objects.filter(entity__in=["student", "studentnote"], entity_id=str(student.pk))
        .select_related("actor")[:limit]
    ):
        events.append({
            "kind": f"audit:{entry.action}",
            "title": entry.summary or f"{entry.action} {entry.entity}",
            "detail": entry.actor_label or "system",
            "at": entry.created_at.isoformat(),
            "link": f"/audit?entity={entry.entity}&entity_id={entry.entity_id}",
        })

    events.sort(key=lambda item: item.get("at") or "", reverse=True)
    return events[:limit]
