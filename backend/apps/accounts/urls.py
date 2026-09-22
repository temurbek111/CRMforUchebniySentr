from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PermissionViewSet, RoleViewSet, UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")
router.register("permissions", PermissionViewSet, basename="permission")

urlpatterns = [path("", include(router.urls))]
