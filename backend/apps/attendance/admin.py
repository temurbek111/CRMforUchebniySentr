from django.contrib import admin

from .models import AttendanceRecord, AttendanceSession


class AttendanceRecordInline(admin.TabularInline):
    model = AttendanceRecord
    extra = 0
    fields = ("student", "status", "reason", "note", "modified_by")


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ("group", "date", "state", "teacher", "submitted_at")
    list_filter = ("state", "group", "date")
    search_fields = ("group__name",)
    date_hierarchy = "date"
    inlines = [AttendanceRecordInline]


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ("student", "session", "status", "reason", "marked_at")
    list_filter = ("status", "reason")
    search_fields = ("student__first_name", "student__last_name", "student__code")
