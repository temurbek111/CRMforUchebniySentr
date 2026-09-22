"""Serializers for runtime settings, notifications and the audit trail."""

from __future__ import annotations

from rest_framework import serializers

from .models import AuditLog, Notification, SystemSettings


class SystemSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSettings
        exclude = ("id",)
        read_only_fields = ("updated_at",)

    def validate_payment_methods(self, value):
        return self._validate_string_list(value, "payment methods")

    def validate_lead_sources(self, value):
        return self._validate_string_list(value, "lead sources")

    def validate_income_categories(self, value):
        return self._validate_string_list(value, "income categories")

    def validate_expense_categories(self, value):
        return self._validate_string_list(value, "expense categories")

    @staticmethod
    def _validate_string_list(value, label: str) -> list[str]:
        if not isinstance(value, list):
            raise serializers.ValidationError(f"{label.capitalize()} must be a list of names.")
        cleaned: list[str] = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise serializers.ValidationError(f"Each of the {label} must be a non-empty name.")
            name = item.strip()
            if name not in cleaned:
                cleaned.append(name)
        if not cleaned:
            raise serializers.ValidationError(f"At least one of the {label} is required.")
        return cleaned


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)

    class Meta:
        model = Notification
        fields = (
            "id", "kind", "severity", "title", "body", "link", "payload",
            "read_at", "is_read", "created_at",
        )
        read_only_fields = fields


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor_label", read_only=True)

    class Meta:
        model = AuditLog
        fields = (
            "id", "actor", "actor_name", "action", "entity", "entity_id",
            "summary", "old_value", "new_value", "ip_address", "created_at",
        )
        read_only_fields = fields
