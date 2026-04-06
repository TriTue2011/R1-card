"""API client for Phicomm R1 (HTTP bridge + native WebSocket)."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
import json
import logging
import math
import re
import time
from typing import Any, Awaitable, Callable, Mapping

from aiohttp import (
    ClientError,
    ClientResponseError,
    ClientSession,
    WSMsgType,
)

from .const import (
    DEFAULT_AIBOX_WS_PORT,
    CONF_ENDPOINT_ADB_CMD,
    CONF_ENDPOINT_DO_CMD,
    CONF_ENDPOINT_KEYEVENT,
    CONF_ENDPOINT_MEDIA_DISPATCH,
    CONF_PARAM_COMMAND,
    CONF_PARAM_KEYCODE,
    CONF_PARAM_MEDIA_KEY,
    CONF_RESPONSE_CODE_KEY,
    CONF_RESPONSE_MESSAGE_KEY,
    CONF_RESPONSE_RESULT_KEY,
    CONF_RESPONSE_SUCCESS_CODE,
    DEFAULT_ENDPOINT_ADB_CMD,
    DEFAULT_ENDPOINT_DO_CMD,
    DEFAULT_ENDPOINT_KEYEVENT,
    DEFAULT_ENDPOINT_MEDIA_DISPATCH,
    DEFAULT_PARAM_COMMAND,
    DEFAULT_PARAM_KEYCODE,
    DEFAULT_PARAM_MEDIA_KEY,
    DEFAULT_PROTOCOL,
    DEFAULT_RESPONSE_CODE_KEY,
    DEFAULT_RESPONSE_MESSAGE_KEY,
    DEFAULT_RESPONSE_RESULT_KEY,
    DEFAULT_RESPONSE_SUCCESS_CODE,
    KEYCODE_MEDIA_NEXT,
    KEYCODE_MEDIA_PLAY_PAUSE,
    KEYCODE_MEDIA_PREVIOUS,
    KEYCODE_MEDIA_STOP,
    KEYCODE_MUTE,
    KEYCODE_VOLUME_DOWN,
    KEYCODE_VOLUME_UP,
    PROTOCOL_HTTP_BRIDGE,
    PROTOCOL_WS_NATIVE,
)


class PhicommR1ApiError(Exception):
    """Base API error."""


class PhicommR1ApiConnectionError(PhicommR1ApiError):
    """Raised when connection to API fails."""


class PhicommR1ApiResponseError(PhicommR1ApiError):
    """Raised when API returns invalid payload."""


_VOLUME_RE = re.compile(r"volume is\s+(?P<current>\d+)\s+in range\s+\[(?P<min>\d+)\.\.(?P<max>\d+)\]")
_PLAYBACK_STATE_RE = re.compile(r"state=(?P<state>\d+)")
_RAW_RESPONSE_KEY = "_raw"
_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class VolumeInfo:
    """Represents parsed media volume information."""

    current: int
    minimum: int
    maximum: int

    @property
    def level(self) -> float:
        """Return volume in Home Assistant 0..1 format."""
        spread = self.maximum - self.minimum
        if spread <= 0:
            return 0.0
        return max(0.0, min(1.0, (self.current - self.minimum) / spread))


@dataclass(slots=True)
class ApiMapping:
    """API mapping descriptor for HTTP bridge variants."""

    endpoint_do_cmd: str = DEFAULT_ENDPOINT_DO_CMD
    endpoint_adb_cmd: str = DEFAULT_ENDPOINT_ADB_CMD
    endpoint_keyevent: str = DEFAULT_ENDPOINT_KEYEVENT
    endpoint_media_dispatch: str = DEFAULT_ENDPOINT_MEDIA_DISPATCH
    param_command: str = DEFAULT_PARAM_COMMAND
    param_keycode: str = DEFAULT_PARAM_KEYCODE
    param_media_key: str = DEFAULT_PARAM_MEDIA_KEY
    response_code_key: str = DEFAULT_RESPONSE_CODE_KEY
    response_message_key: str = DEFAULT_RESPONSE_MESSAGE_KEY
    response_result_key: str = DEFAULT_RESPONSE_RESULT_KEY
    response_success_code: str = DEFAULT_RESPONSE_SUCCESS_CODE

    @staticmethod
    def _chuan_hoa_endpoint(path: str) -> str:
        path = (path or "").strip()
        if not path:
            raise ValueError("Endpoint path cannot be empty")
        if not path.startswith("/"):
            path = f"/{path}"
        return path

    @staticmethod
    def _chuan_hoa_van_ban(value: str, fallback: str) -> str:
        cleaned = (value or "").strip()
        return cleaned if cleaned else fallback

    @classmethod
    def from_config(cls, data: Mapping[str, Any]) -> "ApiMapping":
        """Build mapping from config entry data/options."""
        response_code_key = (
            str(data[CONF_RESPONSE_CODE_KEY]).strip()
            if CONF_RESPONSE_CODE_KEY in data
            else DEFAULT_RESPONSE_CODE_KEY
        )
        response_message_key = (
            str(data[CONF_RESPONSE_MESSAGE_KEY]).strip()
            if CONF_RESPONSE_MESSAGE_KEY in data
            else DEFAULT_RESPONSE_MESSAGE_KEY
        )
        response_result_key = (
            str(data[CONF_RESPONSE_RESULT_KEY]).strip()
            if CONF_RESPONSE_RESULT_KEY in data
            else DEFAULT_RESPONSE_RESULT_KEY
        )
        response_success_code = (
            str(data[CONF_RESPONSE_SUCCESS_CODE]).strip()
            if CONF_RESPONSE_SUCCESS_CODE in data
            else DEFAULT_RESPONSE_SUCCESS_CODE
        )

        return cls(
            endpoint_do_cmd=cls._chuan_hoa_endpoint(
                str(data.get(CONF_ENDPOINT_DO_CMD, DEFAULT_ENDPOINT_DO_CMD))
            ),
            endpoint_adb_cmd=cls._chuan_hoa_endpoint(
                str(data.get(CONF_ENDPOINT_ADB_CMD, DEFAULT_ENDPOINT_ADB_CMD))
            ),
            endpoint_keyevent=cls._chuan_hoa_endpoint(
                str(data.get(CONF_ENDPOINT_KEYEVENT, DEFAULT_ENDPOINT_KEYEVENT))
            ),
            endpoint_media_dispatch=cls._chuan_hoa_endpoint(
                str(data.get(CONF_ENDPOINT_MEDIA_DISPATCH, DEFAULT_ENDPOINT_MEDIA_DISPATCH))
            ),
            param_command=cls._chuan_hoa_van_ban(
                str(data.get(CONF_PARAM_COMMAND, DEFAULT_PARAM_COMMAND)),
                DEFAULT_PARAM_COMMAND,
            ),
            param_keycode=cls._chuan_hoa_van_ban(
                str(data.get(CONF_PARAM_KEYCODE, DEFAULT_PARAM_KEYCODE)),
                DEFAULT_PARAM_KEYCODE,
            ),
            param_media_key=cls._chuan_hoa_van_ban(
                str(data.get(CONF_PARAM_MEDIA_KEY, DEFAULT_PARAM_MEDIA_KEY)),
                DEFAULT_PARAM_MEDIA_KEY,
            ),
            response_code_key=response_code_key,
            response_message_key=response_message_key,
            response_result_key=response_result_key,
            response_success_code=response_success_code,
        )


class PhicommR1ApiClient:
    """Async client for both API modes:

    - `http_bridge`: endpoints like `/do-cmd`, `/input-keyevent`
    - `ws_native`: native R1 websocket at `ws://<ip>:8080`
    """

    def __init__(
        self,
        session: ClientSession,
        host: str,
        port: int,
        mapping: ApiMapping,
        protocol: str = DEFAULT_PROTOCOL,
        aibox_ws_port: int = DEFAULT_AIBOX_WS_PORT,
        timeout: int = 10,
    ) -> None:
        self._session = session
        self._host = host
        self._port = port
        self._base_url = f"http://{host}:{port}"
        self._ws_url = f"ws://{host}:{port}"
        self._aibox_ws_url = f"ws://{host}:{int(aibox_ws_port)}"
        self._mapping = mapping
        self._protocol = protocol
        self._timeout = timeout
        self._last_aibox_playback: dict[str, Any] = {}

    @property
    def protocol(self) -> str:
        """Return configured protocol."""
        return self._protocol

    # ---------------------------
    # HTTP bridge implementation
    # ---------------------------
    async def _goi_get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Perform GET call and validate common response format."""
        url = f"{self._base_url}{path}"
        try:
            async with self._session.get(url, params=params, timeout=self._timeout) as response:
                response.raise_for_status()
                payload = await self._giai_ma_payload(response)
        except (ClientError, ClientResponseError) as err:
            raise PhicommR1ApiConnectionError(str(err)) from err

        if not isinstance(payload, dict):
            raise PhicommR1ApiResponseError("Payload must be a JSON object")

        code_key = self._mapping.response_code_key
        if code_key and self._mapping.response_success_code:
            code = payload.get(code_key)
            if str(code) != self._mapping.response_success_code:
                message = payload.get(self._mapping.response_message_key) or "Unknown API error"
                raise PhicommR1ApiResponseError(str(message))

        return payload

    async def _giai_ma_payload(self, response) -> dict[str, Any]:
        """Decode API payload, supporting JSON and raw text fallbacks."""
        text = await response.text()
        if not text:
            return {}

        try:
            payload = json.loads(text)
        except ValueError:
            return {_RAW_RESPONSE_KEY: text}

        if isinstance(payload, dict):
            return payload
        return {_RAW_RESPONSE_KEY: str(payload)}

    def _lay_ket_qua(self, payload: dict[str, Any]) -> str:
        """Extract output from configured result key with raw fallback."""
        result_key = self._mapping.response_result_key
        if result_key and result_key in payload:
            return str(payload.get(result_key, "")).strip()
        return str(payload.get(_RAW_RESPONSE_KEY, "")).strip()

    # ---------------------------
    # Native WebSocket API (R1)
    # ---------------------------
    async def _ws_gui_va_cho(
        self,
        payload: dict[str, Any],
        expect_type: str | set[str] | None = None,
        timeout: float = 5.0,
    ) -> dict[str, Any]:
        """Send a WS message and wait for matching response type."""
        try:
            async with self._session.ws_connect(self._ws_url, timeout=self._timeout) as ws:
                await ws.send_str(json.dumps(payload, ensure_ascii=False))
                while True:
                    msg = await ws.receive(timeout=timeout)
                    if msg.type is WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(data, dict):
                            continue
                        if expect_type is None:
                            return data
                        msg_type = data.get("type")
                        if isinstance(expect_type, set):
                            if msg_type in expect_type:
                                return data
                        elif msg_type == expect_type:
                            return data
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                        raise PhicommR1ApiConnectionError("WebSocket connection closed unexpectedly")
        except asyncio.TimeoutError as err:
            raise PhicommR1ApiConnectionError("WebSocket response timeout") from err
        except ClientError as err:
            raise PhicommR1ApiConnectionError(str(err)) from err

    async def _ws_chi_gui(self, payload: dict[str, Any]) -> None:
        """Send WS message without waiting for ack."""
        try:
            async with self._session.ws_connect(self._ws_url, timeout=self._timeout) as ws:
                await ws.send_str(json.dumps(payload, ensure_ascii=False))
                await asyncio.sleep(0.05)
        except (ClientError, asyncio.TimeoutError) as err:
            raise PhicommR1ApiConnectionError(str(err)) from err

    @staticmethod
    def _aibox_loai_tin_nhan(payload: dict[str, Any]) -> str | None:
        """Return message kind from common Aibox keys."""
        for key in ("type", "action", "event", "cmd", "command"):
            value = payload.get(key)
            if isinstance(value, str):
                normalized = value.strip()
                if normalized:
                    return normalized
        return None

    @staticmethod
    def _aibox_loai_khop(actual: str | None, expected: str) -> bool:
        """Match Aibox message kinds with relaxed suffix compatibility."""
        if not actual or not expected:
            return False
        actual_norm = actual.strip().lower()
        expected_norm = expected.strip().lower()
        if actual_norm == expected_norm:
            return True

        # Some firmware responses omit or add `_result` / `_state`.
        for suffix in ("_result", "_state"):
            if actual_norm.endswith(suffix) and actual_norm[: -len(suffix)] == expected_norm:
                return True
            if expected_norm.endswith(suffix) and expected_norm[: -len(suffix)] == actual_norm:
                return True
        return False

    @staticmethod
    def _aibox_phan_tich_bool(value: Any) -> bool | None:
        """Normalize mixed boolean representations from Aibox payloads."""
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                return None
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "on", "enable", "enabled", "yes", "y"}:
                return True
            if normalized in {"0", "false", "off", "disable", "disabled", "no", "n"}:
                return False
            try:
                numeric = float(normalized)
            except ValueError:
                return None
            if math.isfinite(numeric):
                return numeric != 0
        return None

    @staticmethod
    def _aibox_chuan_hoa_payload(payload: dict[str, Any]) -> dict[str, Any]:
        """Flatten common wrappers and normalize core state fields."""
        normalized = dict(payload)

        for container_key in ("data", "result", "payload"):
            container = normalized.get(container_key)
            if isinstance(container, dict):
                for key, value in container.items():
                    normalized.setdefault(key, value)

        if "enabled" not in normalized and "enable" in normalized:
            parsed_enabled = PhicommR1ApiClient._aibox_phan_tich_bool(normalized.get("enable"))
            if parsed_enabled is not None:
                normalized["enabled"] = parsed_enabled

        msg_kind = PhicommR1ApiClient._aibox_loai_tin_nhan(normalized)
        if msg_kind and "type" not in normalized:
            normalized["type"] = msg_kind
        return normalized

    def _aibox_khop_ky_vong(
        self,
        msg_kind: str | None,
        expected: str | set[str] | None,
    ) -> bool:
        """Check whether message kind matches expected value(s)."""
        if expected is None:
            return True
        if isinstance(expected, set):
            return any(self._aibox_loai_khop(msg_kind, item) for item in expected)
        return self._aibox_loai_khop(msg_kind, expected)

    @staticmethod
    def _aibox_chuan_hoa_truy_van_tim_kiem(value: Any) -> str:
        """Normalize search query text for reliable frame matching."""
        return re.sub(r"\s+", " ", str(value or "").strip()).lower()

    @classmethod
    def _aibox_lay_truy_van_tim_kiem(cls, payload: dict[str, Any]) -> str:
        """Extract echoed search query from common payload field names."""
        for key in ("query", "keyword", "search_text", "searchText", "text"):
            if key not in payload:
                continue
            normalized = cls._aibox_chuan_hoa_truy_van_tim_kiem(payload.get(key))
            if normalized:
                return normalized
        return ""

    @classmethod
    def _aibox_chon_ket_qua_tim_kiem(
        cls,
        responses: list[dict[str, Any]],
        expected_query: str,
    ) -> dict[str, Any] | None:
        """Pick the safest search result frame from a burst of WS messages."""
        exact_matches: list[dict[str, Any]] = []
        queryless_matches: list[dict[str, Any]] = []

        for response in responses:
            if not isinstance(response, dict):
                continue
            response_query = cls._aibox_lay_truy_van_tim_kiem(response)
            if response_query:
                if expected_query and response_query == expected_query:
                    exact_matches.append(response)
                continue
            queryless_matches.append(response)

        if exact_matches:
            return exact_matches[-1]
        if queryless_matches:
            return queryless_matches[-1]
        return None

    def _aibox_cap_nhat_bo_nho_phat(
        self,
        payload: dict[str, Any],
        msg_kind: str | None = None,
    ) -> None:
        """Capture latest playback metadata broadcast by AiboxPlus."""
        kind = (msg_kind or self._aibox_loai_tin_nhan(payload) or "").strip().lower()
        if not payload:
            return

        is_playback_payload = kind in {
            "playback_state",
            "music_state",
            "player_state",
            "play_state",
        } or any(
            key in payload
            for key in (
                "is_playing",
                "play_state",
                "state",
                "title",
                "artist",
                "channel",
                "duration",
                "position",
                "thumbnail_url",
                "source",
                "id",
                "video_id",
                "song_id",
                "playlist_id",
                "url",
            )
        )
        if not is_playback_payload:
            return

        merged = dict(self._last_aibox_playback)
        previous_title = str(merged.get("title", "") or "").strip()
        previous_identity = str(
            merged.get("video_id")
            or merged.get("song_id")
            or merged.get("playlist_id")
            or merged.get("id")
            or ""
        ).strip()
        incoming_title = str(payload.get("title", "") or "").strip()
        incoming_identity = str(
            payload.get("video_id")
            or payload.get("song_id")
            or payload.get("playlist_id")
            or payload.get("id")
            or ""
        ).strip()
        title_changed = bool(incoming_title and previous_title and incoming_title != previous_title)
        identity_changed = bool(incoming_identity and previous_identity and incoming_identity != previous_identity)
        if title_changed or identity_changed:
            for key in ("id", "video_id", "song_id", "url"):
                merged.pop(key, None)

        for key in (
            "is_playing",
            "play_state",
            "state",
            "position",
            "duration",
            "title",
            "artist",
            "channel",
            "thumbnail_url",
            "source",
            "id",
            "video_id",
            "song_id",
            "playlist_id",
            "url",
            "auto_next_enabled",
            "repeat_enabled",
            "shuffle_enabled",
        ):
            if key in payload:
                merged[key] = payload.get(key)

        # Keep `is_playing` in sync with the freshest state-like signal.
        # Many firmware frames only include `state`/`play_state`, and if we
        # don't normalize them here the old `is_playing` value can become stale.
        playing_hint: bool | None = None
        for key in ("is_playing", "play_state", "state"):
            if key in payload:
                parsed = self._aibox_phan_tich_co_dang_phat(payload.get(key))
                if parsed is not None:
                    playing_hint = parsed
                    break
        if playing_hint is None:
            for key in ("is_playing", "play_state", "state"):
                if key in merged:
                    parsed = self._aibox_phan_tich_co_dang_phat(merged.get(key))
                    if parsed is not None:
                        playing_hint = parsed
                        break
        if playing_hint is not None:
            merged["is_playing"] = playing_hint

        # Drop stale identity fields that no longer match the active source.
        source_text = str(merged.get("source", "") or "").strip().lower()
        if "zing" in source_text:
            merged.pop("video_id", None)
        elif source_text:
            merged.pop("song_id", None)

        # Hard stop frames often omit metadata. Clear old track details so the
        # frontend doesn't keep showing the previous song after playback ends.
        try:
            position_value = float(merged.get("position") or 0)
        except (TypeError, ValueError):
            position_value = 0.0
        try:
            duration_value = float(merged.get("duration") or 0)
        except (TypeError, ValueError):
            duration_value = 0.0
        hard_stopped = (
            playing_hint is False
            and position_value <= 0
            and duration_value <= 0
        )
        if hard_stopped:
            for key in (
                "title",
                "artist",
                "channel",
                "thumbnail_url",
                "source",
                "id",
                "video_id",
                "song_id",
                "playlist_id",
                "url",
            ):
                merged.pop(key, None)

        merged["type"] = kind or payload.get("type") or "playback_state"
        merged["updated_at_ms"] = int(time.time() * 1000)
        self._last_aibox_playback = merged

    @staticmethod
    def _aibox_phan_tich_co_dang_phat(value: Any) -> bool | None:
        """Normalize mixed playback state representations into bool."""
        if value in (True, 1, 3):
            return True
        if value in (False, 0, 2):
            return False
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "3", "playing", "play", "on"}:
                return True
            if normalized in {"false", "0", "2", "paused", "pause", "stopped", "stop", "idle", "off"}:
                return False
        return None

    def get_last_aibox_playback(self) -> dict[str, Any]:
        """Return latest observed Aibox playback metadata."""
        return dict(self._last_aibox_playback)

    @staticmethod
    def _aibox_la_payload_tin_nhan_chat(payload: dict[str, Any]) -> bool:
        """Heuristic for chat message frame variants."""
        return any(
            key in payload
            for key in ("content", "message", "text", "message_type", "role", "sender")
        )

    async def _aibox_yeu_cau_trang_thai_bool(
        self,
        *,
        fetch_state: Callable[[], Awaitable[dict[str, Any]]],
        expected: bool,
        field_names: tuple[str, ...] = ("enabled", "enable"),
        timeout: float = 5.0,
        interval: float = 0.25,
        error_label: str,
    ) -> dict[str, Any]:
        """Poll Aibox getter until bool field matches expected value."""
        end = asyncio.get_running_loop().time() + max(0.1, timeout)
        last_response: dict[str, Any] = {}
        while asyncio.get_running_loop().time() < end:
            with suppress(PhicommR1ApiError, Exception):
                response = await fetch_state()
                if isinstance(response, dict):
                    for field_name in field_names:
                        if field_name not in response:
                            continue
                        last_response = response
                        parsed = self._aibox_phan_tich_bool(response.get(field_name))
                        if parsed is expected:
                            return response
            await asyncio.sleep(max(0.05, interval))
        raise PhicommR1ApiResponseError(
            f"{error_label} state confirmation failed: {last_response}"
        )

    # --------------------------------
    # AiboxPlus WebSocket API (8082)
    # --------------------------------
    async def _aibox_gui_va_cho(
        self,
        payload: dict[str, Any],
        expect_type: str | set[str] | None = None,
        timeout: float = 25.0,
    ) -> dict[str, Any]:
        """Send message to AiboxPlus WS and wait for matching response."""
        try:
            async with self._session.ws_connect(self._aibox_ws_url, timeout=self._timeout) as ws:
                await ws.send_str(json.dumps(payload, ensure_ascii=False))
                while True:
                    msg = await ws.receive(timeout=timeout)
                    if msg.type is WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(data, dict):
                            continue
                        normalized = self._aibox_chuan_hoa_payload(data)
                        msg_kind = self._aibox_loai_tin_nhan(normalized)
                        self._aibox_cap_nhat_bo_nho_phat(normalized, msg_kind)
                        _LOGGER.debug(
                            "Aibox recv action=%s kind=%s payload=%s",
                            payload.get("action"),
                            msg_kind,
                            normalized,
                        )
                        if self._aibox_loai_khop(msg_kind, "connected"):
                            # Handshake frame from AiboxPlus server; continue waiting.
                            continue

                        if self._aibox_khop_ky_vong(msg_kind, expect_type):
                            return normalized

                        # Some builds may vary response type naming; accept payloads
                        # that clearly contain search result or direct error.
                        if "songs" in normalized or "error" in normalized:
                            return normalized

                        request_action = str(payload.get("action", "")).strip().lower()
                        # Some firmware emits noisy unrelated frames on the same WS channel.
                        # Keep fallback matching strict per action family to avoid false positives.
                        msg_kind_norm = str(msg_kind or "").strip().lower()
                        if request_action.startswith("wake_word_") and "wake_word" in msg_kind_norm:
                            expects_sensitivity = "sensitivity" in request_action
                            if expects_sensitivity and any(
                                key in normalized for key in ("sensitivity", "value")
                            ):
                                return normalized
                            if not expects_sensitivity and any(
                                key in normalized for key in ("enabled", "enable", "state")
                            ):
                                return normalized
                        if request_action.startswith("custom_ai_") and "custom_ai" in msg_kind_norm and any(
                            key in normalized for key in ("enabled", "enable")
                        ):
                            return normalized
                        if request_action.startswith("chat_") and (
                            "chat" in msg_kind_norm
                            or "test_mic" in msg_kind_norm
                        ) and any(
                            key in normalized
                            for key in ("state", "chat_state", "button_text", "button_enabled")
                        ):
                            return normalized
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                        raise PhicommR1ApiConnectionError(
                            "AiboxPlus WebSocket connection closed unexpectedly"
                        )
        except asyncio.TimeoutError as err:
            _LOGGER.debug("AiboxPlus timeout for payload %s", payload)
            raise PhicommR1ApiConnectionError("AiboxPlus WebSocket response timeout") from err
        except ClientError as err:
            raise PhicommR1ApiConnectionError(str(err)) from err

    async def _aibox_chi_gui(self, payload: dict[str, Any]) -> None:
        """Send message to AiboxPlus WS without waiting for response."""
        try:
            async with self._session.ws_connect(self._aibox_ws_url, timeout=self._timeout) as ws:
                await ws.send_str(json.dumps(payload, ensure_ascii=False))
                await asyncio.sleep(0.05)
        except (ClientError, asyncio.TimeoutError) as err:
            raise PhicommR1ApiConnectionError(str(err)) from err

    async def _aibox_gui_va_thu_thap(
        self,
        payload: dict[str, Any],
        collect_types: set[str],
        first_timeout: float = 10.0,
        collect_window: float = 1.2,
        max_items: int = 50,
    ) -> list[dict[str, Any]]:
        """Send payload and collect matching WS messages for a short window."""
        if not collect_types:
            return []

        items: list[dict[str, Any]] = []
        try:
            async with self._session.ws_connect(self._aibox_ws_url, timeout=self._timeout) as ws:
                await ws.send_str(json.dumps(payload, ensure_ascii=False))

                # Wait for first matching frame.
                while True:
                    msg = await ws.receive(timeout=first_timeout)
                    if msg.type is WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(data, dict):
                            continue
                        normalized = self._aibox_chuan_hoa_payload(data)
                        msg_kind = self._aibox_loai_tin_nhan(normalized)
                        self._aibox_cap_nhat_bo_nho_phat(normalized, msg_kind)
                        _LOGGER.debug(
                            "Aibox collect(first) action=%s kind=%s payload=%s",
                            payload.get("action"),
                            msg_kind,
                            normalized,
                        )
                        if self._aibox_loai_khop(msg_kind, "connected"):
                            continue
                        if self._aibox_khop_ky_vong(msg_kind, collect_types):
                            items.append(normalized)
                            break
                        request_action = str(payload.get("action", "")).strip().lower()
                        if request_action.startswith("chat_") and self._aibox_la_payload_tin_nhan_chat(
                            normalized
                        ):
                            normalized.setdefault("type", "chat_message")
                            items.append(normalized)
                            break
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                        raise PhicommR1ApiConnectionError(
                            "AiboxPlus WebSocket connection closed unexpectedly"
                        )

                # Collect more frames in the same connection.
                end_time = asyncio.get_running_loop().time() + collect_window
                while len(items) < max_items:
                    remain = end_time - asyncio.get_running_loop().time()
                    if remain <= 0:
                        break
                    try:
                        msg = await ws.receive(timeout=remain)
                    except asyncio.TimeoutError:
                        break

                    if msg.type is WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(data, dict):
                            continue
                        normalized = self._aibox_chuan_hoa_payload(data)
                        msg_kind = self._aibox_loai_tin_nhan(normalized)
                        self._aibox_cap_nhat_bo_nho_phat(normalized, msg_kind)
                        _LOGGER.debug(
                            "Aibox collect(next) action=%s kind=%s payload=%s",
                            payload.get("action"),
                            msg_kind,
                            normalized,
                        )
                        if self._aibox_loai_khop(msg_kind, "connected"):
                            continue
                        if self._aibox_khop_ky_vong(msg_kind, collect_types):
                            items.append(normalized)
                            continue
                        request_action = str(payload.get("action", "")).strip().lower()
                        if request_action.startswith("chat_") and self._aibox_la_payload_tin_nhan_chat(
                            normalized
                        ):
                            normalized.setdefault("type", "chat_message")
                            items.append(normalized)
                    elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                        break
        except asyncio.TimeoutError as err:
            raise PhicommR1ApiConnectionError("AiboxPlus collection timeout") from err
        except ClientError as err:
            raise PhicommR1ApiConnectionError(str(err)) from err
        return items

    async def _aibox_gui_va_chon_ket_qua_tim_kiem(
        self,
        payload: dict[str, Any],
        *,
        expect_type: str,
        query: str,
        first_timeout: float = 6.0,
        collect_window: float = 0.9,
        max_items: int = 12,
    ) -> dict[str, Any]:
        """Send a search request and choose the freshest matching result frame."""
        responses = await self._aibox_gui_va_thu_thap(
            payload,
            collect_types={expect_type},
            first_timeout=first_timeout,
            collect_window=collect_window,
            max_items=max_items,
        )
        expected_query = self._aibox_chuan_hoa_truy_van_tim_kiem(query)
        selected = self._aibox_chon_ket_qua_tim_kiem(responses, expected_query)
        if selected is not None:
            return selected

        _LOGGER.debug(
            "Aibox search frames did not match query=%s expect_type=%s responses=%s",
            expected_query,
            expect_type,
            responses,
        )
        raise PhicommR1ApiConnectionError("AiboxPlus search response did not match requested query")

    def _ws_kiem_tra_ma(self, response: dict[str, Any]) -> None:
        """Validate optional code field in WS response."""
        code = response.get("code")
        if code is None:
            return
        if str(code) not in {"0", "200"}:
            raise PhicommR1ApiResponseError(str(response.get("msg") or response))

    async def _ws_lay_thong_tin(self) -> dict[str, Any]:
        """Get speaker state from native WS API."""
        response = await self._ws_gui_va_cho({"type": "get_info"}, expect_type="get_info")
        self._ws_kiem_tra_ma(response)
        data = response.get("data")
        if isinstance(data, str):
            try:
                parsed = json.loads(data)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError as err:
                raise PhicommR1ApiResponseError("Invalid get_info payload") from err
        if isinstance(data, dict):
            return data
        raise PhicommR1ApiResponseError("Missing get_info data")

    async def _ws_lay_am_luong_toi_da(self) -> int | None:
        """Get max volume if supported."""
        try:
            response = await self._ws_gui_va_cho({"type": "max_vol"}, expect_type="max_vol")
            self._ws_kiem_tra_ma(response)
            return int(response.get("data"))
        except (PhicommR1ApiError, ValueError, TypeError):
            return None

    async def async_get_eq_config(self) -> dict[str, Any]:
        """Get EQ/Bass/Loudness configuration from native WS API."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("EQ config is only available in ws_native mode")

        response = await self._ws_gui_va_cho({"type": "get_eq_config"}, expect_type="get_eq_config")
        self._ws_kiem_tra_ma(response)

        data = response.get("data")
        parsed: dict[str, Any] | None = None
        if isinstance(data, str):
            try:
                candidate = json.loads(data)
            except json.JSONDecodeError as err:
                raise PhicommR1ApiResponseError("Invalid get_eq_config payload") from err
            if isinstance(candidate, dict):
                parsed = candidate
        elif isinstance(data, dict):
            parsed = data

        if parsed is None:
            fallback = {
                key: response.get(key)
                for key in ("eq", "bass", "loudness", "Mixer", "music_light_mode")
                if key in response
            }
            parsed = fallback or None

        if not isinstance(parsed, dict):
            raise PhicommR1ApiResponseError("Missing get_eq_config data")
        return parsed

    async def _ws_hanh_dong_media(self, action: str) -> None:
        """Send media action to native WS API."""
        if action == "next":
            await self.async_shell("input keyevent 87", type_id="myshell")
            await self._ws_chi_gui(
                {"type": "send_message", "what": 65536, "arg1": 0, "arg2": 1, "obj": "web_next"}
            )
            await self._ws_chi_gui({"type": "next"})
            return
        if action == "previous":
            await self.async_shell("input keyevent 88", type_id="myshell")
            await self._ws_chi_gui(
                {"type": "send_message", "what": 65536, "arg1": 0, "arg2": 1, "obj": "web_prev"}
            )
            await self._ws_chi_gui({"type": "prev"})
            return
        if action in {"pause", "stop"}:
            await self._ws_chi_gui(
                {"type": "send_message", "what": 4, "arg1": 2, "arg2": -1, "obj": True}
            )
            return
        if action == "play":
            await self._ws_chi_gui(
                {"type": "send_message", "what": 4, "arg1": 3, "arg2": -1, "obj": True}
            )
            return
        raise PhicommR1ApiResponseError(f"Unsupported media action: {action}")

    async def _ws_dat_am_luong(self, target: int) -> None:
        """Set volume via native WS API."""
        await self._ws_chi_gui({"type": "set_vol", "vol": int(target)})

    async def _ws_cho_dieu_kien(
        self,
        predicate: Any,
        timeout: float = 4.0,
        interval: float = 0.25,
    ) -> dict[str, Any] | None:
        """Poll get_info until predicate matches or timeout expires."""
        end = asyncio.get_running_loop().time() + max(0.1, timeout)
        last_info: dict[str, Any] | None = None
        while asyncio.get_running_loop().time() < end:
            with suppress(PhicommR1ApiError):
                info = await self._ws_lay_thong_tin()
                last_info = info
                try:
                    if predicate(info):
                        return info
                except Exception:  # noqa: BLE001
                    pass
            await asyncio.sleep(max(0.05, interval))
        return last_info

    async def _ws_yeu_cau_dieu_kien(
        self,
        predicate: Any,
        *,
        timeout: float,
        interval: float,
        error_label: str,
    ) -> dict[str, Any]:
        """Require predicate match from get_info and raise if not confirmed."""
        info = await self._ws_cho_dieu_kien(
            predicate=predicate,
            timeout=timeout,
            interval=interval,
        )
        with suppress(PhicommR1ApiError):
            latest = await self._ws_lay_thong_tin()
            info = latest or info

        matched = False
        if info is not None:
            with suppress(Exception):  # noqa: BLE001
                matched = bool(predicate(info))

        if not matched:
            raise PhicommR1ApiResponseError(
                f"{error_label} state confirmation failed: {info}"
            )

        return info

    @staticmethod
    def _ws_la_bluetooth_bat(device_state: Any) -> bool | None:
        """Parse bluetooth state from `device_state` variants."""
        if device_state is None:
            return None
        if isinstance(device_state, (int, float)):
            if not math.isfinite(device_state):
                return None
            return int(device_state) == 3
        normalized = str(device_state).strip().lower()
        if not normalized:
            return None
        with suppress(ValueError):
            return int(float(normalized)) == 3
        if "bluetooth" in normalized:
            if any(token in normalized for token in ("off", "disable", "disconnect", "idle")):
                return False
            return True
        parsed = PhicommR1ApiClient._aibox_phan_tich_bool(normalized)
        return parsed

    # ---------------------------
    # Public API used by entities
    # ---------------------------
    async def async_do_cmd(self, command: str) -> str:
        """Run shell command."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            return await self.async_shell(command, type_id="myshell")

        payload = await self._goi_get(
            self._mapping.endpoint_do_cmd,
            {self._mapping.param_command: command},
        )
        return self._lay_ket_qua(payload)

    async def async_do_adb_cmd(self, command: str) -> str:
        """Run adb command (bridge mode) or fallback to shell (ws mode)."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            return await self.async_do_cmd(command)

        payload = await self._goi_get(
            self._mapping.endpoint_adb_cmd,
            {self._mapping.param_command: command},
        )
        return self._lay_ket_qua(payload)

    async def async_send_keycode(self, keycode: int) -> str:
        """Send Android key event."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            if keycode == KEYCODE_VOLUME_UP:
                volume = await self.async_get_volume()
                if volume is None:
                    raise PhicommR1ApiResponseError("Unable to read current volume")
                await self._ws_dat_am_luong(min(volume.maximum, volume.current + 1))
                return "ok"
            if keycode == KEYCODE_VOLUME_DOWN:
                volume = await self.async_get_volume()
                if volume is None:
                    raise PhicommR1ApiResponseError("Unable to read current volume")
                await self._ws_dat_am_luong(max(volume.minimum, volume.current - 1))
                return "ok"
            if keycode in (KEYCODE_MEDIA_PLAY_PAUSE,):
                state = await self.async_get_playback_state()
                await self._ws_hanh_dong_media("pause" if state == "playing" else "play")
                return "ok"
            if keycode == KEYCODE_MEDIA_NEXT:
                await self._ws_hanh_dong_media("next")
                return "ok"
            if keycode == KEYCODE_MEDIA_PREVIOUS:
                await self._ws_hanh_dong_media("previous")
                return "ok"
            if keycode == KEYCODE_MEDIA_STOP:
                await self._ws_hanh_dong_media("stop")
                return "ok"
            if keycode == KEYCODE_MUTE:
                await self._ws_dat_am_luong(0)
                return "ok"
            raise PhicommR1ApiResponseError(f"Keycode {keycode} not supported in ws_native mode")

        payload = await self._goi_get(
            self._mapping.endpoint_keyevent,
            {self._mapping.param_keycode: keycode},
        )
        return self._lay_ket_qua(payload)

    async def async_media_dispatch(self, key: str) -> str:
        """Dispatch media command."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            await self._ws_hanh_dong_media(key)
            return "ok"

        payload = await self._goi_get(
            self._mapping.endpoint_media_dispatch,
            {self._mapping.param_media_key: key},
        )
        return self._lay_ket_qua(payload)

    async def async_get_model(self) -> str:
        """Get device model."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            info = await self._ws_lay_thong_tin()
            # Native WS payload does not always expose model; fallback to friendly name.
            return str(info.get("device_name") or info.get("dev_name") or "Phicomm R1")
        return await self.async_do_cmd("getprop ro.product.model")

    async def async_get_volume(self) -> VolumeInfo | None:
        """Query current media volume."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            info = await self._ws_lay_thong_tin()
            try:
                current = int(info.get("vol"))
            except (TypeError, ValueError):
                return None
            maximum = await self._ws_lay_am_luong_toi_da()
            if maximum is None:
                # Fallback default used by many R1 builds.
                maximum = 100
            return VolumeInfo(current=current, minimum=0, maximum=maximum)

        output = await self.async_do_cmd("media volume --stream 3 --get")
        match = _VOLUME_RE.search(output)
        if not match:
            return None
        return VolumeInfo(
            current=int(match.group("current")),
            minimum=int(match.group("min")),
            maximum=int(match.group("max")),
        )

    async def async_get_playback_state(self) -> str | None:
        """Get playback state."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            info = await self._ws_lay_thong_tin()
            state_text = str(info.get("state") or "").strip().lower()
            playing_hint: bool | None = None
            for key in ("is_playing", "play_state", "state"):
                if key in info:
                    parsed = self._aibox_phan_tich_co_dang_phat(info.get(key))
                    if parsed is not None:
                        playing_hint = parsed
                        break
            if playing_hint is True:
                return "playing"
            if playing_hint is False:
                if state_text in {"stopped", "stop", "idle", "off"}:
                    return "stopped"
                return "paused"
            return None

        output = await self.async_do_cmd("dumpsys media_session")
        match = _PLAYBACK_STATE_RE.search(output)
        if not match:
            return None

        code = int(match.group("state"))
        if code == 3:
            return "playing"
        if code == 2:
            return "paused"
        if code == 1:
            return "stopped"
        return None

    async def async_set_absolute_volume(self, target: int) -> None:
        """Set absolute volume index."""
        target = int(target)
        if self._protocol == PROTOCOL_WS_NATIVE:
            await self._ws_dat_am_luong(target)
            return
        await self.async_do_cmd(f"media volume --stream 3 --set {target}")

    async def async_get_status_snapshot(self) -> dict[str, Any]:
        """Get unified status snapshot for coordinator update."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            info = await self._ws_lay_thong_tin()
            max_vol = await self._ws_lay_am_luong_toi_da()
            if max_vol is None:
                max_vol = 100

            state_text = str(info.get("state") or "").strip().lower()
            playing_hint: bool | None = None
            for key in ("is_playing", "play_state", "state"):
                if key in info:
                    parsed = self._aibox_phan_tich_co_dang_phat(info.get(key))
                    if parsed is not None:
                        playing_hint = parsed
                        break

            if playing_hint is True:
                playback_state = "playing"
            elif playing_hint is False:
                playback_state = (
                    "stopped" if state_text in {"stopped", "stop", "idle", "off"} else "paused"
                )
            else:
                playback_state = None

            volume_current = None
            try:
                volume_current = int(info.get("vol"))
            except (TypeError, ValueError):
                volume_current = None

            return {
                "model": str(info.get("device_name") or info.get("dev_name") or "Phicomm R1"),
                "playback_state": playback_state,
                "volume_current": volume_current,
                "volume_min": 0,
                "volume_max": int(max_vol),
                "raw": info,
            }

        model = await self.async_get_model()
        volume = await self.async_get_volume()
        playback_state = await self.async_get_playback_state()
        return {
            "model": model,
            "playback_state": playback_state,
            "volume_current": volume.current if volume else None,
            "volume_min": volume.minimum if volume else None,
            "volume_max": volume.maximum if volume else None,
            "raw": {
                "model": model,
                "playback_state": playback_state,
            },
        }

    async def async_ws_send_payload(
        self,
        payload: dict[str, Any],
        expect_type: str | None = None,
    ) -> dict[str, Any]:
        """Send generic payload in ws_native mode."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Generic WS payload is only available in ws_native mode")
        if expect_type:
            response = await self._ws_gui_va_cho(payload, expect_type=expect_type)
            self._ws_kiem_tra_ma(response)
            return response
        await self._ws_chi_gui(payload)
        return {"status": "sent"}

    async def async_send_message(
        self,
        what: int,
        arg1: int,
        arg2: int = -1,
        obj: Any = True,
        type_id: str | None = None,
    ) -> None:
        """Send native WS `send_message` payload."""
        payload: dict[str, Any] = {
            "type": "send_message",
            "what": int(what),
            "arg1": int(arg1),
            "arg2": int(arg2),
            "obj": obj,
        }
        if type_id:
            payload["type_id"] = type_id
        if self._protocol == PROTOCOL_WS_NATIVE:
            await self._ws_chi_gui(payload)
            return
        raise PhicommR1ApiResponseError("send_message is only available in ws_native mode")

    async def async_shell(self, command: str, type_id: str = "myshell") -> str:
        """Run shell command using ws_native shell message."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            response = await self._ws_gui_va_cho(
                {"type": "shell", "type_id": type_id, "shell": command},
                expect_type="shell",
            )
            self._ws_kiem_tra_ma(response)
            return str(response.get("data", "")).strip()
        return await self.async_do_cmd(command)

    async def async_set_dlna(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable DLNA autostart."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("DLNA control is only available in ws_native mode")
        desired = bool(enabled)
        await self._ws_chi_gui(
            {
                "type": "Set_DLNA_Open",
                "open": 1 if desired else 0,
                "type_id": (
                    "Allow DLNA service to start"
                    if desired
                    else "Prohibit DLNA service from starting"
                ),
            }
        )
        return await self._ws_yeu_cau_dieu_kien(
            predicate=lambda info: self._aibox_phan_tich_bool(info.get("dlna_open")) == desired,
            timeout=5.0,
            interval=0.25,
            error_label="DLNA",
        )

    async def async_set_airplay(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable AirPlay autostart."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("AirPlay control is only available in ws_native mode")
        desired = bool(enabled)
        await self._ws_chi_gui(
            {
                "type": "Set_AirPlay_Open",
                "open": 1 if desired else 0,
                "type_id": (
                    "Allow AirPlay service to start"
                    if desired
                    else "Prohibit AirPlay service from starting"
                ),
            }
        )
        return await self._ws_yeu_cau_dieu_kien(
            predicate=lambda info: self._aibox_phan_tich_bool(info.get("airplay_open")) == desired,
            timeout=5.0,
            interval=0.25,
            error_label="AirPlay",
        )

    async def async_set_bluetooth(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable bluetooth."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Bluetooth control is only available in ws_native mode")
        desired = bool(enabled)
        await self.async_send_message(
            what=64,
            arg1=1 if desired else 2,
            arg2=-1,
            obj=True,
            type_id="Open Bluetooth" if desired else "Close Bluetooth",
        )
        return await self._ws_yeu_cau_dieu_kien(
            predicate=lambda info: self._ws_la_bluetooth_bat(info.get("device_state")) == desired,
            timeout=9.0,
            interval=0.3,
            error_label="Bluetooth",
        )

    async def async_set_main_light(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable ambient main light."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Light control is only available in ws_native mode")
        desired = bool(enabled)
        await self.async_send_message(what=4, arg1=64, arg2=1 if desired else 0, obj=True)
        return await self._ws_yeu_cau_dieu_kien(
            predicate=lambda info: self._aibox_phan_tich_bool(info.get("music_light_enable")) == desired,
            timeout=6.0,
            interval=0.25,
            error_label="Main light",
        )

    async def async_set_light_mode(self, mode: int) -> None:
        """Set light effect mode."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Light control is only available in ws_native mode")
        await self.async_send_message(what=4, arg1=68, arg2=int(mode), obj=True)

    async def async_set_light_speed(self, speed: int) -> None:
        """Set light speed in range 1..100."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Light control is only available in ws_native mode")
        await self.async_send_message(what=4, arg1=66, arg2=int(speed), obj=True)

    async def async_set_light_brightness(self, brightness: int) -> None:
        """Set light brightness in range 1..200."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Light control is only available in ws_native mode")
        await self.async_send_message(what=4, arg1=65, arg2=int(brightness), obj=True)

    async def async_set_edge_light(self, enabled: bool, intensity: int | None = None) -> None:
        """Set edge white light via shell command."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Edge light control is only available in ws_native mode")
        if not enabled:
            await self.async_shell("lights_test set 7fffff8000 0", type_id="Turn on light")
            return
        if intensity is None:
            await self.async_shell("lights_test set 7fffff8000 ffffff", type_id="Turn on light")
            return
        val = max(0, min(255, int(round(intensity * 255 / 100))))
        hex_pair = f"{val:02x}"
        await self.async_shell(
            f"lights_test set 7fffff8000 {hex_pair}{hex_pair}{hex_pair}",
            type_id="Turn on light",
        )

    async def async_set_bass_enable(self, enabled: bool) -> None:
        """Toggle bass enhancement."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Bass control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_bass_enable", "enable": bool(enabled)})

    async def async_set_bass_strength(self, strength: int) -> None:
        """Set bass strength."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Bass control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_bass_strength", "strength": int(strength)})

    async def async_set_loudness_enable(self, enabled: bool) -> None:
        """Toggle loudness."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Loudness control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_loudness_enable", "enable": bool(enabled)})

    async def async_set_loudness_gain(self, gain: int) -> None:
        """Set loudness gain."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Loudness control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_loudness_gain", "gain": int(gain)})

    async def async_set_eq_enable(self, enabled: bool) -> None:
        """Toggle EQ."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("EQ control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_eq_enable", "enable": bool(enabled)})

    async def async_set_eq_bandlevel(self, band: int, level: int) -> None:
        """Set EQ band level."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("EQ control is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_eq_bandlevel", "band": int(band), "level": int(level)})

    async def async_set_mixer_value(self, control_name: str, value: int) -> None:
        """Set mixer value."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Mixer control is only available in ws_native mode")
        await self._ws_chi_gui(
            {
                "type": "sends",
                "list": [
                    {"type": "setMixerValue", "controlName": control_name, "value": str(int(value))},
                    {"type": "get_eq_config"},
                ],
            }
        )

    async def async_set_play_mode(self, mode: int) -> None:
        """Set player mode (e.g. repeat/shuffle)."""
        if self._protocol != PROTOCOL_WS_NATIVE:
            raise PhicommR1ApiResponseError("Play mode is only available in ws_native mode")
        await self._ws_chi_gui({"type": "set_play_mode", "mode": int(mode)})

    @staticmethod
    def _dam_bao_khong_rong(value: str, field_name: str) -> str:
        """Validate and normalize required text fields."""
        normalized = (value or "").strip()
        if not normalized:
            raise PhicommR1ApiResponseError(f"{field_name} cannot be empty")
        return normalized

    async def async_search_youtube(self, query: str) -> dict[str, Any]:
        """Search songs on YouTube via AiboxPlus WS API."""
        normalized_query = self._dam_bao_khong_rong(query, "query")
        request = {"action": "search_songs", "query": normalized_query}
        last_err: Exception | None = None
        for _ in range(2):
            try:
                return await self._aibox_gui_va_chon_ket_qua_tim_kiem(
                    request,
                    expect_type="search_result",
                    query=normalized_query,
                )
            except (PhicommR1ApiConnectionError, PhicommR1ApiResponseError) as err:
                last_err = err
                await asyncio.sleep(0.35)
                continue
        _LOGGER.debug("YouTube search fallback after retries: %s", last_err)
        with suppress(PhicommR1ApiConnectionError):
            await self._aibox_chi_gui(request)
        return {"success": False, "type": "search_result", "songs": []}

    async def async_search_playlist(self, query: str) -> dict[str, Any]:
        """Search playlists on YouTube via AiboxPlus WS API."""
        normalized_query = self._dam_bao_khong_rong(query, "query")
        request = {"action": "search_playlist", "query": normalized_query}
        last_err: Exception | None = None
        for _ in range(2):
            try:
                return await self._aibox_gui_va_chon_ket_qua_tim_kiem(
                    request,
                    expect_type="playlist_result",
                    query=normalized_query,
                )
            except (PhicommR1ApiConnectionError, PhicommR1ApiResponseError) as err:
                last_err = err
                await asyncio.sleep(0.35)
                continue
        _LOGGER.debug("Playlist search fallback after retries: %s", last_err)
        with suppress(PhicommR1ApiConnectionError):
            await self._aibox_chi_gui(request)
        return {
            "success": False,
            "type": "playlist_result",
            "songs": [],
            "playlists": [],
            "results": [],
        }

    async def async_search_zing(self, query: str) -> dict[str, Any]:
        """Search songs on Zing MP3 via AiboxPlus WS API."""
        normalized_query = self._dam_bao_khong_rong(query, "query")
        request = {"action": "search_zing", "query": normalized_query}
        last_err: Exception | None = None
        for _ in range(2):
            try:
                return await self._aibox_gui_va_chon_ket_qua_tim_kiem(
                    request,
                    expect_type="zing_result",
                    query=normalized_query,
                )
            except (PhicommR1ApiConnectionError, PhicommR1ApiResponseError) as err:
                last_err = err
                await asyncio.sleep(0.35)
                continue
        _LOGGER.debug("Zing search fallback after retries: %s", last_err)
        with suppress(PhicommR1ApiConnectionError):
            await self._aibox_chi_gui(request)
        return {"success": False, "type": "zing_result", "songs": []}

    async def async_play_youtube(self, video_id: str) -> None:
        """Play YouTube media by video id via AiboxPlus WS API."""
        normalized_video_id = self._dam_bao_khong_rong(video_id, "video_id")
        await self._aibox_chi_gui({"action": "play_song", "video_id": normalized_video_id})
        self._aibox_cap_nhat_bo_nho_phat(
            {
                "is_playing": True,
                "play_state": 1,
                "state": "playing",
                "position": 0,
                "source": "youtube",
                "type": "playback_state",
            },
            "playback_state",
        )

    async def async_play_zing(self, song_id: str) -> None:
        """Play Zing MP3 song by song id via AiboxPlus WS API."""
        normalized_song_id = self._dam_bao_khong_rong(song_id, "song_id")
        await self._aibox_chi_gui({"action": "play_zing", "song_id": normalized_song_id})
        self._aibox_cap_nhat_bo_nho_phat(
            {
                "is_playing": True,
                "play_state": 1,
                "state": "playing",
                "position": 0,
                "source": "zingmp3",
                "type": "playback_state",
            },
            "playback_state",
        )

    async def async_playlist_list(self) -> dict[str, Any]:
        """Fetch playlist library from AiboxPlus."""
        request = {"action": "playlist_list"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_list_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "playlist_list_result", "success": False, "playlists": []}

    async def async_playlist_create(self, name: str) -> dict[str, Any]:
        """Create a playlist in AiboxPlus."""
        normalized_name = self._dam_bao_khong_rong(name, "name")
        request = {"action": "playlist_create", "name": normalized_name}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_created", "playlist_create_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "playlist_created",
                "success": True,
                "playlist": {"name": normalized_name},
                "unverified": True,
            }

    async def async_playlist_delete(self, playlist_id: str | int) -> dict[str, Any]:
        """Delete a playlist by id."""
        normalized_playlist_id = self._dam_bao_khong_rong(str(playlist_id), "playlist_id")
        request = {"action": "playlist_delete", "playlist_id": normalized_playlist_id}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_deleted", "playlist_delete_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "playlist_deleted",
                "success": True,
                "playlist_id": normalized_playlist_id,
                "unverified": True,
            }

    async def async_playlist_get_songs(self, playlist_id: str | int) -> dict[str, Any]:
        """Fetch songs in one playlist."""
        normalized_playlist_id = self._dam_bao_khong_rong(str(playlist_id), "playlist_id")
        request = {"action": "playlist_get_songs", "playlist_id": normalized_playlist_id}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_songs_result", "playlist_get_songs_result"},
                timeout=10.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "playlist_songs_result",
                "success": False,
                "playlist_id": normalized_playlist_id,
                "songs": [],
            }

    async def async_playlist_add_song(
        self,
        playlist_id: str | int,
        *,
        source: str,
        item_id: str,
        title: str = "",
        artist: str = "",
        thumbnail_url: str = "",
        duration_seconds: int = 0,
    ) -> dict[str, Any]:
        """Add one track into a playlist."""
        normalized_playlist_id = self._dam_bao_khong_rong(str(playlist_id), "playlist_id")
        normalized_item_id = self._dam_bao_khong_rong(item_id, "id")
        source_text = str(source or "").strip().lower()
        normalized_source = "zing" if "zing" in source_text else "youtube"
        request = {
            "action": "playlist_add_song",
            "playlist_id": normalized_playlist_id,
            "source": normalized_source,
            "id": normalized_item_id,
            "title": str(title or "").strip(),
            "artist": str(artist or "").strip(),
            "thumbnail_url": str(thumbnail_url or "").strip(),
            "duration_seconds": int(duration_seconds or 0),
        }
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_song_added", "playlist_add_song_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "playlist_song_added",
                "success": True,
                "playlist_id": normalized_playlist_id,
                "id": normalized_item_id,
                "unverified": True,
            }

    async def async_playlist_remove_song(
        self,
        playlist_id: str | int,
        *,
        song_index: int,
    ) -> dict[str, Any]:
        """Remove one track from a playlist by zero-based index."""
        normalized_playlist_id = self._dam_bao_khong_rong(str(playlist_id), "playlist_id")
        request = {
            "action": "playlist_remove_song",
            "playlist_id": normalized_playlist_id,
            "song_index": int(song_index),
        }
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_song_removed", "playlist_remove_song_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "playlist_song_removed",
                "success": True,
                "playlist_id": normalized_playlist_id,
                "song_index": int(song_index),
                "unverified": True,
            }

    async def async_playlist_play(self, playlist_id: str | int) -> dict[str, Any]:
        """Play a playlist by id."""
        normalized_playlist_id = self._dam_bao_khong_rong(str(playlist_id), "playlist_id")
        request = {"action": "playlist_play", "playlist_id": normalized_playlist_id}
        try:
            response = await self._aibox_gui_va_cho(
                request,
                expect_type={"playlist_play_started", "playlist_play_result", "playback_state"},
                timeout=10.0,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            response = {
                "type": "playlist_play_started",
                "success": True,
                "playlist_id": normalized_playlist_id,
                "unverified": True,
            }
        optimistic = {
            "is_playing": True,
            "play_state": 1,
            "state": "playing",
            "position": 0,
            "source": "youtube_playlist",
            "playlist_id": normalized_playlist_id,
            "type": "playback_state",
        }
        playlist_name = response.get("playlist_name") or response.get("name")
        if playlist_name:
            optimistic["title"] = playlist_name
        self._aibox_cap_nhat_bo_nho_phat(optimistic, "playback_state")
        return response

    async def async_aibox_media_action(self, action: str) -> None:
        """Control AiboxPlus playback channel (YouTube/Zing)."""
        action_aliases: dict[str, list[str]] = {
            # Different R1/Aibox firmware builds expose different action names.
            # Keep aliases conservative to avoid sending opposite semantics
            # back-to-back on firmware variants.
            "play": ["resume", "play"],
            "pause": ["pause"],
            "toggle": ["play_pause"],
            "stop": ["stop", "stop_song"],
            "next": ["next", "next_song"],
            "previous": ["previous", "prev_song"],
        }
        aliases = action_aliases.get(action)
        if not aliases:
            raise PhicommR1ApiResponseError(f"Unsupported AiboxPlus media action: {action}")
        last_err: Exception | None = None
        sent_ok = False
        for alias in aliases:
            payload_options = (
                {"action": alias},
                {"type": alias},
            )
            for payload in payload_options:
                try:
                    await self._aibox_chi_gui(payload)
                    _LOGGER.debug("Aibox media action sent: %s via payload %s", action, payload)
                    sent_ok = True
                except PhicommR1ApiConnectionError as err:
                    last_err = err
                    _LOGGER.debug("Aibox media action send failed: %s via payload %s", action, payload)
                    continue

        if sent_ok:
            # Optimistically update playback cache so UI can reflect stop/pause
            # immediately while waiting for the next WS state frame.
            if action == "play":
                self._aibox_cap_nhat_bo_nho_phat(
                    {"is_playing": True, "play_state": 1, "state": "playing", "type": "playback_state"},
                    "playback_state",
                )
            elif action == "pause":
                self._aibox_cap_nhat_bo_nho_phat(
                    {"is_playing": False, "play_state": 0, "state": "paused", "type": "playback_state"},
                    "playback_state",
                )
            elif action == "stop":
                self._aibox_cap_nhat_bo_nho_phat(
                    {"is_playing": False, "play_state": 0, "state": "stopped", "type": "playback_state"},
                    "playback_state",
                )
            return

        if last_err is not None:
            raise last_err

    async def async_wake_word_set_enabled(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable wake word detection."""
        desired = bool(enabled)
        request = {"action": "wake_word_set_enabled", "enabled": desired}
        response: dict[str, Any] = {}
        try:
            response = await self._aibox_gui_va_cho(
                request,
                expect_type={"wake_word_set_enabled_result", "wake_word_enabled_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
        try:
            verify = await self._aibox_yeu_cau_trang_thai_bool(
                fetch_state=self.async_wake_word_get_enabled,
                expected=desired,
                field_names=("enabled", "enable", "state"),
                timeout=5.0,
                interval=0.25,
                error_label="Wake word",
            )
            if "type" not in verify and "type" in response:
                verify["type"] = response.get("type")
            return verify
        except PhicommR1ApiResponseError as err:
            _LOGGER.debug("Wake word confirmation timeout; fallback to optimistic state: %s", err)
            return {
                "type": "wake_word_set_enabled_result",
                "enabled": desired,
                "success": True,
                "unverified": True,
            }

    async def async_wake_word_get_enabled(self) -> dict[str, Any]:
        """Query wake word enabled state."""
        request = {"action": "wake_word_get_enabled"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"wake_word_get_enabled_result", "wake_word_enabled_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "wake_word_enabled_state", "success": False}

    async def async_wake_word_set_sensitivity(self, sensitivity: float) -> dict[str, Any]:
        """Set wake word sensitivity (0..1)."""
        request = {"action": "wake_word_set_sensitivity", "sensitivity": float(sensitivity)}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"wake_word_set_sensitivity_result", "wake_word_sensitivity_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {
                "type": "wake_word_set_sensitivity_result",
                "sensitivity": float(sensitivity),
                "success": True,
            }

    async def async_wake_word_get_sensitivity(self) -> dict[str, Any]:
        """Query wake word sensitivity."""
        request = {"action": "wake_word_get_sensitivity"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"wake_word_get_sensitivity_result", "wake_word_sensitivity_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "wake_word_sensitivity_state", "success": False}

    async def async_custom_ai_set_enabled(self, enabled: bool) -> dict[str, Any]:
        """Enable/disable custom AI (chống điếc AI)."""
        desired = bool(enabled)
        request = {"action": "custom_ai_set_enabled", "enabled": desired}
        response: dict[str, Any] = {}
        try:
            response = await self._aibox_gui_va_cho(
                request,
                expect_type={"custom_ai_set_enabled_result", "custom_ai_enabled_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
        try:
            verify = await self._aibox_yeu_cau_trang_thai_bool(
                fetch_state=self.async_custom_ai_get_enabled,
                expected=desired,
                field_names=("enabled", "enable", "state"),
                timeout=5.0,
                interval=0.25,
                error_label="Custom AI",
            )
            if "type" not in verify and "type" in response:
                verify["type"] = response.get("type")
            return verify
        except PhicommR1ApiResponseError as err:
            _LOGGER.debug("Custom AI confirmation timeout; fallback to optimistic state: %s", err)
            return {
                "type": "custom_ai_set_enabled_result",
                "enabled": desired,
                "success": True,
                "unverified": True,
            }

    async def async_custom_ai_get_enabled(self) -> dict[str, Any]:
        """Query custom AI enabled state."""
        request = {"action": "custom_ai_get_enabled"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"custom_ai_get_enabled_result", "custom_ai_enabled_state"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "custom_ai_enabled_state", "success": False}

    async def async_chat_wake_up(self) -> dict[str, Any]:
        """Trigger chat wake up."""
        request = {"action": "chat_wake_up"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"chat_state", "chat_send_result", "chat_wake_up_result"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "chat_state", "success": False}

    async def async_chat_test_mic(self) -> dict[str, Any]:
        """Trigger microphone test."""
        request = {"action": "chat_test_mic"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"test_mic_state", "chat_state", "chat_test_mic_result"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "test_mic_state", "success": False}

    async def async_chat_get_state(self) -> dict[str, Any]:
        """Get current chat/wake-up state."""
        request = {"action": "chat_get_state"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"chat_state", "chat_get_state_result"},
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"type": "chat_state", "success": False}

    async def async_chat_send_text(self, text: str) -> dict[str, Any]:
        """Send text message to chat pipeline and wait for ack/first message."""
        normalized_text = self._dam_bao_khong_rong(text, "text")
        request = {"action": "chat_send_text", "text": normalized_text}
        try:
            messages = await self._aibox_gui_va_thu_thap(
                request,
                collect_types={"chat_send_result", "chat_message", "chat_text_result"},
                first_timeout=20.0,
                collect_window=1.2,
                max_items=20,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"items": []}
        return {"items": messages}

    async def async_chat_get_history(self) -> dict[str, Any]:
        """Load recent chat history from server."""
        request = {"action": "chat_get_history"}
        try:
            messages = await self._aibox_gui_va_thu_thap(
                request,
                collect_types={"chat_message", "chat_history_result", "chat_history_item"},
                first_timeout=12.0,
                collect_window=1.5,
                max_items=100,
            )
        except PhicommR1ApiConnectionError:
            with suppress(PhicommR1ApiConnectionError):
                await self._aibox_chi_gui(request)
            return {"items": []}
        return {"items": messages}

    # --------------------------------
    # New feature methods (AiboxPlus)
    # --------------------------------

    async def async_aibox_get_playback_state(self) -> dict[str, Any]:
        """Poll current playback state from AiboxPlus."""
        request = {"action": "get_playback_state"}
        try:
            result = await self._aibox_gui_va_cho(
                request,
                expect_type={"playback_state", "music_state", "player_state", "play_state"},
                timeout=5.0,
            )
            self._aibox_cap_nhat_bo_nho_phat(result, self._aibox_loai_tin_nhan(result))
            return result
        except PhicommR1ApiConnectionError:
            return dict(self._last_aibox_playback)

    async def async_aibox_seek(self, position: int) -> None:
        """Seek to position (seconds) in current AiboxPlus playback."""
        await self._aibox_chi_gui({"action": "seek", "position": int(position)})
        # Optimistically update position in cache
        if self._last_aibox_playback:
            self._last_aibox_playback["position"] = int(position)

    async def async_aibox_toggle_repeat(self) -> dict[str, Any]:
        """Toggle repeat mode on AiboxPlus."""
        request = {"action": "toggle_repeat"}
        try:
            result = await self._aibox_gui_va_cho(
                request,
                expect_type={"repeat_state", "toggle_repeat_result", "playback_state"},
                timeout=5.0,
            )
            if "repeat_enabled" in result:
                self._last_aibox_playback["repeat_enabled"] = result["repeat_enabled"]
            return result
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            current = self._last_aibox_playback.get("repeat_enabled", False)
            self._last_aibox_playback["repeat_enabled"] = not current
            return {"repeat_enabled": not current}

    async def async_aibox_toggle_auto_next(self) -> dict[str, Any]:
        """Toggle auto-next mode on AiboxPlus."""
        request = {"action": "toggle_auto_next"}
        try:
            result = await self._aibox_gui_va_cho(
                request,
                expect_type={"auto_next_state", "toggle_auto_next_result", "playback_state"},
                timeout=5.0,
            )
            if "auto_next_enabled" in result:
                self._last_aibox_playback["auto_next_enabled"] = result["auto_next_enabled"]
            return result
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            current = self._last_aibox_playback.get("auto_next_enabled", True)
            self._last_aibox_playback["auto_next_enabled"] = not current
            return {"auto_next_enabled": not current}

    async def async_led_toggle(self) -> dict[str, Any]:
        """Toggle LED on/off via AiboxPlus."""
        request = {"action": "led_toggle"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"led_state", "led_toggle_result"},
                timeout=5.0,
            )
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            return {"type": "led_toggle_result", "success": True}

    async def async_led_get_state(self) -> dict[str, Any]:
        """Get LED state from AiboxPlus."""
        request = {"action": "led_get_state"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"led_state", "led_get_state_result"},
                timeout=5.0,
            )
        except PhicommR1ApiConnectionError:
            return {"type": "led_state", "success": False}

    async def async_stereo_get_state(self) -> dict[str, Any]:
        """Get stereo pairing state from AiboxPlus."""
        request = {"action": "stereo_get_state"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"stereo_state", "stereo_get_state_result"},
                timeout=5.0,
            )
        except PhicommR1ApiConnectionError:
            return {"type": "stereo_state", "success": False}

    async def async_stereo_enable(self) -> dict[str, Any]:
        """Enable stereo pairing mode."""
        request = {"action": "stereo_enable"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"stereo_state", "stereo_enable_result"},
                timeout=8.0,
            )
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            return {"type": "stereo_enable_result", "success": True}

    async def async_stereo_disable(self) -> dict[str, Any]:
        """Disable stereo pairing mode."""
        request = {"action": "stereo_disable"}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"stereo_state", "stereo_disable_result"},
                timeout=5.0,
            )
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            return {"type": "stereo_disable_result", "success": True}

    async def async_stereo_set_channel(self, channel: str) -> dict[str, Any]:
        """Set stereo channel (left/right)."""
        request = {"action": "stereo_set_channel", "channel": channel}
        try:
            return await self._aibox_gui_va_cho(
                request,
                expect_type={"stereo_state", "stereo_set_channel_result"},
                timeout=5.0,
            )
        except PhicommR1ApiConnectionError:
            await self._aibox_chi_gui(request)
            return {"type": "stereo_set_channel_result", "channel": channel, "success": True}

    async def async_reboot(self) -> None:
        """Reboot speaker."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            await self._ws_chi_gui({"type": "reboot"})
            return
        await self.async_do_cmd("stop adbd&&start adbd&&adb reboot")

    async def async_ping(self) -> None:
        """Validate API reachability."""
        if self._protocol == PROTOCOL_WS_NATIVE:
            await self._ws_lay_thong_tin()
            return
        await self.async_get_model()
