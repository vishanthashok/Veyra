"""Engine identity. Bump ENGINE_VERSION on any change that can alter a calculated number."""

ENGINE_VERSION = "0.2.0"
ROUNDING_POLICY = (
    "Decimal arithmetic, unrounded intermediates. Each tenant pool line and each admin fee is "
    "rounded to 0.01 with ROUND_HALF_UP. Totals are sums of rounded components. "
    "Pool rounding differences are reported, never plugged."
)
