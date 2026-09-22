from django.contrib import admin

from .models import Exam, ExamComponent, ExamResult


class ExamComponentInline(admin.TabularInline):
    model = ExamComponent
    extra = 0
    fields = ("name", "max_score", "order")


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "course", "exam_type", "date", "max_score", "passing_score", "is_published")
    list_filter = ("exam_type", "is_published", "course", "date")
    search_fields = ("name", "group__name", "course__name")
    date_hierarchy = "date"
    inlines = [ExamComponentInline]


@admin.register(ExamComponent)
class ExamComponentAdmin(admin.ModelAdmin):
    list_display = ("exam", "name", "max_score", "order")
    list_filter = ("exam",)
    search_fields = ("name", "exam__name")


@admin.register(ExamResult)
class ExamResultAdmin(admin.ModelAdmin):
    list_display = ("exam", "component", "student", "score", "max_score", "percentage", "grade")
    list_filter = ("grade", "exam")
    search_fields = ("student__first_name", "student__last_name", "student__code", "exam__name")
    readonly_fields = ("percentage", "grade", "created_at")
