"""Exam services: creation, marking, grading and performance reporting.

Percentage definition (documented once, used everywhere)::

    percentage = score / max_score * 100        (0 when max_score is 0)

An exam's passing bar is stored as a raw score (``Exam.passing_score``); it is
compared as the equivalent percentage so exams with different maxima stay
comparable. Letter grades come from :data:`GRADE_THRESHOLDS`.

All business rules live here so they are testable without HTTP and cannot be
bypassed by a crafty request (plan sections 50, 54).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.academics.models import Course, Group, Student
from apps.core.audit import log_action
from apps.core.models import AuditLog, Notification, SystemSettings

from .models import DEFAULT_MAX_SCORE, Exam, ExamComponent, ExamResult, ExamType

PERCENT = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")

#: (minimum percentage, grade), evaluated top down. Module-level so the scale can
#: be reviewed in one obvious place instead of being scattered through the code.
GRADE_THRESHOLDS: tuple[tuple[Decimal, str], ...] = (
    (Decimal("90.00"), "A"),
    (Decimal("80.00"), "B"),
    (Decimal("70.00"), "C"),
    (Decimal("60.00"), "D"),
)
FAILING_GRADE = "F"

#: Student momentum: recent half of the results vs the earlier half.
IMPROVING_DELTA = Decimal("5")
DECLINING_DELTA = Decimal("-5")

#: Group momentum: last exam average vs first exam average.
GROUP_TREND_DELTA = Decimal("2")


# --------------------------------------------------------------------------- #
# Maths
# --------------------------------------------------------------------------- #
def _quantize(value: Decimal) -> Decimal:
    return Decimal(value).quantize(PERCENT, rounding=ROUND_HALF_UP)


def _mean(values) -> Decimal:
    values = [Decimal(value) for value in values]
    if not values:
        return ZERO
    return _quantize(sum(values, ZERO) / Decimal(len(values)))


def _pct(numerator: int, denominator: int) -> Decimal:
    if not denominator:
        return ZERO
    return _quantize((Decimal(numerator) / Decimal(denominator)) * HUNDRED)


def _as_decimal(value, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValidationError({field: f"{value!r} is not a valid amount."}) from exc


def _as_date(value, field: str = "date") -> date:
    if isinstance(value, date):
        return value
    parsed = parse_date(str(value)) if value else None
    if parsed is None:
        raise ValidationError({field: "A valid date is required."})
    return parsed


def calculate_percentage(score, max_score) -> Decimal:
    """``score / max_score`` as a 2dp percentage; 0 when ``max_score`` is 0."""
    score = _as_decimal(score if score is not None else 0, "score")
    max_score = _as_decimal(max_score if max_score is not None else 0, "max_score")
    if max_score == 0:
        return ZERO
    return _quantize((score / max_score) * HUNDRED)


def grade_for(percentage) -> str:
    """Letter grade for a percentage, using :data:`GRADE_THRESHOLDS`."""
    value = _as_decimal(percentage if percentage is not None else 0, "percentage")
    for threshold, grade in GRADE_THRESHOLDS:
        if value >= threshold:
            return grade
    return FAILING_GRADE


def _trend(
    values,
    *,
    improve: Decimal = IMPROVING_DELTA,
    decline: Decimal = DECLINING_DELTA,
) -> str:
    """Compare the most recent half of a series with the earlier half.

    ``improving`` at +5 or better, ``declining`` at -5 or worse, else ``stable``;
    fewer than two points is ``insufficient_data``.
    """
    values = [Decimal(value) for value in values]
    if len(values) < 2:
        return "insufficient_data"
    half = len(values) // 2
    earlier, recent = values[:half], values[half:]
    if not earlier or not recent:
        return "insufficient_data"
    delta = _mean(recent) - _mean(earlier)
    if delta >= improve:
        return "improving"
    if delta <= decline:
        return "declining"
    return "stable"


def exam_passing_percentage(exam: Exam) -> Decimal:
    """The exam's passing score expressed as a comparable percentage."""
    return calculate_percentage(exam.passing_score, exam.max_score)


