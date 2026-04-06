"""Config flow for Phicomm R1 integration."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_NAME, CONF_PORT
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ApiMapping, PhicommR1ApiClient, PhicommR1ApiConnectionError, PhicommR1ApiResponseError
from .const import (
    CONF_AIBOX_WS_PORT,
    CONF_ENDPOINT_ADB_CMD,
    CONF_ENDPOINT_DO_CMD,
    CONF_ENDPOINT_KEYEVENT,
    CONF_ENDPOINT_MEDIA_DISPATCH,
    CONF_PARAM_COMMAND,
    CONF_PARAM_KEYCODE,
    CONF_PARAM_MEDIA_KEY,
    CONF_PROTOCOL,
    CONF_RESPONSE_CODE_KEY,
    CONF_RESPONSE_MESSAGE_KEY,
    CONF_RESPONSE_RESULT_KEY,
    CONF_RESPONSE_SUCCESS_CODE,
    CONF_SCAN_INTERVAL,
    CONF_USE_MEDIA_DISPATCH,
    DEFAULT_PROTOCOL,
    DEFAULT_NAME,
    DEFAULT_AIBOX_WS_PORT,
    DEFAULT_ENDPOINT_ADB_CMD,
    DEFAULT_ENDPOINT_DO_CMD,
    DEFAULT_ENDPOINT_KEYEVENT,
    DEFAULT_ENDPOINT_MEDIA_DISPATCH,
    DEFAULT_PARAM_COMMAND,
    DEFAULT_PARAM_KEYCODE,
    DEFAULT_PARAM_MEDIA_KEY,
    DEFAULT_PORT,
    DEFAULT_RESPONSE_CODE_KEY,
    DEFAULT_RESPONSE_MESSAGE_KEY,
    DEFAULT_RESPONSE_RESULT_KEY,
    DEFAULT_RESPONSE_SUCCESS_CODE,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_TIMEOUT,
    DOMAIN,
    PROTOCOL_AUTO,
    PROTOCOL_HTTP_BRIDGE,
    PROTOCOL_OPTIONS,
    PROTOCOL_WS_NATIVE,
)

FORM_DEFAULT_PORT = 8080
ADVANCED_MAPPING_DEFAULTS: dict[str, str] = {
    CONF_ENDPOINT_DO_CMD: DEFAULT_ENDPOINT_DO_CMD,
    CONF_ENDPOINT_ADB_CMD: DEFAULT_ENDPOINT_ADB_CMD,
    CONF_ENDPOINT_KEYEVENT: DEFAULT_ENDPOINT_KEYEVENT,
    CONF_ENDPOINT_MEDIA_DISPATCH: DEFAULT_ENDPOINT_MEDIA_DISPATCH,
    CONF_PARAM_COMMAND: DEFAULT_PARAM_COMMAND,
    CONF_PARAM_KEYCODE: DEFAULT_PARAM_KEYCODE,
    CONF_PARAM_MEDIA_KEY: DEFAULT_PARAM_MEDIA_KEY,
    CONF_RESPONSE_CODE_KEY: DEFAULT_RESPONSE_CODE_KEY,
    CONF_RESPONSE_MESSAGE_KEY: DEFAULT_RESPONSE_MESSAGE_KEY,
    CONF_RESPONSE_RESULT_KEY: DEFAULT_RESPONSE_RESULT_KEY,
    CONF_RESPONSE_SUCCESS_CODE: DEFAULT_RESPONSE_SUCCESS_CODE,
}


def _giu_lai_cau_hinh_an(
    values: dict[str, Any],
    *fallback_sources: dict[str, Any],
) -> dict[str, Any]:
    """Preserve hidden advanced HTTP bridge mapping values when saving config."""
    saved = dict(values)
    for key, default_value in ADVANCED_MAPPING_DEFAULTS.items():
        if key in saved:
            continue
        restored = None
        for source in fallback_sources:
            if key in source:
                restored = source[key]
                break
        saved[key] = restored if restored is not None else default_value
    return saved


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""


class InvalidResponse(HomeAssistantError):
    """Error to indicate payload is invalid."""


async def _xac_thuc_du_lieu_nhap(data: dict[str, Any], hass) -> tuple[str, str, int]:
    """Validate user input and return (model, resolved_protocol, resolved_port)."""
    requested_protocol = str(data.get(CONF_PROTOCOL, DEFAULT_PROTOCOL))
    modes = (
        [PROTOCOL_HTTP_BRIDGE, PROTOCOL_WS_NATIVE]
        if requested_protocol == PROTOCOL_AUTO
        else [requested_protocol]
    )
    requested_port = int(data[CONF_PORT])
    candidate_ports = [requested_port]
    for fallback_port in (8080, 8081, DEFAULT_PORT):
        if fallback_port not in candidate_ports:
            candidate_ports.append(fallback_port)

    last_error: Exception | None = None
    for port in candidate_ports:
        for mode in modes:
            session = async_get_clientsession(hass)
            client = PhicommR1ApiClient(
                session=session,
                host=data[CONF_HOST],
                port=port,
                mapping=ApiMapping.from_config(data),
                protocol=mode,
                aibox_ws_port=int(data.get(CONF_AIBOX_WS_PORT, DEFAULT_AIBOX_WS_PORT)),
                timeout=DEFAULT_TIMEOUT,
            )
            try:
                model = await client.async_get_model()
            except (PhicommR1ApiConnectionError, PhicommR1ApiResponseError) as err:
                last_error = err
                continue

            if model:
                return model, mode, port

    if isinstance(last_error, PhicommR1ApiConnectionError):
        raise CannotConnect from last_error
    raise InvalidResponse from last_error


class PhicommR1ConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Phicomm R1."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> "PhicommR1OptionsFlow":
        """Return options flow handler."""
        return PhicommR1OptionsFlow(config_entry)

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Handle the initial step."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                _model, resolved_protocol, resolved_port = await _xac_thuc_du_lieu_nhap(user_input, self.hass)
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except InvalidResponse:
                errors["base"] = "invalid_response"
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"
            else:
                entry_data = _giu_lai_cau_hinh_an(user_input)
                entry_data[CONF_PROTOCOL] = resolved_protocol
                entry_data[CONF_PORT] = resolved_port
                unique_id = f"{entry_data[CONF_HOST]}:{int(entry_data[CONF_PORT])}"
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=entry_data[CONF_NAME],
                    data=entry_data,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=self._tao_luoc_do(user_input),
            errors=errors,
        )

    @staticmethod
    def _tao_luoc_do(defaults: dict[str, Any] | None = None) -> vol.Schema:
        """Build the end-user config schema."""
        values = defaults or {}
        return vol.Schema(
            {
                vol.Required(CONF_NAME, default=values.get(CONF_NAME, DEFAULT_NAME)): str,
                vol.Required(CONF_HOST, default=values.get(CONF_HOST, "")): str,
                vol.Required(
                    CONF_PORT,
                    default=int(values.get(CONF_PORT, FORM_DEFAULT_PORT)),
                ): vol.Coerce(int),
                vol.Required(
                    CONF_AIBOX_WS_PORT,
                    default=int(values.get(CONF_AIBOX_WS_PORT, DEFAULT_AIBOX_WS_PORT)),
                ): vol.All(vol.Coerce(int), vol.Range(min=1, max=65535)),
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=int(values.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)),
                ): vol.All(vol.Coerce(int), vol.Range(min=5, max=300)),
                vol.Required(
                    CONF_USE_MEDIA_DISPATCH,
                    default=bool(values.get(CONF_USE_MEDIA_DISPATCH, True)),
                ): bool,
                vol.Required(
                    CONF_PROTOCOL,
                    default=values.get(CONF_PROTOCOL, DEFAULT_PROTOCOL),
                ): vol.In(PROTOCOL_OPTIONS),
            }
        )


class PhicommR1OptionsFlow(OptionsFlow):
    """Handle options flow for existing entry."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Manage options."""
        if user_input is not None:
            # Re-validate in case host/port changed.
            merged = {
                **self._config_entry.data,
                **self._config_entry.options,
                **user_input,
            }
            errors: dict[str, str] = {}
            try:
                _model, resolved_protocol, resolved_port = await _xac_thuc_du_lieu_nhap(merged, self.hass)
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except InvalidResponse:
                errors["base"] = "invalid_response"
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"
            else:
                option_data = _giu_lai_cau_hinh_an(
                    user_input,
                    self._config_entry.options,
                    self._config_entry.data,
                )
                option_data[CONF_PROTOCOL] = resolved_protocol
                option_data[CONF_PORT] = resolved_port
                return self.async_create_entry(title="", data=option_data)
            return self.async_show_form(
                step_id="init",
                data_schema=self._tao_luoc_do(user_input),
                errors=errors,
            )

        return self.async_show_form(
            step_id="init",
            data_schema=self._tao_luoc_do(),
        )

    def _tao_luoc_do(self, user_input: dict[str, Any] | None = None) -> vol.Schema:
        """Build the end-user options schema."""
        defaults = {**self._config_entry.data, **self._config_entry.options}
        if user_input:
            defaults.update(user_input)

        return vol.Schema(
            {
                vol.Required(CONF_NAME, default=defaults.get(CONF_NAME, DEFAULT_NAME)): str,
                vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, "")): str,
                vol.Required(
                    CONF_PORT,
                    default=int(defaults.get(CONF_PORT, FORM_DEFAULT_PORT)),
                ): vol.Coerce(int),
                vol.Required(
                    CONF_AIBOX_WS_PORT,
                    default=int(defaults.get(CONF_AIBOX_WS_PORT, DEFAULT_AIBOX_WS_PORT)),
                ): vol.All(vol.Coerce(int), vol.Range(min=1, max=65535)),
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=int(defaults.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)),
                ): vol.All(vol.Coerce(int), vol.Range(min=5, max=300)),
                vol.Required(
                    CONF_USE_MEDIA_DISPATCH,
                    default=bool(defaults.get(CONF_USE_MEDIA_DISPATCH, True)),
                ): bool,
                vol.Required(
                    CONF_PROTOCOL,
                    default=defaults.get(CONF_PROTOCOL, DEFAULT_PROTOCOL),
                ): vol.In(PROTOCOL_OPTIONS),
            }
        )
