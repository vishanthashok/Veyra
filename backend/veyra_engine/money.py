"""Money helpers. All money math uses Decimal. Floats are rejected."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")
SHARE_Q = Decimal("0.00000001")


def D(value: object) -> Decimal:
    """Convert to Decimal without passing through float."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        raise TypeError("Floats are not allowed for money. Pass a str or Decimal.")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("$", "")
        if cleaned.startswith("(") and cleaned.endswith(")"):
            cleaned = "-" + cleaned[1:-1]
        try:
            return Decimal(cleaned)
        except InvalidOperation as exc:
            raise ValueError(f"Not a valid amount: {value!r}") from exc
    raise TypeError(f"Unsupported amount type: {type(value).__name__}")


def cents(value: Decimal) -> Decimal:
    """Round to cents, half up. This is the only rounding rule for money output."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def fmt(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")