# --------------------------------------------------------------------------- #
# Creation
# --------------------------------------------------------------------------- #
def _resolve_passing_score(max_score: Decimal, passing_score) -> Decimal:
    """Explicit passing score, or the centre default percentage applied to max."""
    if passing_score is not None:
        value = _as_decimal(passing_score, "passing_score")
        if value < 0:
            raise ValidationError({"passing_score": "A passing score cannot be negative."})
        if value > max_score:
            raise ValidationError(
                {"passing_score": f"A passing score of {value} is above the maximum of {max_score}."}
            )
        return value
    default_pct = SystemSettings.get_solo().default_passing_score_pct
    return _quantize(max_score * Decimal(default_pct) / HUNDRED)


def create_exam_components(exam: Exam, components) -> list[ExamComponent]:
    """Create the component rows of an exam; ``order`` defaults to list position."""
    existing = set(exam.components.values_list("name", flat=True))
    pending: list[ExamComponent] = []

    for index, item in enumerate(components or []):
        if not isinstance(item, dict):
            raise ValidationError({"components": ["Each component must be an object."]})
        name = str(item.get("name") or "").strip()
        if not name:
            raise ValidationError({"components": ["Every component needs a name."]})
        if name in existing:
            raise ValidationError({"components": [f"Duplicate component {name!r} on this exam."]})
        max_score = _as_decimal(item.get("max_score"), "components")
        if max_score <= 0:
            raise ValidationError(
                {"components": [f"Component {name!r} must have a maximum above zero."]}
            )
        order = item.get("order")
        try:
            order = int(order) if order is not None else index
        except (TypeError, ValueError):
            raise ValidationError(
                {"components": [f"Component {name!r} has an invalid order."]}
            )
        existing.add(name)
        pending.append(ExamComponent(exam=exam, name=name, max_score=max_score, order=order))

    if pending:
        ExamComponent.objects.bulk_create(pending)
    return pending


@transaction.atomic
def create_exam(
    *,
    group: Group,
    name: str,
    exam_type: str,
    exam_date,
    course: Course | None = None,
    teacher=None,
    max_score=DEFAULT_MAX_SCORE,
    passing_score=None,
    description: str = "",
    components=None,
    actor=None,
) -> Exam:
    """Create an exam (and its components) with a server-computed passing score."""
    if group is None:
        raise ValidationError({"group": "An exam belongs to a group."})
    name = str(name or "").strip()
    if not name:
        raise ValidationError({"name": "An exam needs a name."})
    if exam_type not in ExamType.values:
        raise ValidationError({"exam_type": f"Unknown exam type {exam_type!r}."})
    max_score = _as_decimal(max_score, "max_score")
    if max_score <= 0:
        raise ValidationError({"max_score": "The maximum score must be above zero."})
    exam_date = _as_date(exam_date, "date")

    exam = Exam.objects.create(
        group=group,
        course=course or group.course,
        teacher=teacher if teacher is not None else group.teacher,
        name=name,
        exam_type=exam_type,
        date=exam_date,
        max_score=max_score,
        passing_score=_resolve_passing_score(max_score, passing_score),
        description=description or "",
    )
    create_exam_components(exam, components)

    log_action(
        AuditLog.Action.CREATE,
        exam,
        actor=actor,
        new={
            "name": exam.name,
            "group": group.pk,
            "course": exam.course_id,
            "exam_type": exam.exam_type,
            "date": str(exam.date),
            "max_score": str(exam.max_score),
            "passing_score": str(exam.passing_score),
            "components": [component.name for component in exam.components.all()],
        },
        summary=f"Created {exam.get_exam_type_display()} {exam.name} for {group.name}",
    )
    return exam


def replace_exam_components(exam: Exam, components) -> list[ExamComponent]:
    """Swap the component layout of an exam that has no marks recorded yet."""
    if exam.results.exists():
        raise ValidationError(
            {
                "components": "Results are already recorded for this exam, so its components "
                "can no longer be replaced."
            }
        )
    exam.components.all().delete()
    return create_exam_components(exam, components)


