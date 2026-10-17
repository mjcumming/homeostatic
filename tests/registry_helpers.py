"""Registry guards shared by executable scenarios."""

from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from functools import partial
from unittest.mock import patch

from homeassistant.helpers import device_registry as dr

DEPRECATED_DEVICE_PROPERTIES = (
    "config_entries",
    "config_entries_subentries",
    "primary_config_entry",
)


def _forbidden(entry: object, *, name: str) -> object:
    raise AssertionError(
        f"read deprecated DeviceEntry.{name}; use config_entry_id instead"
    )


@contextmanager
def forbid_deprecated_device_properties() -> Iterator[None]:
    """Fail any read of a multi-entry device property inside the block.

    Home Assistant 2026.10 reports each read through call-stack inspection, which
    dominated live discovery time. The pinned 2026.9 shim stays silent, so the
    scenario replaces the properties instead of watching for the report.
    """
    with ExitStack() as stack:
        for name in DEPRECATED_DEVICE_PROPERTIES:
            stack.enter_context(
                patch.object(
                    dr.DeviceEntry, name, property(partial(_forbidden, name=name))
                )
            )
        yield
