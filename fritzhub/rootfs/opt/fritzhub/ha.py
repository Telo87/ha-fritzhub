"""Publish a few key values as Home Assistant sensors via the Supervisor API."""

from __future__ import annotations

import logging
import os
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

API = "http://supervisor/core/api/states"


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
