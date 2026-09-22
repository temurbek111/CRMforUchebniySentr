from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BillingPeriodViewSet,
    ExpenseViewSet,
    FinanceSummaryView,
    IncomeViewSet,
    InvoiceViewSet,
    PaymentViewSet,
)

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("payments", PaymentViewSet, basename="payment")
router.register("income", IncomeViewSet, basename="income")
router.register("expenses", ExpenseViewSet, basename="expense")
router.register("billing-periods", BillingPeriodViewSet, basename="billing-period")

urlpatterns = [
    path("finance/summary", FinanceSummaryView.as_view(), name="finance-summary"),
    path("finance/summary/<str:kind>", FinanceSummaryView.as_view(), name="finance-summary-kind"),
    path("", include(router.urls)),
]
