"""CRM services: the lead pipeline from first contact to registered student.

Rules enforced here (not in the views):

- A lead is converted into **exactly one** student. If the lead was already
  converted the existing student is returned; if another student already holds
  the same phone number that student is reused instead of a duplicate person
  being created (plan sections 7 and 33).
- Every step writes a :class:`LeadActivity` and, where it is a state change, an
  audit entry, so the pipeline can be reconstructed after the fact.
- Lead sources are read from ``SystemSettings.lead_sources`` at runtime.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.academics.models import Group, Student, StudentLifecycle
from apps.academics.services import create_student, enroll_student
from apps.core.audit import log_action
from apps.core.models import DEFAULT_LEAD_SOURCES, AuditLog, SystemSettings

from .models import Lead, LeadActivity, LeadActivityKind, LeadStatus

PERCENT = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def lead_source_choices() -> list[tuple[str, str]]:
    """The administrator-managed source list, resolved at call time."""
    try:
        sources = list(SystemSettings.get_solo().lead_sources or [])
    except Exception:  # pragma: no cover - settings table not migrated yet
        sources = []
    if not sources:
        sources = list(DEFAULT_LEAD_SOURCES)
    return [(str(source), str(source)) for source in sources if str(source).strip()]


def _as_date(value, field: str = "date") -> date:
    if isinstance(value, date):
        return value
    parsed = parse_date(str(value)) if value else None
    if parsed is None:
        raise ValidationError({field: "A valid date is required."})
    return parsed


def _conversion_rate(registered: int, total: int) -> Decimal:
    """Registered leads as a percentage of the total, 2dp; 0 when there are none."""
    if not total:
        return ZERO
    return ((Decimal(registered) / Decimal(total)) * HUNDRED).quantize(
        PERCENT, rounding=ROUND_HALF_UP
    )


def _display_name(user) -> str:
    if user is None:
        return "Unassigned"
    return getattr(user, "full_name", "") or getattr(user, "username", "") or "Unassigned"


# --------------------------------------------------------------------------- #
# Leads
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_lead(
    *,
    full_name: str,
    phone: str,
    email: str = "",
    source: str = "",
    interested_course=None,
    assigned_to=None,
    notes: str = "",
    actor=None,
) -> Lead:
    """Create a lead at the top of the funnel and record it in the audit trail."""
    full_name = str(full_name or "").strip()
    phone = str(phone or "").strip()
    if not full_name:
        raise ValidationError({"full_name": "A lead needs a name."})
    if not phone:
        raise ValidationError({"phone": "A lead needs a phone number."})

    if assigned_to is None and getattr(actor, "pk", None):
        assigned_to = actor

    lead = Lead.objects.create(
        full_name=full_name,
        phone=phone,
        email=str(email or "").strip(),
        source=str(source or "").strip(),
        interested_course=interested_course,
        assigned_to=assigned_to,
        notes=notes or "",
        status=LeadStatus.NEW,
        status_changed_at=timezone.now(),
        created_by=actor if getattr(actor, "pk", None) else None,
    )
    log_action(
        AuditLog.Action.CREATE,
        lead,
        actor=actor,
        new={
            "full_name": lead.full_name,
            "phone": lead.phone,
            "source": lead.source,
            "status": lead.status,
            "assigned_to": lead.assigned_to_id,
        },
        summary=f"Created lead {lead.full_name} ({lead.phone})",
    )
    return lead


def log_activity(lead: Lead, kind: str, note: str, actor=None) -> LeadActivity:
    """Append one follow-up entry to a lead's timeline."""
    if kind not in LeadActivityKind.values:
        raise ValidationError({"kind": f"Unknown activity kind {kind!r}."})
    return LeadActivity.objects.create(
        lead=lead,
        kind=kind,
        note=str(note or "").strip(),
        actor=actor if getattr(actor, "pk", None) else None,
    )


