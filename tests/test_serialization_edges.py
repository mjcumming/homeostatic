"""Presentation serialization edge cases for public records."""

import pytest

from custom_components.homeostatic.serialization import json_object, to_json


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ((1, "two"), [1, "two"]),
        ([{"answer": 42}], [{"answer": 42}]),
    ],
)
def test_sequences_are_json_arrays(value: object, expected: object) -> None:
    """Tuple and list values remain ordered JSON arrays."""
    assert to_json(value) == expected


def test_unsupported_presentation_type_is_rejected() -> None:
    """An unknown object never silently becomes a made-up string."""
    with pytest.raises(TypeError, match="Unsupported presentation type"):
        to_json(object())


def test_json_object_requires_object_shape() -> None:
    """Callers requiring a record cannot receive a scalar."""
    with pytest.raises(TypeError, match="Expected an object"):
        json_object("scalar")
