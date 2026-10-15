"""Discover linked Home Assistant people for reusable delivery methods."""

from typing import Any

from homeassistant.core import HomeAssistant


async def available_people(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return linked Home Assistant people and their current roles."""
    result = []
    for state in hass.states.async_all("person"):
        person_id = state.attributes.get("id")
        user_id = state.attributes.get("user_id")
        if not isinstance(person_id, str) or not isinstance(user_id, str):
            continue
        user = await hass.auth.async_get_user(user_id)
        if user is None:
            continue
        result.append(
            {
                "id": person_id,
                "entity_id": state.entity_id,
                "name": state.name,
                "user_id": user_id,
                "administrator": user.is_admin,
            }
        )
    return sorted(result, key=lambda item: item["name"].casefold())