@transaction.atomic
def change_lead_status(lead: Lead, status: str, *, actor=None, note: str = "") -> Lead:
    """Move a lead through the pipeline, dating and logging the transition."""
    if status not in LeadStatus.values:
        raise ValidationError({"status": f"Unknown lead status {status!r}."})

    previous = lead.status
    if previous == status:
        if note:
            log_activity(lead, LeadActivityKind.NOTE, note, actor)
        return lead

    lead.status = status
    lead.status_changed_at = timezone.now()
    update_fields = ["status", "status_changed_at", "updated_at"]

    if status == LeadStatus.LOST:
        lead.lost_reason = (note or lead.lost_reason or "Marked as lost")[:255]
        update_fields.append("lost_reason")
    else:
        lead.lost_reason = ""

    lead.save(update_fields=update_fields)

    log_activity(
        lead,
        LeadActivityKind.STATUS_CHANGE,
        note or f"Status changed from {previous} to {status}",
        actor,
    )
    log_action(
        AuditLog.Action.UPDATE,
        lead,
        actor=actor,
        old={"status": previous},
        new={"status": status, "note": note},
        summary=f"Lead {lead.full_name} status {previous} → {status}",
    )
    return lead


@transaction.atomic
def schedule_trial(lead: Lead, trial_date, *, actor=None) -> Lead:
    """Book a trial lesson and reflect it in the pipeline."""
    trial_date = _as_date(trial_date, "trial_date")
    lead.trial_date = trial_date
    lead.save(update_fields=["trial_date", "updated_at"])

    change_lead_status(
        lead,
        LeadStatus.TRIAL_SCHEDULED,
        actor=actor,
        note=f"Trial booked for {trial_date}",
    )
    log_activity(
        lead, LeadActivityKind.TRIAL_SCHEDULED, f"Trial scheduled for {trial_date}", actor
    )
    return lead


@transaction.atomic
def record_trial_completed(lead: Lead, *, attended: bool, note: str = "", actor=None) -> Lead:
    """Record the outcome of a trial. A no-show closes the lead as lost."""
    if attended:
        log_activity(lead, LeadActivityKind.TRIAL_COMPLETED, note or "Trial attended", actor)
        change_lead_status(lead, LeadStatus.TRIAL_COMPLETED, actor=actor, note=note or "Trial completed")
    else:
        reason = note or "Did not attend the trial"
        log_activity(lead, LeadActivityKind.TRIAL_COMPLETED, reason, actor)
        change_lead_status(lead, LeadStatus.LOST, actor=actor, note=reason)
    return lead


