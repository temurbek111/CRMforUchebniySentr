"""Management layer: dashboard, alerts, at-risk detection, reports, search.

Every figure here is aggregated from the database. Nothing is hard-coded, and
no indicator is reported without its underlying evidence (plan sections
5, 15, 31, 34, 35, 42, 54).
"""

from __future__ import annotations

import csv
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

from django.db.models import Avg, Count, F, Q, Sum
from django.utils import timezone

from apps.academics.models import Course, Group, Student, Teacher
from apps.attendance.models import AttendanceRecord, AttendanceSession, AttendanceStatus
from apps.attendance.services import (
    centre_attendance_summary,
    daily_totals,
    incomplete_sessions,
    students_with_repeated_absences,
)
from apps.core.models import Notification, SystemSettings
from apps.core.money import ZERO, quantize
from apps.finance.services import (
    expense_breakdown,
    finance_summary,
    group_billing_summary,
    income_breakdown,
    monthly_financial_series,
    monthly_financial_summary,
    outstanding_receivables,
    payment_status_breakdown,
    payroll_payable,
    recent_payments,
    revenue_by_course,
    todays_collections,
)

# --------------------------------------------------------------------------- #
# Alerts (actionable, deduplicated)
# --------------------------------------------------------------------------- #
def alert_scope_for(user) -> dict:
    """Scope kwargs for alerts and at-risk lists, based on the caller's role.

    A teacher sees only their own groups and students; every other role sees the
    whole centre. This is the single place that decides it (plan section 46).
    """
    from apps.accounts.rbac import Perm, effective_permissions

    granted = effective_permissions(user) if user is not None else frozenset()
    scope = {
        "allowed_student_ids": None,
        "allowed_group_ids": None,
        "include_finance": Perm.FINANCE_VIEW in granted or Perm.REPORTS_FINANCE in granted,
        "include_receivables": Perm.INVOICES_VIEW in granted,
        "include_payroll": Perm.PAYROLL_VIEW in granted,
    }
    if user is not None and getattr(user, "role_code", None) == "teacher":
        teacher = getattr(user, "teacher_profile", None)
        if teacher is None:
            scope |= {"allowed_student_ids": set(), "allowed_group_ids": set()}
            return scope
        scope["allowed_group_ids"] = set(
            Group.objects.filter(teacher=teacher).values_list("pk", flat=True)
        )
        scope["allowed_student_ids"] = set(
            Student.objects.filter(
                group_memberships__group__teacher=teacher,
                group_memberships__left_at__isnull=True,
            ).values_list("pk", flat=True)
        )
    return scope


