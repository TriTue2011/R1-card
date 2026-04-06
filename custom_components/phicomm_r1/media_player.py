"""Media player platform for Phicomm R1."""

from __future__ import annotations

import json
from contextlib import suppress
import logging
from math import ceil
import time
from typing import Any

import voluptuous as vol

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import entity_platform
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import PhicommR1ApiClient, PhicommR1ApiError
from .const import (
    CONF_USE_MEDIA_DISPATCH,
    DEFAULT_NAME,
    DOMAIN,
    KEYCODE_MEDIA_NEXT,
    KEYCODE_MEDIA_PLAY_PAUSE,
    KEYCODE_MEDIA_PREVIOUS,
    KEYCODE_MEDIA_STOP,
    KEYCODE_MUTE,
    KEYCODE_POWER,
    KEYCODE_VOLUME_DOWN,
    KEYCODE_VOLUME_UP,
    PROTOCOL_WS_NATIVE,
)
from .coordinator import PhicommR1Coordinator, _suy_ra_chat_button_enabled

SERVICE_SEND_KEYCODE = "send_keycode"
SERVICE_RUN_COMMAND = "run_command"
SERVICE_SEND_MESSAGE = "send_message"
SERVICE_WS_SEND_PAYLOAD = "ws_send_payload"
SERVICE_SEARCH_YOUTUBE = "search_youtube"
SERVICE_SEARCH_PLAYLIST = "search_playlist"
SERVICE_SEARCH_ZING = "search_zing"
SERVICE_PLAY_YOUTUBE = "play_youtube"
SERVICE_PLAY_ZING = "play_zing"
SERVICE_PLAYLIST_LIST = "playlist_list"
SERVICE_PLAYLIST_CREATE = "playlist_create"
SERVICE_PLAYLIST_DELETE = "playlist_delete"
SERVICE_PLAYLIST_GET_SONGS = "playlist_get_songs"
SERVICE_PLAYLIST_ADD_SONG = "playlist_add_song"
SERVICE_PLAYLIST_REMOVE_SONG = "playlist_remove_song"
SERVICE_PLAYLIST_PLAY = "playlist_play"
SERVICE_WAKE_WORD_SET_ENABLED = "wake_word_set_enabled"
SERVICE_WAKE_WORD_GET_ENABLED = "wake_word_get_enabled"
SERVICE_WAKE_WORD_SET_SENSITIVITY = "wake_word_set_sensitivity"
SERVICE_WAKE_WORD_GET_SENSITIVITY = "wake_word_get_sensitivity"
SERVICE_CUSTOM_AI_SET_ENABLED = "custom_ai_set_enabled"
SERVICE_CUSTOM_AI_GET_ENABLED = "custom_ai_get_enabled"
SERVICE_ANTI_DEAF_AI_SET_ENABLED = "anti_deaf_ai_set_enabled"
SERVICE_ANTI_DEAF_AI_GET_ENABLED = "anti_deaf_ai_get_enabled"
SERVICE_CHAT_WAKE_UP = "chat_wake_up"
SERVICE_CHAT_TEST_MIC = "chat_test_mic"
SERVICE_CHAT_GET_STATE = "chat_get_state"
SERVICE_CHAT_SEND_TEXT = "chat_send_text"
SERVICE_CHAT_GET_HISTORY = "chat_get_history"
SERVICE_SET_DLNA = "set_dlna"
SERVICE_SET_AIRPLAY = "set_airplay"
SERVICE_SET_BLUETOOTH = "set_bluetooth"
SERVICE_SET_MAIN_LIGHT = "set_main_light"
SERVICE_SET_LIGHT_MODE = "set_light_mode"
SERVICE_SET_LIGHT_SPEED = "set_light_speed"
SERVICE_SET_LIGHT_BRIGHTNESS = "set_light_brightness"
SERVICE_SET_EDGE_LIGHT = "set_edge_light"
SERVICE_SET_BASS_ENABLE = "set_bass_enable"
SERVICE_SET_BASS_STRENGTH = "set_bass_strength"
SERVICE_SET_LOUDNESS_ENABLE = "set_loudness_enable"
SERVICE_SET_LOUDNESS_GAIN = "set_loudness_gain"
SERVICE_SET_EQ_ENABLE = "set_eq_enable"
SERVICE_SET_EQ_BANDLEVEL = "set_eq_bandlevel"
SERVICE_SET_MIXER_VALUE = "set_mixer_value"
SERVICE_SET_PLAY_MODE = "set_play_mode"
SERVICE_REBOOT = "reboot"
SERVICE_SEEK = "seek"
SERVICE_TOGGLE_REPEAT = "toggle_repeat"
SERVICE_TOGGLE_AUTO_NEXT = "toggle_auto_next"
SERVICE_LED_TOGGLE = "led_toggle"
SERVICE_LED_GET_STATE = "led_get_state"
SERVICE_STEREO_ENABLE = "stereo_enable"
SERVICE_STEREO_DISABLE = "stereo_disable"
SERVICE_STEREO_SET_CHANNEL = "stereo_set_channel"
SERVICE_STEREO_GET_STATE = "stereo_get_state"
SERVICE_REFRESH_STATE = "refresh_state"

ATTR_KEYCODE = "keycode"
ATTR_COMMAND = "command"
ATTR_TYPE_ID = "type_id"
ATTR_WHAT = "what"
ATTR_ARG1 = "arg1"
ATTR_ARG2 = "arg2"
ATTR_OBJ = "obj"
ATTR_PAYLOAD = "payload"
ATTR_EXPECT_TYPE = "expect_type"
ATTR_QUERY = "query"
ATTR_VIDEO_ID = "video_id"
ATTR_SONG_ID = "song_id"
ATTR_PLAYLIST_ID = "playlist_id"
ATTR_NAME = "name"
ATTR_TITLE = "title"
ATTR_ID = "id"
ATTR_SOURCE = "source"
ATTR_ARTIST = "artist"
ATTR_THUMBNAIL_URL = "thumbnail_url"
ATTR_DURATION_SECONDS = "duration_seconds"
ATTR_SONG_INDEX = "song_index"
ATTR_SENSITIVITY = "sensitivity"
ATTR_TEXT = "text"
ATTR_ENABLED = "enabled"
ATTR_MODE = "mode"
ATTR_SPEED = "speed"
ATTR_BRIGHTNESS = "brightness"
ATTR_INTENSITY = "intensity"
ATTR_STRENGTH = "strength"
ATTR_GAIN = "gain"
ATTR_BAND = "band"
ATTR_LEVEL = "level"
ATTR_CONTROL_NAME = "control_name"
ATTR_VALUE = "value"
ATTR_POSITION = "position"
ATTR_CHANNEL = "channel"

MEDIA_ACTION_TO_KEYCODE: dict[str, int] = {
    "play": KEYCODE_MEDIA_PLAY_PAUSE,
    "pause": KEYCODE_MEDIA_PLAY_PAUSE,
    "toggle": KEYCODE_MEDIA_PLAY_PAUSE,
    "next": KEYCODE_MEDIA_NEXT,
    "previous": KEYCODE_MEDIA_PREVIOUS,
    "stop": KEYCODE_MEDIA_STOP,
}

_LOGGER = logging.getLogger(__name__)


