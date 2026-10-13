"""Presentation serialization edge cases for public records."""

from datetime import time, timedelta

import pytest

from custom_components.homeostatic.serialization import json_object, to_json


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        pytest.param((1, "two"), [1, "two"], id="tuple"),
        pytest.param([{"answer": 42}], [{"answer": 42}], id="list"),
        pytest.param(timedelta(minutes=15), 900.0, id="reminder-duration"),
        pytest.param(time(7, 30), "07:30:00", id="local-report-time"),
    ],
)
def test_public_record_values(value: object, expected: object) -> None:
    """Policy timing and ordered collections have stable JSON representations."""
    assert to_json(value) == expected


def test_unsupported_presentation_type_is_rejected() -> None:
    """An unknown object never silently becomes a made-up string."""
    with pytest.raises(TypeError, match="Unsupported presentation type"):
        to_json(object())


def test_json_object_requires_object_shape() -> None:
    """Callers requiring a record cannot receive a scalar."""
    with pytest.raises(TypeError, match="Expected an object"):
        json_object("scalar")
