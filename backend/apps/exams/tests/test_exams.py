"""Exam rules: score arithmetic, grading, simple and multi-component exams.

The brief requires proof that scores calculate correctly, that pass/fail is
right, and that multi-component exams (IELTS Listening/Reading/Writing/Speaking
and any other shape) work without hard-coding one exam system.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.core.models import SystemSettings
from apps.exams.models import Exam, ExamComponent, ExamResult
from apps.exams.services import (
    calculate_percentage,
    create_exam,
    exam_results_summary,
    grade_for,
    group_performance,
    students_below_passing,
    student_exam_history,
    student_exam_summary,
)
from tests.factories import enroll, make_group, make_student

pytestmark = pytest.mark.django_db


@pytest.fixture
def group_with_students():
    group = make_group(name="IELTS Evening A")
    students = [
        make_student("Ali", "Karimov"),
        make_student("Madina", "Yusupova"),
        make_student("Bekzod", "Tursunov"),
    ]
    for student in students:
        enroll(student, group)
    return group, students


def test_percentage_arithmetic():
    assert calculate_percentage(Decimal("84"), Decimal("100")) == Decimal("84.00")
    assert calculate_percentage(Decimal("7.5"), Decimal("9")) == Decimal("83.33")
    assert calculate_percentage(Decimal("0"), Decimal("100")) == Decimal("0.00")
    # A zero maximum cannot divide, and must not raise or return NaN.
    assert calculate_percentage(Decimal("10"), Decimal("0")) == Decimal("0.00")


def test_grades_use_the_documented_scale():
    assert grade_for(Decimal("95")) == "A"
    assert grade_for(Decimal("90")) == "A"
    assert grade_for(Decimal("85")) == "B"
    assert grade_for(Decimal("72")) == "C"
    assert grade_for(Decimal("61")) == "D"
    assert grade_for(Decimal("59")) == "F"
    assert grade_for(Decimal("0")) == "F"


def test_simple_exam_marks_percentage_and_pass_state(group_with_students):
    group, students = group_with_students
    exam = create_exam(group=group, name="Monthly Test", exam_type="monthly_test",
                       exam_date=date.today(), max_score=Decimal("100"),
                       passing_score=Decimal("60"))
    record(exam, [
        {"student": students[0].pk, "component": None, "score": Decimal("84")},
        {"student": students[1].pk, "component": None, "score": Decimal("45")},
    ])

    passing = exam.results.get(student=students[0])
    failing = exam.results.get(student=students[1])
    assert passing.percentage == Decimal("84.00")
    assert passing.grade == "B"
    assert failing.percentage == Decimal("45.00")
    assert failing.grade == "F"
    assert passing.is_overall is True

    sheet = exam_results_summary(exam)
    rows = {row["student"]: row for row in sheet["students"]}
    assert rows[students[0].pk]["passed"] is True
    assert rows[students[1].pk]["passed"] is False
    assert sheet["statistics"]["passed_count"] == 1
    assert sheet["statistics"]["failed_count"] == 1
    assert Decimal(sheet["statistics"]["pass_rate"]) == Decimal("50.00")


def test_passing_score_defaults_from_system_settings(group_with_students):
    group, _ = group_with_students
    settings_obj = SystemSettings.get_solo()
    settings_obj.default_passing_score_pct = Decimal("70.00")
    settings_obj.save()
    exam = create_exam(group=group, name="Quiz", exam_type="quiz", exam_date=date.today(),
                       max_score=Decimal("50"))
    assert exam.passing_score == Decimal("35.00")   # 70% of 50


def test_multi_component_exam_stores_every_component(group_with_students):
    group, _ = group_with_students
    exam = create_exam(
        group=group, name="Mock Exam", exam_type="mock_exam", exam_date=date.today(),
        max_score=Decimal("9"), passing_score=Decimal("5.5"),
        components=[
            {"name": "Listening", "max_score": Decimal("9"), "order": 1},
            {"name": "Reading", "max_score": Decimal("9"), "order": 2},
            {"name": "Writing", "max_score": Decimal("9"), "order": 3},
            {"name": "Speaking", "max_score": Decimal("9"), "order": 4},
        ],
    )
    names = list(exam.components.order_by("order").values_list("name", flat=True))
    assert names == ["Listening", "Reading", "Writing", "Speaking"]
    # Components may carry different maxima: nothing is hard-coded to 9.
    writing = exam.components.get(name="Writing")
    assert writing.max_score == Decimal("9.00")


def test_different_maxima_per_component_are_supported(group_with_students):
    group, _ = group_with_students
    exam = create_exam(
        group=group, name="Mixed Exam", exam_type="custom", exam_date=date.today(),
        max_score=Decimal("150"),
        components=[
            {"name": "Vocabulary", "max_score": Decimal("50"), "order": 1},
            {"name": "Essay", "max_score": Decimal("100"), "order": 2},
        ],
    )
    assert exam.components.get(name="Vocabulary").max_score == Decimal("50.00")
    assert exam.components.get(name="Essay").max_score == Decimal("100.00")


def test_record_results_rejects_impossible_scores(group_with_students):
    group, students = group_with_students
    exam = create_exam(group=group, name="Quiz", exam_type="quiz", exam_date=date.today(),
                       max_score=Decimal("100"))
    with pytest.raises(ValidationError):
        record(exam, [{"student": students[0].pk, "component": None, "score": Decimal("150")}])
    with pytest.raises(ValidationError):
        record(exam, [{"student": students[0].pk, "component": None, "score": Decimal("-5")}])
    with pytest.raises(ValidationError):
        record(exam, [])
    assert exam.results.count() == 0


def test_record_results_is_an_upsert_not_a_duplicate(group_with_students):
    group, students = group_with_students
    exam = create_exam(group=group, name="Quiz", exam_type="quiz", exam_date=date.today(),
                       max_score=Decimal("100"))
    record(exam, [{"student": students[0].pk, "component": None, "score": Decimal("70")}])
    record(exam, [{"student": students[0].pk, "component": None, "score": Decimal("88")}])
    results = exam.results.filter(student=students[0])
    assert results.count() == 1
    assert results.first().score == Decimal("88.00")


def test_multi_component_results_roll_up_to_an_overall(group_with_students):
    group, students = group_with_students
    exam = create_exam(
        group=group, name="Mock Exam", exam_type="mock_exam", exam_date=date.today(),
        max_score=Decimal("9"), passing_score=Decimal("5.5"),
        components=[{"name": name, "max_score": Decimal("9"), "order": index}
                    for index, name in enumerate(
                        ["Listening", "Reading", "Writing", "Speaking"], start=1)],
    )
    components = list(exam.components.order_by("order"))
    entries = [
        {"student": students[0].pk, "component": component.pk,
         "score": score, "teacher_comment": ""}
        for component, score in zip(components, [Decimal("8"), Decimal("7"), Decimal("6"), Decimal("7")])
    ]
    summary = record(exam, entries)
    assert summary["created"] == 4
    assert summary["total"] == 4
    assert all(row["percentage"] for row in summary["results"])

    sheet = exam_results_summary(exam)
    row = next(item for item in sheet["students"] if item["student"] == students[0].pk)
    assert Decimal(row["overall_percentage"]) == Decimal("77.78")   # mean of 88.9/77.8/66.7/77.8
    assert row["passed"] is True
    assert row["grade"]


def test_group_performance_and_failing_students(group_with_students):
    group, students = group_with_students
    exam = create_exam(group=group, name="Monthly Test", exam_type="monthly_test",
                       exam_date=date.today(), max_score=Decimal("100"),
                       passing_score=Decimal("60"))
    record(exam, [
        {"student": students[0].pk, "component": None, "score": Decimal("90")},
        {"student": students[1].pk, "component": None, "score": Decimal("30")},
        {"student": students[2].pk, "component": None, "score": Decimal("75")},
    ])

    performance = group_performance(group)
    assert performance["group"] == group.pk
    assert Decimal(performance["average_percentage"]) == Decimal("65.00")
    assert Decimal(performance["pass_rate"]) == Decimal("66.67")

    failing = students_below_passing(date.today() - timedelta(days=1), date.today())
    failing_ids = {row["student"] for row in failing}
    assert students[1].pk in failing_ids
    assert students[0].pk not in failing_ids


def test_student_summary_reports_a_trend(group_with_students):
    group, students = group_with_students
    student = students[0]
    earlier = create_exam(group=group, name="Earlier Quiz", exam_type="quiz",
                          exam_date=date.today() - timedelta(days=20), max_score=Decimal("100"))
    later = create_exam(group=group, name="Later Quiz", exam_type="quiz",
                        exam_date=date.today(), max_score=Decimal("100"))
    record(earlier, [{"student": student.pk, "component": None, "score": Decimal("90")}])
    record(later, [{"student": student.pk, "component": None, "score": Decimal("95")}])

    summary = student_exam_summary(student)
    assert summary["exams_taken"] == 2
    assert summary["trend"] == "improving"
    assert float(summary["average_percentage"]) == 92.5

    history = student_exam_history(student)
    assert history["summary"]["exams_taken"] == 2
    assert len(history["results"]) == 2


def record(exam, entries):
    """Call record_results with raw dicts, tolerating serializer-validated dicts too."""
    from apps.exams.services import record_results

    return record_results(exam, entries)
