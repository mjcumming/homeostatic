"""Homeostatic identifiers and adapter defaults."""

from datetime import timedelta

DOMAIN = "homeostatic"
NAME = "Homeostatic"
STORE_VERSION = 1
EVENT_NOTIFICATION = "homeostatic_notification"
RECONCILE_INTERVAL = timedelta(seconds=60)
DEFAULTS: dict[str, int] = {
    "settle": 120,
    "rejoin_grace": 60,
    "startup_grace": 120,
    "coalesce_count": 3,
    "coalesce_window": 60,
    "batch": 30,
    "clear_hold": 120,
    "unknown_hold": 900,
    "retry_hold": 120,
}
