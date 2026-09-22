from django.contrib import admin

from .models import ScheduleSlot


@admin.register(ScheduleSlot)
class ScheduleSlotAdmin(admin.ModelAdmin):
    list_display = ("group", "weekday", "start_time", "end_time", "teacher", "room", "is_active")
    list_filter = ("weekday", "is_active", "room", "teacher")
    search_fields = ("group__name",)
