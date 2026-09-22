from django.contrib import admin

from .models import BillingPeriod, Expense, Income, Payment, StudentInvoice


@admin.register(StudentInvoice)
class StudentInvoiceAdmin(admin.ModelAdmin):
    list_display = ("student", "period_label", "amount_due", "status", "due_date")
    list_filter = ("status", "period_label")
    search_fields = ("student__first_name", "student__last_name", "student__code")
    date_hierarchy = "period_start"


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("receipt_number", "student", "amount", "paid_at", "method", "is_void")
    list_filter = ("method", "is_void", "paid_at")
    search_fields = ("student__first_name", "student__last_name", "student__code", "reference")
    date_hierarchy = "paid_at"

    def has_delete_permission(self, request, obj=None):
        return False   # payments are voided, never deleted


@admin.register(Income)
class IncomeAdmin(admin.ModelAdmin):
    list_display = ("date", "display_category", "amount", "method", "is_void")
    list_filter = ("category", "method", "is_void")
    search_fields = ("description", "reference")


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("date", "display_category", "amount", "method", "is_void")
    list_filter = ("category", "method", "is_void")
    search_fields = ("description", "reference")


@admin.register(BillingPeriod)
class BillingPeriodAdmin(admin.ModelAdmin):
    list_display = ("label", "period_start", "period_end", "due_date", "is_closed")