@transaction.atomic
def convert_lead_to_student(
    lead: Lead,
    *,
    group: Group | None = None,
    course=None,
    monthly_fee=None,
    start_date=None,
    actor=None,
    payment_terms: str = "",
) -> Student:
    """Turn a lead into a student without ever creating a duplicate person.

    Returns the ``Student``. Calling this twice returns the same student, and a
    student that already owns the lead's phone number is reused rather than
    duplicated; either path is recorded on the lead's activity timeline.
    """
    if lead.converted_student_id:
        return lead.converted_student

    start_date = _as_date(start_date, "start_date") if start_date else timezone.localdate()
    if group is not None and group.course_id:
        # A group implies the course actually being taken.
        course = group.course

    previous_status = lead.status
    first_name, last_name = lead.name_parts()
    reused = False

    student = None
    if lead.phone:
        student = Student.objects.filter(phone=lead.phone).first()

    if student is not None:
        reused = True
        changed_fields: list[str] = []
        if lead.email and not student.email:
            student.email = lead.email
            changed_fields.append("email")
        if lead.notes and not student.notes:
            student.notes = lead.notes
            changed_fields.append("notes")
        if changed_fields:
            student.save(update_fields=changed_fields + ["updated_at"])
        log_action(
            AuditLog.Action.UPDATE,
            student,
            actor=actor,
            new={"reused_for_lead": lead.pk},
            summary=f"Reused existing student {student.full_name} ({student.code}) for lead conversion",
        )
    else:
        student = create_student(
            first_name=first_name,
            last_name=last_name,
            phone=lead.phone,
            email=lead.email,
            notes=lead.notes,
            registered_at=start_date,
            status=StudentLifecycle.ACTIVE if group is not None else StudentLifecycle.TRIAL,
            monthly_fee_override=monthly_fee if group is None else None,
            actor=actor,
        )

    if group is not None:
        enroll_student(
            student=student,
            group=group,
            actor=actor,
            fee=monthly_fee,
            joined_at=start_date,
            note=payment_terms or "Converted from lead",
        )
    elif monthly_fee is not None and student.monthly_fee_override != monthly_fee:
        student.monthly_fee_override = monthly_fee
        student.save(update_fields=["monthly_fee_override", "updated_at"])

    lead.converted_student = student
    lead.status = LeadStatus.REGISTERED
    lead.status_changed_at = timezone.now()
    lead.lost_reason = ""
    if course is not None:
        lead.interested_course = course
    lead.save(
        update_fields=[
            "converted_student", "status", "status_changed_at", "lost_reason",
            "interested_course", "updated_at",
        ]
    )

    note_text = f"Converted to student {student.code} ({student.full_name})"
    if reused:
        note_text += " — an existing student with this phone number was reused, no duplicate created"
    if group is not None:
        note_text += f"; enrolled in {group.name}"
    if payment_terms:
        note_text += f"; {payment_terms}"
    log_activity(lead, LeadActivityKind.STATUS_CHANGE, note_text, actor)
    log_action(
        AuditLog.Action.UPDATE,
        lead,
        actor=actor,
        old={"status": previous_status},
        new={"status": lead.status, "student": student.pk, "reused": reused},
        summary=note_text,
    )
    return student


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def pipeline_metrics(date_from=None, date_to=None) -> dict:
    """Funnel snapshot for a period: counts, conversion rate and breakdowns."""
    date_from = _as_date(date_from, "from") if date_from else None
    date_to = _as_date(date_to, "to") if date_to else None

    leads = Lead.objects.between(date_from, date_to)
    counts = {
        row["status"]: row["total"]
        for row in leads.values("status").annotate(total=Count("id"))
    }

    total = sum(counts.values())
    registered = counts.get(LeadStatus.REGISTERED, 0)
    trials_scheduled = leads.with_trial().count()
    trials_completed = (
        LeadActivity.objects.filter(lead__in=leads, kind=LeadActivityKind.TRIAL_COMPLETED)
        .values("lead")
        .distinct()
        .count()
    )

    by_source = [
        {
            "source": row["source"] or "Unspecified",
            "leads": row["total"],
            "registered": row["registered"],
            "conversion_rate": _conversion_rate(row["registered"], row["total"]),
        }
        for row in leads.values("source")
        .annotate(
            total=Count("id"),
            registered=Count("id", filter=Q(status=LeadStatus.REGISTERED)),
        )
        .order_by("-total", "source")
    ]

    by_assignee = []
    for row in (
        leads.values(
            "assigned_to",
            "assigned_to__first_name",
            "assigned_to__last_name",
            "assigned_to__username",
        )
        .annotate(
            total=Count("id"),
            registered=Count("id", filter=Q(status=LeadStatus.REGISTERED)),
        )
        .order_by("-total")
    ):
        name = (
            f"{row['assigned_to__first_name']} {row['assigned_to__last_name']}".strip()
            or row["assigned_to__username"]
            or "Unassigned"
        )
        by_assignee.append(
            {
                "assigned_to": row["assigned_to"],
                "assigned_to_name": name,
                "leads": row["total"],
                "registered": row["registered"],
                "conversion_rate": _conversion_rate(row["registered"], row["total"]),
            }
        )

    return {
        "new_leads": total,
        "contacted": counts.get(LeadStatus.CONTACTED, 0),
        "trials_scheduled": trials_scheduled,
        "trials_completed": trials_completed,
        "interested": counts.get(LeadStatus.INTERESTED, 0),
        "registered": registered,
        "lost": counts.get(LeadStatus.LOST, 0),
        "conversion_rate": _conversion_rate(registered, total),
        "by_source": by_source,
        "by_assignee": by_assignee,
    }


def lead_timeline(lead: Lead, limit: int | None = None) -> list[dict]:
    """The lead's activity feed plus its audit entries, newest first."""
    events = [
        {
            "kind": f"activity:{activity.kind}",
            "title": activity.get_kind_display(),
            "detail": activity.note,
            "actor": _display_name(activity.actor) if activity.actor_id else "system",
            "at": activity.created_at.isoformat(),
        }
        for activity in lead.activities.select_related("actor")
    ]
    for entry in AuditLog.objects.filter(entity="lead", entity_id=str(lead.pk)).select_related("actor"):
        events.append(
            {
                "kind": f"audit:{entry.action}",
                "title": entry.summary or f"{entry.action} lead",
                "detail": "",
                "actor": entry.actor_label or "system",
                "at": entry.created_at.isoformat(),
            }
        )
    events.sort(key=lambda item: item["at"], reverse=True)
    return events[:limit] if limit else events