def build_alerts(*, allowed_student_ids=None, allowed_group_ids=None,
                 include_finance: bool = True, include_receivables: bool = True,
                 include_payroll: bool = True) -> list[dict]:
    """Everything that requires attention now, each pointing at a real record.

    ``allowed_*`` narrows the lists for roles that may not see the whole centre.
    """
    settings_obj = SystemSettings.get_solo()
    today = timezone.localdate()
    alerts: list[dict] = []

    def student_allowed(student_id) -> bool:
        return allowed_student_ids is None or student_id in allowed_student_ids

    def group_allowed(group_id) -> bool:
        return allowed_group_ids is None or group_id in allowed_group_ids

    if include_receivables:
        receivables = outstanding_receivables()
        if receivables["overdue_count"]:
            alerts.append({
                "key": "overdue_payments",
                "kind": Notification.Kind.PAYMENT_OVERDUE,
                "severity": "critical" if Decimal(receivables["overdue_amount"]) > ZERO else "warning",
                "title": f"{receivables['overdue_count']} overdue payment"
                         f"{'s' if receivables['overdue_count'] != 1 else ''}",
                "body": f"{receivables['overdue_amount']} outstanding past the due date",
                "link": "/payments?overdue=1",
                "count": receivables["overdue_count"],
                "payload": {"amount": receivables["overdue_amount"], "buckets": receivables["buckets"]},
            })

    absences = [
        row for row in students_with_repeated_absences(date_from=today.replace(day=1), date_to=today)
        if student_allowed(row["student"])
    ]
    if absences:
        alerts.append({
            "key": "repeated_absences",
            "kind": Notification.Kind.ATTENDANCE_WARNING,
            "severity": "warning",
            "title": f"{len(absences)} student{'s' if len(absences) != 1 else ''} with repeated absences",
            "body": f"{settings_obj.absence_alert_count}+ absences this month",
            "link": "/attendance?tab=absences",
            "count": len(absences),
            "payload": {"students": absences[:10]},
        })

    incomplete = [row for row in incomplete_sessions(today) if group_allowed(row["group"])]
    if incomplete:
        alerts.append({
            "key": "incomplete_attendance",
            "kind": Notification.Kind.ATTENDANCE_INCOMPLETE,
            "severity": "warning",
            "title": f"{len(incomplete)} attendance sheet"
                     f"{'s' if len(incomplete) != 1 else ''} incomplete",
            "body": "Classes today without a submitted attendance sheet",
            "link": "/attendance?tab=incomplete",
            "count": len(incomplete),
            "payload": {"sessions": incomplete},
        })

    failing = [row for row in students_below_passing(reference_date=today)
               if student_allowed(row["student"])]
    if failing:
        alerts.append({
            "key": "failing_exams",
            "kind": Notification.Kind.EXAM_RESULT,
            "severity": "warning",
            "title": f"{len(failing)} student{'s' if len(failing) != 1 else ''} below the passing score",
            "body": "Latest exam results under the configured passing score",
            "link": "/results?below_passing=1",
            "count": len(failing),
            "payload": {"students": failing[:10]},
        })

    declining = [row for row in declining_groups() if group_allowed(row["group"])]
    if declining:
        alerts.append({
            "key": "declining_groups",
            "kind": Notification.Kind.EXAM_RESULT,
            "severity": "info",
            "title": f"{len(declining)} group{'s' if len(declining) != 1 else ''} with declining results",
            "body": "Average exam score dropped against the previous period",
            "link": "/progress?trend=declining",
            "count": len(declining),
            "payload": {"groups": declining[:10]},
        })

    if include_payroll:
        try:
            from apps.payroll.services import pending_payroll_runs

            awaiting = [run for run in pending_payroll_runs() if run["status"] == "calculated"]
            if awaiting:
                alerts.append({
                    "key": "payroll_pending",
                    "kind": Notification.Kind.PAYROLL_PENDING,
                    "severity": "warning",
                    "title": f"{len(awaiting)} payroll run awaiting approval",
                    "body": ", ".join(run["label"] for run in awaiting[:3]),
                    "link": "/payroll?status=calculated",
                    "count": len(awaiting),
                    "payload": {"runs": awaiting},
                })
        except Exception:  # pragma: no cover - payroll optional at import time
            pass

    upcoming = [exam for exam in upcoming_exams(7) if group_allowed(exam["group"])]
    if upcoming:
        alerts.append({
            "key": "upcoming_exams",
            "kind": Notification.Kind.EXAM_SCHEDULED,
            "severity": "info",
            "title": f"{len(upcoming)} exam{'s' if len(upcoming) != 1 else ''} in the next 7 days",
            "body": ", ".join(f"{exam['name']} ({exam['date']})" for exam in upcoming[:3]),
            "link": "/exams?upcoming=1",
            "count": len(upcoming),
            "payload": {"exams": upcoming},
        })

    return alerts


def sync_notifications(actor=None) -> dict:
    """Materialise alerts into the notification centre without duplicating them."""
    from apps.core.audit import json_safe

    created, existing = 0, 0
    today = timezone.localdate()
    for alert in build_alerts():
        dedupe_key = f"{alert['key']}:{today.isoformat()}"
        _, was_created = Notification.objects.get_or_create(
            dedupe_key=dedupe_key,
            defaults={
                "kind": alert["kind"], "severity": alert["severity"],
                "title": alert["title"], "body": alert["body"], "link": alert["link"],
                # Payloads may contain dates or Decimals from the reporting layer;
                # the JSON column only accepts JSON-native values.
                "payload": json_safe(alert.get("payload", {})),
            },
        )
        created += 1 if was_created else 0
        existing += 0 if was_created else 1
    return {"created": created, "already_present": existing, "date": today}


