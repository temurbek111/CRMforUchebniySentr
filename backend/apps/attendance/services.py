"""Attendance services: fast marking, calculations, and absence detection.

Percentage definition (documented once, used everywhere):
    attended  = present + late
    counted   = every record that is not excused
    percentage = attended / counted * 100   (0 when nothing is counted)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.academics.models import Group, Student
from apps.core.audit import log_action
from apps.core.models import AuditLog, SystemSettings

from .models import (
    AbsenceReason,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    SessionState,
)

PERCENT = Decimal("0.01")


def _pct(numerator: int, denominator: int) -> Decimal:
    if not denominator:
        return Decimal("0.00")
    value = (Decimal(numerator) / Decimal(denominator)) * Decimal(100)
    return value.quantize(PERCENT, rounding=ROUND_HALF_UP)


def active_students(group: Group):
    return Student.objects.filter(
        group_memberships__group=group, group_memberships__left_at__isnull=True
    ).distinct()


def get_or_create_session(group: Group, session_date: date, *, slot=None, teacher=None, actor=None):
    """Idempotent session lookup: never creates a duplicate sheet for one class."""
    session = AttendanceSession.objects.filter(group=group, date=session_date, slot=slot).first()
    if session is None:
        session = AttendanceSession.objects.create(
            group=group, date=session_date, slot=slot,
            teacher=teacher or group.teacher, created_by=actor,
        )
        log_action(
            AuditLog.Action.CREATE, session, actor=actor,
            new={"group": group.pk, "date": str(session_date)},
            summary=f"Opened attendance for {group.name} on {session_date}",
        )
    return session


def session_payload(session: AttendanceSession) -> dict:
    """Everything the marking UI needs in one response: roster + current state."""
    records = {record.student_id: record for record in session.records.all()}
    roster = []
    for student in active_students(session.group).order_by("first_name", "last_name"):
        record = records.get(student.pk)
        roster.append({
            "student": student.pk,
            "student_name": student.full_name,
            "student_code": student.code,
            "photo": student.photo.url if student.photo else None,
            "status": record.status if record else None,
            "reason": record.reason if record else "",
            "note": record.note if record else "",
            "record_id": record.pk if record else None,
            "modified_by": (
                record.modified_by.full_name if record and record.modified_by_id else None
            ),
            "marked_at": record.marked_at if record else None,
        })
    stats = session_statistics(session)
    return {
        "session": {
            "id": session.pk,
            "group": session.group_id,
            "group_name": session.group.name,
            "date": session.date,
            "state": session.state,
            "submitted_at": session.submitted_at,
            "teacher": session.teacher.full_name if session.teacher else None,
        },
        "roster": roster,
        "statistics": stats,
        "statuses": [{"value": value, "label": label} for value, label in AttendanceStatus.choices],
        "reasons": [{"value": value, "label": label} for value, label in AbsenceReason.choices],
    }


@transaction.atomic
def mark_attendance(session: AttendanceSession, entries: list[dict], *, actor=None,
                    submit: bool = False) -> AttendanceSession:
    """Bulk upsert attendance for a session. Duplicate-safe by construction."""
    if not entries:
        raise ValidationError({"records": "No attendance entries were supplied."})

    valid_statuses = set(AttendanceStatus.values)
    roster_ids = set(active_students(session.group).values_list("pk", flat=True))
    now = timezone.now()
    updated = 0
    created = 0

    existing = {record.student_id: record for record in session.records.all()}
    to_create: list[AttendanceRecord] = []

    for entry in entries:
        student_id = entry.get("student")
        status = entry.get("status")
        if status not in valid_statuses:
            raise ValidationError({"status": f"Invalid attendance status {status!r}."})
        if student_id not in roster_ids:
            raise ValidationError(
                {"student": f"Student {student_id} is not an active member of {session.group.name}."}
            )
        reason = entry.get("reason") or ""
        if reason and reason not in set(AbsenceReason.values):
            raise ValidationError({"reason": f"Invalid absence reason {reason!r}."})
        if status in {AttendanceStatus.PRESENT, AttendanceStatus.LATE}:
            reason = ""

        record = existing.get(student_id)
        if record is None:
            to_create.append(AttendanceRecord(
                session=session, student_id=student_id, status=status, reason=reason,
                note=(entry.get("note") or "")[:255], marked_at=now, modified_by=actor,
            ))
        else:
            if (record.status, record.reason, record.note) != (status, reason, (entry.get("note") or record.note)[:255]):
                record.status = status
                record.reason = reason
                record.note = (entry.get("note") or "")[:255]
                record.marked_at = now
                record.modified_by = actor
                record.save(update_fields=["status", "reason", "note", "marked_at", "modified_by"])
                updated += 1

    if to_create:
        AttendanceRecord.objects.bulk_create(to_create, ignore_conflicts=True)
        created = len(to_create)

    if submit:
        session.state = SessionState.SUBMITTED
        session.submitted_at = now
        session.save(update_fields=["state", "submitted_at", "updated_at"])

    log_action(
        AuditLog.Action.UPDATE if updated else AuditLog.Action.CREATE, session, actor=actor,
        new={"created": created, "updated": updated, "submitted": submit},
        summary=(
            f"Attendance for {session.group.name} on {session.date}: "
            f"{created} marked, {updated} changed{' (submitted)' if submit else ''}"
        ),
    )
    return session


def mark_all_present(session: AttendanceSession, *, actor=None, submit: bool = False) -> AttendanceSession:
    entries = [{"student": pk, "status": AttendanceStatus.PRESENT}
               for pk in active_students(session.group).values_list("pk", flat=True)]
    return mark_attendance(session, entries, actor=actor, submit=submit)


def session_statistics(session: AttendanceSession) -> dict:
    counts = dict(
        session.records.values_list("status").annotate(total=Count("id")).values_list("status", "total")
    )
    present = counts.get(AttendanceStatus.PRESENT, 0)
    absent = counts.get(AttendanceStatus.ABSENT, 0)
    late = counts.get(AttendanceStatus.LATE, 0)
    excused = counts.get(AttendanceStatus.EXCUSED, 0)
    roster = active_students(session.group).count()
    counted = present + absent + late
    return {
        "roster": roster,
        "marked": sum(counts.values()),
        "unmarked": max(roster - sum(counts.values()), 0),
        "present": present,
        "absent": absent,
        "late": late,
        "excused": excused,
        "percentage": str(_pct(present + late, counted)),
    }


# --------------------------------------------------------------------------- #
# Student / group reporting
# --------------------------------------------------------------------------- #
def _records_for_student(student: Student, date_from=None, date_to=None):
    queryset = AttendanceRecord.objects.filter(student=student).select_related(
        "session", "session__group"
    )
    if date_from:
        queryset = queryset.filter(session__date__gte=date_from)
    if date_to:
        queryset = queryset.filter(session__date__lte=date_to)
    return queryset


def student_attendance_summary(student: Student, date_from=None, date_to=None) -> dict:
    records = list(_records_for_student(student, date_from, date_to))
    present = sum(1 for r in records if r.status == AttendanceStatus.PRESENT)
    absent = sum(1 for r in records if r.status == AttendanceStatus.ABSENT)
    late = sum(1 for r in records if r.status == AttendanceStatus.LATE)
    excused = sum(1 for r in records if r.status == AttendanceStatus.EXCUSED)
    counted = present + absent + late
    return {
        "total": len(records),
        "present": present,
        "absent": absent,
        "late": late,
        "excused": excused,
        "percentage": str(_pct(present + late, counted)),
    }


def student_attendance_detail(student: Student, date_from=None, date_to=None) -> dict:
    """Monthly breakdown plus per-session rows, for the profile table + calendar."""
    records = list(
        _records_for_student(student, date_from, date_to).order_by("-session__date")
    )
    monthly: dict[str, dict] = defaultdict(
        lambda: {"present": 0, "absent": 0, "late": 0, "excused": 0, "total": 0}
    )
    rows = []
    calendar: dict[str, str] = {}

    for record in records:
        key = record.session.date.strftime("%Y-%m")
        bucket = monthly[key]
        bucket[record.status] = bucket.get(record.status, 0) + 1
        bucket["total"] += 1
        calendar[record.session.date.isoformat()] = record.status
        rows.append({
            "id": record.pk,
            "date": record.session.date,
            "group": record.session.group.name,
            "status": record.status,
            "status_label": record.get_status_display(),
            "reason": record.reason,
            "note": record.note,
            "modified_by": record.modified_by.full_name if record.modified_by_id else None,
        })

    for key, bucket in monthly.items():
        bucket["percentage"] = str(_pct(bucket["present"] + bucket["late"],
                                        bucket["present"] + bucket["absent"] + bucket["late"]))

    summary = student_attendance_summary(student, date_from, date_to)
    return {
        "summary": summary,
        "monthly": dict(sorted(monthly.items(), reverse=True)),
        "records": rows,
        "calendar": calendar,
    }


def group_attendance_summary(group: Group, date_from=None, date_to=None) -> dict:
    """Group-level attendance including teacher submission status per date."""
    sessions = group.attendance_sessions.all()
    if date_from:
        sessions = sessions.filter(date__gte=date_from)
    if date_to:
        sessions = sessions.filter(date__lte=date_to)
    sessions = sessions.prefetch_related("records").order_by("-date")

    dates = []
    totals = {"present": 0, "absent": 0, "late": 0, "excused": 0}
    for session in sessions:
        stats = session_statistics(session)
        for key in totals:
            totals[key] += stats[key]
        dates.append({
            "session": session.pk,
            "date": session.date,
            "state": session.state,
            "teacher": session.teacher.full_name if session.teacher else None,
            "submitted_at": session.submitted_at,
            "marked": stats["marked"],
            "unmarked": stats["unmarked"],
            "present": stats["present"],
            "absent": stats["absent"],
            "late": stats["late"],
            "excused": stats["excused"],
            "percentage": stats["percentage"],
        })

    counted = totals["present"] + totals["absent"] + totals["late"]
    return {
        "group": group.pk,
        "group_name": group.name,
        "sessions": dates,
        "totals": totals | {"percentage": str(_pct(totals["present"] + totals["late"], counted))},
        "students": _per_student_breakdown(group, date_from, date_to),
    }


def _per_student_breakdown(group: Group, date_from=None, date_to=None) -> list[dict]:
    """One aggregate query for the whole group - no per-student queries (N+1 safe)."""
    records = AttendanceRecord.objects.filter(session__group=group)
    if date_from:
        records = records.filter(session__date__gte=date_from)
    if date_to:
        records = records.filter(session__date__lte=date_to)
    aggregates = records.values("student", "student__first_name", "student__last_name", "student__code").annotate(
        present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
        absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
        late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
        excused=Count("id", filter=Q(status=AttendanceStatus.EXCUSED)),
    )
    out = []
    for row in aggregates:
        counted = row["present"] + row["absent"] + row["late"]
        out.append({
            "student": row["student"],
            "student_name": f"{row['student__first_name']} {row['student__last_name']}",
            "student_code": row["student__code"],
            "present": row["present"],
            "absent": row["absent"],
            "late": row["late"],
            "excused": row["excused"],
            "percentage": str(_pct(row["present"] + row["late"], counted)),
        })
    out.sort(key=lambda item: item["percentage"])
    return out


def daily_totals(day: date) -> dict:
    """Present/absent/late/excused across the whole centre for one date."""
    records = AttendanceRecord.objects.filter(session__date=day)
    counts = dict(records.values_list("status").annotate(total=Count("id")).values_list("status", "total"))
    present = counts.get(AttendanceStatus.PRESENT, 0)
    absent = counts.get(AttendanceStatus.ABSENT, 0)
    late = counts.get(AttendanceStatus.LATE, 0)
    excused = counts.get(AttendanceStatus.EXCUSED, 0)
    counted = present + absent + late
    return {
        "date": day,
        "present": present,
        "absent": absent,
        "late": late,
        "excused": excused,
        "marked": present + absent + late + excused,
        "percentage": str(_pct(present + late, counted)),
    }


def centre_attendance_summary(date_from=None, date_to=None) -> dict:
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to - timedelta(days=29)
    records = AttendanceRecord.objects.filter(session__date__range=(date_from, date_to))
    counts = dict(records.values_list("status").annotate(total=Count("id")).values_list("status", "total"))
    present = counts.get(AttendanceStatus.PRESENT, 0)
    absent = counts.get(AttendanceStatus.ABSENT, 0)
    late = counts.get(AttendanceStatus.LATE, 0)
    excused = counts.get(AttendanceStatus.EXCUSED, 0)
    counted = present + absent + late
    return {
        "from": date_from, "to": date_to,
        "present": present, "absent": absent, "late": late, "excused": excused,
        "percentage": str(_pct(present + late, counted)),
    }


def incomplete_sessions(day: date | None = None) -> list[dict]:
    """Groups that had a class but no attendance sheet, or an unsubmitted one."""
    day = day or timezone.localdate()
    from apps.schedule.services import slots_on_date

    incomplete = []
    for slot in slots_on_date(day):
        session = AttendanceSession.objects.filter(group=slot.group, date=day, slot=slot).first()
        if session is None:
            incomplete.append({
                "group": slot.group_id, "group_name": slot.group.name, "date": day,
                "state": "missing", "time": slot.start_time.strftime("%H:%M"),
            })
        elif session.state != SessionState.SUBMITTED:
            incomplete.append({
                "group": slot.group_id, "group_name": slot.group.name, "date": day,
                "state": "not_submitted", "time": slot.start_time.strftime("%H:%M"),
            })
    return incomplete


def students_with_repeated_absences(date_from=None, date_to=None) -> list[dict]:
    """Absence-based watch list, thresholds taken from SystemSettings."""
    settings_obj = SystemSettings.get_solo()
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to.replace(day=1)
    threshold = settings_obj.absence_alert_count
    streak_threshold = settings_obj.absence_streak_alert_count

    rows = (
        AttendanceRecord.objects.filter(
            session__date__range=(date_from, date_to), status=AttendanceStatus.ABSENT
        )
        .values("student", "student__first_name", "student__last_name", "student__code")
        .annotate(absences=Count("id"))
        .filter(absences__gte=threshold)
        .order_by("-absences")
    )

    alerts = []
    for row in rows:
        streak = _current_absence_streak(row["student"], date_from, date_to)
        alerts.append({
            "student": row["student"],
            "student_name": f"{row['student__first_name']} {row['student__last_name']}",
            "student_code": row["student__code"],
            "absences": row["absences"],
            "streak": streak,
            "reason": "streak" if streak >= streak_threshold else "count",
            "from": date_from,
            "to": date_to,
        })
    return alerts


def _current_absence_streak(student_id: int, date_from: date, date_to: date) -> int:
    records = (
        AttendanceRecord.objects.filter(
            student_id=student_id, session__date__range=(date_from, date_to)
        )
        .order_by("-session__date")
        .values_list("status", flat=True)
    )
    streak = 0
    for status in records:
        if status == AttendanceStatus.ABSENT:
            streak += 1
        else:
            break
    return streak
