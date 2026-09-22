"""CRM rules: the pipeline, trials, and converting a lead without duplicating people."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from django.core.exceptions import ValidationError

from apps.academics.models import Student
from apps.crm.models import Lead, LeadActivity, LeadStatus
from apps.crm.services import (
    change_lead_status,
    convert_lead_to_student,
    create_lead,
    lead_timeline,
    log_activity,
    pipeline_metrics,
    record_trial_completed,
    schedule_trial,
)
from tests.factories import make_course, make_group, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def receptionist():
    return make_user("front.desk", "receptionist")


def test_a_lead_needs_a_name_and_a_phone():
    with pytest.raises(ValidationError):
        create_lead(full_name="", phone="+998****1111")
    with pytest.raises(ValidationError):
        create_lead(full_name="Aziza Karimova", phone="")


def test_new_lead_starts_at_the_top_of_the_pipeline(receptionist):
    lead = create_lead(full_name="Aziza Karimova", phone="+998****1111",
                       source="Instagram", actor=receptionist)
    assert lead.status == LeadStatus.NEW
    assert lead.assigned_to_id == receptionist.pk      # assigned to whoever logged it
    assert lead.status_changed_at is not None


def test_sources_are_free_text_driven_by_settings_not_hardcoded(receptionist):
    course = make_course("IELTS", "IELTS Preparation")
    lead = create_lead(full_name="Bekzod Tursunov", phone="+998****2222",
                       source="Instagram", interested_course=course, actor=receptionist)
    assert lead.source == "Instagram"
    assert lead.interested_course_id == course.pk


def test_status_moves_are_validated(receptionist):
    lead = create_lead(full_name="Sardor Aliyev", phone="+998****3333", actor=receptionist)
    with pytest.raises(ValidationError):
        change_lead_status(lead, "not_a_real_status", actor=receptionist)
    change_lead_status(lead, LeadStatus.CONTACTED, actor=receptionist, note="Called")
    assert lead.status == LeadStatus.CONTACTED
    assert LeadActivity.objects.filter(lead=lead).exists()


def test_scheduling_and_completing_a_trial(receptionist):
    lead = create_lead(full_name="Madina Yusupova", phone="+998****4444", actor=receptionist)
    trial_day = date.today() + timedelta(days=2)
    lead = schedule_trial(lead, trial_day, actor=receptionist)
    assert lead.status == LeadStatus.TRIAL_SCHEDULED
    assert lead.trial_date == trial_day

    lead = record_trial_completed(lead, attended=True, note="Came with her mother",
                                  actor=receptionist)
    assert lead.status == LeadStatus.TRIAL_COMPLETED
    timeline = lead_timeline(lead)
    kinds = {entry["kind"] for entry in timeline}
    assert "activity:trial_scheduled" in kinds
    assert "activity:trial_completed" in kinds


def test_conversion_creates_one_student_and_links_the_lead(receptionist):
    group = make_group(name="IELTS Evening A")
    lead = create_lead(full_name="Ali Karimov", phone="+998****5555", actor=receptionist)

    student = convert_lead_to_student(lead, group=group, start_date=date.today(),
                                      actor=receptionist)
    lead.refresh_from_db()
    assert isinstance(student, Student)
    assert student.phone == lead.phone
    assert lead.converted_student_id == student.pk
    assert lead.status == LeadStatus.REGISTERED
    # The student is enrolled in the group the lead was registered into.
    assert student.group_memberships.filter(group=group, left_at__isnull=True).exists()
    # The historical lead record is preserved, never overwritten.
    assert Lead.objects.filter(pk=lead.pk).exists()


def test_conversion_is_idempotent(receptionist):
    lead = create_lead(full_name="Zarina Saidova", phone="+998****6666", actor=receptionist)
    first = convert_lead_to_student(lead, actor=receptionist)
    second = convert_lead_to_student(lead, actor=receptionist)
    assert first.pk == second.pk
    assert Student.objects.filter(phone="+998****6666").count() == 1


def test_conversion_reuses_an_existing_person_instead_of_duplicating(receptionist):
    """A returning student who phones again must not become a second record."""
    lead = create_lead(full_name="Rustam Nazarov", phone="+998****7777", actor=receptionist,
                       notes="Asking about the maths group")
    existing = Student.objects.create(first_name="Rustam", last_name="Nazarov",
                                     phone="+998****7777")
    converted = convert_lead_to_student(lead, actor=receptionist)
    assert converted.pk == existing.pk
    assert Student.objects.filter(phone="+998****7777").count() == 1
    # The reuse is recorded on the lead's timeline.
    assert LeadActivity.objects.filter(lead=lead).exists()


def test_pipeline_metrics_count_the_funnel(receptionist):
    today = date.today()
    for index in range(4):
        create_lead(full_name=f"Lead {index}", phone=f"+998****1{index:03d}",
                    source="Telegram", actor=receptionist)
    convert_one = Lead.objects.first()
    convert_lead_to_student(convert_one, actor=receptionist)
    lost = Lead.objects.last()
    change_lead_status(lost, LeadStatus.LOST, actor=receptionist, note="Chose another centre")

    metrics = pipeline_metrics(today.replace(day=1), today)
    assert metrics["registered"] >= 1
    assert metrics["lost"] >= 1
    assert metrics["new_leads"] >= 4
    assert 0 <= float(metrics["conversion_rate"]) <= 100
    assert any(row["source"] == "Telegram" for row in metrics["by_source"])


def test_activity_logging_validates_kind():
    lead = create_lead(full_name="Nilufar Ergasheva", phone="+998****8888")
    with pytest.raises(ValidationError):
        log_activity(lead, "carrier_pigeon", "not a channel")
    entry = log_activity(lead, "call", "Left a voicemail")
    assert entry.kind == "call"
