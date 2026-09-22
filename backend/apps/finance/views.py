"""Finance API: invoices, payments, income, expenses, summaries."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Perm, RequirePerms
from apps.academics.models import Group
from apps.core.audit import log_action
from apps.core.models import AuditLog
from apps.core.money import quantize

from . import services
from .models import BillingPeriod, Expense, Income, InvoiceStatus, Payment, StudentInvoice
from .serializers import (
    BillingPeriodSerializer,
    ExpenseSerializer,
    GenerateInvoicesSerializer,
    IncomeSerializer,
    InvoiceSerializer,
    InvoiceWriteSerializer,
    PaymentSerializer,
    PaymentWriteSerializer,
    VoidSerializer,
)


def parse_range(request, default_days: int = 30) -> tuple[date, date]:
    raw_from = request.query_params.get("from")
    raw_to = request.query_params.get("to")
    date_to = date.fromisoformat(raw_to) if raw_to else timezone.localdate()
    date_from = (
        date.fromisoformat(raw_from) if raw_from else date_to - timedelta(days=default_days - 1)
    )
    return date_from, date_to


class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = StudentInvoice.objects.select_related("student", "group", "period")
    permission_classes = [RequirePerms(Perm.INVOICES_VIEW)]
    filterset_fields = ["student", "group", "status", "period_start", "period"]
    search_fields = ["student__first_name", "student__last_name", "student__code", "period_label"]
    ordering_fields = ["period_start", "due_date", "amount_due"]
    ordering = ["-period_start"]

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return InvoiceWriteSerializer
        return InvoiceSerializer

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "waive", "cancel"}:
            return [RequirePerms(Perm.INVOICES_MANAGE)()]
        return [RequirePerms(Perm.INVOICES_VIEW)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        overdue = self.request.query_params.get("overdue")
        if overdue in {"1", "true", "True"}:
            queryset = queryset.filter(due_date__lt=timezone.localdate()).exclude(
                status__in=[InvoiceStatus.WAIVED, InvoiceStatus.CANCELLED, InvoiceStatus.PAID]
            )
        return queryset

    def perform_create(self, serializer):
        invoice = serializer.save(created_by=self.request.user)
        log_action(AuditLog.Action.CREATE, invoice, actor=self.request.user,
                   new={"student": invoice.student_id, "amount_due": str(invoice.amount_due),
                        "period": invoice.period_label},
                   summary=f"Invoice created for {invoice.student.full_name}: {invoice.amount_due}",
                   request=self.request)

    def perform_update(self, serializer):
        before = {"amount_due": str(serializer.instance.amount_due),
                  "due_date": str(serializer.instance.due_date), "notes": serializer.instance.notes}
        invoice = serializer.save()
        log_action(AuditLog.Action.UPDATE, invoice, actor=self.request.user, old=before,
                   new={"amount_due": str(invoice.amount_due), "due_date": str(invoice.due_date),
                        "notes": invoice.notes},
                   summary=f"Invoice updated for {invoice.student.full_name} ({invoice.period_label})",
                   request=self.request)

    def destroy(self, request, *args, **kwargs):
        """Invoices with payments are cancelled, never deleted."""
        invoice = self.get_object()
        if invoice.amount_paid > 0:
            return Response(
                {"detail": "An invoice that already has payments cannot be deleted - cancel it instead.",
                 "errors": {"non_field_errors": ["Payments exist for this invoice."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        log_action(AuditLog.Action.DELETE, invoice, actor=request.user,
                   old={"student": invoice.student_id, "period": invoice.period_label},
                   summary=f"Deleted invoice for {invoice.student.full_name} ({invoice.period_label})",
                   request=request)
        invoice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def waive(self, request, pk=None):
        invoice = self.get_object()
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice.status = InvoiceStatus.WAIVED
        invoice.waived_reason = serializer.validated_data["reason"]
        invoice.save(update_fields=["status", "waived_reason", "updated_at"])
        log_action(AuditLog.Action.UPDATE, invoice, actor=request.user,
                   new={"status": "waived", "reason": invoice.waived_reason},
                   summary=f"Waived invoice {invoice.period_label} for {invoice.student.full_name}",
                   request=request)
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invoice = self.get_object()
        if invoice.amount_paid > 0:
            return Response(
                {"detail": "Void the payments before cancelling this invoice.",
                 "errors": {"non_field_errors": ["Payments exist."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice.status = InvoiceStatus.CANCELLED
        invoice.notes = serializer.validated_data["reason"][:255]
        invoice.save(update_fields=["status", "notes", "updated_at"])
        log_action(AuditLog.Action.UPDATE, invoice, actor=request.user, new={"status": "cancelled"},
                   summary=f"Cancelled invoice {invoice.period_label} for {invoice.student.full_name}",
                   request=request)
        return Response(InvoiceSerializer(invoice).data)


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                     viewsets.GenericViewSet):
    """Payments can be created and voided. They are never edited or deleted."""

    queryset = Payment.objects.select_related("student", "invoice", "received_by")
    serializer_class = PaymentSerializer
    permission_classes = [RequirePerms(Perm.INVOICES_VIEW)]
    filterset_fields = ["student", "invoice", "method", "paid_at", "is_void"]
    search_fields = ["student__first_name", "student__last_name", "student__code", "reference"]
    ordering_fields = ["paid_at", "amount", "created_at"]
    ordering = ["-paid_at", "-id"]

    def get_permissions(self):
        if self.action in {"create", "void"}:
            return [RequirePerms(Perm.PAYMENTS_MANAGE)()]
        return [RequirePerms(Perm.INVOICES_VIEW)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("date_from"):
            queryset = queryset.filter(paid_at__gte=self.request.query_params["date_from"])
        if self.request.query_params.get("date_to"):
            queryset = queryset.filter(paid_at__lte=self.request.query_params["date_to"])
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = PaymentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment = services.record_payment(
            student=data["student"], amount=data["amount"], invoice=data.get("invoice"),
            method=data["method"], paid_at=data.get("paid_at"),
            received_by=request.user, reference=data.get("reference", ""),
            notes=data.get("notes", ""), actor=request.user,
            allow_overpayment=bool(data.get("allow_overpayment")),
        )
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        payment = self.get_object()
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.void_payment(payment, serializer.validated_data["reason"], actor=request.user)
        return Response(PaymentSerializer(payment).data)


class IncomeViewSet(viewsets.ModelViewSet):
    serializer_class = IncomeSerializer
    permission_classes = [RequirePerms(Perm.FINANCE_VIEW)]
    filterset_fields = ["category", "method", "date", "is_void", "student"]
    search_fields = ["description", "reference", "category_label"]
    ordering_fields = ["date", "amount"]
    ordering = ["-date"]

    def get_queryset(self):
        return Income.objects.select_related("student", "created_by")

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "void"}:
            return [RequirePerms(Perm.INCOME_MANAGE)()]
        return [RequirePerms(Perm.FINANCE_VIEW)()]

    def create(self, request, *args, **kwargs):
        serializer = IncomeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("created_by", None)
        income = services.create_income(actor=request.user, **data)
        return Response(IncomeSerializer(income).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        income = self.get_object()
        if income.is_void:
            return Response(
                {"detail": "Voided records cannot be edited.",
                 "errors": {"non_field_errors": ["Record is void."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = IncomeSerializer(income, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = {"amount": str(income.amount), "category": income.category}
        income = serializer.save()
        log_action(AuditLog.Action.UPDATE, income, actor=request.user, old=before,
                   new={"amount": str(income.amount), "category": income.category},
                   summary=f"Income updated: {income.display_category} {income.amount}",
                   request=request)
        return Response(IncomeSerializer(income).data)

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Financial records are voided, not deleted.",
             "errors": {"non_field_errors": ["Use POST /void with a reason."]}},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        income = services.void_income(self.get_object(), serializer.validated_data["reason"],
                                     actor=request.user)
        return Response(IncomeSerializer(income).data)


class ExpenseViewSet(IncomeViewSet):
    serializer_class = ExpenseSerializer
    filterset_fields = ["category", "method", "date", "is_void", "reference"]
    ordering_fields = ["date", "amount"]

    def get_queryset(self):
        return Expense.objects.select_related("created_by")

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "void"}:
            return [RequirePerms(Perm.EXPENSES_MANAGE)()]
        return [RequirePerms(Perm.FINANCE_VIEW)()]

    def create(self, request, *args, **kwargs):
        serializer = ExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("created_by", None)
        expense = services.create_expense(actor=request.user, **data)
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        expense = self.get_object()
        if expense.is_void:
            return Response(
                {"detail": "Voided records cannot be edited.",
                 "errors": {"non_field_errors": ["Record is void."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ExpenseSerializer(expense, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = {"amount": str(expense.amount), "category": expense.category}
        expense = serializer.save()
        log_action(AuditLog.Action.UPDATE, expense, actor=request.user, old=before,
                   new={"amount": str(expense.amount), "category": expense.category},
                   summary=f"Expense updated: {expense.display_category} {expense.amount}",
                   request=request)
        return Response(ExpenseSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expense = services.void_expense(self.get_object(), serializer.validated_data["reason"],
                                       actor=request.user)
        return Response(ExpenseSerializer(expense).data)


class BillingPeriodViewSet(viewsets.ModelViewSet):
    queryset = BillingPeriod.objects.all()
    serializer_class = BillingPeriodSerializer
    permission_classes = [RequirePerms(Perm.INVOICES_VIEW)]
    ordering = ["-period_start"]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "generate"}:
            return [RequirePerms(Perm.INVOICES_MANAGE)()]
        return [RequirePerms(Perm.INVOICES_VIEW)()]

    @action(detail=False, methods=["post"])
    def generate(self, request):
        """Idempotent monthly billing run across every active student with a fee."""
        serializer = GenerateInvoicesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = None
        if data.get("group"):
            group = Group.objects.filter(pk=data["group"]).first()
            if group is None:
                raise DjangoValidationError({"group": "Group not found."})
        result = services.generate_monthly_invoices(
            year=data["year"], month=data["month"], due_date=data.get("due_date"),
            group=group, actor=request.user,
        )
        log_action(AuditLog.Action.CREATE, "billingperiod", actor=request.user,
                   new={"period": result["period"], "created": result["created"]},
                   summary=f"Generated {result['created']} invoices for {result['period']}",
                   request=request)
        return Response(result, status=status.HTTP_201_CREATED)


class FinanceSummaryView(APIView):
    """Aggregate financial figures straight from the database."""

    permission_classes = [RequirePerms(Perm.FINANCE_VIEW)]

    def get(self, request, kind=None):
        if kind == "outstanding":
            return Response(services.outstanding_receivables())
        if kind == "revenue-by-course":
            date_from, date_to = parse_range(request, 90)
            return Response({"from": date_from, "to": date_to,
                             "results": services.revenue_by_course(date_from, date_to)})
        if kind == "breakdown":
            date_from, date_to = parse_range(request)
            return Response({
                "from": date_from, "to": date_to,
                "income": services.income_breakdown(date_from, date_to),
                "expenses": services.expense_breakdown(date_from, date_to),
            })
        if kind == "monthly":
            year = int(request.query_params.get("year") or timezone.localdate().year)
            month = int(request.query_params.get("month") or timezone.localdate().month)
            return Response(services.monthly_financial_summary(year, month))
        if kind == "series":
            year = int(request.query_params.get("year") or timezone.localdate().year)
            return Response({"year": year, "series": services.monthly_financial_series(year)})

        date_from, date_to = parse_range(request)
        return Response(services.finance_summary(date_from, date_to))
