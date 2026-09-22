"""Money helpers.

Financial truth is stored as ``Decimal`` in ``DecimalField(max_digits=14, decimal_places=2)``.
Floats are never used for money anywhere in this codebase (see plan section 37).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.core.validators import MinValueValidator
from django.db import models

MONEY_MAX_DIGITS = 14
MONEY_DECIMAL_PLACES = 2
MONEY_QUANT = Decimal("0.01")

ZERO = Decimal("0.00")


def quantize(value: Decimal | int | str | None) -> Decimal:
    """Round a value to 2 decimal places using commercial rounding."""
    if value is None:
        return ZERO
    try:
        return Decimal(value).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:  # pragma: no cover - defensive
        raise ValueError(f"Not a valid money amount: {value!r}") from exc


def money_field(**kwargs) -> models.DecimalField:
    """Non-negative money field. Amounts below zero are rejected by the database."""
    kwargs.setdefault("max_digits", MONEY_MAX_DIGITS)
    kwargs.setdefault("decimal_places", MONEY_DECIMAL_PLACES)
    kwargs.setdefault("default", ZERO)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


def format_money(amount: Decimal | int | str | None, symbol: str = "", decimals: bool = True) -> str:
    """Human-readable money for API payloads and documents."""
    value = quantize(amount)
    pattern = "#,##0.00" if decimals else "#,##0"
    rendered = f"{value:{pattern}}"
    return f"{rendered} {symbol}".strip()
