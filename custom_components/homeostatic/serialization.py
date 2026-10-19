"""JSON presentation of public library records."""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from datetime import datetime, time, timedelta
from enum import Enum

from health_tree.types import JSONValue


def json_digest(value: object) -> str:
    """Stable digest of JSON-compatible data, for equality comparison only."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def to_json(value: object) -> JSONValue:
    """Serialize public records without interpreting engine snapshot internals."""
    if isinstance(value, Enum):
        return to_json(value.value)
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, datetime | time):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: to_json(getattr(value, field.name)) for field in fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): to_json(item) for key, item in value.items()}
    if isinstance(value, set | frozenset):
        return [to_json(item) for item in sorted(value)]
    if isinstance(value, tuple | list):
        return [to_json(item) for item in value]
    raise TypeError(f"Unsupported presentation type: {type(value).__name__}")


def json_object(value: object) -> dict[str, JSONValue]:
    """Serialize a record that must have object shape."""
    result = to_json(value)
    if not isinstance(result, dict):
        raise TypeError("Expected an object")
    return result
