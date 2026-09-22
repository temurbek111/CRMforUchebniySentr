"""Payroll serializers."""

from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.academics.models import Teacher

from .models import PayrollItem, PayrollRun, SalaryModel, SalaryPolicy


class SalaryPolicySerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True)
    model_label = serializers.CharField(source="get_model_display", read_only=True)
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = SalaryPolicy
        fields = (
            "id", "teacher", "teacher_name", "model", "model_label", "base_amount",
            "per_lesson_rate", "revenue_share_pct", "lesson_bonus", "effective_from",
            "effective_to", "is_open", "note", "created_at",
        )
        read_only_fields = ("created_at",)


class SalaryPolicyWriteSerializer(serializers.Serializer):
    """Policies are created through the service so versions close cleanly."""

    teacher = serializers.PrimaryKeyRelatedField(queryset=Teacher.objects.all())
    model = serializers.ChoiceField(choices=SalaryModel.choices)
    effective_from = serializers.DateField()
    base_amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False,
                                           default=Decimal("0"))
    per_lesson_rate = serializers.DecimalField(max_digits=14, decimal_places=2, required=False,
                                               default=Decimal("0"))
    revenue_share_pct = serializers.DecimalField(max_digits=5, decimal_places=2, required=False,
                                                 default=Decimal("0"))
    lesson_bonus = serializers.DecimalField(max_digits=14, decimal_places=2, required=False,
                                            default=Decimal("0"))
    note = serializers.CharField(required=False, allow_blank=True)


class PayrollItemSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True)

    class Meta:
        model = PayrollItem
        fields = (
            "id", "run", "teacher", "teacher_name", "lessons_count", "base_amount",
            "per_lesson_amount", "revenue_share_amount", "revenue_base", "bonuses",
            "deductions", "gross_amount", "net_amount", "policy_snapshot", "breakdown", "note",
        )


class PayrollRunSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    is_locked = serializers.BooleanField(read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")
    teachers_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = PayrollRun
        fields = (
            "id", "label", "period_start", "period_end", "status", "status_label",
            "is_locked", "total_gross", "total_deductions", "total_net", "teachers_count",
            "expense", "calculated_at", "approved_by", "approved_by_name", "approved_at",
            "paid_at", "notes", "created_at",
        )
        read_only_fields = (
            "label", "status", "total_gross", "total_deductions", "total_net", "expense",
            "calculated_at", "approved_by", "approved_at", "paid_at", "created_at",
        )


class CalculatePayrollSerializer(serializers.Serializer):
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    teacher_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    deductions = serializers.DictField(
        child=serializers.DecimalField(max_digits=14, decimal_places=2), required=False
    )
    label = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["period_end"] < attrs["period_start"]:
            raise serializers.ValidationError({"period_end": "The period cannot end before it starts."})
        return attrs


class PayPayrollSerializer(serializers.Serializer):
    method = serializers.ChoiceField(
        choices=["cash", "bank_transfer", "card", "online", "other"], default="bank_transfer"
    )
    paid_date = serializers.DateField(required=False, allow_null=True)
    reference = serializers.CharField(required=False, allow_blank=True)
