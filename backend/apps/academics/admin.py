from django.contrib import admin

from .models import (
    Course,
    Group,
    GroupMembership,
    Guardian,
    Room,
    Student,
    StudentNote,
    Teacher,
    TeacherGroupAssignment,
)


class GroupMembershipInline(admin.TabularInline):
    model = GroupMembership
    extra = 0
    fields = ("student", "joined_at", "left_at", "status", "monthly_fee", "note")


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ("code", "full_name", "status", "phone", "registered_at")
    list_filter = ("status", "gender")
    search_fields = ("code", "first_name", "last_name", "phone")
    readonly_fields = ("code", "created_at", "updated_at")
    inlines = [GroupMembershipInline]


@admin.register(Teacher)
class TeacherAdmin(admin.ModelAdmin):
    list_display = ("full_name", "specialization", "employment_type", "status", "user")
    list_filter = ("status", "employment_type")
    search_fields = ("first_name", "last_name", "phone", "email")


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ("name", "course", "teacher", "room", "capacity", "monthly_fee", "status")
    list_filter = ("status", "course", "teacher")
    search_fields = ("name",)
    inlines = [GroupMembershipInline]


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "level", "default_monthly_fee", "status")
    list_filter = ("status",)
    search_fields = ("code", "name")


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("name", "capacity", "location", "status")
    list_filter = ("status",)
    search_fields = ("name", "location")


@admin.register(Guardian)
class GuardianAdmin(admin.ModelAdmin):
    list_display = ("full_name", "phone", "relation", "email")
    search_fields = ("full_name", "phone")


@admin.register(GroupMembership)
class GroupMembershipAdmin(admin.ModelAdmin):
    list_display = ("student", "group", "joined_at", "left_at", "status")
    list_filter = ("status", "group")
    search_fields = ("student__first_name", "student__last_name", "student__code")


@admin.register(StudentNote)
class StudentNoteAdmin(admin.ModelAdmin):
    list_display = ("student", "author", "is_pinned", "created_at")
    search_fields = ("student__first_name", "student__last_name", "body")


admin.site.register(TeacherGroupAssignment)