def _tinh_nang_dau_tien(*names: str) -> MediaPlayerEntityFeature:
    """Return first available media player feature flag from names."""
    for name in names:
        flag = getattr(MediaPlayerEntityFeature, name, None)
        if flag is not None:
            return flag
    return MediaPlayerEntityFeature(0)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Phicomm R1 media player from config entry."""
    coordinator: PhicommR1Coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    client: PhicommR1ApiClient = hass.data[DOMAIN][entry.entry_id]["client"]

    async_add_entities([PhicommR1MediaPlayer(entry, coordinator, client)])

    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service(
        SERVICE_SEND_KEYCODE,
        {vol.Required(ATTR_KEYCODE): vol.Coerce(int)},
        "async_send_keycode",
    )
    platform.async_register_entity_service(
        SERVICE_RUN_COMMAND,
        {
            vol.Required(ATTR_COMMAND): cv.string,
            vol.Optional(ATTR_TYPE_ID, default="myshell"): cv.string,
        },
        "async_run_command",
    )
    platform.async_register_entity_service(
        SERVICE_SEND_MESSAGE,
        {
            vol.Required(ATTR_WHAT): vol.Coerce(int),
            vol.Required(ATTR_ARG1): vol.Coerce(int),
            vol.Optional(ATTR_ARG2, default=-1): vol.Coerce(int),
            vol.Optional(ATTR_OBJ, default=True): vol.Any(bool, vol.Coerce(int), cv.string),
            vol.Optional(ATTR_TYPE_ID): cv.string,
        },
        "async_send_message",
    )
    platform.async_register_entity_service(
        SERVICE_WS_SEND_PAYLOAD,
        {
            vol.Required(ATTR_PAYLOAD): cv.string,
            vol.Optional(ATTR_EXPECT_TYPE): cv.string,
        },
        "async_ws_send_payload",
    )
    platform.async_register_entity_service(
        SERVICE_SEARCH_YOUTUBE,
        {vol.Required(ATTR_QUERY): cv.string},
        "async_search_youtube",
    )
    platform.async_register_entity_service(
        SERVICE_SEARCH_PLAYLIST,
        {vol.Required(ATTR_QUERY): cv.string},
        "async_search_playlist",
    )
    platform.async_register_entity_service(
        SERVICE_SEARCH_ZING,
        {vol.Required(ATTR_QUERY): cv.string},
        "async_search_zing",
    )
    platform.async_register_entity_service(
        SERVICE_PLAY_YOUTUBE,
        {vol.Required(ATTR_VIDEO_ID): cv.string},
        "async_play_youtube",
    )
    platform.async_register_entity_service(
        SERVICE_PLAY_ZING,
        {vol.Required(ATTR_SONG_ID): cv.string},
        "async_play_zing",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_LIST,
        {},
        "async_playlist_list",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_CREATE,
        {vol.Required(ATTR_NAME): cv.string},
        "async_playlist_create",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_DELETE,
        {vol.Required(ATTR_PLAYLIST_ID): vol.Any(vol.Coerce(int), cv.string)},
        "async_playlist_delete",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_GET_SONGS,
        {vol.Required(ATTR_PLAYLIST_ID): vol.Any(vol.Coerce(int), cv.string)},
        "async_playlist_get_songs",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_ADD_SONG,
        {
            vol.Required(ATTR_PLAYLIST_ID): vol.Any(vol.Coerce(int), cv.string),
            vol.Required(ATTR_SOURCE): cv.string,
            vol.Required(ATTR_ID): cv.string,
            vol.Optional(ATTR_TITLE, default=""): cv.string,
            vol.Optional(ATTR_ARTIST, default=""): cv.string,
            vol.Optional(ATTR_THUMBNAIL_URL, default=""): cv.string,
            vol.Optional(ATTR_DURATION_SECONDS, default=0): vol.Coerce(int),
        },
        "async_playlist_add_song",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_REMOVE_SONG,
        {
            vol.Required(ATTR_PLAYLIST_ID): vol.Any(vol.Coerce(int), cv.string),
            vol.Required(ATTR_SONG_INDEX): vol.Coerce(int),
        },
        "async_playlist_remove_song",
    )
    platform.async_register_entity_service(
        SERVICE_PLAYLIST_PLAY,
        {vol.Required(ATTR_PLAYLIST_ID): vol.Any(vol.Coerce(int), cv.string)},
        "async_playlist_play",
    )
    platform.async_register_entity_service(
        SERVICE_WAKE_WORD_SET_ENABLED,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_wake_word_set_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_WAKE_WORD_GET_ENABLED,
        {},
        "async_wake_word_get_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_WAKE_WORD_SET_SENSITIVITY,
        {vol.Required(ATTR_SENSITIVITY): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=1.0))},
        "async_wake_word_set_sensitivity",
    )
    platform.async_register_entity_service(
        SERVICE_WAKE_WORD_GET_SENSITIVITY,
        {},
        "async_wake_word_get_sensitivity",
    )
    platform.async_register_entity_service(
        SERVICE_CUSTOM_AI_SET_ENABLED,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_custom_ai_set_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_CUSTOM_AI_GET_ENABLED,
        {},
        "async_custom_ai_get_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_ANTI_DEAF_AI_SET_ENABLED,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_anti_deaf_ai_set_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_ANTI_DEAF_AI_GET_ENABLED,
        {},
        "async_anti_deaf_ai_get_enabled",
    )
    platform.async_register_entity_service(
        SERVICE_CHAT_WAKE_UP,
        {},
        "async_chat_wake_up",
    )
    platform.async_register_entity_service(
        SERVICE_CHAT_TEST_MIC,
        {},
        "async_chat_test_mic",
    )
    platform.async_register_entity_service(
        SERVICE_CHAT_GET_STATE,
        {},
        "async_chat_get_state",
    )
    platform.async_register_entity_service(
        SERVICE_CHAT_SEND_TEXT,
        {vol.Required(ATTR_TEXT): cv.string},
        "async_chat_send_text",
    )
    platform.async_register_entity_service(
        SERVICE_CHAT_GET_HISTORY,
        {},
        "async_chat_get_history",
    )
    platform.async_register_entity_service(
        SERVICE_SET_DLNA,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_dlna",
    )
    platform.async_register_entity_service(
        SERVICE_SET_AIRPLAY,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_airplay",
    )
    platform.async_register_entity_service(
        SERVICE_SET_BLUETOOTH,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_bluetooth",
    )
    platform.async_register_entity_service(
        SERVICE_SET_MAIN_LIGHT,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_main_light",
    )
    platform.async_register_entity_service(
        SERVICE_SET_LIGHT_MODE,
        {vol.Required(ATTR_MODE): vol.Coerce(int)},
        "async_set_light_mode",
    )
    platform.async_register_entity_service(
        SERVICE_SET_LIGHT_SPEED,
        {vol.Required(ATTR_SPEED): vol.All(vol.Coerce(int), vol.Range(min=1, max=100))},
        "async_set_light_speed",
    )
    platform.async_register_entity_service(
        SERVICE_SET_LIGHT_BRIGHTNESS,
        {vol.Required(ATTR_BRIGHTNESS): vol.All(vol.Coerce(int), vol.Range(min=1, max=200))},
        "async_set_light_brightness",
    )
    platform.async_register_entity_service(
        SERVICE_SET_EDGE_LIGHT,
        {
            vol.Required(ATTR_ENABLED): cv.boolean,
            vol.Optional(ATTR_INTENSITY): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        },
        "async_set_edge_light",
    )
    platform.async_register_entity_service(
        SERVICE_SET_BASS_ENABLE,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_bass_enable",
    )
    platform.async_register_entity_service(
        SERVICE_SET_BASS_STRENGTH,
        {vol.Required(ATTR_STRENGTH): vol.Coerce(int)},
        "async_set_bass_strength",
    )
    platform.async_register_entity_service(
        SERVICE_SET_LOUDNESS_ENABLE,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_loudness_enable",
    )
    platform.async_register_entity_service(
        SERVICE_SET_LOUDNESS_GAIN,
        {vol.Required(ATTR_GAIN): vol.Coerce(int)},
        "async_set_loudness_gain",
    )
    platform.async_register_entity_service(
        SERVICE_SET_EQ_ENABLE,
        {vol.Required(ATTR_ENABLED): cv.boolean},
        "async_set_eq_enable",
    )
    platform.async_register_entity_service(
        SERVICE_SET_EQ_BANDLEVEL,
        {
            vol.Required(ATTR_BAND): vol.Coerce(int),
            vol.Required(ATTR_LEVEL): vol.All(vol.Coerce(int), vol.Range(min=-1500, max=1500)),
        },
        "async_set_eq_bandlevel",
    )
    platform.async_register_entity_service(
        SERVICE_SET_MIXER_VALUE,
        {
            vol.Required(ATTR_CONTROL_NAME): cv.string,
            vol.Required(ATTR_VALUE): vol.Coerce(int),
        },
        "async_set_mixer_value",
    )
    platform.async_register_entity_service(
        SERVICE_SET_PLAY_MODE,
        {vol.Required(ATTR_MODE): vol.Coerce(int)},
        "async_set_play_mode",
    )
    platform.async_register_entity_service(
        SERVICE_REBOOT,
        {},
        "async_reboot",
    )
    platform.async_register_entity_service(
        SERVICE_SEEK,
        {vol.Required(ATTR_POSITION): vol.Coerce(int)},
        "async_seek",
    )
    platform.async_register_entity_service(
        SERVICE_TOGGLE_REPEAT,
        {},
        "async_toggle_repeat",
    )
    platform.async_register_entity_service(
        SERVICE_TOGGLE_AUTO_NEXT,
        {},
        "async_toggle_auto_next",
    )
    platform.async_register_entity_service(
        SERVICE_LED_TOGGLE,
        {},
        "async_led_toggle",
    )
    platform.async_register_entity_service(
        SERVICE_LED_GET_STATE,
        {},
        "async_led_get_state",
    )
    platform.async_register_entity_service(
        SERVICE_STEREO_ENABLE,
        {},
        "async_stereo_enable",
    )
    platform.async_register_entity_service(
        SERVICE_STEREO_DISABLE,
        {},
        "async_stereo_disable",
    )
    platform.async_register_entity_service(
        SERVICE_STEREO_SET_CHANNEL,
        {vol.Required(ATTR_CHANNEL): cv.string},
        "async_stereo_set_channel",
    )
    platform.async_register_entity_service(
        SERVICE_STEREO_GET_STATE,
        {},
        "async_stereo_get_state",
    )
    platform.async_register_entity_service(
        SERVICE_REFRESH_STATE,
        {},
        "async_refresh_state",
    )


class PhicommR1MediaPlayer(CoordinatorEntity[PhicommR1Coordinator], MediaPlayerEntity):
    """Representation of Phicomm R1 as media player."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = "mdi:speaker"
    _attr_should_poll = False
    _base_supported_features = (
        _tinh_nang_dau_tien("PAUSE")
        | _tinh_nang_dau_tien("PLAY")
        | _tinh_nang_dau_tien("STOP")
        | _tinh_nang_dau_tien("NEXT_TRACK")
        | _tinh_nang_dau_tien("PREVIOUS_TRACK")
        | _tinh_nang_dau_tien("VOLUME_STEP", "VOLUME_UP")
        | _tinh_nang_dau_tien("VOLUME_SET")
        | _tinh_nang_dau_tien("VOLUME_MUTE")
    )

    def __init__(
        self,
        entry: ConfigEntry,
        coordinator: PhicommR1Coordinator,
        client: PhicommR1ApiClient,
    ) -> None:
        """Initialize media player."""
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._is_ws_native = self._client.protocol == PROTOCOL_WS_NATIVE
        self._use_media_dispatch = bool(
            entry.options.get(
                CONF_USE_MEDIA_DISPATCH,
                entry.data.get(CONF_USE_MEDIA_DISPATCH, True),
            )
        )
        self._attr_supported_features = self._base_supported_features
        if not self._is_ws_native:
            self._attr_supported_features |= (
                _tinh_nang_dau_tien("TURN_ON") | _tinh_nang_dau_tien("TURN_OFF")
            )

        self._attr_unique_id = f"{entry.entry_id}_media_player"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            manufacturer="Phicomm",
            model="R1",
            name=entry.options.get(CONF_NAME, entry.data.get(CONF_NAME, DEFAULT_NAME)),
        )
        self._last_search: dict[str, Any] = {}
        self._last_play: dict[str, Any] = {}
        self._playlist_library: dict[str, Any] = {}
        self._playlist_detail: dict[str, Any] = {}
        self._last_playlist_event: dict[str, Any] = {}
        self._wake_word: dict[str, Any] = {}
        self._custom_ai: dict[str, Any] = {}
        self._chat_state: dict[str, Any] = {}
        self._last_chat_items: list[dict[str, Any]] = []
        self._last_play_pause_sent: str | None = None
        self._led_state: dict[str, Any] = {}
        self._stereo_state: dict[str, Any] = {}
        self._system_state: dict[str, Any] = {}

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return self.coordinator.last_update_success

    @property
    def state(self) -> MediaPlayerState:
        """Return playback state."""
        status = self.coordinator.data
        if status.playback_state == "playing":
            return MediaPlayerState.PLAYING
        if status.playback_state == "paused":
            return MediaPlayerState.PAUSED
        if status.playback_state == "stopped":
            return MediaPlayerState.IDLE
        return MediaPlayerState.IDLE

    @property
    def volume_level(self) -> float | None:
        """Return volume level in range 0..1."""
        return self.coordinator.data.volume_level

    @property
    def media_title(self) -> str | None:
        """Return current media title from the latest playback snapshot."""
        title = self._chu_dau_tien(self._aibox_playback_snapshot(), ("title",))
        if not title:
            return None
        if title.strip().lower() in {"không có nhạc", "khong co nhac", "chưa có bài đang phát", "chua co bai dang phat"}:
            return None
        return title

    @property
    def media_artist(self) -> str | None:
        """Return current artist/channel from the latest playback snapshot."""
        return self._chu_dau_tien(self._aibox_playback_snapshot(), ("artist", "channel"))

    @property
    def media_duration(self) -> int | None:
        """Return current media duration in seconds."""
        return self._ep_kieu_giay_phat(self._aibox_playback_snapshot().get("duration"))

    @property
    def media_position(self) -> int | None:
        """Return current media position in seconds."""
        return self._ep_kieu_giay_phat(self._aibox_playback_snapshot().get("position"))

    @property
    def media_image_url(self) -> str | None:
        """Return current media artwork URL."""
        return self._chu_dau_tien(self._aibox_playback_snapshot(), ("thumbnail_url",))

    @property
    def is_volume_muted(self) -> bool | None:
        """Return true if volume is muted."""
        return self.coordinator.data.is_muted

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional state attributes."""
        status = self.coordinator.data
        attrs: dict[str, Any] = {
            "model": status.model,
            "volume_current": status.volume_current,
            "volume_min": status.volume_min,
            "volume_max": status.volume_max,
            "playback_state_raw": status.playback_state,
        }
        for key in (
            "dlna_open",
            "airplay_open",
            "device_state",
            "music_light_enable",
            "music_light_luma",
            "music_light_chroma",
            "music_light_mode",
        ):
            if key in status.raw:
                attrs[key] = status.raw[key]
            elif key in self._system_state:
                attrs[key] = self._system_state[key]
        if self._last_search:
            attrs["last_music_search"] = self._last_search
        if self._last_play:
            attrs["last_music_play"] = self._last_play
        if self._playlist_library:
            attrs["playlist_library"] = self._playlist_library
        if self._playlist_detail:
            attrs["playlist_detail"] = self._playlist_detail
        if self._last_playlist_event:
            attrs["last_playlist_event"] = self._last_playlist_event

        # Let coordinator-polled state win over local optimistic overrides.
        merged_wake = dict(self._wake_word) if self._wake_word else {}
        if status.wake_word:
            merged_wake.update(status.wake_word)
        if merged_wake:
            attrs["wake_word"] = merged_wake

        # Let coordinator-polled state win over local optimistic overrides.
        merged_ai = dict(self._custom_ai) if self._custom_ai else {}
        if status.custom_ai:
            merged_ai.update(status.custom_ai)
        if merged_ai:
            attrs["custom_ai"] = merged_ai

        # Merge chat_state: coordinator-polled + entity-level overrides
        merged_chat_state = dict(status.chat_state) if status.chat_state else {}
        if self._chat_state:
            merged_chat_state.update(self._chat_state)
        if merged_chat_state:
            attrs["chat_state"] = merged_chat_state
        if self._last_chat_items:
            attrs["last_chat_items"] = self._last_chat_items

        # Aibox playback: prefer coordinator-polled, fallback to client cache
        aibox_playback = self._aibox_playback_snapshot()
        if aibox_playback:
            attrs["aibox_playback"] = aibox_playback

        # LED state from coordinator
        if status.led_state:
            attrs["led_state"] = status.led_state

        merged_audio = dict(self._system_state.get("audio_config") or {})
        if status.audio_state:
            merged_audio.update(status.audio_state)
        if merged_audio:
            attrs["audio_config"] = merged_audio

        edge_light = self._system_state.get("edge_light")
        if isinstance(edge_light, dict) and edge_light:
            attrs["edge_light"] = dict(edge_light)

        return attrs

    @staticmethod
    def _chu_dau_tien(item: dict[str, Any], keys: tuple[str, ...]) -> str | None:
        """Return first non-empty text value from provided keys."""
        for key in keys:
            value = item.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return None

    @staticmethod
    def _playlist_id_text(value: Any) -> str:
        """Normalize playlist id for HA attributes and outbound requests."""
        if value is None:
            return ""
        text = str(value).strip()
        return text

    def _aibox_playback_snapshot(self) -> dict[str, Any]:
        """Return the latest normalized Aibox playback payload."""
        status = self.coordinator.data
        playback = status.aibox_playback if status.aibox_playback else self._client.get_last_aibox_playback()
        return dict(playback) if isinstance(playback, dict) else {}

    @staticmethod
    def _ep_kieu_giay_phat(value: Any) -> int | None:
        """Coerce device playback seconds into a positive integer."""
        if value is None or value == "":
            return None
        with suppress(TypeError, ValueError):
            numeric = int(float(value))
            return max(0, numeric)
        return None

    def _tim_muc_tim_kiem_theo_id(self, item_id: str) -> dict[str, Any] | None:
        """Return the last search item matching a playback identifier."""
        normalized_id = str(item_id or "").strip()
        if not normalized_id:
            return None
        items = self._last_search.get("items")
        if not isinstance(items, list):
            return None
        for item in items:
            if not isinstance(item, dict):
                continue
            candidates = {
                str(value).strip()
                for value in (
                    item.get("id"),
                    item.get("video_id"),
                    item.get("song_id"),
                    item.get("playlist_id"),
                )
                if value is not None and str(value).strip()
            }
            if normalized_id in candidates:
                return item
        return None

    def _tao_last_play_payload(
        self,
        *,
        source: str,
        item_id: str,
        video_id: str = "",
        song_id: str = "",
        playlist_id: str = "",
        title: str = "",
        artist: str = "",
        thumbnail_url: str = "",
        duration_seconds: Any = None,
    ) -> dict[str, Any]:
        """Build a short-lived playback fallback payload for the frontend."""
        payload: dict[str, Any] = {
            "source": source,
            "id": item_id,
            "updated_at_ms": int(time.time() * 1000),
        }
        if video_id:
            payload["video_id"] = video_id
        if song_id:
            payload["song_id"] = song_id
        if playlist_id:
            payload["playlist_id"] = playlist_id
        if title:
            payload["title"] = title
        if artist:
            payload["artist"] = artist
        if thumbnail_url:
            payload["thumbnail_url"] = thumbnail_url
        duration_value = self._ep_kieu_giay_phat(duration_seconds)
        if duration_value is not None:
            payload["duration_seconds"] = duration_value
        return payload

    def _tao_playlist_item_rut_gon(self, playlist: dict[str, Any]) -> dict[str, Any]:
        """Compress one playlist entry for entity attributes."""
        items = playlist.get("items")
        count = playlist.get("song_count", playlist.get("count"))
        if count is None and isinstance(items, list):
            count = len(items)
        return {
            "id": self._playlist_id_text(playlist.get("id", playlist.get("playlist_id"))),
            "name": self._chu_dau_tien(playlist, ("name", "playlist_name")) or "Playlist",
            "song_count": int(count or 0),
        }

    def _tao_playlist_library_rut_gon(self, response: dict[str, Any]) -> dict[str, Any]:
        """Compress playlist library payload for entity attributes."""
        playlists = response.get("playlists")
        compact_items: list[dict[str, Any]] = []
        if isinstance(playlists, list):
            for playlist in playlists[:40]:
                if isinstance(playlist, dict):
                    compact_items.append(self._tao_playlist_item_rut_gon(playlist))
        return {
            "updated_at_ms": int(time.time() * 1000),
            "success": bool(response.get("success", True)),
            "playlists": compact_items,
        }

    def _tao_playlist_detail_rut_gon(
        self,
        playlist_id: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        """Compress playlist songs payload for entity attributes."""
        songs = response.get("songs")
        compact_items: list[dict[str, Any]] = []
        if isinstance(songs, list):
            for index, song in enumerate(songs[:100]):
                if not isinstance(song, dict):
                    continue
                compact_items.append(
                    {
                        "index": index,
                        "kind": "track",
                        "source": self._chu_dau_tien(song, ("source",))
                        or ("zingmp3" if song.get("song_id") else "youtube"),
                        "title": self._chu_dau_tien(song, ("title", "name")) or "Unknown",
                        "id": self._chu_dau_tien(song, ("song_id", "video_id", "id")) or "",
                        "video_id": self._chu_dau_tien(song, ("video_id",)),
                        "song_id": self._chu_dau_tien(song, ("song_id",)),
                        "artist": self._chu_dau_tien(song, ("artist", "channel", "author")),
                        "duration_seconds": song.get("duration_seconds"),
                        "thumbnail_url": self._chu_dau_tien(song, ("thumbnail_url", "thumbnail")),
                    }
                )
        return {
            "updated_at_ms": int(time.time() * 1000),
            "success": bool(response.get("success", True)),
            "playlist_id": playlist_id,
            "playlist_name": self._chu_dau_tien(response, ("playlist_name", "name")) or "Playlist",
            "items": compact_items,
        }

    def _tao_playlist_event_rut_gon(
        self,
        response: dict[str, Any],
        *,
        default_type: str,
        playlist_id: Any = None,
        playlist_name: str = "",
    ) -> dict[str, Any]:
        """Compress playlist mutation responses for frontend waiting logic."""
        playlist = response.get("playlist") if isinstance(response.get("playlist"), dict) else {}
        resolved_playlist_id = self._playlist_id_text(
            playlist_id
            if playlist_id is not None
            else response.get("playlist_id", playlist.get("id", playlist.get("playlist_id")))
        )
        resolved_playlist_name = (
            self._chu_dau_tien(playlist, ("name", "playlist_name"))
            or self._chu_dau_tien(response, ("playlist_name", "name"))
            or str(playlist_name or "").strip()
        )
        event: dict[str, Any] = {
            "updated_at_ms": int(time.time() * 1000),
            "type": str(response.get("type") or default_type),
            "success": bool(response.get("success", True)),
        }
        if resolved_playlist_id:
            event["playlist_id"] = resolved_playlist_id
        if resolved_playlist_name:
            event["playlist_name"] = resolved_playlist_name
        song_index = response.get("song_index")
        if isinstance(song_index, int):
            event["song_index"] = song_index
        return event

    @staticmethod
    def _ep_kieu_bool(value: Any, fallback: bool = False) -> bool:
        """Normalize boolean-like values returned by device services."""
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "on", "enable", "enabled", "yes", "y"}:
                return True
            if normalized in {"0", "false", "off", "disable", "disabled", "no", "n"}:
                return False
            with suppress(ValueError):
                return float(normalized) != 0
        return fallback

    @staticmethod
    def _chuan_hoa_chat_role(value: Any, fallback: str = "server") -> str:
        """Normalize chat role names into the user/server variants used by the card."""
        normalized = str(value or "").strip().lower()
        if normalized in {"user", "human", "client", "me"}:
            return "user"
        if normalized in {"assistant", "ai", "bot", "server", "system"}:
            return "server"
        return fallback

    @staticmethod
    def _chuan_hoa_chat_timestamp(value: Any) -> Any:
        """Keep chat timestamps in a stable, non-empty format when available."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return value
        text = str(value).strip()
        return text or None

    def _chuan_hoa_chat_item(
        self,
        item: Any,
        *,
        fallback_role: str = "server",
        fallback_content: str | None = None,
    ) -> dict[str, Any] | None:
        """Normalize chat payload variants into a single message shape."""
        source = dict(item) if isinstance(item, dict) else {}
        content = self._chu_dau_tien(source, ("content", "message", "text", "msg"))
        if content is None:
            content = fallback_content.strip() if isinstance(fallback_content, str) else None
        if not content:
            return None

        role = self._chuan_hoa_chat_role(
            source.get("message_type", source.get("role", source.get("sender"))),
            fallback=fallback_role,
        )
        normalized = dict(source)
        normalized["content"] = content
        normalized["message_type"] = role
        normalized["role"] = role
        normalized["sender"] = role

        timestamp = self._chuan_hoa_chat_timestamp(
            source.get(
                "ts",
                source.get(
                    "timestamp",
                    source.get("time", source.get("created_at", source.get("createdAt"))),
                ),
            )
        )
        if timestamp is not None:
            normalized["ts"] = timestamp

        return normalized

    @staticmethod
    def _la_chat_item_trung(current: dict[str, Any], incoming: dict[str, Any]) -> bool:
        """Detect when an optimistic local echo should be replaced by the real payload."""
        current_id = str(
            current.get("id", current.get("message_id", current.get("_local_echo_id"))) or ""
        ).strip()
        incoming_id = str(
            incoming.get("id", incoming.get("message_id", incoming.get("_local_echo_id"))) or ""
        ).strip()
        if current_id and incoming_id and current_id == incoming_id:
            return True

        current_ts = current.get("ts")
        incoming_ts = incoming.get("ts")
        if current_ts is not None and incoming_ts is not None and current_ts == incoming_ts:
            return True

        same_role = current.get("message_type") == incoming.get("message_type")
        same_content = current.get("content") == incoming.get("content")
        current_local = PhicommR1MediaPlayer._ep_kieu_bool(current.get("_local_echo"), False)
        incoming_local = PhicommR1MediaPlayer._ep_kieu_bool(incoming.get("_local_echo"), False)
        return same_role and same_content and current_local != incoming_local and (
            current_local or incoming_local
        )

    def _hop_nhat_chat_items(self, *groups: Any, limit: int = 50) -> list[dict[str, Any]]:
        """Merge chat messages while preserving order and replacing optimistic echoes."""
        merged: list[dict[str, Any]] = []
        for group in groups:
            if not isinstance(group, list):
                continue
            for raw_item in group:
                normalized = self._chuan_hoa_chat_item(raw_item)
                if normalized is None:
                    continue
                if merged and self._la_chat_item_trung(merged[-1], normalized):
                    merged_item = dict(merged[-1])
                    merged_item.update(normalized)
                    if not self._ep_kieu_bool(normalized.get("_local_echo"), False):
                        merged_item.pop("_local_echo", None)
                        merged_item.pop("_local_echo_id", None)
                    merged[-1] = merged_item
                else:
                    merged.append(normalized)
        return merged[-max(1, limit) :]

    def _cap_nhat_trang_thai_chat_tu_phan_hoi(self, response: dict[str, Any]) -> None:
        """Normalize chat state payload variants into entity attributes."""
        state_value = response.get("state", response.get("chat_state", response.get("status")))
        if state_value is None:
            if any(
                key in response
                for key in ("button_text", "buttonText", "button_enabled", "buttonEnabled")
            ):
                state_value = "ready"
            elif "success" in response:
                state_value = "ready" if self._ep_kieu_bool(response.get("success"), False) else "unavailable"

        if state_value is not None:
            state_text = str(state_value).strip()
            if state_text:
                self._chat_state["state"] = state_text

        if "button_text" in response or "buttonText" in response or "text" in response:
            button_text = response.get("button_text", response.get("buttonText", response.get("text")))
            self._chat_state["button_text"] = "" if button_text is None else str(button_text)

        parsed_enabled = None
        if "button_enabled" in response or "buttonEnabled" in response or "enabled" in response:
            current_enabled = self._ep_kieu_bool(self._chat_state.get("button_enabled"), False)
            button_enabled = response.get(
                "button_enabled",
                response.get("buttonEnabled", response.get("enabled")),
            )
            parsed_enabled = self._ep_kieu_bool(button_enabled, current_enabled)
            self._chat_state["button_enabled"] = parsed_enabled

        if parsed_enabled is None:
            inferred_enabled = _suy_ra_chat_button_enabled(self._chat_state.get("state"))
            if inferred_enabled is not None:
                self._chat_state["button_enabled"] = inferred_enabled

        if "type" in response:
            self._chat_state["last_response_type"] = response.get("type")

    def _tao_ket_qua_tim_kiem_rut_gon(
        self,
        source: str,
        query: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        """Compress search payload so it fits comfortably in entity attributes."""
        songs: list[Any] = []
        for key in ("songs", "playlists", "results"):
            raw_items = response.get(key)
            if isinstance(raw_items, list):
                songs = raw_items
                break
        compact_items: list[dict[str, Any]] = []
        for song in songs[:10]:
            if not isinstance(song, dict):
                continue
            fallback_id = self._chu_dau_tien(song, ("id",))
            playlist_id = self._chu_dau_tien(song, ("playlist_id",))
            video_id = self._chu_dau_tien(song, ("video_id",))
            song_id = self._chu_dau_tien(song, ("song_id",))
            items = song.get("items")
            song_count = song.get("song_count", song.get("count"))
            if song_count is None and isinstance(items, list):
                song_count = len(items)
            kind = "playlist" if source == "youtube_playlist" or playlist_id else "track"
            resolved_playlist_id = playlist_id or (fallback_id if kind == "playlist" else "")
            item_source = (
                "youtube_playlist"
                if kind == "playlist"
                else ("zingmp3" if song_id else "youtube")
            )
            compact_items.append(
                {
                    "kind": kind,
                    "source": item_source,
                    "title": self._chu_dau_tien(song, ("title", "name")) or "Unknown",
                    "id": (
                        self._chu_dau_tien(song, ("playlist_id", "id", "video_id", "song_id"))
                        if kind == "playlist"
                        else self._chu_dau_tien(song, ("song_id", "video_id", "id", "playlist_id"))
                    ),
                    "video_id": video_id,
                    "song_id": song_id,
                    "playlist_id": resolved_playlist_id,
                    "artist": self._chu_dau_tien(song, ("artist", "channel", "author")),
                    "duration_seconds": song.get("duration_seconds"),
                    "thumbnail_url": self._chu_dau_tien(song, ("thumbnail_url", "thumbnail")),
                    "song_count": int(song_count or 0),
                }
            )

        return {
            "source": source,
            "query": query,
            "success": bool(response.get("success", False)),
            "total": len(songs),
            "updated_at_ms": int(time.time() * 1000),
            "items": compact_items,
        }

    def _lay_audio_config_hien_tai(self) -> dict[str, Any]:
        """Return merged audio config with optimistic fallback."""
        current = dict(self._system_state.get("audio_config") or {})
        status_audio = self.coordinator.data.audio_state
        if status_audio:
            current.update(status_audio)
        return current

    def _luu_audio_config_cuc_bo(self, audio_config: dict[str, Any]) -> None:
        """Persist optimistic audio config until coordinator polls fresh data."""
        self._system_state["audio_config"] = audio_config
        self.coordinator.data.audio_state = audio_config

    def _cap_nhat_audio_section_cuc_bo(self, section_name: str, values: dict[str, Any]) -> None:
        """Update one audio section in optimistic state."""
        audio_config = self._lay_audio_config_hien_tai()
        section = dict(audio_config.get(section_name) or {})
        section.update(values)
        audio_config[section_name] = section
        self._luu_audio_config_cuc_bo(audio_config)

    def _cap_nhat_eq_band_cuc_bo(self, band: int, level: int) -> None:
        """Update one EQ band level in optimistic state."""
        audio_config = self._lay_audio_config_hien_tai()
        eq_state = dict(audio_config.get("eq") or {})
        bands = dict(eq_state.get("Bands") or {})
        existing_list = bands.get("list")
        band_list: list[dict[str, Any]] = []
        if isinstance(existing_list, list):
            for item in existing_list:
                band_list.append(dict(item) if isinstance(item, dict) else {})
        while len(band_list) <= int(band):
            band_list.append({})
        band_list[int(band)]["BandLevel"] = int(level)
        bands["list"] = band_list
        eq_state["Bands"] = bands
        audio_config["eq"] = eq_state
        self._luu_audio_config_cuc_bo(audio_config)

    async def async_send_keycode(self, keycode: int) -> None:
        """Entity service: send Android keycode."""
        await self._client.async_send_keycode(keycode)
        await self.coordinator.async_request_refresh()

    async def async_run_command(self, command: str, type_id: str = "myshell") -> None:
        """Entity service: execute shell command through /do-cmd."""
        if self._is_ws_native:
            await self._client.async_shell(command, type_id=type_id)
        else:
            await self._client.async_do_cmd(command)
        await self.coordinator.async_request_refresh()

    async def async_send_message(
        self,
        what: int,
        arg1: int,
        arg2: int = -1,
        obj: Any = True,
        type_id: str | None = None,
    ) -> None:
        """Entity service: send native `send_message` payload."""
        await self._client.async_send_message(
            what=what,
            arg1=arg1,
            arg2=arg2,
            obj=obj,
            type_id=type_id,
        )
        await self.coordinator.async_request_refresh()

    async def async_ws_send_payload(self, payload: str, expect_type: str | None = None) -> None:
        """Entity service: send generic WS payload as JSON string."""
        parsed = json.loads(payload)
        if not isinstance(parsed, dict):
            raise ValueError("payload must be a JSON object")
        await self._client.async_ws_send_payload(parsed, expect_type=expect_type)
        await self.coordinator.async_request_refresh()

    async def async_search_youtube(self, query: str) -> None:
        """Entity service: search YouTube songs."""
        response = await self._client.async_search_youtube(query)
        self._last_search = self._tao_ket_qua_tim_kiem_rut_gon(
            source="youtube",
            query=query.strip(),
            response=response,
        )
        self.async_write_ha_state()

    async def async_search_playlist(self, query: str) -> None:
        """Entity service: search YouTube playlists."""
        response = await self._client.async_search_playlist(query)
        self._last_search = self._tao_ket_qua_tim_kiem_rut_gon(
            source="youtube_playlist",
            query=query.strip(),
            response=response,
        )
        self.async_write_ha_state()

    async def async_search_zing(self, query: str) -> None:
        """Entity service: search Zing MP3 songs."""
        response = await self._client.async_search_zing(query)
        self._last_search = self._tao_ket_qua_tim_kiem_rut_gon(
            source="zingmp3",
            query=query.strip(),
            response=response,
        )
        self.async_write_ha_state()

    async def async_play_youtube(self, video_id: str) -> None:
        """Entity service: play YouTube song by video id."""
        normalized_video_id = video_id.strip()
        await self._client.async_play_youtube(normalized_video_id)
        matched_item = self._tim_muc_tim_kiem_theo_id(normalized_video_id) or {}
        self._last_play = self._tao_last_play_payload(
            source="youtube",
            item_id=normalized_video_id,
            video_id=normalized_video_id,
            title=self._chu_dau_tien(matched_item, ("title",)) or "",
            artist=self._chu_dau_tien(matched_item, ("artist",)) or "",
            thumbnail_url=self._chu_dau_tien(matched_item, ("thumbnail_url",)) or "",
            duration_seconds=matched_item.get("duration_seconds"),
        )
        self._last_play_pause_sent = "play"
        await self.coordinator.async_request_refresh()

    async def async_play_zing(self, song_id: str) -> None:
        """Entity service: play Zing MP3 song by song id."""
        normalized_song_id = song_id.strip()
        await self._client.async_play_zing(normalized_song_id)
        matched_item = self._tim_muc_tim_kiem_theo_id(normalized_song_id) or {}
        self._last_play = self._tao_last_play_payload(
            source="zingmp3",
            item_id=normalized_song_id,
            song_id=normalized_song_id,
            title=self._chu_dau_tien(matched_item, ("title",)) or "",
            artist=self._chu_dau_tien(matched_item, ("artist",)) or "",
            thumbnail_url=self._chu_dau_tien(matched_item, ("thumbnail_url",)) or "",
            duration_seconds=matched_item.get("duration_seconds"),
        )
        self._last_play_pause_sent = "play"
        await self.coordinator.async_request_refresh()

    async def _lam_moi_playlist_library(self) -> None:
        """Refresh cached playlist library from device."""
        response = await self._client.async_playlist_list()
        self._playlist_library = self._tao_playlist_library_rut_gon(response)

    async def _lam_moi_playlist_detail(self, playlist_id: str) -> None:
        """Refresh cached playlist detail from device."""
        if not playlist_id:
            self._playlist_detail = {}
            return
        response = await self._client.async_playlist_get_songs(playlist_id)
        self._playlist_detail = self._tao_playlist_detail_rut_gon(playlist_id, response)

    async def async_playlist_list(self) -> None:
        """Entity service: fetch playlist library."""
        await self._lam_moi_playlist_library()
        self.async_write_ha_state()

    async def async_playlist_create(self, name: str) -> None:
        """Entity service: create a playlist."""
        normalized_name = name.strip()
        response = await self._client.async_playlist_create(normalized_name)
        self._last_playlist_event = self._tao_playlist_event_rut_gon(
            response,
            default_type="playlist_created",
            playlist_name=normalized_name,
        )
        await self._lam_moi_playlist_library()
        self.async_write_ha_state()

    async def async_playlist_delete(self, playlist_id: int | str) -> None:
        """Entity service: delete playlist by id."""
        normalized_playlist_id = self._playlist_id_text(playlist_id)
        response = await self._client.async_playlist_delete(normalized_playlist_id)
        self._last_playlist_event = self._tao_playlist_event_rut_gon(
            response,
            default_type="playlist_deleted",
            playlist_id=normalized_playlist_id,
        )
        await self._lam_moi_playlist_library()
        if self._playlist_detail.get("playlist_id") == normalized_playlist_id:
            self._playlist_detail = {}
        self.async_write_ha_state()

    async def async_playlist_get_songs(self, playlist_id: int | str) -> None:
        """Entity service: fetch songs in one playlist."""
        normalized_playlist_id = self._playlist_id_text(playlist_id)
        response = await self._client.async_playlist_get_songs(normalized_playlist_id)
        self._playlist_detail = self._tao_playlist_detail_rut_gon(normalized_playlist_id, response)
        self.async_write_ha_state()

    async def async_playlist_add_song(
        self,
        playlist_id: int | str,
        source: str,
        id: str,
        title: str = "",
        artist: str = "",
        thumbnail_url: str = "",
        duration_seconds: int = 0,
    ) -> None:
        """Entity service: add one track to playlist."""
        normalized_playlist_id = self._playlist_id_text(playlist_id)
        response = await self._client.async_playlist_add_song(
            normalized_playlist_id,
            source=source,
            item_id=id,
            title=title,
            artist=artist,
            thumbnail_url=thumbnail_url,
            duration_seconds=duration_seconds,
        )
        self._last_playlist_event = self._tao_playlist_event_rut_gon(
            response,
            default_type="playlist_song_added",
            playlist_id=normalized_playlist_id,
        )
        await self._lam_moi_playlist_library()
        if self._playlist_detail.get("playlist_id") == normalized_playlist_id:
            await self._lam_moi_playlist_detail(normalized_playlist_id)
        self.async_write_ha_state()

    async def async_playlist_remove_song(self, playlist_id: int | str, song_index: int) -> None:
        """Entity service: remove one track from playlist."""
        normalized_playlist_id = self._playlist_id_text(playlist_id)
        response = await self._client.async_playlist_remove_song(
            normalized_playlist_id,
            song_index=song_index,
        )
        self._last_playlist_event = self._tao_playlist_event_rut_gon(
            response,
            default_type="playlist_song_removed",
            playlist_id=normalized_playlist_id,
        )
        await self._lam_moi_playlist_library()
        await self._lam_moi_playlist_detail(normalized_playlist_id)
        self.async_write_ha_state()

    async def async_playlist_play(self, playlist_id: int | str) -> None:
        """Entity service: play one playlist by id."""
        normalized_playlist_id = self._playlist_id_text(playlist_id)
        response = await self._client.async_playlist_play(normalized_playlist_id)
        playlist_name = self._chu_dau_tien(response, ("playlist_name", "name")) or ""
        self._last_playlist_event = self._tao_playlist_event_rut_gon(
            response,
            default_type="playlist_play_started",
            playlist_id=normalized_playlist_id,
            playlist_name=playlist_name,
        )
        self._last_play = self._tao_last_play_payload(
            source="youtube_playlist",
            item_id=normalized_playlist_id,
            playlist_id=normalized_playlist_id,
            title=playlist_name,
        )
        self._last_play_pause_sent = "play"
        await self.coordinator.async_request_refresh()
        await self._lam_moi_playlist_detail(normalized_playlist_id)
        self.async_write_ha_state()

    async def async_wake_word_set_enabled(self, enabled: bool) -> None:
        """Entity service: enable/disable wake word."""
        response = await self._client.async_wake_word_set_enabled(enabled)
        enabled_value = response.get("enabled", response.get("enable", response.get("state", enabled)))
        self._wake_word["enabled"] = self._ep_kieu_bool(enabled_value, bool(enabled))
        self._wake_word["last_response_type"] = response.get("type")
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_wake_word_get_enabled(self) -> None:
        """Entity service: get wake word enabled state."""
        response = await self._client.async_wake_word_get_enabled()
        if "enabled" in response or "enable" in response or "state" in response:
            self._wake_word["enabled"] = self._ep_kieu_bool(
                response.get("enabled", response.get("enable", response.get("state"))),
                self._wake_word.get("enabled", False),
            )
        self._wake_word["last_response_type"] = response.get("type")
        self.async_write_ha_state()

    async def async_wake_word_set_sensitivity(self, sensitivity: float) -> None:
        """Entity service: set wake word sensitivity (0..1)."""
        response = await self._client.async_wake_word_set_sensitivity(sensitivity)
        sensitivity_value = response.get("sensitivity", response.get("value", sensitivity))
        with suppress(TypeError, ValueError):
            self._wake_word["sensitivity"] = float(sensitivity_value)
        self._wake_word["last_response_type"] = response.get("type")
        self.async_write_ha_state()

    async def async_wake_word_get_sensitivity(self) -> None:
        """Entity service: get wake word sensitivity."""
        response = await self._client.async_wake_word_get_sensitivity()
        if "sensitivity" in response or "value" in response:
            with suppress(TypeError, ValueError):
                self._wake_word["sensitivity"] = float(
                    response.get("sensitivity", response.get("value"))
                )
        self._wake_word["last_response_type"] = response.get("type")
        self.async_write_ha_state()

    async def async_custom_ai_set_enabled(self, enabled: bool) -> None:
        """Entity service: enable/disable Custom AI (chống điếc AI)."""
        response = await self._client.async_custom_ai_set_enabled(enabled)
        enabled_value = response.get("enabled", response.get("enable", response.get("state", enabled)))
        self._custom_ai["enabled"] = self._ep_kieu_bool(enabled_value, bool(enabled))
        self._custom_ai["last_response_type"] = response.get("type")
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_custom_ai_get_enabled(self) -> None:
        """Entity service: query Custom AI state."""
        response = await self._client.async_custom_ai_get_enabled()
        if "enabled" in response or "enable" in response or "state" in response:
            self._custom_ai["enabled"] = self._ep_kieu_bool(
                response.get("enabled", response.get("enable", response.get("state"))),
                self._custom_ai.get("enabled", False),
            )
        self._custom_ai["last_response_type"] = response.get("type")
        self.async_write_ha_state()

    async def async_anti_deaf_ai_set_enabled(self, enabled: bool) -> None:
        """Alias service for custom_ai_set_enabled."""
        await self.async_custom_ai_set_enabled(enabled)

    async def async_anti_deaf_ai_get_enabled(self) -> None:
        """Alias service for custom_ai_get_enabled."""
        await self.async_custom_ai_get_enabled()

    async def async_chat_wake_up(self) -> None:
        """Entity service: trigger chat wake-up."""
        response = await self._client.async_chat_wake_up()
        self._cap_nhat_trang_thai_chat_tu_phan_hoi(response)
        self.async_write_ha_state()

    async def async_chat_test_mic(self) -> None:
        """Entity service: trigger chat mic test."""
        response = await self._client.async_chat_test_mic()
        self._chat_state["test_mic_state"] = response.get(
            "state",
            response.get("chat_state", response.get("status")),
        )
        self._chat_state["test_mic_button_text"] = response.get(
            "button_text",
            response.get("buttonText", response.get("text")),
        )
        self._cap_nhat_trang_thai_chat_tu_phan_hoi(response)
        self.async_write_ha_state()

    async def async_chat_get_state(self) -> None:
        """Entity service: query chat state."""
        response = await self._client.async_chat_get_state()
        self._cap_nhat_trang_thai_chat_tu_phan_hoi(response)
        self.async_write_ha_state()

    async def async_chat_send_text(self, text: str) -> None:
        """Entity service: send chat text."""
        local_item = self._chuan_hoa_chat_item(
            {
                "content": text,
                "message_type": "user",
                "ts": int(time.time() * 1000),
                "_local_echo": True,
                "_local_echo_id": f"local-{time.time_ns()}",
            }
        )
        if local_item is not None:
            self._last_chat_items = self._hop_nhat_chat_items(
                self._last_chat_items,
                [local_item],
                limit=50,
            )
            self.async_write_ha_state()

        response = await self._client.async_chat_send_text(text)
        items = response.get("items") or []
        if isinstance(items, list):
            self._last_chat_items = self._hop_nhat_chat_items(
                self._last_chat_items,
                items,
                limit=50,
            )
        self.async_write_ha_state()

    async def async_chat_get_history(self) -> None:
        """Entity service: load recent chat history."""
        response = await self._client.async_chat_get_history()
        items = response.get("items") or []
        merged = self._hop_nhat_chat_items(items, limit=50)
        if merged:
            self._last_chat_items = merged
        self.async_write_ha_state()

    async def async_set_dlna(self, enabled: bool) -> None:
        """Entity service: toggle DLNA autostart."""
        info = await self._client.async_set_dlna(enabled)
        observed = self._client._aibox_phan_tich_bool(info.get("dlna_open"))
        self.coordinator.data.raw["dlna_open"] = bool(enabled) if observed is None else observed
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_airplay(self, enabled: bool) -> None:
        """Entity service: toggle AirPlay autostart."""
        info = await self._client.async_set_airplay(enabled)
        observed = self._client._aibox_phan_tich_bool(info.get("airplay_open"))
        self.coordinator.data.raw["airplay_open"] = bool(enabled) if observed is None else observed
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_bluetooth(self, enabled: bool) -> None:
        """Entity service: toggle bluetooth."""
        info = await self._client.async_set_bluetooth(enabled)
        observed = self._client._ws_la_bluetooth_bat(info.get("device_state"))
        if "device_state" in info:
            self.coordinator.data.raw["device_state"] = info.get("device_state")
        else:
            self.coordinator.data.raw["device_state"] = 3 if (bool(enabled) if observed is None else observed) else 0
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_main_light(self, enabled: bool) -> None:
        """Entity service: toggle ambient main light."""
        info = await self._client.async_set_main_light(enabled)
        observed = self._client._aibox_phan_tich_bool(info.get("music_light_enable"))
        resolved = bool(enabled) if observed is None else observed
        self._system_state["music_light_enable"] = resolved
        self.coordinator.data.raw["music_light_enable"] = resolved
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_light_mode(self, mode: int) -> None:
        """Entity service: set light effect mode."""
        await self._client.async_set_light_mode(mode)
        self._system_state["music_light_mode"] = int(mode)
        self.coordinator.data.raw["music_light_mode"] = int(mode)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_light_speed(self, speed: int) -> None:
        """Entity service: set light speed."""
        await self._client.async_set_light_speed(speed)
        self._system_state["music_light_chroma"] = int(speed)
        self.coordinator.data.raw["music_light_chroma"] = int(speed)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_light_brightness(self, brightness: int) -> None:
        """Entity service: set light brightness."""
        await self._client.async_set_light_brightness(brightness)
        self._system_state["music_light_luma"] = int(brightness)
        self.coordinator.data.raw["music_light_luma"] = int(brightness)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_edge_light(self, enabled: bool, intensity: int | None = None) -> None:
        """Entity service: set edge white light state/intensity."""
        await self._client.async_set_edge_light(enabled=enabled, intensity=intensity)
        edge_state = dict(self._system_state.get("edge_light") or {})
        edge_state["enabled"] = bool(enabled)
        if intensity is not None:
            edge_state["intensity"] = int(intensity)
        elif "intensity" not in edge_state:
            edge_state["intensity"] = 100 if enabled else 0
        self._system_state["edge_light"] = edge_state
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_bass_enable(self, enabled: bool) -> None:
        """Entity service: toggle bass enhancement."""
        await self._client.async_set_bass_enable(enabled)
        self._cap_nhat_audio_section_cuc_bo(
            "bass",
            {
                "Bass_Enable": bool(enabled),
                "sound_effects_bass_enable": bool(enabled),
            },
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_bass_strength(self, strength: int) -> None:
        """Entity service: set bass strength."""
        await self._client.async_set_bass_strength(strength)
        self._cap_nhat_audio_section_cuc_bo("bass", {"Current_Strength": int(strength)})
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_loudness_enable(self, enabled: bool) -> None:
        """Entity service: toggle loudness."""
        await self._client.async_set_loudness_enable(enabled)
        self._cap_nhat_audio_section_cuc_bo(
            "loudness",
            {
                "Loudness_Enable": bool(enabled),
                "sound_effects_loudness_enable": bool(enabled),
            },
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_loudness_gain(self, gain: int) -> None:
        """Entity service: set loudness gain."""
        await self._client.async_set_loudness_gain(gain)
        self._cap_nhat_audio_section_cuc_bo("loudness", {"Current_Gain": int(gain)})
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_eq_enable(self, enabled: bool) -> None:
        """Entity service: toggle EQ."""
        await self._client.async_set_eq_enable(enabled)
        self._cap_nhat_audio_section_cuc_bo(
            "eq",
            {
                "Eq_Enable": bool(enabled),
                "sound_effects_eq_enable": bool(enabled),
            },
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_eq_bandlevel(self, band: int, level: int) -> None:
        """Entity service: set EQ band level."""
        await self._client.async_set_eq_bandlevel(band=band, level=level)
        self._cap_nhat_eq_band_cuc_bo(band=band, level=level)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_mixer_value(self, control_name: str, value: int) -> None:
        """Entity service: set mixer control value."""
        await self._client.async_set_mixer_value(control_name=control_name, value=value)
        await self.coordinator.async_request_refresh()

    async def async_set_play_mode(self, mode: int) -> None:
        """Entity service: set play mode."""
        await self._client.async_set_play_mode(mode)
        await self.coordinator.async_request_refresh()

    async def async_reboot(self) -> None:
        """Entity service: reboot speaker."""
        await self._client.async_reboot()
        await self.coordinator.async_request_refresh()

    async def async_seek(self, position: int) -> None:
        """Entity service: seek to position in seconds."""
        await self._client.async_aibox_seek(position)
        self.async_write_ha_state()

    async def async_toggle_repeat(self) -> None:
        """Entity service: toggle repeat mode."""
        await self._client.async_aibox_toggle_repeat()
        await self.coordinator.async_request_refresh()

    async def async_toggle_auto_next(self) -> None:
        """Entity service: toggle auto-next mode."""
        await self._client.async_aibox_toggle_auto_next()
        await self.coordinator.async_request_refresh()

    async def async_led_toggle(self) -> None:
        """Entity service: toggle LED on/off."""
        response = await self._client.async_led_toggle()
        self._led_state = response
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_led_get_state(self) -> None:
        """Entity service: get LED state."""
        response = await self._client.async_led_get_state()
        self._led_state = response
        self.async_write_ha_state()

    async def async_stereo_enable(self) -> None:
        """Entity service: enable stereo pairing."""
        response = await self._client.async_stereo_enable()
        self._stereo_state = response
        self.async_write_ha_state()

    async def async_stereo_disable(self) -> None:
        """Entity service: disable stereo pairing."""
        response = await self._client.async_stereo_disable()
        self._stereo_state = response
        self.async_write_ha_state()

    async def async_stereo_set_channel(self, channel: str) -> None:
        """Entity service: set stereo channel (left/right)."""
        response = await self._client.async_stereo_set_channel(channel)
        self._stereo_state = response
        self.async_write_ha_state()

    async def async_stereo_get_state(self) -> None:
        """Entity service: get stereo pairing state."""
        response = await self._client.async_stereo_get_state()
        self._stereo_state = response
        self.async_write_ha_state()

    async def async_refresh_state(self) -> None:
        """Entity service: force coordinator refresh."""
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self) -> None:
        """Turn the speaker on (power toggle)."""
        if self._is_ws_native:
            return
        await self._client.async_send_keycode(KEYCODE_POWER)
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self) -> None:
        """Turn the speaker off (power toggle)."""
        if self._is_ws_native:
            return
        await self._client.async_send_keycode(KEYCODE_POWER)
        await self.coordinator.async_request_refresh()

    async def async_mute_volume(self, mute: bool) -> None:
        """Mute/unmute."""
        if self._is_ws_native:
            if mute:
                await self._client.async_set_absolute_volume(0)
            else:
                status = self.coordinator.data
                restore = max(1, int((status.volume_max or 100) * 0.2))
                await self._client.async_set_absolute_volume(restore)
            await self.coordinator.async_request_refresh()
            return
        current = self.coordinator.data.is_muted
        if current is None or current != mute:
            await self._client.async_send_keycode(KEYCODE_MUTE)
            await self.coordinator.async_request_refresh()

    async def async_volume_up(self) -> None:
        """Volume up."""
        await self._client.async_send_keycode(KEYCODE_VOLUME_UP)
        await self.coordinator.async_request_refresh()

    async def async_volume_down(self) -> None:
        """Volume down."""
        await self._client.async_send_keycode(KEYCODE_VOLUME_DOWN)
        await self.coordinator.async_request_refresh()

    async def async_set_volume_level(self, volume: float) -> None:
        """Set volume level."""
        status = self.coordinator.data
        if status.volume_min is not None and status.volume_max is not None:
            target = status.volume_min + ceil(
                max(0.0, min(1.0, volume)) * (status.volume_max - status.volume_min)
            )
            await self._client.async_set_absolute_volume(target)
            await self.coordinator.async_request_refresh()
            return

        # Fallback when current/max volume cannot be parsed: step-based adjust.
        current = status.volume_level
        if current is None:
            return
        diff = volume - current
        if abs(diff) < 0.01:
            return

        steps = max(1, min(15, ceil(abs(diff) * 15)))
        keycode = KEYCODE_VOLUME_UP if diff > 0 else KEYCODE_VOLUME_DOWN
        for _ in range(steps):
            await self._client.async_send_keycode(keycode)
        await self.coordinator.async_request_refresh()

    async def async_media_play(self) -> None:
        """Play media."""
        await self._thuc_hien_hanh_dong_media("play")

    async def async_media_pause(self) -> None:
        """Pause media."""
        await self._thuc_hien_hanh_dong_media("pause")

    async def async_media_play_pause(self) -> None:
        """Toggle play/pause (Aibox uses command-history toggle)."""
        prefer_aibox = self._uu_tien_dieu_khien_media_aibox()
        if prefer_aibox:
            # Aibox playback (YouTube/Zing) often reports paused via native WS
            # even when music is playing. Toggle deterministically by command history.
            desired = "play" if self._last_play_pause_sent == "pause" else "pause"
            _LOGGER.debug(
                "media_play_pause called: ws_native=%s prefer_aibox=%s last_play_pause_sent=%s desired=%s",
                self._is_ws_native,
                prefer_aibox,
                self._last_play_pause_sent,
                desired,
            )
            await self._thuc_hien_hanh_dong_media(desired)
            return

        coordinator_state = self.coordinator.data.playback_state
        live_state: str | None = None
        with suppress(PhicommR1ApiError):
            live_state = await self._client.async_get_playback_state()

        effective_state = live_state or coordinator_state
        if effective_state == "playing":
            desired = "pause"
        elif effective_state in {"paused", "stopped"}:
            desired = "play"
        else:
            # Some firmware builds do not expose playback state for Aibox media.
            # In that case, keep deterministic toggle behavior by alternating.
            desired = "play" if self._last_play_pause_sent == "pause" else "pause"
        _LOGGER.debug(
            "media_play_pause called: ws_native=%s prefer_aibox=%s coordinator_state=%s live_state=%s effective_state=%s desired=%s",
            self._is_ws_native,
            prefer_aibox,
            coordinator_state,
            live_state,
            effective_state,
            desired,
        )
        await self._thuc_hien_hanh_dong_media(desired)

    async def async_media_stop(self) -> None:
        """Stop media."""
        await self._thuc_hien_hanh_dong_media("stop")

    async def async_media_next_track(self) -> None:
        """Next track."""
        await self._thuc_hien_hanh_dong_media("next")

    async def async_media_previous_track(self) -> None:
        """Previous track."""
        await self._thuc_hien_hanh_dong_media("previous")

    async def _thuc_hien_hanh_dong_media(self, action: str) -> None:
        """Send media action through selected API strategy."""
        prefer_aibox = self._uu_tien_dieu_khien_media_aibox()
        _LOGGER.debug(
            "media_action=%s ws_native=%s prefer_aibox=%s last_play=%s",
            action,
            self._is_ws_native,
            prefer_aibox,
            self._last_play,
        )
        if action in {"play", "pause"}:
            self._last_play_pause_sent = action
        if action == "toggle":
            if prefer_aibox:
                try:
                    await self._client.async_aibox_media_action("toggle")
                    await self.coordinator.async_request_refresh()
                    return
                except PhicommR1ApiError:
                    _LOGGER.debug("Aibox toggle failed, fallback to keyevent play/pause")
            await self._client.async_send_keycode(KEYCODE_MEDIA_PLAY_PAUSE)
            await self.coordinator.async_request_refresh()
            return

        if self._is_ws_native:
            if prefer_aibox:
                try:
                    await self._client.async_aibox_media_action(action)
                    # Stop is reinforced with keycode for stubborn firmware.
                    if action == "stop":
                        with suppress(PhicommR1ApiError):
                            await self._client.async_send_keycode(KEYCODE_MEDIA_STOP)
                    await self.coordinator.async_request_refresh()
                    return
                except PhicommR1ApiError:
                    _LOGGER.debug("Aibox media action failed in ws_native, fallback to native path")

            # Native WS controls are explicit (play/pause/next/prev/stop) and
            # are more reliable than keyevent toggle flows.
            try:
                await self._client.async_media_dispatch(action)
            except PhicommR1ApiError:
                await self._client.async_send_keycode(MEDIA_ACTION_TO_KEYCODE[action])
            await self.coordinator.async_request_refresh()
            return

        # Bridge mode: YouTube/Zing playback is controlled by AiboxPlus (port 8082).
        # Try Aibox first, then fallback to legacy bridge controls.
        try:
            await self._client.async_aibox_media_action(action)
        except PhicommR1ApiError:
            if self._use_media_dispatch:
                await self._client.async_media_dispatch(action)
            else:
                await self._client.async_send_keycode(MEDIA_ACTION_TO_KEYCODE[action])

        # Reinforce stop in bridge mode because some Aibox builds accept
        # `stop` action without actually halting playback.
        if action == "stop":
            with suppress(PhicommR1ApiError):
                await self._client.async_send_keycode(KEYCODE_MEDIA_STOP)
        await self.coordinator.async_request_refresh()

    def _uu_tien_dieu_khien_media_aibox(self) -> bool:
        """Return true when current playback likely comes from Aibox (YouTube/Zing)."""
        source = str(self._last_play.get("source", "")).strip().lower()
        if source in {"youtube", "youtube_playlist", "zingmp3"}:
            return True
        last_search = self._last_search or {}
        search_source = str(last_search.get("source", "")).strip().lower()
        return search_source in {"youtube", "youtube_playlist", "zingmp3"}
