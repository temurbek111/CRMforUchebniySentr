from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AuditLogViewSet, HealthView, NotificationViewSet, SettingsView

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notification")
router.register("audit", AuditLogViewSet, basename="audit")

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("settings", SettingsView.as_view(), name="settings"),
    path("", include(router.urls)),
]
