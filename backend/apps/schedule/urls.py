from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ScheduleSlotViewSet

router = DefaultRouter()
router.register("schedule", ScheduleSlotViewSet, basename="schedule")

urlpatterns = [path("", include(router.urls))]
