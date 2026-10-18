"""Convert published device policies to entity coverage at the setup boundary."""

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .config import Settings
from .enrollment import inventory
from .rules import CatalogRule, attributes


def migrate_device_policies(
    hass: HomeAssistant, data: dict[str, Any]
) -> dict[str, Any]:
    """Preserve saved choices and validate before writing converted settings."""
    candidate = deepcopy(data)
    retired = [
        row
        for row in candidate.get("monitoring_policies", [])
        if isinstance(row, dict)
        and row.get("check") == "availability"
        and row.get("match", {}).get("kind") in (["device"], "device")
    ]
    if not retired:
        return data
    scopes = {row["id"]: deepcopy(row["match"]) for row in retired}
    for row in retired:
        row["match"]["kind"] = ["entity"]
    settings = Settings.from_data(candidate, functions_enabled=False)
    devices = [
        source
        for source in inventory(hass, settings, {}).values()
        if source.kind == "device"
    ]
    for row in retired:
        scope = scopes[row["id"]]
        if "device" not in scope or scope.keys() - {"kind", "device"}:
            selector = CatalogRule(id=row["id"], match=attributes(scope))
            row["match"] = {
                "kind": ["entity"],
                "device": sorted(
                    {
                        device
                        for source in devices
                        if selector.matches(source.attributes)
                        for device in source.attributes.get("device", ())
                    }
                ),
            }
    Settings.from_data(candidate, functions_enabled=False)
    return candidate
