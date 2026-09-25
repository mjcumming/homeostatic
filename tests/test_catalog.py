"""Config-entry producer semantics using HA's actual lifecycle states."""

from datetime import UTC, datetime, timedelta

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.catalog import Source, entry_observation
from custom_components.homeostatic.config import Settings

NOW = datetime(2026, 9, 25, 8, tzinfo=UTC)
SOURCE = Source(
    node_id="entry:source", name="Controller", kind="integration", entry_id="source"
)


@pytest.mark.parametrize(
    "state,status",
    [
        (ConfigEntryState.LOADED, Status.PASS),
        (ConfigEntryState.SETUP_RETRY, Status.WARN),
        (ConfigEntryState.SETUP_ERROR, Status.FAIL),
        (ConfigEntryState.MIGRATION_ERROR, Status.FAIL),
        (ConfigEntryState.FAILED_UNLOAD, Status.FAIL),
        (ConfigEntryState.NOT_LOADED, Status.UNKNOWN),
        (ConfigEntryState.SETUP_IN_PROGRESS, Status.UNKNOWN),
        (ConfigEntryState.UNLOAD_IN_PROGRESS, Status.UNKNOWN),
    ],
)
def test_entry_states(state: ConfigEntryState, status: Status) -> None:
    """Transient states do not claim a working or dead physical device."""
    entry = MockConfigEntry(state=state)
    result = entry_observation(SOURCE, entry, NOW, None, Settings.from_data({}), False)
    assert result.status is status
    assert result.reason == state.value


@pytest.mark.parametrize("elapsed,status", [(119, Status.WARN), (120, Status.FAIL)])
def test_retry_hold(elapsed: int, status: Status) -> None:
    """Retry transitions from warning to failure exactly at its configured hold."""
    entry = MockConfigEntry(state=ConfigEntryState.SETUP_RETRY)
    result = entry_observation(
        SOURCE,
        entry,
        NOW,
        NOW - timedelta(seconds=elapsed),
        Settings.from_data({}),
        False,
    )
    assert result.status is status


def test_disabled_entry() -> None:
    """A deliberately disabled integration is unknown evidence."""
    entry = MockConfigEntry(
        state=ConfigEntryState.LOADED, disabled_by=ConfigEntryDisabler.USER
    )
    result = entry_observation(SOURCE, entry, NOW, None, Settings.from_data({}), False)
    assert result.status is Status.UNKNOWN
    assert result.reason == "disabled"


def test_reauthentication() -> None:
    """An explicit pending reauth overrides the loaded lifecycle state."""
    entry = MockConfigEntry(state=ConfigEntryState.LOADED)
    result = entry_observation(SOURCE, entry, NOW, None, Settings.from_data({}), True)
    assert result.status is Status.FAIL
    assert result.reason == "auth_required"


def test_missing_entry() -> None:
    """A deleted selection remains an unknown requirement."""
    result = entry_observation(SOURCE, None, NOW, None, Settings.from_data({}), False)
    assert result.status is Status.UNKNOWN
    assert result.reason == "source_missing"
