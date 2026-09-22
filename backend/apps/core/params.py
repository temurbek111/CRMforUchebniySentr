"""Parsing helpers for query-string parameters.

Query parameters arrive as raw strings. Passing them straight into a service
that expects a `date` produces an unhandled `AttributeError` deep inside domain
code — which surfaces to the user as a 500 and a stack trace in the log. Every
date parameter is parsed once, here, and rejected with a clean 400 when the client
sends something that is not a date.

The product bug this exists for: `/api/attendance/incomplete/?date=2026-09-15`
returned HTTP 500 because the view handed the string to a service that called
`.weekday()` on it.
"""

from __future__ import annotations

from datetime import date

from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError


def query_date(value, *, field: str) -> date | None:
    """Parse an ISO `YYYY-MM-DD` query parameter.

    Returns ``None`` for a missing or empty value so callers can apply their own
    default. Raises a 400 (DRF ``ValidationError``, mapped to
    ``{"detail", "errors": {field: [...]}}`` by the project's exception handler)
    when the value is present but not a date.
    """
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    try:
        parsed = parse_date(text)
    except (ValueError, TypeError):
        # Django's parse_date matches the YYYY-MM-DD shape with a regex and then
        # constructs datetime.date(**kw), so a syntactically valid but
        # impossible date ("2026-13-45") raises ValueError instead of returning
        # None. Bad input must be a 400 here, never a 500 further down.
        parsed = None
    if parsed is None:
        raise ValidationError({
            field: f"'{value}' is not a valid date. Use the format YYYY-MM-DD.",
        })
    return parsed
