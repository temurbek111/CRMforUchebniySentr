"""Uniform API error bodies (plan section 57).

Every error leaves the API as::

    {"detail": "Human readable message", "errors": {"field": ["..."]}}

Raw stack traces are never returned to clients: unexpected exceptions become a
500 with a generic message and Django still logs the traceback server-side.
"""

from __future__ import annotations

import logging
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def _flatten_errors(detail: Any) -> dict[str, list[str]]:
    """Normalise DRF's nested error structures into {field: [messages]}."""
    if isinstance(detail, dict):
        flat: dict[str, list[str]] = {}
        for key, value in detail.items():
            messages = _flatten_list(value)
            flat[str(key)] = messages
        return flat
    if isinstance(detail, list):
        return {"non_field_errors": _flatten_list(detail)}
    return {"non_field_errors": [str(detail)]}


def _flatten_list(value: Any) -> list[str]:
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_flatten_list(item))
        return out
    if isinstance(value, dict):
        out = []
        for key, item in value.items():
            out.extend(f"{key}: {msg}" for msg in _flatten_list(item))
        return out
    return [str(value)]


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)

    if response is not None:
        detail = response.data
        if isinstance(exc, ValidationError):
            message = "Validation failed."
        else:
            message = _flatten_list(detail)[0] if detail else "Request failed."
        response.data = {"detail": message, "errors": _flatten_errors(detail)}
        return response

    if isinstance(exc, Http404):
        return Response(
            {"detail": "Not found.", "errors": {"non_field_errors": ["Not found."]}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if isinstance(exc, DjangoPermissionDenied):
        return Response(
            {"detail": "You do not have permission to perform this action.",
             "errors": {"non_field_errors": ["Permission denied."]}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if isinstance(exc, DjangoValidationError):
        # Domain services raise Django's ValidationError; the API renders it as 400.
        detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
        return Response(
            {"detail": "Validation failed.", "errors": _flatten_errors(detail)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(exc, IntegrityError):
        logger.warning("Integrity error: %s", exc)
        return Response(
            {"detail": "The operation conflicts with existing data.",
             "errors": {"non_field_errors": ["Database constraint violated."]}},
            status=status.HTTP_409_CONFLICT,
        )

    logger.exception("Unhandled API exception in %s", context.get("view"))
    return Response(
        {"detail": "An unexpected server error occurred.",
         "errors": {"non_field_errors": ["Internal server error."]}},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
