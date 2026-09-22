from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ExamResultViewSet, ExamViewSet

router = DefaultRouter()
router.register("exams", ExamViewSet, basename="exam")
router.register("results", ExamResultViewSet, basename="exam-result")

urlpatterns = [path("", include(router.urls))]