# --------------------------------------------------------------------------- #
# Marking
# --------------------------------------------------------------------------- #
@transaction.atomic
def record_results(exam: Exam, entries, *, actor=None) -> dict:
    """Bulk upsert marks for an exam, component by component.

    ``entries`` is a list of ``{"student": id, "component": id | None,
    "score": Decimal, "teacher_comment": str}``. Negative scores and scores above
    the component/exam maximum are rejected with a field-mapped ``ValidationError``.
    Re-submitting the same ``(exam, component, student)`` updates the existing row
    instead of creating a duplicate.
    """
    entries = list(entries or [])
    if not entries:
        raise ValidationError({"entries": "No results were supplied."})

    components = {component.pk: component for component in exam.components.all()}
    errors: dict[str, list[str]] = {}
    prepared: list[dict] = []

    for index, entry in enumerate(entries):
        position = f"row {index + 1}"
        student_id = entry.get("student")
        component_id = entry.get("component")
        raw_score = entry.get("score")

        student = None
        if student_id in (None, ""):
            errors.setdefault("student", []).append(f"{position}: a student is required.")
        else:
            student = Student.objects.filter(pk=student_id).first()
            if student is None:
                errors.setdefault("student", []).append(
                    f"{position}: student {student_id} does not exist."
                )

        component = None
        has_component = component_id not in (None, "")
        if has_component:
            try:
                component = components.get(int(component_id))
            except (TypeError, ValueError):
                component = None
            if component is None:
                errors.setdefault("component", []).append(
                    f"{position}: component {component_id} does not belong to {exam.name}."
                )

        score = None
        try:
            score = _as_decimal(raw_score, "score")
        except ValidationError:
            errors.setdefault("score", []).append(
                f"{position}: {raw_score!r} is not a valid score."
            )
        if score is not None:
            if score < 0:
                errors.setdefault("score", []).append(f"{position}: scores cannot be negative.")
            max_score = component.max_score if component is not None else exam.max_score
            if max_score and score > max_score:
                errors.setdefault("score", []).append(
                    f"{position}: {score} is above the maximum of {max_score}."
                )

        if student is None or score is None or (has_component and component is None):
            continue

        prepared.append(
            {
                "student": student,
                "component": component,
                "score": score,
                "teacher_comment": entry.get("teacher_comment") or "",
            }
        )

    if errors:
        raise ValidationError(errors)

    created = 0
    updated = 0
    results: list[dict] = []
    marker = actor if getattr(actor, "pk", None) else None

    for item in prepared:
        student = item["student"]
        component = item["component"]
        score = item["score"]
        max_score = component.max_score if component is not None else exam.max_score
        percentage = calculate_percentage(score, max_score)

        result = ExamResult.objects.filter(
            exam=exam, component=component, student=student
        ).first()
        if result is None:
            result = ExamResult(exam=exam, component=component, student=student)
            created += 1
        else:
            updated += 1

        result.score = score
        result.max_score = max_score
        result.teacher_comment = item["teacher_comment"]
        result.marked_by = marker
        result.percentage = percentage
        result.grade = grade_for(percentage)
        result.save()

        results.append(
            {
                "id": result.pk,
                "student": student.pk,
                "student_name": student.full_name,
                "component": component.pk if component is not None else None,
                "component_name": component.name if component is not None else "",
                "score": str(result.score),
                "max_score": str(result.max_score),
                "percentage": str(result.percentage),
                "grade": result.grade,
            }
        )

    log_action(
        AuditLog.Action.UPDATE if updated and not created else AuditLog.Action.CREATE,
        exam,
        actor=actor,
        new={"created": created, "updated": updated},
        summary=f"Recorded results for {exam.name}: {created} new, {updated} updated",
    )
    return {
        "exam": exam.pk,
        "exam_name": exam.name,
        "created": created,
        "updated": updated,
        "total": created + updated,
        "results": results,
    }


