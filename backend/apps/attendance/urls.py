from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AttendanceRecordViewSet, AttendanceSessionViewSet

router = DefaultRouter()
router.register("attendance", AttendanceSessionViewSet, basename="attendance")
router.register("attendance-records", AttendanceRecordViewSet, basename="attendance-record")

urlpatterns = [path("", include(router.urls))]
