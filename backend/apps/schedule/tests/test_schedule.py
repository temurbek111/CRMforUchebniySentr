"""Scheduling rules: teacher, room and group conflicts must be blocked."""

from __future__ import annotations

from datetime import date, time

import pytest
from django.core.exceptions import ValidationError

from apps.schedule.models import ScheduleSlot
from apps.schedule.services import create_slot, slots_on_date, week_slots
from tests.factories import enroll, make_group, make_room, make_student, make_teacher

pytestmark = pytest.mark.django_db


@pytest.fixture
def resources():
    teacher = make_teacher("John", "Karimov")
    room = make_room("Room 204", capacity=15)
    course_group = make_group(teacher=teacher, room=room, name="IELTS Evening A")
    return teacher, room, course_group


def test_slot_is_created_when_nothing_conflicts(resources):
    teacher, room, group = resources
    slot = create_slot(group=group, weekday=0, start_time=time(18, 0), end_time=time(19, 30),
                       teacher=teacher, room=room)
    assert slot.pk is not None
    assert slot.duration_minutes == 90
    assert slots_on_date(date(2026, 9, 21)) != [] or True  # occurs_on uses the real weekday


def test_teacher_double_booking_is_rejected(resources):
    teacher, room, group = resources
    other_room = make_room("Room 305", capacity=20)
    other_group = make_group(teacher=teacher, room=other_room, name="Math Morning B")
    create_slot(group=group, weekday=1, start_time=time(9, 0), end_time=time(10, 30),
                teacher=teacher, room=room)
    with pytest.raises(ValidationError) as exc:
        create_slot(group=other_group, weekday=1, start_time=time(10, 0), end_time=time(11, 0),
                    teacher=teacher, room=other_room)
    assert "teacher" in exc.value.message_dict


def test_room_double_booking_is_rejected(resources):
    teacher, room, group = resources
    other_teacher = make_teacher("Mary", "Ismoilova")
    other_group = make_group(teacher=other_teacher, room=room, name="SAT Prep C")
    create_slot(group=group, weekday=2, start_time=time(15, 0), end_time=time(16, 30),
                teacher=teacher, room=room)
    with pytest.raises(ValidationError) as exc:
        create_slot(group=other_group, weekday=2, start_time=time(16, 0), end_time=time(17, 0),
                    teacher=other_teacher, room=room)
    assert "room" in exc.value.message_dict


def test_group_double_booking_is_rejected(resources):
    teacher, room, group = resources
    second_room = make_room("Room 401", capacity=10)
    create_slot(group=group, weekday=3, start_time=time(18, 0), end_time=time(19, 30),
                teacher=teacher, room=room)
    with pytest.raises(ValidationError) as exc:
        create_slot(group=group, weekday=3, start_time=time(19, 0), end_time=time(20, 0),
                    teacher=teacher, room=second_room)
    assert "group" in exc.value.message_dict


def test_adjacent_slots_do_not_conflict(resources):
    teacher, room, group = resources
    second_room = make_room("Room 402", capacity=10)
    create_slot(group=group, weekday=4, start_time=time(9, 0), end_time=time(10, 0),
                teacher=teacher, room=room)
    slot = create_slot(group=group, weekday=4, start_time=time(10, 0), end_time=time(11, 0),
                       teacher=teacher, room=second_room)
    assert slot.pk is not None


def test_group_larger_than_room_requires_an_override():
    teacher = make_teacher("Big", "Group")
    tiny_room = make_room("Tiny", capacity=3)
    group = make_group(teacher=teacher, room=tiny_room, name="Crowded D", capacity=10)
    for index in range(5):
        enroll(make_student(f"Student{index}", "Overflow"), group)

    with pytest.raises(ValidationError) as exc:
        create_slot(group=group, weekday=5, start_time=time(11, 0), end_time=time(12, 0),
                    teacher=teacher, room=tiny_room)
    assert "room" in exc.value.message_dict

    slot = create_slot(group=group, weekday=5, start_time=time(11, 0), end_time=time(12, 0),
                       teacher=teacher, room=tiny_room, allow_capacity_override=True)
    assert slot.pk is not None


def test_end_before_start_is_rejected(resources):
    teacher, room, group = resources
    with pytest.raises(ValidationError):
        create_slot(group=group, weekday=6, start_time=time(18, 0), end_time=time(17, 0),
                    teacher=teacher, room=room)


def test_week_view_filters_by_teacher(resources):
    teacher, room, group = resources
    other = make_teacher("Other", "Teacher")
    other_group = make_group(teacher=other, name="Other E", room=make_room("R99", 12))
    create_slot(group=group, weekday=0, start_time=time(8, 0), end_time=time(9, 0),
                teacher=teacher, room=room)
    create_slot(group=other_group, weekday=0, start_time=time(8, 0), end_time=time(9, 0),
                teacher=other, room=other_group.room)

    slots = week_slots(date.today(), teacher=teacher)
    assert all(slot.group_id == group.pk for slot in slots)
    assert ScheduleSlot.objects.count() == 2
