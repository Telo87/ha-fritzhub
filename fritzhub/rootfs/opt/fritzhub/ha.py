"""Publish a few key values as Home Assistant sensors via the Supervisor API."""

from __future__ import annotations

import logging
import os
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

CORE = "http://supervisor/core/api"
API = f"{CORE}/states"


class SensorPublisher:
    def __init__(self) -> None:
        self._token = os.environ.get("SUPERVISOR_TOKEN")
        self._session: aiohttp.ClientSession | None = None
        self._warned = False

    @property
    def available(self) -> bool:
        return bool(self._token)

    async def close(self) -> None:
        if self._session:
            await self._session.close()

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            )
        return self._session

    async def _post(self, path: str, payload: dict[str, Any]) -> None:
        """POST to the Home Assistant Core API; raises on failure (for the UI)."""
        if not self._token:
            raise RuntimeError("Keine Verbindung zu Home Assistant (SUPERVISOR_TOKEN fehlt).")
        async with self._ensure_session().post(f"{CORE}/{path}", json=payload) as resp:
            if resp.status >= 400:
                text = (await resp.text())[:200]
                raise RuntimeError(f"Home Assistant antwortet mit HTTP {resp.status}: {text}")

    async def call_service(self, service: str, data: dict[str, Any]) -> None:
        """``service`` like ``notify.mobile_app_iphone``."""
        domain, _, name = service.partition(".")
        if not domain or not name:
            raise RuntimeError(f"Ungültiger Dienst: {service!r} (Format: domain.dienst)")
        await self._post(f"services/{domain}/{name}", data)

    async def fire_event(self, event: str, data: dict[str, Any]) -> None:
        await self._post(f"events/{event}", data)

    async def publish(self, entity_id: str, state: Any, attributes: dict[str, Any]) -> None:
        if not self._token:
            return
        if self._session is None:
            self._session = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            )
        payload = {"state": "unknown" if state is None else state, "attributes": attributes}
        try:
            async with self._session.post(f"{API}/{entity_id}", json=payload) as resp:
                if resp.status >= 400 and not self._warned:
                    self._warned = True
                    _LOGGER.warning("Publishing %s failed: HTTP %s", entity_id, resp.status)
        except (aiohttp.ClientError, TimeoutError) as err:
            if not self._warned:
                self._warned = True
                _LOGGER.warning("Publishing sensors failed: %s", err)