def publish_results(exam: Exam, *, actor=None) -> Exam:
    """Publish an exam's results and raise one (deduplicated) notification."""
    was_published = exam.is_published
    if not was_published:
        exam.is_published = True
        exam.save(update_fields=["is_published"])
        log_action(
            AuditLog.Action.UPDATE,
            exam,
            actor=actor,
            old={"is_published": False},
            new={"is_published": True},
            summary=f"Published results for {exam.name}",
        )

    Notification.objects.get_or_create(
        dedupe_key=f"exam-published-{exam.pk}",
        defaults={
            "kind": Notification.Kind.EXAM_RESULT,
            "severity": Notification.Severity.INFO,
            "title": f"Results published: {exam.name}",
            "body": f"{exam.group.name} · {exam.date} · {exam.get_exam_type_display()}",
            "link": f"/exams/{exam.pk}",
            "payload": {
                "exam": exam.pk,
                "group": exam.group_id,
                "course": exam.course_id,
                "date": str(exam.date),
            },
        },
    )
    return exam


# --------------------------------------------------------------------------- #
# Shared aggregation helpers
# --------------------------------------------------------------------------- #
def _results_by_student(exam: Exam) -> dict[int, list[ExamResult]]:
    rows = (
        ExamResult.objects.filter(exam=exam)
        .select_related("student", "component")
        .order_by("student__first_name", "student__last_name", "student__id", "id")
    )
    grouped: dict[int, list[ExamResult]] = defaultdict(list)
    for row in rows:
        grouped[row.student_id].append(row)
    return grouped


def _overall_from_rows(exam: Exam, rows: list[ExamResult]):
    """Overall score/percentage/grade/comment for one student's rows."""
    overall = next((row for row in rows if row.component_id is None), None)
    if overall is not None:
        return overall.score, overall.percentage, overall.grade, overall.teacher_comment

    total = sum((row.score for row in rows), ZERO)
    total_max = sum(
        (
            row.max_score if row.max_score is not None else exam.max_score
            for row in rows
        ),
        ZERO,
    )
    percentage = calculate_percentage(total, total_max)
    comment = "; ".join(row.teacher_comment for row in rows if row.teacher_comment)
    return total, percentage, grade_for(percentage), comment


def _exam_student_rows(exam: Exam) -> list[dict]:
    """One row per student with marks in ``exam``: overall percentage + pass flag."""
    passing = exam_passing_percentage(exam)
    rows = []
    for student_rows in _results_by_student(exam).values():
        score, percentage, grade, comment = _overall_from_rows(exam, student_rows)
        rows.append(
            {
                "student": student_rows[0].student,
                "score": score,
                "percentage": percentage,
                "grade": grade,
                "comment": comment,
                "passed": percentage >= passing,
            }
        )
    return rows


