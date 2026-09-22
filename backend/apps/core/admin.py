from django.contrib import admin

from .models import AuditLog, Notification, SystemSettings


@admin.register(SystemSettings)
class SystemSettingsAdmin(admin.ModelAdmin):
    list_display = ("centre_name", "currency_code", "default_billing_day", "updated_at")
    readonly_fields = ("updated_at",)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor_label", "action", "entity", "entity_id", "summary")
    list_filter = ("action", "entity")
    search_fields = ("summary", "actor_label", "entity_id")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "title", "kind", "severity", "recipient", "role_scope", "read_at")
    list_filter = ("kind", "severity")
    search_fields = ("title", "body")
