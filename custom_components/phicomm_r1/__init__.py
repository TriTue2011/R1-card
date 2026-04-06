"""Phicomm R1 integration entrypoint."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ApiMapping, PhicommR1ApiClient, PhicommR1ApiError
from .const import (
    CONF_AIBOX_WS_PORT,
    CONF_PROTOCOL,
    CONF_SCAN_INTERVAL,
    CONF_USE_MEDIA_DISPATCH,
    DEFAULT_AIBOX_WS_PORT,
    DEFAULT_PROTOCOL,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_TIMEOUT,
    DOMAIN,
    PLATFORMS,
    PROTOCOL_AUTO,
    PROTOCOL_HTTP_BRIDGE,
    PROTOCOL_WS_NATIVE,
)
from .coordinator import PhicommR1Coordinator

PhicommR1ConfigEntry = ConfigEntry[dict[str, Any]]
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: PhicommR1ConfigEntry) -> bool:
    """Set up Phicomm R1 from a config entry."""
    merged = {**entry.data, **entry.options}
    session = async_get_clientsession(hass)
    host = merged.get(CONF_HOST, entry.data[CONF_HOST])
    port = int(merged.get(CONF_PORT, entry.data[CONF_PORT]))
    aibox_ws_port = int(merged.get(CONF_AIBOX_WS_PORT, DEFAULT_AIBOX_WS_PORT))
    mapping = ApiMapping.from_config(merged)
    protocol = str(merged.get(CONF_PROTOCOL, DEFAULT_PROTOCOL))
    if protocol == PROTOCOL_AUTO:
        protocol, port = await _phat_hien_giao_thuc(session, host, port, mapping)

    client = PhicommR1ApiClient(
        session=session,
        host=host,
        port=port,
        mapping=mapping,
        protocol=protocol,
        aibox_ws_port=aibox_ws_port,
        timeout=DEFAULT_TIMEOUT,
    )

    coordinator = PhicommR1Coordinator(
        hass=hass,
        client=client,
        scan_interval=timedelta(
            seconds=int(
                entry.options.get(
                    CONF_SCAN_INTERVAL,
                    entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                )
            )
        ),
        use_media_dispatch=bool(
            entry.options.get(
                CONF_USE_MEDIA_DISPATCH,
                entry.data.get(CONF_USE_MEDIA_DISPATCH, True),
            )
        ),
    )
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning(
            "Initial refresh failed for Phicomm R1 (%s:%s, protocol=%s): %s. Integration will "
            "start as unavailable and retry.",
            host,
            port,
            protocol,
            err,
        )
        await coordinator.async_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
    }

    entry.async_on_unload(entry.add_update_listener(_cap_nhat_tuy_chon))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: PhicommR1ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            hass.data.pop(DOMAIN, None)
    return unload_ok


async def _cap_nhat_tuy_chon(hass: HomeAssistant, entry: PhicommR1ConfigEntry) -> None:
    """Reload integration when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)


async def _phat_hien_giao_thuc(
    session,
    host: str,
    port: int,
    mapping: ApiMapping,
) -> tuple[str, int]:
    """Auto-detect protocol/port for old entries or 'auto' mode."""
    candidate_ports = [port]
    for fallback_port in (8080, 8081, DEFAULT_PORT):
        if fallback_port not in candidate_ports:
            candidate_ports.append(fallback_port)

    for candidate_port in candidate_ports:
        for mode in (PROTOCOL_HTTP_BRIDGE, PROTOCOL_WS_NATIVE):
            client = PhicommR1ApiClient(
                session=session,
                host=host,
                port=candidate_port,
                mapping=mapping,
                protocol=mode,
                aibox_ws_port=DEFAULT_AIBOX_WS_PORT,
                timeout=DEFAULT_TIMEOUT,
            )
            try:
                await client.async_ping()
                return mode, candidate_port
            except PhicommR1ApiError:
                continue
    return PROTOCOL_HTTP_BRIDGE, port
