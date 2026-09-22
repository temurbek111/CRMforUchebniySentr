from django.contrib import admin

from .models import PayrollItem, PayrollRun, SalaryPolicy


class PayrollItemInline(admin.TabularInline):
    model = PayrollItem
    extra = 0
    readonly_fields = (
        "teacher", "lessons_count", "base_amount", "per_lesson_amount",
        "revenue_share_amount", "bonuses", "deductions", "gross_amount", "net_amount",
    )
    can_delete = False


@admin.register(SalaryPolicy)
class SalaryPolicyAdmin(admin.ModelAdmin):
    list_display = ("teacher", "model", "base_amount", "per_lesson_rate", "revenue_share_pct",
                    "effective_from", "effective_to")
    list_filter = ("model",)
    search_fields = ("teacher__first_name", "teacher__last_name")


@admin.register(PayrollRun)
class PayrollRunAdmin(admin.ModelAdmin):
    list_display = ("label", "period_start", "period_end", "status", "total_gross",
                    "total_deductions", "total_net")
    list_filter = ("status",)
    inlines = [PayrollItemInline]


@admin.register(PayrollItem)
class PayrollItemAdmin(admin.ModelAdmin):
    list_display = ("run", "teacher", "lessons_count", "gross_amount", "deductions", "net_amount")
    list_filter = ("run",)
    search_fields = ("teacher__first_name", "teacher__last_name")
