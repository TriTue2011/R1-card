"""WebSocket proxy views for Phicomm R1 integration.

Registers two endpoints so the aibox-ha-card can reach R1 devices on the LAN
when the browser accesses Home Assistant over HTTPS:

  /api/r1/ws?ip=<device_ip>[&port=8082]   → AiboxPlus  (default port 8082)
  /api/r1/spk?ip=<device_ip>[&port=8080]  → Speaker/R1 (default port 8080)
"""

from __future__ import annotations

import asyncio
import logging
from ipaddress import ip_address

from aiohttp import ClientSession, WSMsgType, web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_AIBOX_WS_PORT

_LOGGER = logging.getLogger(__name__)

_DEFAULT_SPEAKER_PORT = 8080
_CONNECT_TIMEOUT = 10


def _validate_target(ip_str: str, port: int) -> str | None:
    """Return an error string if the target is not acceptable, else None."""
    if not ip_str:
        return "Missing ip parameter"
    try:
        addr = ip_address(ip_str)
    except ValueError:
        return f"Invalid IP address: {ip_str}"
    if not addr.is_private:
        return "Only private/local IP addresses are allowed"
    if not 1 <= port <= 65535:
        return f"Port out of range: {port}"
    return None


async def _proxy_websocket(
    request: web.Request,
    session: ClientSession,
    target_ip: str,
    target_port: int,
) -> web.WebSocketResponse:
    """Bidirectional WebSocket proxy between the browser and an R1 device."""
    ws_browser = web.WebSocketResponse()
    await ws_browser.prepare(request)

    target_url = f"ws://{target_ip}:{target_port}"
    try:
        ws_device = await session.ws_connect(target_url, timeout=_CONNECT_TIMEOUT)
    except Exception as err:
        _LOGGER.warning("Cannot connect to R1 at %s: %s", target_url, err)
        await ws_browser.close(code=1011, message=b"Cannot connect to R1 device")
        return ws_browser

    async def _forward_browser_to_device() -> None:
        async for msg in ws_browser:
            if ws_device.closed:
                break
            if msg.type == WSMsgType.TEXT:
                await ws_device.send_str(msg.data)
            elif msg.type == WSMsgType.BINARY:
                await ws_device.send_bytes(msg.data)
            elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.ERROR):
                break

    async def _forward_device_to_browser() -> None:
        async for msg in ws_device:
            if ws_browser.closed:
                break
            if msg.type == WSMsgType.TEXT:
                await ws_browser.send_str(msg.data)
            elif msg.type == WSMsgType.BINARY:
                await ws_browser.send_bytes(msg.data)
            elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                break

    task_b2d = asyncio.create_task(_forward_browser_to_device())
    task_d2b = asyncio.create_task(_forward_device_to_browser())
    try:
        _done, pending = await asyncio.wait(
            [task_b2d, task_d2b], return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
    finally:
        if not ws_device.closed:
            await ws_device.close()
        if not ws_browser.closed:
            await ws_browser.close()

    return ws_browser


class R1WsProxyView(HomeAssistantView):
    """Proxy WebSocket for AiboxPlus (default port 8082)."""

    url = "/api/r1/ws"
    name = "api:r1:ws"
    requires_auth = False

    async def get(self, request: web.Request) -> web.WebSocketResponse | web.Response:
        """Handle WebSocket upgrade and proxy to the R1 device."""
        ip = request.query.get("ip", "").strip()
        try:
            port = int(request.query.get("port", DEFAULT_AIBOX_WS_PORT))
        except (ValueError, TypeError):
            port = DEFAULT_AIBOX_WS_PORT

        err = _validate_target(ip, port)
        if err:
            return web.Response(status=400, text=err)

        hass: HomeAssistant = request.app["hass"]
        session = async_get_clientsession(hass)
        _LOGGER.debug("WS proxy → ws://%s:%s", ip, port)
        return await _proxy_websocket(request, session, ip, port)


class R1SpkProxyView(HomeAssistantView):
    """Proxy WebSocket for R1 speaker/native protocol (default port 8080)."""

    url = "/api/r1/spk"
    name = "api:r1:spk"
    requires_auth = False

    async def get(self, request: web.Request) -> web.WebSocketResponse | web.Response:
        """Handle WebSocket upgrade and proxy to the R1 device."""
        ip = request.query.get("ip", "").strip()
        try:
            port = int(request.query.get("port", _DEFAULT_SPEAKER_PORT))
        except (ValueError, TypeError):
            port = _DEFAULT_SPEAKER_PORT

        err = _validate_target(ip, port)
        if err:
            return web.Response(status=400, text=err)

        hass: HomeAssistant = request.app["hass"]
        session = async_get_clientsession(hass)
        _LOGGER.debug("SPK proxy → ws://%s:%s", ip, port)
        return await _proxy_websocket(request, session, ip, port)


def async_register_views(hass: HomeAssistant) -> None:
    """Register the WebSocket proxy views with Home Assistant HTTP server."""
    hass.http.register_view(R1WsProxyView)
    hass.http.register_view(R1SpkProxyView)
    _LOGGER.info("Registered R1 WebSocket proxy at /api/r1/ws and /api/r1/spk")