# --------------------------------------------------------------------------- #
# At-risk students (evidence-based)
# --------------------------------------------------------------------------- #
def at_risk_students(limit: int = 50, restrict_student_ids=None) -> list[dict]:
    """Students flagged by objective rules, always with the reasons attached.

    ``restrict_student_ids`` narrows the scan for roles (teachers) who may only
    see their own students.
    """
    settings_obj = SystemSettings.get_solo()
    threshold = Decimal(settings_obj.attendance_threshold_pct)
    today = timezone.localdate()
    window_start = today - timedelta(days=30)
    month_start = today.replace(day=1)

    attendance_rows = (
        AttendanceRecord.objects.filter(session__date__range=(window_start, today))
        .values("student")
        .annotate(
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
        )
    )
    attendance_map = {}
    for row in attendance_rows:
        counted = row["present"] + row["absent"] + row["late"]
        pct = (
            (Decimal(row["present"] + row["late"]) / Decimal(counted) * Decimal(100)).quantize(
                Decimal("0.01")
            )
            if counted else None
        )
        attendance_map[row["student"]] = {
            "percentage": pct, "absences": row["absent"], "present": row["present"],
            "late": row["late"], "counted": counted,
        }

    month_absences = dict(
        AttendanceRecord.objects.filter(
            session__date__range=(month_start, today), status=AttendanceStatus.ABSENT
        )
        .values_list("student")
        .annotate(total=Count("id"))
        .values_list("student", "total")
    )

    overdue_map = {}
    for invoice in StudentInvoice_overdue():
        overdue_map[invoice.student_id] = {
            "days": invoice.days_overdue, "amount": str(invoice.remaining),
        }

    failed_map, trend_map = _exam_risk_signals()

    results = []
    students = Student.objects.filter(status="active").select_related("guardian")
    if restrict_student_ids is not None:
        students = students.filter(pk__in=restrict_student_ids)
    for student in students:
        reasons = []
        attendance = attendance_map.get(student.pk)
        if attendance and attendance["percentage"] is not None and attendance["percentage"] < threshold:
            reasons.append({
                "code": "low_attendance",
                "label": f"Attendance {attendance['percentage']}% below the {threshold}% threshold",
            })
        absences = month_absences.get(student.pk, 0)
        if absences >= settings_obj.absence_alert_count:
            reasons.append({"code": "repeated_absences", "label": f"{absences} absences this month"})
        overdue = overdue_map.get(student.pk)
        if overdue:
            reasons.append({
                "code": "overdue_payment",
                "label": f"Payment overdue by {overdue['days']} day(s) ({overdue['amount']})",
            })
        failed = failed_map.get(student.pk, 0)
        if failed >= settings_obj.failing_exam_alert_count:
            reasons.append({"code": "failing_exams", "label": f"{failed} recent exam(s) below passing"})
        trend = trend_map.get(student.pk)
        if trend == "declining":
            reasons.append({"code": "declining_performance", "label": "Exam results declining"})

        if reasons:
            severity = "critical" if len(reasons) >= 3 else "warning" if len(reasons) == 2 else "info"
            results.append({
                "student": student.pk,
                "student_name": student.full_name,
                "student_code": student.code,
                "status": student.status,
                "attendance_pct": str(attendance["percentage"]) if attendance and attendance["percentage"] is not None else None,
                "absences_this_month": absences,
                "overdue": overdue,
                "failed_exams": failed,
                "trend": trend,
                "severity": severity,
                "reasons": reasons,
                "link": f"/students/{student.pk}",
            })

    results.sort(key=lambda row: (-len(row["reasons"]), row["student_name"]))
    return results[:limit]


def student_at_risk(student: Student) -> dict:
    """Same rules, scoped to one student (used on the profile page)."""
    for row in at_risk_students(limit=1000):
        if row["student"] == student.pk:
            return row
    return {
        "student": student.pk, "student_name": student.full_name, "student_code": student.code,
        "severity": "ok", "reasons": [], "link": f"/students/{student.pk}",
    }


def StudentInvoice_overdue():
    from apps.finance.models import InvoiceStatus, StudentInvoice

    return (
        StudentInvoice.objects.filter(due_date__lt=timezone.localdate())
        .exclude(status__in=[InvoiceStatus.PAID, InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED])
        .select_related("student")
        .order_by("due_date")
    )


def _exam_risk_signals() -> tuple[dict, dict]:
    """Failed-exam counts and performance trends per student (two queries)."""
    try:
        from apps.exams.models import Exam, ExamResult
    except Exception:  # pragma: no cover - exams app optional at import time
        return {}, {}

    window_start = timezone.localdate() - timedelta(days=90)
    results = (
        ExamResult.objects.filter(exam__date__gte=window_start, percentage__isnull=False)
        .values("student", "percentage", "exam__date", "exam__passing_score", "exam__max_score")
        .order_by("exam__date")
    )
    failed: dict[int, int] = {}
    history: dict[int, list[Decimal]] = {}
    for row in results:
        passing_pct = (
            (Decimal(row["exam__passing_score"]) / Decimal(row["exam__max_score"]) * Decimal(100))
            if row["exam__max_score"] else Decimal("60")
        )
        if row["percentage"] < passing_pct:
            failed[row["student"]] = failed.get(row["student"], 0) + 1
        history.setdefault(row["student"], []).append(row["percentage"])

    trends = {student: _trend(values) for student, values in history.items()}
    return failed, trends


