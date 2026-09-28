"""Central state: configured boxes, background polling, caches and history."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from .box import BoxError, FritzBox
from .config import BoxStore, Options, Settings
from .ha import SensorPublisher
from .nas import FritzNas
from .oui import vendors
from .stats import Stats
from .webscan import scan as scan_web_uis

_LOGGER = logging.getLogger(__name__)

HISTORY_POINTS = 360  # e.g. 1 hour at 10 s interval
MESH_TTL = 30
HOSTS_TTL = 15
PHONE_POLL = 60
WEBSCAN_INTERVAL = 30 * 60
WLAN_POLL = 30


class Hub:
    def __init__(
        self,
        options: Options,
        store: BoxStore | None = None,
        box_cls: type = FritzBox,
        nas_cls: type = FritzNas,
        stats: Stats | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.options = options
        self.stats = stats or Stats()
        self.settings = settings or Settings()
        # devices with a web interface: {ip: [{url, port, title, …}]}
        self.web_uis: dict[str, list[dict[str, Any]]] = {}
        self.webscan_fn = scan_web_uis
        self._webscan_task: asyncio.Task | None = None
        self.last_webscan = 0.0
        self._last_save = time.time()
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
        self._mesh_roles: dict[str, str] = {}
        self._box_nodes: dict[str, str] = {}  # box id -> mesh node id
        self.wlan_clients: dict[str, dict[str, Any]] = {}
        # WLAN uplink of repeaters / mesh clients: {box_id: {...}} + 1 h history
        self.uplinks: dict[str, dict[str, Any] | None] = {}
        self.uplink_history: dict[str, deque] = {}
        self._last_wlan_poll = 0.0
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
        # load the vendor database (~50k entries) off the event loop
        asyncio.get_running_loop().run_in_executor(None, lambda: vendors.blocks)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self.publisher.close()
        await asyncio.to_thread(self.stats.save, True)

    def _record(self, now: float) -> None:
        """Throughput history, data volume and "last seen" – after the mesh roles
        are known, so mesh clients (which also report WAN data) are not counted."""
        for box_id, st in self.state.items():
            wan = st.get("wan")
            if not wan or st.get("updated") != now:
                continue
            down, up = wan.get("rate_down") or 0, wan.get("rate_up") or 0
            self.history.setdefault(box_id, deque(maxlen=HISTORY_POINTS)).append((int(now), down, up))
            self.stats.record_rate(box_id, now, down, up)
            self.stats.record_volume(box_id, wan.get("total_down"), wan.get("total_up"))
        if self._hosts_cache and now - self._hosts_cache[0] < HOSTS_TTL + 1:
            self.stats.mark_seen(self._hosts_cache[1], now)
            new = self.stats.update_known(self._hosts_cache[1], now)
            if new:
                asyncio.get_running_loop().create_task(self._announce_new_devices(new))
                self.start_webscan(new)  # check new devices right away
            elif now - self.last_webscan > WEBSCAN_INTERVAL:
                self.start_webscan()
        if now - self._last_save > 300:
            self._last_save = now
            asyncio.get_running_loop().run_in_executor(None, self.stats.save)

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

        await self._apply_mesh_roles()
        self._demote_mesh_boxes()
        self._record(now)

        if now - self._last_wlan_poll > WLAN_POLL:
            self._last_wlan_poll = now
            await self._poll_wlan_clients()
        if now - self._last_phone_poll > PHONE_POLL:
            self._last_phone_poll = now
            await self._poll_phone()
        if self.options.publish_sensors and self.publisher.available:
            await self._publish()

    async def _apply_mesh_roles(self) -> None:
        """Mark every box with its mesh role (``master`` / ``slave``).

        The role comes from the mesh topology of the master; boxes are matched
        via IP (host list) -> MAC -> mesh node. Mesh clients take over their
        settings (WLAN, guest access, …) from the master, and FRITZ!Boxes in
        mesh repeater mode must not be treated as internet routers.
        """
        try:
            mesh = await self.mesh()
            hosts = await self._raw_hosts()
        except BoxError:
            mesh, hosts = None, []
        if mesh:
            ip_to_mac = {h["ip"]: h["mac"] for h in hosts if h.get("ip") and h.get("mac")}
            mac_to_node = {m: n for n in mesh["nodes"] for m in n["macs"]}
            roles: dict[str, str] = {}
            master_node = next((n for n in mesh["nodes"] if n["role"] == "master"), None)
            for box in self.active_boxes():
                node = mac_to_node.get(ip_to_mac.get(box.cfg.host, ""))
                if node and node["role"] in ("master", "slave"):
                    roles[box.cfg.id] = node["role"]
                    self._box_nodes[box.cfg.id] = node["id"]
                elif box.cfg.id == mesh.get("source") and master_node:
                    # the master itself is usually not part of its own host list
                    roles[box.cfg.id] = "master"
                    self._box_nodes[box.cfg.id] = master_node["id"]
            if roles:
                self._mesh_roles = roles
        roles = self._mesh_roles
        master_id = next((bid for bid, role in roles.items() if role == "master"), None)
        master = self.boxes.get(master_id) if master_id else None
        master_label = None
        if master:
            master_info = self.state.get(master.cfg.id, {}).get("info") or {}
            master_label = master.cfg.name or master_info.get("model") or master.cfg.host

        for box_id, st in self.state.items():
            info = st.get("info")
            if not st.get("online") or not info:
                continue
            role = roles.get(box_id)
            info = {**info, "mesh_role": role, "mesh_master": master_label, "mesh_master_id": master_id}
            if role == "slave":
                st["wan"] = None
                info["is_router"] = False
                info["services"] = {**info["services"], "wan": False}
            st["info"] = info

    # ------------------------------------------------------------ web interfaces
    @property
    def webscan_running(self) -> bool:
        return bool(self._webscan_task and not self._webscan_task.done())

    def start_webscan(self, hosts: list[dict[str, Any]] | None = None) -> bool:
        """Scan all online devices (or only ``hosts``) in the background."""
        if self.webscan_running:
            return False
        targets = hosts if hosts is not None else (self._hosts_cache[1] if self._hosts_cache else [])
        if not targets:
            return False
        full = hosts is None
        if full:
            self.last_webscan = time.time()

        async def run() -> None:
            try:
                found = await self.webscan_fn(targets)
            except Exception:  # noqa: BLE001 - never break polling
                _LOGGER.exception("Web interface scan failed")
                return
            if full:
                self.web_uis = found
            else:
                self.web_uis.update(found)

        self._webscan_task = asyncio.get_running_loop().create_task(run())
        return True

    # ------------------------------------------------------------ new devices
    def describe_device(self, host: dict[str, Any]) -> dict[str, Any]:
        vendor = vendors.lookup(host.get("mac")) or {}
        client = self.wlan_clients.get(host.get("mac") or "")
        return {
            "name": host.get("name") or "Unbekanntes Gerät",
            "ip": host.get("ip"),
            "mac": host.get("mac"),
            "vendor": "Private MAC (zufällig)" if vendor.get("private") else vendor.get("vendor"),
            "connected_to": client["ap"] if client else None,
            "band": client["band"] if client else None,
        }

    async def _announce_new_devices(self, hosts: list[dict[str, Any]]) -> None:
        for host in hosts:
            dev = self.describe_device(host)
            _LOGGER.info("Neues Gerät: %s (%s, %s)", dev["name"], dev["mac"], dev["ip"])
            if self.settings.get("new_device_alarm"):
                try:
                    await self.notify_new_device(dev)
                except Exception as err:  # noqa: BLE001 - never break polling
                    _LOGGER.warning("Benachrichtigung fehlgeschlagen: %s", err)

    async def notify_new_device(self, dev: dict[str, Any]) -> None:
        details = [f"**{dev['name']}**"]
        details += [f"{label}: {dev[key]}" for key, label in (
            ("vendor", "Hersteller"), ("ip", "IP"), ("mac", "MAC"), ("connected_to", "Verbunden über"),
        ) if dev.get(key)]
        message = "\n".join(details)
        title = "Neues Gerät im Heimnetz"
        await self.publisher.fire_event("fritzhub_new_device", dev)
        if self.settings.get("notify_persistent"):
            await self.publisher.call_service("persistent_notification.create", {
                "title": title, "message": message,
                "notification_id": f"fritzhub_new_{(dev.get('mac') or 'test').replace(':', '')}",
            })
        service = self.settings.get("notify_service")
        if service:
            push = " · ".join(v for v in (dev["name"], dev.get("vendor"), dev.get("ip")) if v)
            await self.publisher.call_service(service, {"title": title, "message": push})

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
                    "uplink": self.uplinks.get(cfg.id),
                    "uplink_known": cfg.id in self.uplinks,
                }
            )
        hosts = self._hosts_cache[1] if self._hosts_cache else None
        return {
            "boxes": boxes,
            "scan_interval": self.options.scan_interval,
            "hosts_online": sum(1 for h in hosts if h["active"]) if hosts else None,
            "hosts_total": len(hosts) if hosts else None,
            "weak_wlan": self.weakest_wlan(),
            "wlan_signal_known": bool(self.wlan_clients),
            "tracking_since": self.stats.since,
        }

    # ------------------------------------------------------- hosts & mesh
    async def mesh(self, force: bool = False) -> dict[str, Any]:
        now = time.time()
        if not force and self._mesh_cache and now - self._mesh_cache[0] < MESH_TTL:
            return self._mesh_cache[1]
        errors = []
        routers = self.routers()
        candidates = routers + [b for b in self.active_boxes() if b not in routers]
        # a known mesh master always delivers the authoritative topology
        candidates.sort(key=lambda b: self._mesh_roles.get(b.cfg.id) != "master")
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
            mesh = None
        if mesh:
            self._enrich_from_mesh(hosts, mesh)
        # signal strength as reported by the access point the device is connected to
        for h in hosts:
            h.update(vendors.lookup(h["mac"]) or {})
            h["new_since"] = self.stats.known_since(h["mac"]) or None
            h["web"] = self.web_uis.get(h.get("ip") or "", []) if h["active"] else []
            seen = self.stats.seen(h["mac"]) or {}
            h["last_seen"] = seen.get("last")
            h["first_seen"] = seen.get("first")
            client = self.wlan_clients.get(h["mac"])
            if client and h["active"]:
                h["signal"] = client["signal"]
                h["wlan_speed"] = client["speed"]
                h["connected_to"] = client["ap"]
                h["band"] = client["band"] or h.get("band")
                h["link_type"] = "WLAN"
        return hosts

    def _enrich_from_mesh(self, hosts: list[dict[str, Any]], mesh: dict[str, Any]) -> None:
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

    # ------------------------------------------------------------ WLAN signal
    async def _poll_uplinks(self) -> None:
        """WLAN connection quality of every box that is not the mesh master."""
        boxes = [
            b for b in self.active_boxes()
            if self.state.get(b.cfg.id, {}).get("online") and self._mesh_roles.get(b.cfg.id) != "master"
            and not (self.state[b.cfg.id].get("info") or {}).get("is_router")
        ]
        results = await asyncio.gather(*(self.run(b.wlan_uplink) for b in boxes), return_exceptions=True)
        now = int(time.time())
        mesh = self._mesh_cache[1] if self._mesh_cache else None
        parents = mesh_parents(mesh) if mesh else {}
        names = {n["id"]: n["name"] for n in mesh["nodes"]} if mesh else {}
        for box, result in zip(boxes, results, strict=True):
            if isinstance(result, Exception):
                _LOGGER.debug("Uplink %s: %s", box.cfg.host, result)
                continue
            parent_id, link = parents.get(self._box_nodes.get(box.cfg.id, ""), (None, None))
            parent = names.get(parent_id)
            if result:
                result = {**result, "type": "wlan", "parent": parent}
                hist = self.uplink_history.setdefault(box.cfg.id, deque(maxlen=120))
                hist.append((now, result["signal"], result["speed_tx"], result["speed_rx"]))
            elif link and (link.get("type") or "").upper() != "WLAN":
                rate = max(link.get("rate_rx") or 0, link.get("rate_tx") or 0)
                top = max(link.get("max_rx") or 0, link.get("max_tx") or 0)
                result = {
                    "type": "lan",
                    "speed": round(rate / 1000) if rate else None,  # kbit/s -> Mbit/s
                    "max": round(top / 1000) if top else None,
                    "parent": parent,
                }
            self.uplinks[box.cfg.id] = result

    async def _poll_wlan_clients(self) -> None:
        """Collect WLAN devices incl. signal strength from every box / repeater."""
        await self._poll_uplinks()
        boxes = [
            b for b in self.active_boxes()
            if self.state.get(b.cfg.id, {}).get("online") and self.state[b.cfg.id].get("wlan")
        ]
        results = await asyncio.gather(
            *(self.run(b.wlan_clients, self.state[b.cfg.id]["wlan"]) for b in boxes),
            return_exceptions=True,
        )
        clients: dict[str, dict[str, Any]] = {}
        for box, result in zip(boxes, results, strict=True):
            if isinstance(result, Exception):
                _LOGGER.debug("WLAN clients %s: %s", box.cfg.host, result)
                continue
            info = self.state[box.cfg.id].get("info") or {}
            ap = box.cfg.name or info.get("model") or box.cfg.host
            for c in result:
                # a device is associated with one access point – keep the best entry
                old = clients.get(c["mac"])
                if old is None or (c["signal"] or 0) > (old["signal"] or 0):
                    clients[c["mac"]] = {**c, "ap": ap, "box": box.cfg.id}
        self.wlan_clients = clients

    def weakest_wlan(self, limit: int = 5) -> list[dict[str, Any]]:
        hosts = {h["mac"]: h for h in (self._hosts_cache[1] if self._hosts_cache else [])}
        entries = []
        for mac, c in self.wlan_clients.items():
            if c["signal"] is None:
                continue
            host = hosts.get(mac, {})
            entries.append(
                {
                    "mac": mac,
                    "name": host.get("name") or c["ip"] or mac,
                    "model": host.get("model"),
                    "vendor": (vendors.lookup(mac) or {}).get("vendor"),
                    "ip": c["ip"] or host.get("ip"),
                    "signal": c["signal"],
                    "speed": c["speed"],
                    "band": c["band"],
                    "ap": c["ap"],
                    "guest": c["guest"],
                }
            )
        entries.sort(key=lambda e: (e["signal"], e["speed"] or 0))
        return entries[:limit]

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
            node["web"] = self.web_uis.get(node.get("ip") or "", [])
            if node.get("box_id") and node["box_id"] in self.uplinks:
                node["uplink"] = self.uplinks[node["box_id"]]
                node["uplink_history"] = list(self.uplink_history.get(node["box_id"], []))
            if not node["infrastructure"]:
                client = next((self.wlan_clients[m] for m in node["macs"] if m in self.wlan_clients), None)
                if client:
                    node["signal"] = client["signal"]
                    node["wlan_speed"] = client["speed"]
                    node["ap"] = client["ap"]
                vendor = vendors.lookup(node["mac"]) or {}
                node["vendor"] = vendor.get("vendor")
                node["private"] = vendor.get("private", False)
            nodes.append(node)
        # the box delivering the topology is the master – its IP is not in the host list
        for node in nodes:
            if node["role"] == "master" and not node.get("box_id"):
                node["box_id"] = mesh.get("source")
        mesh["nodes"] = nodes
        return mesh


def mesh_parents(mesh: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    """For every mesh node: (parent node id, link) on the way to the master.

    Only links between mesh devices (boxes / repeaters) are considered, so a
    chain like master -> repeater A -> repeater B resolves correctly.
    """
    nodes = {n["id"]: n for n in mesh.get("nodes", [])}
    master = next((n["id"] for n in nodes.values() if n["role"] == "master"), None)
    if not master:
        return {}
    adj: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for link in mesh.get("links", []):
        a, b = link["source"], link["target"]
        if nodes.get(a, {}).get("infrastructure") and nodes.get(b, {}).get("infrastructure"):
            adj.setdefault(a, []).append((b, link))
            adj.setdefault(b, []).append((a, link))
    parents: dict[str, tuple[str, dict[str, Any]]] = {}
    queue, seen = [master], {master}
    while queue:
        current = queue.pop(0)
        for neighbour, link in adj.get(current, []):
            if neighbour not in seen:
                seen.add(neighbour)
                parents[neighbour] = (current, link)
                queue.append(neighbour)
    return parents


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%d.%m.%y %H:%M", "%d.%m.%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None
