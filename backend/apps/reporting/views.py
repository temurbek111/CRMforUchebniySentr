"""Reporting API: dashboard, alerts, at-risk, reports, search, CSV export."""

from __future__ import annotations

from datetime import date

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Perm, RequirePerms

from . import services


def _range(request) -> tuple[date | None, date | None]:
    raw_from = request.query_params.get("from")
    raw_to = request.query_params.get("to")
    return (
        date.fromisoformat(raw_from) if raw_from else None,
        date.fromisoformat(raw_to) if raw_to else None,
    )


class DashboardView(APIView):
    """Everything the dashboard needs, in one request, from real data."""

    permission_classes = [RequirePerms(Perm.DASHBOARD_VIEW)]

    def get(self, request):
        return Response(services.dashboard_payload(request.user))


class AlertsView(APIView):
    permission_classes = [RequirePerms(Perm.DASHBOARD_VIEW)]

    def get(self, request):
        scope = services.alert_scope_for(request.user)
        return Response({"alerts": services.build_alerts(
            allowed_student_ids=scope["allowed_student_ids"],
            allowed_group_ids=scope["allowed_group_ids"],
            include_finance=scope["include_finance"],
            include_receivables=scope["include_receivables"],
            include_payroll=scope["include_payroll"],
        )})

    def post(self, request):
        """Materialise the current alerts into the notification centre.

        Restricted to roles that oversee the centre: this writes one row set for
        everyone, so it is not a per-teacher action.
        """
        if not (request.user.has_perm_code(Perm.REPORTS_VIEW)
                or request.user.has_perm_code(Perm.REPORTS_FINANCE)):
            return Response(
                {"detail": "You cannot refresh centre-wide alerts.",
                 "errors": {"non_field_errors": ["Permission denied."]}},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(services.sync_notifications(request.user))


class AtRiskView(APIView):
    permission_classes = [RequirePerms(Perm.REPORTS_VIEW)]

    def get(self, request):
        return Response({"students": services.at_risk_students(limit=200)})


class ReportView(APIView):
    """One endpoint per report name: /api/reports/<name>."""

    def get_permissions(self):
        finance_reports = {"finance", "management"}
        report = self.kwargs.get("name")
        if report in finance_reports:
            return [RequirePerms(Perm.REPORTS_FINANCE)()]
        return [RequirePerms(Perm.REPORTS_VIEW)()]

    def get(self, request, name: str):
        date_from, date_to = _range(request)
        try:
            payload = services.build_report(name, date_from, date_to)
        except ValueError as exc:
            return Response(
                {"detail": str(exc), "errors": {"name": [str(exc)]}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(payload)


class ReportExportView(APIView):
    """CSV download of any report. Excel opens it directly; PDF printing is done by the browser."""

    def get_permissions(self):
        report = self.kwargs.get("name")
        if report in {"finance", "management"}:
            return [RequirePerms(Perm.REPORTS_FINANCE)()]
        return [RequirePerms(Perm.REPORTS_VIEW)()]

    def get(self, request, name: str):
        date_from, date_to = _range(request)
        try:
            csv_text = services.report_to_csv(name, date_from, date_to)
        except ValueError as exc:
            return Response(
                {"detail": str(exc), "errors": {"name": [str(exc)]}},
                status=status.HTTP_404_NOT_FOUND,
            )
        response = HttpResponse(csv_text, content_type="text/csv; charset=utf-8")
        stamp = (date_to or date.today()).isoformat()
        response["Content-Disposition"] = f'attachment; filename="{name}-report-{stamp}.csv"'
        return response


class SearchView(APIView):
    """Global search. Teachers only see their own students and groups."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("q", "")
        restrict = None
        if request.user.role_code == "teacher":
            teacher = getattr(request.user, "teacher_profile", None)
            restrict = {"teacher_id": teacher.pk if teacher else -1}
        return Response(services.global_search(query, restrict=restrict))


@api_view(["GET"])
@permission_classes([RequirePerms(Perm.DASHBOARD_VIEW)])
def alerts_endpoint(request):
    return Response({"alerts": services.build_alerts()})
