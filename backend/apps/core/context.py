"""Request-scoped context for audit metadata.

Audit records need the acting user and the request metadata, but model-level
services must not require a request argument. A context variable carries it.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_current_request: ContextVar[Any | None] = ContextVar("current_request", default=None)


def set_current_request(request: Any | None) -> None:
    _current_request.set(request)


def get_current_request() -> Any | None:
    return _current_request.get()


def client_ip(request: Any | None = None) -> str | None:
    request = request or get_current_request()
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def user_agent(request: Any | None = None) -> str:
    request = request or get_current_request()
    if request is None:
        return ""
    return (request.META.get("HTTP_USER_AGENT") or "")[:255]
