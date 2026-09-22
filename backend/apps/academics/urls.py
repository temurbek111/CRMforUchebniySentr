from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CourseViewSet,
    GroupMembershipViewSet,
    GroupViewSet,
    GuardianViewSet,
    RoomViewSet,
    StudentNoteViewSet,
    StudentViewSet,
    TeacherViewSet,
)

router = DefaultRouter()
router.register("courses", CourseViewSet, basename="course")
router.register("rooms", RoomViewSet, basename="room")
router.register("teachers", TeacherViewSet, basename="teacher")
router.register("students", StudentViewSet, basename="student")
router.register("groups", GroupViewSet, basename="group")
router.register("memberships", GroupMembershipViewSet, basename="membership")
router.register("student-notes", StudentNoteViewSet, basename="student-note")
router.register("guardians", GuardianViewSet, basename="guardian")

urlpatterns = [path("", include(router.urls))]