def _result_payload(result: ExamResult) -> dict:
    return {
        "id": result.pk,
        "exam": result.exam_id,
        "exam_name": result.exam.name,
        "type": result.exam.exam_type,
        "date": result.exam.date,
        "group": result.exam.group_id,
        "group_name": result.exam.group.name,
        "component": result.component_id,
        "component_name": result.component.name if result.component_id else "",
        "score": str(result.score),
        "max_score": str(result.max_score) if result.max_score is not None else None,
        "percentage": str(result.percentage),
        "grade": result.grade,
        "teacher_comment": result.teacher_comment,
    }


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def exam_results_summary(exam: Exam) -> dict:
    """Mark sheet for one exam: components, per-student rows and statistics."""
    components = list(exam.components.order_by("order", "id"))
    component_names = {component.pk: component.name for component in components}
    grouped = _results_by_student(exam)
    passing = exam_passing_percentage(exam)

    students: list[dict] = []
    percentages: list[Decimal] = []
    below_passing: list[dict] = []

    for student_rows in grouped.values():
        student = student_rows[0].student
        score, percentage, grade, comment = _overall_from_rows(exam, student_rows)
        scores = {
            component_names[row.component_id]: str(row.score)
            for row in student_rows
            if row.component_id is not None
        }
        passed = percentage >= passing
        percentages.append(percentage)
        students.append(
            {
                "student": student.pk,
                "student_name": student.full_name,
                "student_code": student.code,
                "scores": scores,
                "overall_score": str(score),
                "overall_percentage": str(percentage),
                "grade": grade,
                "passed": passed,
                "comment": comment,
            }
        )
        if not passed:
            below_passing.append(
                {
                    "student": student.pk,
                    "student_name": student.full_name,
                    "percentage": str(percentage),
                }
            )

    students.sort(key=lambda item: Decimal(item["overall_percentage"]), reverse=True)
    below_passing.sort(key=lambda item: Decimal(item["percentage"]))
    passed_count = sum(1 for item in students if item["passed"])

    return {
        "exam": {
            "id": exam.pk,
            "name": exam.name,
            "type": exam.exam_type,
            "date": exam.date,
            "group_name": exam.group.name,
            "course_name": exam.course.name if exam.course_id else "",
            "max_score": str(exam.max_score),
            "passing_score": str(exam.passing_score),
        },
        "components": [
            {
                "id": component.pk,
                "name": component.name,
                "max_score": str(component.max_score),
                "order": component.order,
            }
            for component in components
        ],
        "students": students,
        "statistics": {
            "average_percentage": str(_mean(percentages)),
            "highest_percentage": str(max(percentages)) if percentages else str(ZERO),
            "lowest_percentage": str(min(percentages)) if percentages else str(ZERO),
            "pass_rate": str(_pct(passed_count, len(students))),
            "passed_count": passed_count,
            "failed_count": len(students) - passed_count,
            "below_passing": below_passing,
        },
    }


def _student_exam_rows(student: Student) -> list[dict]:
    """One row per exam the student has marks for, oldest first."""
    rows = (
        ExamResult.objects.filter(student=student)
        .select_related("exam", "exam__group", "exam__course", "component")
        .order_by("exam__date", "exam__id", "id")
    )
    grouped: dict[int, list[ExamResult]] = defaultdict(list)
    for row in rows:
        grouped[row.exam_id].append(row)

    out = []
    for exam_rows in grouped.values():
        exam = exam_rows[0].exam
        score, percentage, grade, comment = _overall_from_rows(exam, exam_rows)
        passing = exam_passing_percentage(exam)
        out.append(
            {
                "exam": exam,
                "score": score,
                "percentage": percentage,
                "grade": grade,
                "comment": comment,
                "passing_percentage": passing,
                "passed": percentage >= passing,
                "date": exam.date,
            }
        )
    out.sort(key=lambda item: (item["date"], item["exam"].pk))
    return out


def student_exam_summary(student: Student) -> dict:
    """Exams taken, averages, pass/fail counts, momentum and the last 5 marks."""
    exam_rows = _student_exam_rows(student)
    percentages = [row["percentage"] for row in exam_rows]
    taken = len(exam_rows)
    passed = sum(1 for row in exam_rows if row["passed"])
    latest = exam_rows[-1] if exam_rows else None

    recent = (
        ExamResult.objects.filter(student=student)
        .select_related("exam", "exam__group", "component")
        .order_by("-exam__date", "-exam__id", "-id")[:5]
    )

    return {
        "exams_taken": taken,
        "average_percentage": str(_mean(percentages)),
        "latest_score": str(latest["score"]) if latest else None,
        "latest_percentage": str(latest["percentage"]) if latest else None,
        "highest_percentage": str(max(percentages)) if percentages else None,
        "lowest_percentage": str(min(percentages)) if percentages else None,
        "pass_count": passed,
        "fail_count": taken - passed,
        "trend": _trend(percentages),
        "recent": [_result_payload(result) for result in recent],
    }


