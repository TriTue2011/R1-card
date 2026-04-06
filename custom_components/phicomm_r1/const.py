"""Constants for the Phicomm R1 integration."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "phicomm_r1"

PLATFORMS: list[Platform] = [Platform.MEDIA_PLAYER]

DEFAULT_NAME = "Phicomm R1"
DEFAULT_PORT = 2847
DEFAULT_AIBOX_WS_PORT = 8082
DEFAULT_SCAN_INTERVAL = 15
DEFAULT_TIMEOUT = 10

CONF_SCAN_INTERVAL = "scan_interval"
CONF_USE_MEDIA_DISPATCH = "use_media_dispatch"
CONF_AIBOX_WS_PORT = "aibox_ws_port"

# API mapping options (for custom Phicomm R1 bridge variants)
CONF_ENDPOINT_DO_CMD = "endpoint_do_cmd"
CONF_ENDPOINT_ADB_CMD = "endpoint_adb_cmd"
CONF_ENDPOINT_KEYEVENT = "endpoint_keyevent"
CONF_ENDPOINT_MEDIA_DISPATCH = "endpoint_media_dispatch"

CONF_PARAM_COMMAND = "param_command"
CONF_PARAM_KEYCODE = "param_keycode"
CONF_PARAM_MEDIA_KEY = "param_media_key"

CONF_RESPONSE_CODE_KEY = "response_code_key"
CONF_RESPONSE_MESSAGE_KEY = "response_message_key"
CONF_RESPONSE_RESULT_KEY = "response_result_key"
CONF_RESPONSE_SUCCESS_CODE = "response_success_code"
CONF_PROTOCOL = "protocol"

DEFAULT_ENDPOINT_DO_CMD = "/do-cmd"
DEFAULT_ENDPOINT_ADB_CMD = "/do-adb-cmd"
DEFAULT_ENDPOINT_KEYEVENT = "/input-keyevent"
DEFAULT_ENDPOINT_MEDIA_DISPATCH = "/media-dispatch"

DEFAULT_PARAM_COMMAND = "cmd"
DEFAULT_PARAM_KEYCODE = "key"
DEFAULT_PARAM_MEDIA_KEY = "key"

DEFAULT_RESPONSE_CODE_KEY = "code"
DEFAULT_RESPONSE_MESSAGE_KEY = "message"
DEFAULT_RESPONSE_RESULT_KEY = "result"
DEFAULT_RESPONSE_SUCCESS_CODE = "0"

PROTOCOL_AUTO = "auto"
PROTOCOL_HTTP_BRIDGE = "http_bridge"
PROTOCOL_WS_NATIVE = "ws_native"
DEFAULT_PROTOCOL = PROTOCOL_AUTO
PROTOCOL_OPTIONS = [PROTOCOL_AUTO, PROTOCOL_HTTP_BRIDGE, PROTOCOL_WS_NATIVE]

# Android keycodes commonly useful on Phicomm R1
KEYCODE_POWER = 26
KEYCODE_VOLUME_UP = 24
KEYCODE_VOLUME_DOWN = 25
KEYCODE_MUTE = 164
KEYCODE_MEDIA_PLAY_PAUSE = 85
KEYCODE_MEDIA_STOP = 86
KEYCODE_MEDIA_NEXT = 87
KEYCODE_MEDIA_PREVIOUS = 88
