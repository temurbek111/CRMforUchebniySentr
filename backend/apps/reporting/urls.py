from django.urls import path

from .views import (
    AlertsView,
    AtRiskView,
    DashboardView,
    ReportExportView,
    ReportView,
    SearchView,
)

urlpatterns = [
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path("alerts", AlertsView.as_view(), name="alerts"),
    path("at-risk", AtRiskView.as_view(), name="at-risk"),
    path("reports/<str:name>", ReportView.as_view(), name="report"),
    path("reports/<str:name>/export.csv", ReportExportView.as_view(), name="report-export"),
    path("search", SearchView.as_view(), name="search"),
]
