"""Audit trail write-path.

Usage from a service or view::

    log_action(AuditLog.Action.UPDATE, student, old=before, new=after,
               summary="Monthly fee changed")

`old`/`new` are JSON snapshots; values are always coerced to JSON-safe types so
a Decimal or a date can never break the trail.
"""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Iterable

from django.db import models

from .context import client_ip, user_agent
from .models import AuditLog

MAX_STRING = 500


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, models.Model):
        return value.pk
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    return str(value)


def snapshot(instance: models.Model, fields: Iterable[str] | None = None) -> dict:
    """JSON-safe snapshot of a model instance (optionally limited to `fields`)."""
    names = list(fields) if fields else [
        f.name
        for f in instance._meta.concrete_fields
        if f.name != "id"
    ]
    data: dict[str, Any] = {"id": instance.pk}
    for name in names:
        try:
            data[name] = json_safe(getattr(instance, name))
        except AttributeError:  # pragma: no cover - defensive
            continue
    return data


def diff(old: dict | None, new: dict | None) -> dict:
    """Only the changed keys, so the audit log stays readable."""
    old = old or {}
    new = new or {}
    changed: dict[str, Any] = {}
    for key in set(old) | set(new):
        if old.get(key) != new.get(key):
            changed[key] = {"from": old.get(key), "to": new.get(key)}
    return changed


def log_action(
    action: str,
    entity: str | models.Model,
    *,
    actor=None,
    entity_id: str | int | None = None,
    old: dict | None = None,
    new: dict | None = None,
    summary: str = "",
    request=None,
) -> AuditLog:
    """Record an auditable action. Never raises on missing context."""
    if isinstance(entity, models.Model):
        entity_name = entity.__class__.__name__.lower()
        entity_pk = entity_id if entity_id is not None else entity.pk
    else:
        entity_name = str(entity)
        entity_pk = entity_id

    if actor is None:
        from .context import get_current_request

        current = request or get_current_request()
        user = getattr(current, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            actor = user

    label = ""
    if actor is not None:
        label = (getattr(actor, "get_full_name", lambda: "")() or getattr(actor, "username", "")) or ""

    return AuditLog.objects.create(
        actor=actor if getattr(actor, "pk", None) else None,
        actor_label=label[:160],
        action=action,
        entity=entity_name[:64],
        entity_id=str(entity_pk)[:64] if entity_pk is not None else "",
        summary=(summary or "")[:255],
        old_value=json_safe(old or {}),
        new_value=json_safe(new or {}),
        ip_address=client_ip(request) or None,
        user_agent=user_agent(request),
    )
