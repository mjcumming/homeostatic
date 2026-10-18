"""Homeostatic identifiers and adapter defaults."""

from datetime import timedelta

DOMAIN = "homeostatic"
NAME = "Homeostatic"
STORE_VERSION = 1
EVENT_NOTIFICATION = "homeostatic_notification"
EVENT_EPISODE = "homeostatic_episode"
EVENT_CONTROL = "homeostatic_control"
RECONCILE_INTERVAL = timedelta(seconds=60)
# Evidence-only refreshes persist at most this often; requests, episode and
# control changes, settings and shutdown save immediately (ADR 0096).
SAVE_COALESCE_SECONDS = 15
DEFAULTS: dict[str, int] = {
    "settle": 120,
    "rejoin_grace": 60,
    "startup_grace": 120,
    "startup_quiet_max": 600,
    "coalesce_count": 3,
    "coalesce_window": 60,
    "batch": 30,
    "clear_hold": 120,
    "unknown_hold": 900,
    "retry_hold": 120,
}
