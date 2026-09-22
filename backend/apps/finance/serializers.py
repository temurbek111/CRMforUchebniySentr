"""Finance serializers."""

from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.academics.models import Student

from .models import BillingPeriod, Expense, Income, Payment, StudentInvoice


class InvoiceSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_code = serializers.CharField(source="student.code", read_only=True)
    group_name = serializers.CharField(source="group.name", read_only=True, default="")
    amount_paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    remaining = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    credit = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    status = serializers.CharField(read_only=True)
    display_status = serializers.CharField(read_only=True)
    days_overdue = serializers.IntegerField(read_only=True)

    class Meta:
        model = StudentInvoice
        fields = (
            "id", "student", "student_name", "student_code", "group", "group_name",
            "period", "period_start", "period_end", "period_label", "amount_due",
            "amount_paid", "remaining", "credit", "due_date", "status", "display_status",
            "days_overdue", "waived_reason", "notes", "created_at",
        )


class InvoiceWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentInvoice
        fields = ("id", "student", "group", "period_start", "period_end", "amount_due",
                  "due_date", "notes")

    def validate(self, attrs):
        student = attrs.get("student", getattr(self.instance, "student", None))
        period_start = attrs.get("period_start", getattr(self.instance, "period_start", None))
        if self.instance is not None and self.instance.amount_paid > 0 and "amount_due" in attrs:
            if attrs["amount_due"] < self.instance.amount_paid:
                raise serializers.ValidationError({
                    "amount_due": "The amount due cannot be lowered below what has already been paid."
                })
        if student and period_start:
            clash = StudentInvoice.objects.filter(student=student, period_start=period_start)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    "period_start": "This student already has an invoice for that billing period."
                })
        return attrs


class PaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_code = serializers.CharField(source="student.code", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    receipt = serializers.CharField(source="receipt_number", read_only=True)
    period_label = serializers.CharField(source="invoice.period_label", read_only=True, default="")
    received_by_name = serializers.CharField(source="received_by.full_name", read_only=True, default="")

    class Meta:
        model = Payment
        fields = (
            "id", "receipt", "student", "student_name", "student_code", "invoice",
            "period_label", "amount", "paid_at", "method", "method_label", "received_by",
            "received_by_name", "reference", "notes", "is_void", "void_reason",
            "voided_at", "created_at",
        )


class PaymentWriteSerializer(serializers.Serializer):
    """Payment creation always goes through the service layer."""

    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    invoice = serializers.PrimaryKeyRelatedField(
        queryset=StudentInvoice.objects.all(), required=False, allow_null=True
    )
    method = serializers.ChoiceField(choices=Payment.Method.choices, default=Payment.Method.CASH)
    paid_at = serializers.DateField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    allow_overpayment = serializers.BooleanField(required=False, default=False)


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField()

    def validate_reason(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A reason is required.")
        return value.strip()


class IncomeSerializer(serializers.ModelSerializer):
    category_label_display = serializers.CharField(source="display_category", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True, default="")
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = Income
        fields = (
            "id", "category", "category_label", "category_label_display", "amount", "date",
            "description", "method", "method_label", "reference", "student", "student_name",
            "created_by_name", "is_void", "void_reason", "created_at",
        )
        read_only_fields = ("created_at", "is_void", "void_reason")


class ExpenseSerializer(serializers.ModelSerializer):
    category_label_display = serializers.CharField(source="display_category", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = Expense
        fields = (
            "id", "category", "category_label", "category_label_display", "amount", "date",
            "description", "method", "method_label", "reference", "created_by_name",
            "is_void", "void_reason", "created_at",
        )
        read_only_fields = ("created_at", "is_void", "void_reason")


class BillingPeriodSerializer(serializers.ModelSerializer):
    invoices_count = serializers.IntegerField(source="invoices.count", read_only=True)

    class Meta:
        model = BillingPeriod
        fields = ("id", "label", "period_start", "period_end", "due_date", "is_closed",
                  "invoices_count")

    def validate(self, attrs):
        start = attrs.get("period_start", getattr(self.instance, "period_start", None))
        end = attrs.get("period_end", getattr(self.instance, "period_end", None))
        due = attrs.get("due_date", getattr(self.instance, "due_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"period_end": "The period cannot end before it starts."})
        if start and end and due and not (start <= due <= end):
            raise serializers.ValidationError({"due_date": "The due date must fall inside the period."})
        return attrs


class GenerateInvoicesSerializer(serializers.Serializer):
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    due_date = serializers.DateField(required=False, allow_null=True)
    group = serializers.IntegerField(required=False, allow_null=True)