def student_exam_history(student: Student) -> dict:
    """The student profile's Exams tab: summary plus every mark, newest first."""
    results = (
        ExamResult.objects.filter(student=student)
        .select_related("exam", "exam__group", "exam__course", "component")
        .order_by("-exam__date", "-exam__id", "-id")
    )
    return {
        "summary": student_exam_summary(student),
        "results": [_result_payload(result) for result in results],
    }


def group_performance(group: Group) -> dict:
    """Exam-by-exam, student-by-student and overall performance for one group."""
    exams = list(group.exams.order_by("date", "id"))
    exam_rows: list[dict] = []
    student_buckets: dict[int, dict] = {}
    all_percentages: list[Decimal] = []
    exam_averages: list[Decimal] = []
    passed_total = results_total = 0

    for exam in exams:
        rows = _exam_student_rows(exam)
        if not rows:
            exam_rows.append(
                {
                    "exam": exam.pk,
                    "exam_name": exam.name,
                    "type": exam.exam_type,
                    "date": exam.date,
                    "max_score": str(exam.max_score),
                    "passing_score": str(exam.passing_score),
                    "results_count": 0,
                    "average_percentage": None,
                    "pass_rate": None,
                }
            )
            continue

        percentages = [row["percentage"] for row in rows]
        passed = sum(1 for row in rows if row["passed"])
        average = _mean(percentages)
        exam_rows.append(
            {
                "exam": exam.pk,
                "exam_name": exam.name,
                "type": exam.exam_type,
                "date": exam.date,
                "max_score": str(exam.max_score),
                "passing_score": str(exam.passing_score),
                "results_count": len(rows),
                "average_percentage": str(average),
                "pass_rate": str(_pct(passed, len(rows))),
            }
        )
        exam_averages.append(average)
        all_percentages.extend(percentages)
        passed_total += passed
        results_total += len(rows)

        for row in rows:
            bucket = student_buckets.setdefault(
                row["student"].pk,
                {"student": row["student"], "percentages": [], "passed": 0, "total": 0},
            )
            bucket["percentages"].append(row["percentage"])
            bucket["total"] += 1
            if row["passed"]:
                bucket["passed"] += 1

    student_rows = [
        {
            "student": bucket["student"].pk,
            "student_name": bucket["student"].full_name,
            "student_code": bucket["student"].code,
            "exams_taken": bucket["total"],
            "average_percentage": str(_mean(bucket["percentages"])),
            "passed": bucket["passed"],
            "failed": bucket["total"] - bucket["passed"],
            "trend": _trend(bucket["percentages"]),
        }
        for bucket in student_buckets.values()
    ]
    student_rows.sort(key=lambda item: Decimal(item["average_percentage"]), reverse=True)

    return {
        "group": group.pk,
        "group_name": group.name,
        "exams": exam_rows,
        "average_percentage": str(_mean(all_percentages)),
        "pass_rate": str(_pct(passed_total, results_total)),
        "students": student_rows,
        "trend": _trend(exam_averages),
    }


def course_performance(course: Course) -> dict:
    """Aggregate every group of a course into one comparable picture."""
    exams = list(course.exams.select_related("group").order_by("date", "id"))
    group_buckets: dict[int, dict] = {}
    all_percentages: list[Decimal] = []
    passed_total = results_total = 0

    for exam in exams:
        rows = _exam_student_rows(exam)
        percentages = [row["percentage"] for row in rows]
        passed = sum(1 for row in rows if row["passed"])
        all_percentages.extend(percentages)
        passed_total += passed
        results_total += len(rows)

        bucket = group_buckets.setdefault(
            exam.group_id,
            {"group": exam.group, "percentages": [], "passed": 0, "total": 0, "exams": 0},
        )
        bucket["percentages"].extend(percentages)
        bucket["passed"] += passed
        bucket["total"] += len(rows)
        bucket["exams"] += 1

    group_rows = [
        {
            "group": bucket["group"].pk,
            "group_name": bucket["group"].name,
            "exams": bucket["exams"],
            "average_percentage": str(_mean(bucket["percentages"])),
            "pass_rate": str(_pct(bucket["passed"], bucket["total"])),
            "trend": _trend(bucket["percentages"]),
        }
        for bucket in group_buckets.values()
    ]
    group_rows.sort(key=lambda item: item["group_name"])

    return {
        "course": course.pk,
        "course_name": course.name,
        "average_percentage": str(_mean(all_percentages)),
        "pass_rate": str(_pct(passed_total, results_total)),
        "groups": group_rows,
    }


