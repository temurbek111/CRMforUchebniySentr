from django.contrib import admin

from .models import Lead, LeadActivity


class LeadActivityInline(admin.TabularInline):
    model = LeadActivity
    extra = 0
    fields = ("kind", "note", "actor", "created_at")
    readonly_fields = ("created_at",)


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = (
        "full_name", "phone", "source", "status", "assigned_to", "trial_date",
        "converted_student", "created_at",
    )
    list_filter = ("status", "source", "assigned_to")
    search_fields = ("full_name", "phone", "email")
    date_hierarchy = "created_at"
    readonly_fields = ("created_at", "updated_at", "status_changed_at")
    inlines = [LeadActivityInline]


@admin.register(LeadActivity)
class LeadActivityAdmin(admin.ModelAdmin):
    list_display = ("lead", "kind", "actor", "created_at")
    list_filter = ("kind",)
    search_fields = ("lead__full_name", "lead__phone", "note")
    date_hierarchy = "created_at"
