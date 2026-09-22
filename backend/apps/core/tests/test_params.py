"""Date query parameters must be parsed, not trusted.

The product bug this covers: `GET /api/attendance/incomplete/?date=2026-09-15`
returned HTTP 500 because the view handed the raw query string to a service that
called `.weekday()` on it. A malformed value did the same. Both are client
errors and must surface as a clean 400 with a field-mapped body.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role
from apps.core.params import query_date
from tests.factories import enroll, make_group, make_student, make_teacher, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager_client():
    Role.objects.get_or_create(code="manager", defaults={"name": "Manager"})
    client = APIClient()
    client.force_authenticate(make_user("boss", "manager"))
    return client


def test_query_date_parses_and_rejects():
    assert query_date("2026-09-15", field="date") == date(2026, 9, 15)
    assert query_date(None, field="date") is None
    assert query_date("", field="date") is None
    assert query_date("   ", field="date") is None
    # An already-parsed date passes through (services call this too).
    assert query_date(date(2026, 9, 15), field="date") == date(2026, 9, 15)
    # Two leniencies are deliberate: Django's parse_date accepts an unpadded
    # month/day ("2026-9-5") and Python 3.11+ accepts the compact ISO form
    # ("20260915"). Both are unambiguous, so both are accepted.
    assert query_date("2026-9-5", field="date") == date(2026, 9, 5)
    assert query_date("20260915", field="date") == date(2026, 9, 15)

    for bad in ("not-a-date", "2026-13-45", "2026-02-30", "15/09/2026", "2026-", "tomorrow"):
        with pytest.raises(Exception) as caught:
            query_date(bad, field="date")
        assert "not a valid date" in str(getattr(caught.value, "detail", caught.value))


@pytest.fixture
def centre_with_a_lesson():
    """A group with a student and a weekly slot, so a past date has a class."""
    teacher = make_teacher("Kate", "Nazarova")
    group = make_group(teacher=teacher, name="IELTS Evening A")
    student = make_student("Ali", "Karimov")
    enroll(student, group)
    return group, student


def test_incomplete_returns_200_for_a_date_with_classes(manager_client, centre_with_a_lesson):
    """The regression: this endpoint answered 500 for every date."""
    group, _student = centre_with_a_lesson
    day = date.today() - timedelta(days=1)
    response = manager_client.get(f"/api/attendance/incomplete/?date={day.isoformat()}")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert set(body.keys()) == {"date", "results"}
    assert body["date"] == day.isoformat()
    assert isinstance(body["results"], list)


def test_incomplete_defaults_to_today_when_no_date_is_given(manager_client):
    response = manager_client.get("/api/attendance/incomplete/")
    assert response.status_code == 200, response.json()
    assert response.json()["date"] == date.today().isoformat()


@pytest.mark.parametrize("bad", ["not-a-date", "2026-13-45", "2026-02-30", "banana", "15/09/2026"])
def test_malformed_dates_are_400_not_500(manager_client, bad):
    endpoints = [
        f"/api/attendance/incomplete/?date={bad}",
        f"/api/attendance/summary/?date_from={bad}",
        f"/api/attendance/absences/?date_from={bad}",
        f"/api/attendance-records/?date_from={bad}",
        f"/api/attendance/?date_from={bad}",
    ]
    for path in endpoints:
        response = manager_client.get(path)
        assert response.status_code == 400, f"{path} → {response.status_code}"


def test_the_error_body_names_the_offending_field(manager_client):
    response = manager_client.get("/api/attendance/incomplete/?date=not-a-date")
    assert response.status_code == 400
    body = response.json()
    assert "date" in body["errors"]
    assert "not-a-date" in body["errors"]["date"][0]


def test_valid_date_filters_still_work(manager_client):
    response = manager_client.get(
        "/api/attendance/summary/?date_from=2026-09-01&date_to=2026-09-20"
    )
    assert response.status_code == 200, response.json()
