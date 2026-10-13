"""Validated owner-selected UPS reserve thresholds."""

import math
from collections.abc import Mapping
from dataclasses import asdict, dataclass

UPS_CHECKS = frozenset(
    {"ups_power", "ups_reserve", "ups_battery_replacement", "ups_fault"}
)


def _number(value: object, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not math.isfinite(value)
        or not 0 <= value <= maximum
    ):
        raise ValueError("Choose a valid nonnegative UPS threshold")
    return float(value)


@dataclass(frozen=True, slots=True, kw_only=True)
class ReserveParameters:
    """Optional numeric expectations alongside the UPS's explicit warning."""

    charge_low: float | None = None
    charge_clear: float | None = None
    runtime_low_minutes: float | None = None
    runtime_clear_minutes: float | None = None
    replace_battery_check: bool = False

    @classmethod
    def from_data(cls, data: Mapping[str, object]) -> ReserveParameters:
        """Reject incomplete threshold pairs and unsupported parameters."""
        names = {
            "charge_low",
            "charge_clear",
            "runtime_low_minutes",
            "runtime_clear_minutes",
            "replace_battery_check",
        }
        if data.keys() - names:
            raise ValueError("Unknown UPS reserve parameter")
        values: dict[str, float | None] = {}
        for low, clear, maximum in (
            ("charge_low", "charge_clear", 100.0),
            ("runtime_low_minutes", "runtime_clear_minutes", 525600.0),
        ):
            raise_value, clear_value = data.get(low), data.get(clear)
            if (raise_value is None) != (clear_value is None):
                raise ValueError("Choose both raise and clear UPS thresholds")
            if raise_value is None:
                values[low] = values[clear] = None
                continue
            parsed_low = _number(raise_value, maximum)
            parsed_clear = _number(clear_value, maximum)
            values[low] = parsed_low
            values[clear] = parsed_clear
            if parsed_clear <= parsed_low:
                raise ValueError("UPS recovery threshold must exceed its low threshold")
        replace_battery = data.get("replace_battery_check", False)
        if type(replace_battery) is not bool:
            raise ValueError("Battery monitoring transfer must be on or off")
        return cls(**values, replace_battery_check=replace_battery)

    def data(self) -> dict[str, float | bool | None]:
        """Return a detached editable parameter object."""
        return asdict(self)
