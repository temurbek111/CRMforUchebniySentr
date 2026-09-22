from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PayrollItemViewSet,
    PayrollRunViewSet,
    SalaryPolicyViewSet,
    TeacherEarningsView,
)

router = DefaultRouter()
router.register("salaries", SalaryPolicyViewSet, basename="salary-policy")
router.register("payroll", PayrollRunViewSet, basename="payroll")
router.register("payroll-items", PayrollItemViewSet, basename="payroll-item")

urlpatterns = [
    # Trailing slash kept for consistency with every DefaultRouter route above;
    # the SPA calls /api/teachers/{id}/earnings/ and my API docs promise the slash.
    path("teachers/<int:teacher_id>/earnings/", TeacherEarningsView.as_view(), name="teacher-earnings"),
    path("", include(router.urls)),
]
