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


@pytest.mark.parametrize(
    "state,reauth,disabled,reported,expected",
    [
        pytest.param(
            ConfigEntryState.SETUP_ERROR,
            False,
            None,
            "Unable to sign in to provider",
            "Unable to sign in to provider",
            id="reported-sign-in-error",
        ),
        pytest.param(
            ConfigEntryState.SETUP_RETRY,
            False,
            None,
            "Connection timed out",
            "Connection timed out",
            id="retry-detail",
        ),
        pytest.param(
            ConfigEntryState.MIGRATION_ERROR,
            False,
            None,
            "Unsupported configuration version",
            "Unsupported configuration version",
            id="migration-detail",
        ),
        pytest.param(
            ConfigEntryState.FAILED_UNLOAD,
            False,
            None,
            "Could not stop listener",
            "Could not stop listener",
            id="unload-detail",
        ),
        pytest.param(
            ConfigEntryState.LOADED,
            True,
            None,
            "Session expired",
            "Session expired",
            id="pending-reauth",
        ),
        pytest.param(
            ConfigEntryState.SETUP_ERROR,
            False,
            None,
            None,
            "setup error",
            id="no-reported-cause",
        ),
        pytest.param(
            ConfigEntryState.LOADED,
            False,
            None,
            "Old error",
            "loaded",
            id="recovery-drops-error",
        ),
        pytest.param(
            ConfigEntryState.SETUP_ERROR,
            True,
            ConfigEntryDisabler.USER,
            "Old error",
            "disabled",
            id="disabled-is-not-sign-in",
        ),
    ],
)
def test_reported_entry_error(
    state: ConfigEntryState,
    reauth: bool,
    disabled: ConfigEntryDisabler | None,
    reported: str | None,
    expected: str,
) -> None:
    """Use HA's displayed error without reading credentials or inventing a cause."""
    entry = MockConfigEntry(
        state=state,
        reason=reported,
        disabled_by=disabled,
        data={"password": "must-not-be-exposed"},
    )
    result = entry_observation(SOURCE, entry, NOW, None, Settings.from_data({}), reauth)
    assert result.message == f"Controller: {expected}"
    assert "must-not-be-exposed" not in str(result)
