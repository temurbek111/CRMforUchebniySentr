"""Payroll API: policies, runs, approval and payment."""

from __future__ import annotations

from datetime import date

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Teacher
from apps.core.audit import log_action
from apps.core.models import AuditLog
from apps.finance.services import payroll_payable

from . import services
from .models import PayrollItem, PayrollRun, SalaryPolicy
from .serializers import (
    CalculatePayrollSerializer,
    PayPayrollSerializer,
    PayrollItemSerializer,
    PayrollRunSerializer,
    SalaryPolicySerializer,
    SalaryPolicyWriteSerializer,
)


class SalaryPolicyViewSet(viewsets.ModelViewSet):
    queryset = SalaryPolicy.objects.select_related("teacher")
    serializer_class = SalaryPolicySerializer
    permission_classes = [RequirePerms(Perm.PAYROLL_VIEW)]
    filterset_fields = ["teacher", "model"]
    ordering = ["-effective_from"]
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [RequirePerms(Perm.PAYROLL_MANAGE)()]
        return [RequirePerms(Perm.PAYROLL_VIEW)()]

    def create(self, request, *args, **kwargs):
        serializer = SalaryPolicyWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        policy = services.set_salary_policy(actor=request.user, **serializer.validated_data)
        return Response(SalaryPolicySerializer(policy).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def current(self, request):
        """The policy in force today for every teacher (used by the salaries view)."""
        on_date = date.fromisoformat(request.query_params["date"]) if request.query_params.get("date") \
            else date.today()
        rows = []
        for teacher in Teacher.objects.filter(status="active"):
            policy = services.policy_for(teacher, on_date)
            rows.append({
                "teacher": teacher.pk,
                "teacher_name": teacher.full_name,
                "policy": SalaryPolicySerializer(policy).data if policy else None,
                "lessons_this_month": services.lessons_taught(
                    teacher, on_date.replace(day=1), on_date
                ),
            })
        return Response({"date": on_date, "results": rows})


class PayrollRunViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = PayrollRun.objects.prefetch_related("items__teacher").select_related("approved_by")
    serializer_class = PayrollRunSerializer
    permission_classes = [RequirePerms(Perm.PAYROLL_VIEW)]
    filterset_fields = ["status"]
    ordering = ["-period_start"]

    def get_permissions(self):
        if self.action in {"calculate", "pay"}:
            return [RequirePerms(Perm.PAYROLL_MANAGE)()]
        if self.action == "approve":
            return [RequirePerms(Perm.PAYROLL_APPROVE)()]
        return [RequirePerms(Perm.PAYROLL_VIEW)()]

    def retrieve(self, request, *args, **kwargs):
        return Response(services.run_summary(self.get_object()))

    @action(detail=False, methods=["post"])
    def calculate(self, request):
        """Calculate (or recalculate) a payroll run for a period."""
        serializer = CalculatePayrollSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        teachers = None
        if data.get("teacher_ids"):
            teachers = list(Teacher.objects.filter(pk__in=data["teacher_ids"]))
            if not teachers:
                return Response(
                    {"detail": "No matching teachers.", "errors": {"teacher_ids": ["No such teachers."]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        deductions = {int(key): value for key, value in (data.get("deductions") or {}).items()}
        run = services.calculate_payroll_run(
            period_start=data["period_start"], period_end=data["period_end"],
            actor=request.user, teachers=teachers, deductions=deductions,
            label=data.get("label") or None,
        )
        return Response(services.run_summary(run), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        run = services.approve_payroll_run(self.get_object(), actor=request.user)
        return Response(services.run_summary(run))

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        serializer = PayPayrollSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        run = services.mark_payroll_paid(
            self.get_object(), actor=request.user,
            method=serializer.validated_data["method"],
            paid_date=serializer.validated_data.get("paid_date"),
            reference=serializer.validated_data.get("reference", ""),
        )
        return Response(services.run_summary(run))

    @action(detail=False, methods=["get"])
    def payable(self, request):
        return Response({"payroll_payable": str(payroll_payable()),
                         "pending_runs": services.pending_payroll_runs()})


class PayrollItemViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = PayrollItem.objects.select_related("teacher", "run")
    serializer_class = PayrollItemSerializer
    permission_classes = [RequirePerms(Perm.PAYROLL_VIEW)]
    filterset_fields = ["run", "teacher"]
    ordering_fields = ["net_amount", "lessons_count"]
    ordering = ["teacher__first_name"]


class TeacherEarningsView(APIView):
    """A teacher's compensation history: policies applied and amounts paid."""

    permission_classes = [RequirePerms(Perm.PAYROLL_VIEW)]

    def get(self, request, teacher_id: int):
        from django.shortcuts import get_object_or_404

        teacher = get_object_or_404(Teacher, pk=teacher_id)
        return Response(services.teacher_earnings_history(teacher))