def students_below_passing(date_from, date_to, limit=None) -> list[dict]:
    """Students whose exam percentage fell under that exam's passing percentage."""
    exams = (
        Exam.objects.between(date_from, date_to).select_related("group", "course").order_by("date", "id")
    )
    out: list[dict] = []
    for exam in exams:
        passing = exam_passing_percentage(exam)
        for row in _exam_student_rows(exam):
            if row["passed"]:
                continue
            student = row["student"]
            out.append(
                {
                    "student": student.pk,
                    "student_name": student.full_name,
                    "student_code": student.code,
                    "exam": exam.pk,
                    "exam_name": exam.name,
                    "percentage": str(row["percentage"]),
                    "passing_percentage": str(passing),
                    "date": exam.date,
                }
            )
    out.sort(key=lambda item: (Decimal(item["percentage"]), item["date"]))
    if limit:
        return out[: int(limit)]
    return out


def group_performance_trends(date_from, date_to) -> list[dict]:
    """First-half vs second-half exam averages per group; -2 points is declining."""
    exams = (
        Exam.objects.between(date_from, date_to).select_related("group").order_by("date", "id")
    )
    buckets: dict[int, dict] = {}
    for exam in exams:
        rows = _exam_student_rows(exam)
        if not rows:
            continue
        bucket = buckets.setdefault(exam.group_id, {"group": exam.group, "averages": []})
        bucket["averages"].append(_mean(row["percentage"] for row in rows))

    trends = []
    for bucket in buckets.values():
        averages = bucket["averages"]
        half = max(len(averages) // 2, 1)
        first_average = _mean(averages[:half])
        last_average = _mean(averages[-half:])
        delta = _quantize(last_average - first_average)
        if delta < -GROUP_TREND_DELTA:
            trend = "declining"
        elif delta > GROUP_TREND_DELTA:
            trend = "improving"
        else:
            trend = "stable"
        trends.append(
            {
                "group": bucket["group"].pk,
                "group_name": bucket["group"].name,
                "first_average": str(first_average),
                "last_average": str(last_average),
                "delta": str(delta),
                "trend": trend,
            }
        )
    trends.sort(key=lambda item: Decimal(item["delta"]))
    return trends


def centre_exam_summary(date_from, date_to) -> dict:
    """Whole-centre exam health for a period."""
    exams = list(Exam.objects.between(date_from, date_to).order_by("date", "id"))
    all_percentages: list[Decimal] = []
    passed_total = results_total = 0
    students_below: set[int] = set()

    for exam in exams:
        rows = _exam_student_rows(exam)
        for row in rows:
            all_percentages.append(row["percentage"])
            if row["passed"]:
                passed_total += 1
            else:
                students_below.add(row["student"].pk)
        results_total += len(rows)

    declining = [
        row for row in group_performance_trends(date_from, date_to) if row["trend"] == "declining"
    ]
    return {
        "exams_count": len(exams),
        "average_percentage": str(_mean(all_percentages)),
        "pass_rate": str(_pct(passed_total, results_total)),
        "students_below_passing": len(students_below),
        "groups_declining": len(declining),
    }


def exams_upcoming(*, days: int = 7, group: Group | None = None) -> list[Exam]:
    """Exams on the calendar inside the next ``days`` (used by the dashboard)."""
    today = timezone.localdate()
    horizon = today + timedelta(days=days)
    queryset = Exam.objects.between(date_from=today, date_to=horizon).select_related(
        "group", "course", "teacher"
    )
    if group is not None:
        queryset = queryset.filter(group=group)
    return list(queryset.order_by("date", "id"))
