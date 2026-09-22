"""Schedule services: server-side conflict detection (plan section 18, rule 54)."""

from __future__ import annotations

from datetime import date

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.audit import log_action
from apps.core.models import AuditLog

from .models import ScheduleSlot


def _overlaps(slot: ScheduleSlot, *, weekday: int, start, end, effective_from, effective_to) -> bool:
    """Same weekday, intersecting time window and intersecting date range."""
    if slot.weekday != weekday:
        return False
    if not (slot.start_time < end and start < slot.end_time):
        return False
    slot_to = slot.effective_to
    if slot_to and effective_from and slot_to < effective_from:
        return False
    if effective_to and slot.effective_from and effective_to < slot.effective_from:
        return False
    return True


def find_conflicts(*, group, weekday, start_time, end_time,
                   teacher=None, room=None, effective_from=None, effective_to=None,
                   exclude_id=None) -> dict[str, list[ScheduleSlot]]:
    """Return conflicts grouped by the resource they involve."""
    effective_from = effective_from or timezone.localdate()
    queryset = ScheduleSlot.objects.filter(is_active=True).select_related("group", "teacher", "room")
    if exclude_id:
        queryset = queryset.exclude(pk=exclude_id)

    conflicts: dict[str, list[ScheduleSlot]] = {"group": [], "teacher": [], "room": []}
    for slot in queryset:
        if _overlaps(slot, weekday=weekday, start=start_time, end=end_time,
                     effective_from=effective_from, effective_to=effective_to):
            if slot.group_id == group.pk:
                conflicts["group"].append(slot)
            if teacher and (slot.teacher_id == teacher.pk or slot.group.teacher_id == teacher.pk):
                conflicts["teacher"].append(slot)
            if room and (slot.room_id == room.pk or slot.group.room_id == room.pk):
                conflicts["room"].append(slot)
    return conflicts


def _describe(slots: list[ScheduleSlot], limit: int = 3) -> str:
    return "; ".join(str(slot) for slot in slots[:limit])


def validate_slot(*, group, weekday, start_time, end_time, teacher=None, room=None,
                  effective_from=None, effective_to=None, exclude_id=None,
                  allow_capacity_override: bool = False) -> None:
    """Raise a field-mapped ValidationError if the slot cannot be created."""
    if end_time <= start_time:
        raise ValidationError({"end_time": "End time must be after the start time."})

    teacher = teacher or group.teacher
    room = room or group.room

    if room and not allow_capacity_override and group.student_count > room.capacity:
        raise ValidationError({
            "room": f"Group {group.name} has {group.student_count} students but room "
                    f"{room.name} holds {room.capacity}. Reduce the group or request an override."
        })

    conflicts = find_conflicts(
        group=group, weekday=weekday, start_time=start_time, end_time=end_time,
        teacher=teacher, room=room, effective_from=effective_from, effective_to=effective_to,
        exclude_id=exclude_id,
    )
    errors: dict[str, list[str]] = {}
    if conflicts["teacher"]:
        errors["teacher"] = [
            f"{teacher.full_name if teacher else 'Teacher'} is already teaching on "
            f"{dict(ScheduleSlot._meta.get_field('weekday').choices).get(weekday, weekday)}: "
            f"{_describe(conflicts['teacher'])}"
        ]
    if conflicts["room"]:
        errors["room"] = [
            f"Room {room.name if room else ''} is already occupied: {_describe(conflicts['room'])}"
        ]
    if conflicts["group"]:
        errors["group"] = [
            f"Group {group.name} already has a class in that window: {_describe(conflicts['group'])}"
        ]
    if errors:
        raise ValidationError(errors)


@transaction.atomic
def create_slot(*, group, weekday, start_time, end_time, teacher=None, room=None,
                effective_from=None, effective_to=None, note="", actor=None,
                allow_capacity_override: bool = False) -> ScheduleSlot:
    validate_slot(
        group=group, weekday=weekday, start_time=start_time, end_time=end_time,
        teacher=teacher, room=room, effective_from=effective_from, effective_to=effective_to,
        allow_capacity_override=allow_capacity_override,
    )
    slot = ScheduleSlot.objects.create(
        group=group, teacher=teacher, room=room, weekday=weekday,
        start_time=start_time, end_time=end_time,
        effective_from=effective_from or timezone.localdate(),
        effective_to=effective_to, note=note,
    )
    log_action(AuditLog.Action.CREATE, slot, actor=actor,
               new={"group": group.pk, "weekday": weekday,
                    "start": str(start_time), "end": str(end_time)},
               summary=f"Scheduled {slot}")
    return slot


@transaction.atomic
def update_slot(slot: ScheduleSlot, *, actor=None, allow_capacity_override: bool = False, **fields) -> ScheduleSlot:
    group = fields.get("group", slot.group)
    weekday = fields.get("weekday", slot.weekday)
    start_time = fields.get("start_time", slot.start_time)
    end_time = fields.get("end_time", slot.end_time)
    teacher = fields.get("teacher", slot.teacher)
    room = fields.get("room", slot.room)
    effective_from = fields.get("effective_from", slot.effective_from)
    effective_to = fields.get("effective_to", slot.effective_to)

    validate_slot(
        group=group, weekday=weekday, start_time=start_time, end_time=end_time,
        teacher=teacher, room=room, effective_from=effective_from, effective_to=effective_to,
        exclude_id=slot.pk, allow_capacity_override=allow_capacity_override,
    )
    before = {
        "group": slot.group_id, "weekday": slot.weekday,
        "start": str(slot.start_time), "end": str(slot.end_time),
        "teacher": slot.teacher_id, "room": slot.room_id,
    }
    for key, value in fields.items():
        setattr(slot, key, value)
    slot.save()
    log_action(AuditLog.Action.UPDATE, slot, actor=actor, old=before,
               new={"group": slot.group_id, "weekday": slot.weekday,
                    "start": str(slot.start_time), "end": str(slot.end_time),
                    "teacher": slot.teacher_id, "room": slot.room_id},
               summary=f"Updated schedule slot {slot}")
    return slot


def slots_on_date(day: date) -> list[ScheduleSlot]:
    """All active slots that occur on a concrete date."""
    weekday = day.weekday()
    queryset = (
        ScheduleSlot.objects.filter(weekday=weekday, is_active=True,
                                    effective_from__lte=day)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=day))
        .select_related("group", "group__course", "teacher", "room")
        .order_by("start_time")
    )
    return list(queryset)


def week_slots(week_start: date, *, teacher=None, room=None, group=None, course=None) -> list[ScheduleSlot]:
    week_end = week_start + __import__("datetime").timedelta(days=6)
    queryset = (
        ScheduleSlot.objects.filter(is_active=True, effective_from__lte=week_end)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=week_start))
        .select_related("group", "group__course", "teacher", "room")
    )
    if teacher:
        queryset = queryset.filter(Q(teacher=teacher) | Q(group__teacher=teacher))
    if room:
        queryset = queryset.filter(Q(room=room) | Q(group__room=room))
    if group:
        queryset = queryset.filter(group=group)
    if course:
        queryset = queryset.filter(group__course=course)
    return list(queryset.order_by("weekday", "start_time"))
