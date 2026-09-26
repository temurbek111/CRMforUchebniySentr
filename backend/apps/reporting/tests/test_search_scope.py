"""Global search must not leak data past a user's permissions.

Regression cover for a real leak: `/api/search` is gated only by
IsAuthenticated, and `global_search` scoped its student and group results for
teachers but returned the `payments` and `leads` blocks to everyone. A teacher -
who holds no `invoices.view` and no `leads.view` - could type a student's name
into the search box and receive receipt numbers, amounts and lead contact
details.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.rbac import Perm, effective_permissions
from apps.finance.models import Payment, StudentInvoice
from apps.finance.services import ensure_invoice, record_payment
from apps.reporting.services import global_search
from tests.factories import enroll, make_group, make_student, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def centre_with_a_payment():
    group = make_group(fee="1200000")
    student = make_student("Zilola", "Yusupova")
    enroll(student, group, fee="1200000")
    invoice = ensure_invoice(student, date.today().replace(day=1))
    record_payment(student=student, amount=Decimal("1200000"), invoice=invoice,
                   method=Payment.Method.CASH)
    return student, invoice


def test_teacher_search_does_not_return_payment_records(centre_with_a_payment):
    """The core leak: money data must not reach a user without invoices.view."""
    teacher = make_user("search.teacher", "teacher")
    assert Perm.INVOICES_VIEW not in effective_permissions(teacher)

    result = global_search(
        "Zilola",
        restrict={"teacher_id": -1},
        permissions=effective_permissions(teacher),
    )
    assert "payments" not in result["results"]


def test_teacher_search_does_not_return_leads(centre_with_a_payment):
    """Lead contact details need leads.view; teachers do not hold it."""
    from apps.crm.models import Lead

    Lead.objects.create(full_name="Zilola Prospect", phone="+998900000000")
    teacher = make_user("search.teacher2", "teacher")
    assert Perm.LEADS_VIEW not in effective_permissions(teacher)

    result = global_search("Zilola", permissions=effective_permissions(teacher))
    assert "leads" not in result["results"]


def test_accountant_search_still_returns_payments(centre_with_a_payment):
    """The gate must not break the roles that legitimately need the data."""
    accountant = make_user("search.accountant", "accountant")
    assert Perm.INVOICES_VIEW in effective_permissions(accountant)

    result = global_search("Zilola", permissions=effective_permissions(accountant))
    assert len(result["results"]["payments"]) == 1
    # The amount travels inside `label` as a decimal string, never a float.
    label = result["results"]["payments"][0]["label"]
    assert "1200000.00" in label, label


def test_receptionist_search_sees_leads_and_payments(centre_with_a_payment):
    """Reception legitimately holds both invoices.view and leads.view.

    This guards the other direction: the permission gate must not over-restrict
    the roles that need the data. Reception collects payments at the front desk
    and works the CRM pipeline, so both blocks must appear for them.
    """
    from apps.crm.models import Lead

    Lead.objects.create(full_name="Zilola Prospect", phone="+998****0000")
    reception = make_user("search.reception", "receptionist")
    perms = effective_permissions(reception)
    assert Perm.LEADS_VIEW in perms and Perm.INVOICES_VIEW in perms

    result = global_search("Zilola", permissions=perms)
    assert "leads" in result["results"]
    assert "payments" in result["results"]


def test_the_search_endpoint_hides_payments_from_a_teacher(centre_with_a_payment):
    """End-to-end through the real endpoint, not just the service function."""
    group = make_group(fee="1200000", name="Searchable Group")
    student = make_student("Zilola", "Endpointova")
    enroll(student, group, fee="1200000")

    teacher_user = make_user("search.teacher3", "teacher")
    client = APIClient()
    client.force_authenticate(teacher_user)

    response = client.get("/api/search?q=Zilola")
    assert response.status_code == 200
    assert "payments" not in response.json()["results"]
    assert "leads" not in response.json()["results"]


def test_internal_callers_without_permissions_still_get_everything(centre_with_a_payment):
    """A caller that has already established authorisation passes no filter."""
    result = global_search("Zilola")
    assert len(result["results"]["payments"]) == 1
