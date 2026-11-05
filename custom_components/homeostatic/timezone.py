"""Resolve configured time zones at asynchronous Home Assistant boundaries."""

from datetime import tzinfo

from homeassistant.util import dt as dt_util


async def async_resolve_timezone(value: object) -> tzinfo:
    """Resolve an IANA zone without blocking the event loop."""
    if not isinstance(value, str) or not value:
        raise ValueError("Choose an IANA timezone")
    try:
        zone = await dt_util.async_get_time_zone(value)
    except (TypeError, ValueError) as err:
        raise ValueError("Choose an IANA timezone") from err
    if zone is None:
        raise ValueError("Choose an IANA timezone")
    return zone


def require_timezone(name: object, zone: tzinfo) -> None:
    """Reject a zone that was not resolved for the supplied configuration."""
    if not isinstance(name, str) or not name or str(zone) != name:
        raise ValueError("Choose an IANA timezone")
