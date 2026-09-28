"""Central state: configured boxes, background polling, caches and history."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from .box import BoxError, FritzBox
from .config import BoxStore, Options
from .ha import SensorPublisher
from .nas import FritzNas

_LOGGER = logging.getLogger(__name__)

HISTORY_POINTS = 360  # e.g. 1 hour at 10 s interval
MESH_TTL = 30
HOSTS_TTL = 15
PHONE_POLL = 60


class Hub:
    def __init__(
        self,
        options: Options,
        store: BoxStore | None = None,
        box_cls: type = FritzBox,
        nas_cls: type = FritzNas,
    ) -> None:
        self.options = options
        self.store = store or BoxStore()
        self._box_cls = box_cls
        self._nas_cls = nas_cls
        self.boxes: dict[str, FritzBox] = {}
        self.nas: dict[str, FritzNas] = {}
        self.state: dict[str, dict[str, Any]] = {}
        self.history: dict[str, deque] = {}
        self.phone_summary: dict[str, dict[str, Any]] = {}
        self._mesh_cache: tuple[float, dict[str, Any]] | None = None
        self._hosts_cache: tuple[float, list[dict[str, Any]]] | None = None
        self._last_phone_poll = 0.0
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()
        self.publisher = SensorPublisher()
        self._sync_boxes()

    # ------------------------------------------------------------ lifecycle
    def _sync_boxes(self) -> None:
        configs = {c.id: c for c in self.store.all()}
        for box_id in list(self.boxes):
            if box_id not in configs:
                self.boxes.pop(box_id)
                self.nas.pop(box_id, None)
                self.state.pop(box_id, None)
                self.history.pop(box_id, None)
        for cfg in configs.values():
            box = self.boxes.get(cfg.id)
            if box is None or box.cfg is not cfg:
                self.boxes[cfg.id] = self._box_cls(cfg, self.options.verify_ssl)
                self.nas[cfg.id] = self._nas_cls(cfg)
            self.history.setdefault(cfg.id, deque(maxlen=HISTORY_POINTS))

    def config_changed(self, box_id: str | None = None) -> None:
        if box_id and box_id in self.boxes:
            self.boxes.pop(box_id)
            self.nas.pop(box_id, None)
            self.state.pop(box_id, None)
        self._sync_boxes()
        self._mesh_cache = None
        self._hosts_cache = None
        self._wake.set()

    async def start(self) -> None:
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self.publisher.close()

    # --------------------------------------------------------------- helpers
    def box(self, box_id: str) -> FritzBox:
        box = self.boxes.get(box_id)
        if box is None:
            raise BoxError("Unbekannte Box.")
        return box

    async def run(self, func, *args):
        return await asyncio.to_thread(func, *args)

    def active_boxes(self) -> list[FritzBox]:
        return [b for b in self.boxes.values() if b.cfg.enabled]

    def routers(self) -> list[FritzBox]:
        """Boxes with internet access, best candidate first."""
        result = []
        for box in self.active_boxes():
            st = self.state.get(box.cfg.id, {})
            info = st.get("info") or {}
            if info.get("is_router"):
                connected = bool((st.get("wan") or {}).get("connected"))
                result.append((not connected, box.cfg.name or box.cfg.host, box))
        return [r[2] for r in sorted(result, key=lambda r: r[:2])]

    def boxes_with(self, service: str) -> list[FritzBox]:
        return [
            b
            for b in self.active_boxes()
            if ((self.state.get(b.cfg.id, {}).get("info") or {}).get("services") or {}).get(
                service
            )
        ]

    # --------------------------------------------------------------- polling
    async def _poll_loop(self) -> None:
        while True:
            try:
                await self.poll()
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Polling failed")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), self.options.scan_interval)
            except asyncio.TimeoutError:
                pass

    def _snapshot(self, box: FritzBox) -> dict[str, Any]:
        info = box.info()
        return {
            "info": info,
            "wan": box.wan() if info.get("is_router") else None,
            "wlan": box.wlan(),
        }

    async def poll(self) -> None:
        boxes = self.active_boxes()
        results = await asyncio.gather(
            *(self.run(self._snapshot, b) for b in boxes), return_exceptions=True
        )
        now = time.time()
        for box, result in zip(boxes, results, strict=True):
            prev = self.state.get(box.cfg.id, {})
            if isinstance(result, Exception):
                if not isinstance(result, BoxError):
                    _LOGGER.exception("Unexpected error for %s", box.cfg.host, exc_info=result)
                if prev.get("online", True):
                    _LOGGER.warning("%s nicht erreichbar: %s", box.cfg.host, result)
                box.reset()
                message = (
                    str(result)
                    if isinstance(result, BoxError)
                    else f"Unerwarteter Fehler ({type(result).__name__}: {result})"
                )
                self.state[box.cfg.id] = {
                    **prev,
                    "online": False,
                    "error": message,
                    "updated": now,
                }
                continue
            self.state[box.cfg.id] = {**result, "online": True, "error": None, "updated": now}
            wan = result.get("wan")
            if wan:
                self.history[box.cfg.id].append(
                    (int(now), wan.get("rate_down") or 0, wan.get("rate_up") or 0)
                )

        self._demote_mesh_boxes()

        if now - self._last_phone_poll > PHONE_POLL:
            self._last_phone_poll = now
            await self._poll_phone()
        if self.options.publish_sensors and self.publisher.available:
            await self._publish()

    def _demote_mesh_boxes(self) -> None:
        """FRITZ!Boxes used as mesh repeaters (IP client) still expose WAN services.

        If another box has a working internet connection, treat boxes without
        one as repeaters so they don't show up as disconnected routers.
        """
        states = [s for s in self.state.values() if s.get("online") and s.get("info")]
        if not any((s.get("wan") or {}).get("connected") for s in states):
            return
        for st in states:
            wan = st.get("wan")
            if wan is not None and not wan.get("connected"):
                st["wan"] = None
                st["info"] = {
                    **st["info"],
                    "is_router": False,
                    "services": {**st["info"]["services"], "wan": False},
                }

    async def _poll_phone(self) -> None:
        for box in self.boxes_with("phone"):
            summary: dict[str, Any] = {}
            try:
                calls = await self.run(box.calls, 1)
                cutoff = datetime.now() - timedelta(hours=24)
                summary["missed_24h"] = sum(
                    1
                    for c in calls
                    if c["type"] == "missed" and (_parse_date(c["date"]) or cutoff) >= cutoff
                )
                if box.has("X_AVM-DE_TAM1"):
                    new = 0
                    for tam in await self.run(box.tams):
                        msgs = await self.run(box.tam_messages, tam["index"])
                        new += sum(1 for m in msgs if m["new"])
                    summary["new_messages"] = new
            except BoxError as err:
                _LOGGER.debug("Phone poll %s: %s", box.cfg.host, err)
                continue
            self.phone_summary[box.cfg.id] = summary

    async def _publish(self) -> None:
        pub = self.publisher
        for box in self.active_boxes():
            st = self.state.get(box.cfg.id)
            if not st:
                continue
            slug = f"fritzhub_{box.cfg.slug}"
            label = box.cfg.name or (st.get("info") or {}).get("model") or box.cfg.host
            info = st.get("info") or {}
            await pub.publish(
                f"binary_sensor.{slug}_online",
                "on" if st.get("online") else "off",
                {
                    "friendly_name": f"{label} erreichbar",
                    "device_class": "connectivity",
                    "model": info.get("model"),
                    "firmware": info.get("firmware"),
                    "update_available": info.get("update_available"),
                },
            )
            wan = st.get("wan")
            if wan:
                mbit = lambda b: round((b or 0) * 8 / 1_000_000, 2)  # noqa: E731
                await pub.publish(
                    f"binary_sensor.{slug}_internet",
                    "on" if wan.get("connected") else "off",
                    {
                        "friendly_name": f"{label} Internet",
                        "device_class": "connectivity",
                        "external_ip": wan.get("external_ip"),
                        "external_ipv6": wan.get("external_ipv6"),
                    },
                )
                for key, name, icon in (
                    ("rate_down", "Download", "mdi:download"),
                    ("rate_up", "Upload", "mdi:upload"),
                ):
                    await pub.publish(
                        f"sensor.{slug}_{name.lower()}",
                        mbit(wan.get(key)),
                        {
                            "friendly_name": f"{label} {name}",
                            "unit_of_measurement": "Mbit/s",
                            "state_class": "measurement",
                            "icon": icon,
                        },
                    )
                await pub.publish(
                    f"sensor.{slug}_external_ip",
                    wan.get("external_ip"),
                    {"friendly_name": f"{label} Externe IP", "icon": "mdi:ip-network"},
                )
            summary = self.phone_summary.get(box.cfg.id)
            if summary:
                await pub.publish(
                    f"sensor.{slug}_missed_calls",
                    summary.get("missed_24h", 0),
                    {
                        "friendly_name": f"{label} Verpasste Anrufe (24 h)",
                        "icon": "mdi:phone-missed",
                        "state_class": "measurement",
                    },
                )
                if "new_messages" in summary:
                    await pub.publish(
                        f"sensor.{slug}_voicemail",
                        summary["new_messages"],
                        {
                            "friendly_name": f"{label} Neue AB-Nachrichten",
                            "icon": "mdi:voicemail",
                            "state_class": "measurement",
                        },
                    )
        if self._hosts_cache:
            online = sum(1 for h in self._hosts_cache[1] if h["active"])
            await pub.publish(
                "sensor.fritzhub_devices_online",
                online,
                {
                    "friendly_name": "FritzHub Geräte online",
                    "icon": "mdi:devices",
                    "state_class": "measurement",
                },
            )

    # -------------------------------------------------------------- overview
    def overview(self) -> dict[str, Any]:
        boxes = []
        for cfg in self.store.all():
            st = self.state.get(cfg.id, {})
            boxes.append(
                {
                    "config": cfg.public(),
                    "online": st.get("online"),
                    "error": st.get("error"),
                    "updated": st.get("updated"),
                    "info": st.get("info"),
                    "wan": st.get("wan"),
                    "wlan": st.get("wlan") or [],
                    "history": list(self.history.get(cfg.id, [])),
                    "phone": self.phone_summary.get(cfg.id),
                }
            )
        hosts = self._hosts_cache[1] if self._hosts_cache else None
        return {
            "boxes": boxes,
            "scan_interval": self.options.scan_interval,
            "hosts_online": sum(1 for h in hosts if h["active"]) if hosts else None,
            "hosts_total": len(hosts) if hosts else None,
        }

    # ------------------------------------------------------- hosts & mesh
    async def mesh(self, force: bool = False) -> dict[str, Any]:
        now = time.time()
        if not force and self._mesh_cache and now - self._mesh_cache[0] < MESH_TTL:
            return self._mesh_cache[1]
        errors = []
        candidates = self.routers() + [
            b for b in self.active_boxes() if b not in self.routers()
        ]
        for box in candidates:
            try:
                graph = await self.run(box.mesh)
            except BoxError as err:
                errors.append(f"{box.cfg.name or box.cfg.host}: {err}")
                continue
            if graph["nodes"]:
                graph["source"] = box.cfg.id
                self._mesh_cache = (now, graph)
                return graph
        raise BoxError(
            "Keine Box liefert eine Mesh-Topologie. " + " | ".join(errors)
            if errors
            else "Keine Box konfiguriert."
        )

    async def _raw_hosts(self, force: bool = False) -> list[dict[str, Any]]:
        now = time.time()
        if not force and self._hosts_cache and now - self._hosts_cache[0] < HOSTS_TTL:
            return self._hosts_cache[1]
        errors = []
        for box in self.routers() or self.active_boxes():
            try:
                hosts = await self.run(box.hosts)
            except BoxError as err:
                errors.append(str(err))
                continue
            for h in hosts:
                h["box"] = box.cfg.id
            self._hosts_cache = (now, hosts)
            return hosts
        raise BoxError(" | ".join(errors) or "Keine Box konfiguriert.")

    async def hosts(self, force: bool = False) -> list[dict[str, Any]]:
        hosts = [dict(h) for h in await self._raw_hosts(force)]
        try:
            mesh = await self.mesh(force)
        except BoxError:
            return hosts
        nodes = {n["id"]: n for n in mesh["nodes"]}
        mac_to_node = {m: n for n in mesh["nodes"] for m in n["macs"]}
        for h in hosts:
            node = mac_to_node.get(h["mac"])
            if not node:
                continue
            for link in mesh["links"]:
                if node["id"] not in (link["source"], link["target"]):
                    continue
                other = nodes.get(
                    link["target"] if link["source"] == node["id"] else link["source"]
                )
                if other and other["infrastructure"] and not node["infrastructure"]:
                    h["connected_to"] = other["name"]
                    h["link_type"] = link["type"]
                    h["band"] = link["band"]
                    h["link_rate"] = max(link["rate_rx"] or 0, link["rate_tx"] or 0) or None
                    break
            h["mesh_role"] = node["role"]
        return hosts

    async def topology(self, force: bool = False) -> dict[str, Any]:
        mesh = dict(await self.mesh(force))
        try:
            hosts = await self._raw_hosts(force)
        except BoxError:
            hosts = []
        by_mac = {h["mac"]: h for h in hosts if h["mac"]}
        configured = {c.host: c.id for c in self.store.all()}
        nodes = []
        for node in mesh["nodes"]:
            node = dict(node)
            host = next((by_mac[m] for m in node["macs"] if m in by_mac), None)
            if host:
                node["ip"] = host["ip"]
                node["active"] = host["active"]
                node["interface"] = host["interface"]
            node["box_id"] = configured.get(node.get("ip") or "")
            nodes.append(node)
        # the box delivering the topology is the master – its IP is not in the host list
        for node in nodes:
            if node["role"] == "master" and not node.get("box_id"):
                node["box_id"] = mesh.get("source")
        mesh["nodes"] = nodes
        return mesh


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%d.%m.%y %H:%M", "%d.%m.%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None