def _trend(values: list[Decimal]) -> str:
    if len(values) < 2:
        return "insufficient_data"
    midpoint = max(len(values) // 2, 1)
    earlier = values[:midpoint]
    later = values[midpoint:] or values[-1:]
    delta = (sum(later) / len(later)) - (sum(earlier) / len(earlier))
    if delta >= Decimal("5"):
        return "improving"
    if delta <= Decimal("-5"):
        return "declining"
    return "stable"


def students_below_passing(reference_date: date | None = None, limit: int = 50) -> list[dict]:
    """Students whose most recent exam result is under the passing score."""
    try:
        from apps.exams.models import ExamResult
    except Exception:  # pragma: no cover
        return []

    reference_date = reference_date or timezone.localdate()
    rows = (
        ExamResult.objects.filter(percentage__isnull=False, exam__date__lte=reference_date)
        .select_related("student", "exam")
        .order_by("student_id", "-exam__date", "-id")
    )
    latest: dict[int, ExamResult] = {}
    for result in rows:
        latest.setdefault(result.student_id, result)

    out = []
    for result in latest.values():
        passing_pct = (
            (Decimal(result.exam.passing_score) / Decimal(result.exam.max_score) * Decimal(100))
            if result.exam.max_score else Decimal("60")
        )
        if result.percentage < passing_pct:
            out.append({
                "student": result.student_id,
                "student_name": result.student.full_name,
                "student_code": result.student.code,
                "exam": result.exam_id,
                "exam_name": result.exam.name,
                "date": result.exam.date,
                "percentage": str(result.percentage),
                "passing_percentage": str(quantize(passing_pct)),
                "link": f"/students/{result.student_id}",
            })
    out.sort(key=lambda row: Decimal(row["percentage"]))
    return out[:limit]


def declining_groups(lookback_days: int = 60) -> list[dict]:
    try:
        from apps.exams.models import Exam
    except Exception:  # pragma: no cover
        return []

    cutoff = timezone.localdate() - timedelta(days=lookback_days)
    rows = (
        Exam.objects.filter(date__gte=cutoff)
        .values("group_id", "group__name", "date")
        .annotate(average=Avg("results__percentage"), results=Count("results"))
        .filter(results__gt=0)
        .order_by("group_id", "date")
    )
    grouped: dict[int, dict] = {}
    for row in rows:
        entry = grouped.setdefault(row["group_id"], {"group": row["group_id"],
                                                    "group_name": row["group__name"],
                                                    "points": []})
        entry["points"].append(row["average"])
    out = []
    for entry in grouped.values():
        if len(entry["points"]) < 2:
            continue
        delta = entry["points"][-1] - entry["points"][0]
        if delta <= Decimal("-2"):
            out.append({
                "group": entry["group"], "group_name": entry["group_name"],
                "first_average": str(quantize(entry["points"][0])),
                "last_average": str(quantize(entry["points"][-1])),
                "delta": str(quantize(delta)),
                "trend": "declining",
                "link": f"/groups/{entry['group']}",
            })
    out.sort(key=lambda row: Decimal(row["delta"]))
    return out


def upcoming_exams(days: int = 7) -> list[dict]:
    try:
        from apps.exams.models import Exam
    except Exception:  # pragma: no cover
        return []

    today = timezone.localdate()
    exams = (
        Exam.objects.filter(date__gte=today, date__lte=today + timedelta(days=days))
        .select_related("group", "course")
        .order_by("date")
    )
    return [
        {
            "id": exam.pk, "name": exam.name, "date": exam.date, "type": exam.exam_type,
            "group": exam.group_id, "group_name": exam.group.name if exam.group else "",
            "course": exam.course.name if exam.course else "",
            "link": f"/exams/{exam.pk}",
        }
        for exam in exams
    ]


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
def dashboard_payload(user=None) -> dict:
    """The centre's current state, ordered by what needs attention first.

    The payload is shaped by the caller's permissions: a teacher receives no
    financial or CRM figures and no money-related alerts, so the dashboard can
    never become a side door around the finance endpoints (plan section 46).
    """
    scope = alert_scope_for(user)
    may_see_finance = scope["include_finance"]
    may_see_receivables = scope["include_receivables"]
    may_see_payroll = scope["include_payroll"]
    may_see_crm = scope["allowed_student_ids"] is None or user is None or \
        getattr(user, "role_code", None) != "teacher"

    settings_obj = SystemSettings.get_solo()
    today = timezone.localdate()
    month_start = today.replace(day=1)
    previous_month_end = month_start - timedelta(days=1)
    previous_month_start = previous_month_end.replace(day=1)

    active_students = Student.objects.filter(status="active").count()
    new_this_month = Student.objects.filter(registered_at__gte=month_start).count()
    left_this_month = Student.objects.filter(
        left_at__gte=month_start
    ).exclude(status="active").count()
    previous_new = Student.objects.filter(
        registered_at__range=(previous_month_start, previous_month_end)
    ).count()

    attendance_today = daily_totals(today)
    attendance_month = centre_attendance_summary(month_start, today)

    finance_month = finance_summary(month_start, today) if may_see_finance else None
    previous_finance = finance_summary(previous_month_start, previous_month_end) \
        if may_see_finance else None
    collections_today = todays_collections(today) if may_see_finance else None

    academic = academic_summary(month_start, today)
    leads = lead_summary(month_start, today) if may_see_crm else None

    alerts = build_alerts(
        allowed_student_ids=scope["allowed_student_ids"],
        allowed_group_ids=scope["allowed_group_ids"],
        include_finance=may_see_finance,
        include_receivables=may_see_receivables,
        include_payroll=may_see_payroll,
    )

    finance_block = None
    if may_see_finance:
        finance_block = {
            "income_month": finance_month["gross_income"],
            "expenses_month": finance_month["total_expenses"],
            "net_month": finance_month["net_result"],
            "student_fees_month": finance_month["student_fees"],
            "other_income_month": finance_month["other_income"],
            "payroll_month": finance_month["payroll"] if may_see_payroll else None,
            "outstanding": finance_month["outstanding"] if may_see_receivables else None,
            "overdue_count": finance_month["overdue_count"] if may_see_receivables else None,
            "payroll_payable": str(quantize(payroll_payable())) if may_see_payroll else None,
            "collected_today": str(quantize(collections_today)),
            "net_previous_month": previous_finance["net_result"],
            "net_change_pct": _pct_change(
                Decimal(finance_month["net_result"]), Decimal(previous_finance["net_result"])
            ),
        }

    widgets = {
        "attendance_today": attendance_today,
        "todays_schedule": schedule_today(),
        "upcoming_schedule": upcoming_schedule(7),
    }
    if may_see_finance:
        widgets |= {
            "financial_series": monthly_financial_series(today.year),
            "financial_month": monthly_financial_summary(today.year, today.month),
        }
    if may_see_receivables:
        widgets |= {
            "payment_status": payment_status_breakdown(month_start),
            "recent_payments": recent_payments(8),
        }
    if may_see_crm:
        widgets |= {"leads_by_source": leads["by_source"]}

    return {
        "generated_at": timezone.now(),
        "date": today,
        "centre": {
            "name": settings_obj.centre_name,
            "currency": settings_obj.currency_code,
            "currency_symbol": settings_obj.currency_symbol,
            "currency_decimals": settings_obj.currency_decimals,
        },
        "kpis": {
            "students": {
                "total": Student.objects.exclude(status="archived").count(),
                "active": active_students,
                "new_this_month": new_this_month,
                "left_this_month": left_this_month,
                "new_previous_month": previous_new,
                "new_change_pct": _pct_change(new_this_month, previous_new),
            },
            "attendance": {"today": attendance_today, "month": attendance_month},
            "finance": finance_block,
            "academic": academic,
            "crm": leads,
        },
        "widgets": widgets,
        "alerts": alerts,
        "at_risk": at_risk_students(limit=8, restrict_student_ids=scope["allowed_student_ids"]),
        "permissions": {
            "finance": may_see_finance,
            "receivables": may_see_receivables,
            "payroll": may_see_payroll,
            "crm": may_see_crm,
        },
    }


def schedule_today() -> list[dict]:
    from apps.schedule.services import slots_on_date
    from apps.attendance.models import AttendanceSession, SessionState

    slots = slots_on_date(timezone.localdate())
    outstanding = {
        session.group_id
        for session in AttendanceSession.objects.filter(date=timezone.localdate())
        .exclude(state=SessionState.SUBMITTED)
    }
    return [
        {
            "id": slot.pk,
            "group": slot.group_id,
            "group_name": slot.group.name,
            "teacher": slot.effective_teacher.full_name if slot.effective_teacher else "",
            "room": slot.effective_room.name if slot.effective_room else "",
            "start_time": slot.start_time.strftime("%H:%M"),
            "end_time": slot.end_time.strftime("%H:%M"),
            "students": slot.group.student_count,
            "attendance_pending": slot.group_id in outstanding,
            "link": f"/attendance?group={slot.group_id}&date={timezone.localdate().isoformat()}",
        }
        for slot in slots
    ]


def upcoming_schedule(days: int = 7) -> list[dict]:
    from apps.schedule.services import slots_on_date

    today = timezone.localdate()
    entries = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        for slot in slots_on_date(day):
            entries.append({
                "date": day,
                "weekday": slot.get_weekday_display(),
                "group": slot.group_id,
                "group_name": slot.group.name,
                "teacher": slot.effective_teacher.full_name if slot.effective_teacher else "",
                "room": slot.effective_room.name if slot.effective_room else "",
                "start_time": slot.start_time.strftime("%H:%M"),
                "end_time": slot.end_time.strftime("%H:%M"),
            })
    return entries[:40]


def academic_summary(date_from: date, date_to: date) -> dict:
    try:
        from apps.exams.models import Exam, ExamResult
    except Exception:  # pragma: no cover
        return {
            "exams_this_month": 0, "average_score": None, "students_below_passing": 0,
            "declining_groups": 0, "pass_rate": None,
        }

    exams = Exam.objects.filter(date__range=(date_from, date_to))
    results = ExamResult.objects.filter(exam__date__range=(date_from, date_to), percentage__isnull=False)
    aggregates = results.aggregate(average=Avg("percentage"), count=Count("id"))
    passing_pairs = results.values("id", "percentage", "exam__passing_score", "exam__max_score")
    passed = failed = 0
    for row in passing_pairs:
        passing_pct = (
            (Decimal(row["exam__passing_score"]) / Decimal(row["exam__max_score"]) * Decimal(100))
            if row["exam__max_score"] else Decimal("60")
        )
        if row["percentage"] >= passing_pct:
            passed += 1
        else:
            failed += 1
    total = passed + failed
    return {
        "exams_this_month": exams.count(),
        "average_score": str(quantize(aggregates["average"])) if aggregates["average"] is not None else None,
        "results_recorded": aggregates["count"] or 0,
        "students_below_passing": len(students_below_passing(date_to)),
        "declining_groups": len(declining_groups()),
        "pass_rate": str(quantize(Decimal(passed) / Decimal(total) * 100)) if total else None,
        "passed": passed,
        "failed": failed,
    }


def lead_summary(date_from: date, date_to: date) -> dict:
    try:
        from apps.crm.services import pipeline_metrics
    except Exception:  # pragma: no cover
        return {"new_leads": 0, "trials": 0, "registered": 0, "lost": 0,
                "conversion_rate": "0.00", "by_source": []}

    metrics = pipeline_metrics(date_from, date_to)
    return {
        "new_leads": metrics["new_leads"],
        "trials": metrics["trials_scheduled"] + metrics["trials_completed"],
        "registered": metrics["registered"],
        "lost": metrics["lost"],
        "conversion_rate": metrics["conversion_rate"],
        "by_source": metrics["by_source"],
    }


def _pct_change(current: Decimal | int, previous: Decimal | int) -> str | None:
    current, previous = Decimal(current or 0), Decimal(previous or 0)
    if previous == 0:
        return None if current == 0 else "100.00"
    return str(quantize((current - previous) / previous * Decimal(100)))


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
def students_report(date_from: date | None = None, date_to: date | None = None,
                    group=None, course=None) -> dict:
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to.replace(day=1)
    students = Student.objects.select_related("guardian")
    if group:
        students = students.filter(group_memberships__group=group)
    if course:
        students = students.filter(group_memberships__group__course=course)

    by_course = (
        Student.objects.filter(group_memberships__left_at__isnull=True)
        .values("group_memberships__group__course__name")
        .annotate(total=Count("id", distinct=True))
        .order_by("-total")
    )
    by_group = (
        Student.objects.filter(group_memberships__left_at__isnull=True)
        .values("group_memberships__group__name")
        .annotate(total=Count("id", distinct=True))
        .order_by("-total")
    )
    return {
        "from": date_from, "to": date_to,
        "active": Student.objects.filter(status="active").count(),
        "new": Student.objects.filter(registered_at__range=(date_from, date_to)).count(),
        "dropped": Student.objects.filter(
            left_at__range=(date_from, date_to), status="dropped"
        ).count(),
        "graduated": Student.objects.filter(
            left_at__range=(date_from, date_to), status="graduated"
        ).count(),
        "paused": Student.objects.filter(status="paused").count(),
        "total_tracked": students.count(),
        "by_course": [
            {"course": row["group_memberships__group__course__name"] or "Unassigned",
             "students": row["total"]}
            for row in by_course
        ],
        "by_group": [
            {"group": row["group_memberships__group__name"], "students": row["total"]}
            for row in by_group
        ],
    }


def attendance_report(date_from: date | None = None, date_to: date | None = None) -> dict:
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to - timedelta(days=29)
    summary = centre_attendance_summary(date_from, date_to)
    daily = (
        AttendanceRecord.objects.filter(session__date__range=(date_from, date_to))
        .values("session__date")
        .annotate(
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            excused=Count("id", filter=Q(status=AttendanceStatus.EXCUSED)),
        )
        .order_by("session__date")
    )
    by_group = (
        AttendanceRecord.objects.filter(session__date__range=(date_from, date_to))
        .values("session__group__name")
        .annotate(
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
        )
        .order_by("session__group__name")
    )
    students = (
        AttendanceRecord.objects.filter(session__date__range=(date_from, date_to))
        .values("student", "student__first_name", "student__last_name", "student__code")
        .annotate(
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            excused=Count("id", filter=Q(status=AttendanceStatus.EXCUSED)),
        )
    )
    per_student = []
    for row in students:
        counted = row["present"] + row["absent"] + row["late"]
        per_student.append({
            "student": row["student"],
            "student_name": f"{row['student__first_name']} {row['student__last_name']}",
            "student_code": row["student__code"],
            **{key: row[key] for key in ("present", "absent", "late", "excused")},
            "percentage": str(quantize(Decimal(row["present"] + row["late"]) / Decimal(counted) * 100))
            if counted else "0.00",
        })
    per_student.sort(key=lambda row: Decimal(row["percentage"]))

    return {
        "from": date_from, "to": date_to,
        "summary": summary,
        "daily": [dict(row) | {"date": row.pop("session__date")} for row in daily],
        "by_group": [dict(row) | {"group": row.pop("session__group__name")} for row in by_group],
        "students": per_student,
        "repeated_absences": students_with_repeated_absences(date_from, date_to),
    }


def academic_report(date_from: date | None = None, date_to: date | None = None) -> dict:
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to - timedelta(days=89)
    return {
        "from": date_from, "to": date_to,
        "summary": academic_summary(date_from, date_to),
        "below_passing": students_below_passing(date_to, limit=100),
        "declining_groups": declining_groups(),
        "upcoming_exams": upcoming_exams(14),
    }


def financial_report(date_from: date | None = None, date_to: date | None = None) -> dict:
    date_to = date_to or timezone.localdate()
    date_from = date_from or date_to.replace(day=1)
    return {
        "summary": finance_summary(date_from, date_to),
        "income_breakdown": income_breakdown(date_from, date_to),
        "expense_breakdown": expense_breakdown(date_from, date_to),
        "revenue_by_course": revenue_by_course(date_from, date_to),
        "outstanding": outstanding_receivables(date_to),
        "monthly_series": monthly_financial_series(date_to.year),
        "recent_payments": recent_payments(20),
    }


def management_report(reference_date: date | None = None) -> dict:
    """The single monthly operational summary the manager asks for."""
    reference_date = reference_date or timezone.localdate()
    month_start = reference_date.replace(day=1)
    students = students_report(month_start, reference_date)
    attendance = centre_attendance_summary(month_start, reference_date)
    finance = finance_summary(month_start, reference_date)
    academic = academic_summary(month_start, reference_date)
    leads = lead_summary(month_start, reference_date)
    return {
        "label": month_start.strftime("%B %Y"),
        "from": month_start,
        "to": reference_date,
        "students": students,
        "attendance": attendance,
        "finance": finance,
        "academic": academic,
        "leads": leads,
        "groups": group_overview(),
        "payroll": payroll_payable_report(),
    }


def group_overview() -> list[dict]:
    groups = (
        Group.objects.select_related("course", "teacher", "room")
        .annotate(
            students=Count("group_memberships",
                           filter=Q(group_memberships__left_at__isnull=True), distinct=True)
        )
        .order_by("-students")
    )
    return [
        {
            "group": group.pk, "name": group.name,
            "course": group.course.name if group.course else "",
            "teacher": group.teacher.full_name if group.teacher else "",
            "room": group.room.name if group.room else "",
            "students": group.students, "capacity": group.capacity,
            "monthly_fee": str(group.monthly_fee), "status": group.status,
            "utilisation_pct": str(quantize(Decimal(group.students) / Decimal(group.capacity) * 100))
            if group.capacity else "0.00",
        }
        for group in groups
    ]


def payroll_payable_report() -> dict:
    try:
        from apps.payroll.services import pending_payroll_runs
    except Exception:  # pragma: no cover
        return {"payable": "0.00", "runs": []}
    return {"payable": str(quantize(payroll_payable())), "runs": pending_payroll_runs()}


# --------------------------------------------------------------------------- #
# Global search
# --------------------------------------------------------------------------- #
def global_search(query: str, *, limit: int = 6, restrict: dict | None = None) -> dict:
    """Search across every major entity. ``restrict`` narrows results for teachers."""
    query = (query or "").strip()
    if len(query) < 2:
        return {"query": query, "results": {}, "total": 0}

    students = Student.objects.filter(
        Q(first_name__icontains=query) | Q(last_name__icontains=query)
        | Q(code__iexact=query) | Q(code__icontains=query)
        | Q(phone__icontains=query)
    )
    groups = Group.objects.filter(
        Q(name__icontains=query) | Q(level__icontains=query) | Q(course__name__icontains=query)
    )
    if restrict and restrict.get("teacher_id"):
        teacher_id = restrict["teacher_id"]
        students = students.filter(
            group_memberships__group__teacher_id=teacher_id,
            group_memberships__left_at__isnull=True,
        ).distinct()
        groups = groups.filter(teacher_id=teacher_id)

    student_rows = students.values("id", "first_name", "last_name", "code", "status", "phone")[:limit]
    group_rows = groups.values("id", "name", "status")[:limit]

    courses = Course.objects.filter(
        Q(name__icontains=query) | Q(code__icontains=query)
    )
    teachers = Teacher.objects.filter(
        Q(first_name__icontains=query) | Q(last_name__icontains=query)
        | Q(phone__icontains=query) | Q(specialization__icontains=query)
    )
    teacher_rows = teachers.values("id", "first_name", "last_name", "status")[:limit]
    course_rows = courses.values("id", "name", "code")[:limit]

    payments = []
    try:
        from apps.finance.models import Payment

        payments = [
            {
                "id": payment.pk, "receipt": payment.receipt_number,
                "amount": str(payment.amount), "student": payment.student_id,
                "student_name": payment.student.full_name, "date": payment.paid_at,
            }
            for payment in Payment.objects.select_related("student").filter(
                Q(reference__icontains=query) | Q(student__first_name__icontains=query)
                | Q(student__last_name__icontains=query) | Q(student__code__icontains=query)
            )[:limit]
        ]
    except Exception:  # pragma: no cover
        pass

    leads = []
    try:
        from apps.crm.models import Lead

        leads = list(
            Lead.objects.filter(
                Q(full_name__icontains=query) | Q(phone__icontains=query) | Q(email__icontains=query)
            ).values("id", "full_name", "phone", "status")[:limit]
        )
    except Exception:  # pragma: no cover
        pass

    results = {
        "students": [
            {
                "id": row["id"],
                "label": f"{row['first_name']} {row['last_name']}",
                "sublabel": f"{row['code']} · {row['status']}",
                "link": f"/students/{row['id']}",
            }
            for row in student_rows
        ],
        "teachers": [
            {
                "id": row["id"],
                "label": f"{row['first_name']} {row['last_name']}",
                "sublabel": row["status"],
                "link": f"/teachers/{row['id']}",
            }
            for row in teacher_rows
        ],
        "groups": [
            {"id": row["id"], "label": row["name"], "sublabel": row["status"],
             "link": f"/groups/{row['id']}"}
            for row in group_rows
        ],
        "courses": [
            {"id": row["id"], "label": row["name"], "sublabel": row["code"],
             "link": f"/settings/courses?q={row['code']}"}
            for row in course_rows
        ],
        "payments": [
            {"id": row["id"], "label": f"{row['receipt']} · {row['amount']}",
             "sublabel": row["student_name"], "link": f"/payments?student={row['student']}"}
            for row in payments
        ],
        "leads": [
            {"id": row["id"], "label": row["full_name"], "sublabel": f"{row['phone']} · {row['status']}",
             "link": f"/leads/{row['id']}"}
            for row in leads
        ],
    }
    results = {key: value for key, value in results.items() if value}
    return {
        "query": query,
        "results": results,
        "total": sum(len(value) for value in results.values()),
    }


# --------------------------------------------------------------------------- #
# CSV export
# --------------------------------------------------------------------------- #
def report_to_csv(report: str, date_from: date | None = None, date_to: date | None = None) -> str:
    """Flatten a report into CSV text for download."""
    payload = build_report(report, date_from, date_to)
    buffer = StringIO()
    writer = csv.writer(buffer)

    def write_table(title: str, rows: list[dict]) -> None:
        writer.writerow([])
        writer.writerow([title])
        if not rows:
            writer.writerow(["no data"])
            return
        headers = list(rows[0].keys())
        writer.writerow(headers)
        for row in rows:
            writer.writerow([_csv_value(row.get(header)) for header in headers])

    writer.writerow(["Report", report])
    writer.writerow(["From", payload.get("from") or payload.get("summary", {}).get("from", "")])
    writer.writerow(["To", payload.get("to") or payload.get("summary", {}).get("to", "")])
    for key, value in payload.items():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            write_table(key, value)
        elif isinstance(value, dict) and not any(isinstance(item, (dict, list)) for item in value.values()):
            writer.writerow([])
            writer.writerow([key])
            for sub_key, sub_value in value.items():
                writer.writerow([sub_key, _csv_value(sub_value)])
    return buffer.getvalue()


def _csv_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return "; ".join(f"{k}={v}" for k, v in value.items()) if isinstance(value, dict) else ", ".join(
            str(item) for item in value
        )
    return str(value)


REPORTS = {
    "students": students_report,
    "attendance": attendance_report,
    "academic": academic_report,
    "finance": financial_report,
    "management": management_report,
    "groups": lambda **_: {"groups": group_overview()},
    "at-risk": lambda **_: {"students": at_risk_students(limit=200)},
}


def build_report(name: str, date_from: date | None = None, date_to: date | None = None) -> dict:
    if name not in REPORTS:
        raise ValueError(f"Unknown report {name!r}")
    builder = REPORTS[name]
    try:
        return builder(date_from=date_from, date_to=date_to)
    except TypeError:
        return builder()
