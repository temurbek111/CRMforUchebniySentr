"""Shared test factories.

Small, explicit builders keep tests readable and avoid a factory-library
dependency (plan section 11).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from apps.accounts.models import Role, User
from apps.academics.models import Course, Group, GroupMembership, Room, Student, Teacher
from apps.attendance.models import AttendanceRecord, AttendanceSession, AttendanceStatus


def make_user(username: str, role_code: str | None = None, *, password: str = "TestPass123!",
              is_superuser: bool = False, **extra) -> User:
    role = None
    if role_code:
        role, _ = Role.objects.get_or_create(
            code=role_code, defaults={"name": role_code.replace("_", " ").title()}
        )
    user = User(username=username, role=role, is_superuser=is_superuser,
                first_name=extra.pop("first_name", username.title()),
                last_name=extra.pop("last_name", "Test"), **extra)
    user.set_password(password)
    user.save()
    return user


def make_course(code: str = "ENG", name: str = "English", fee: str = "1200000") -> Course:
    """Courses are shared reference data: reuse the row instead of colliding on code."""
    course, _ = Course.objects.get_or_create(
        code=code,
        defaults={"name": name, "default_monthly_fee": Decimal(fee), "level": "A2"},
    )
    return course


def make_room(name: str = "Room 204", capacity: int = 15) -> Room:
    room, _ = Room.objects.get_or_create(
        name=name, defaults={"capacity": capacity, "location": "Floor 2"}
    )
    return room


def make_teacher(first_name: str = "John", last_name: str = "Karimov", *, user=None) -> Teacher:
    return Teacher.objects.create(first_name=first_name, last_name=last_name,
                                 phone="+998901112233", user=user,
                                 specialization="IELTS")


def make_group(course: Course | None = None, teacher: Teacher | None = None,
               room: Room | None = None, *, name: str = "IELTS Evening A",
               fee: str = "1200000", capacity: int = 15) -> Group:
    return Group.objects.create(
        name=name, course=course or make_course(), teacher=teacher or make_teacher(),
        room=room or make_room(), capacity=capacity, monthly_fee=Decimal(fee), level="B1",
    )


def make_student(first_name: str = "Ali", last_name: str = "Karimov", *,
                 phone: str = "+998901234567", fee: str | None = None, **extra) -> Student:
    return Student.objects.create(
        first_name=first_name, last_name=last_name, phone=phone,
        monthly_fee_override=Decimal(fee) if fee else None, **extra
    )


def enroll(student: Student, group: Group, *, fee: str | None = None) -> GroupMembership:
    return GroupMembership.objects.create(
        student=student, group=group, monthly_fee=Decimal(fee) if fee else None
    )


def make_session(group: Group, day: date | None = None, *, teacher: Teacher | None = None,
                 submit: bool = False) -> AttendanceSession:
    return AttendanceSession.objects.create(
        group=group, date=day or date.today(), teacher=teacher or group.teacher,
        state="submitted" if submit else "open",
    )


def mark(session: AttendanceSession, student: Student, status: str = AttendanceStatus.PRESENT,
         reason: str = "") -> AttendanceRecord:
    return AttendanceRecord.objects.create(session=session, student=student,
                                           status=status, reason=reason)


def month_start(offset_months: int = 0) -> date:
    today = date.today().replace(day=1)
    month = today.month - offset_months
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def days_ago(days: int) -> date:
    return date.today() - timedelta(days=days)
