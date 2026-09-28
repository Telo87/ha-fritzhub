"""Per-device history: online/offline changes, roaming between access points
and signal strength over time.

Stored in /data/devices.json (bounded: events 14 days, signal 3 days).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from .config import DATA_DIR

_LOGGER = logging.getLogger(__name__)

DEVICES_FILE = DATA_DIR / "devices.json"
EVENT_DAYS = 14
MAX_EVENTS = 300
SIGNAL_DAYS = 3
SIGNAL_BUCKET = 600  # 10 minutes
PINGPONG_ROAMS = 6  # roams per 24 h that count as "jumping back and forth"


class DeviceLog:
    def __init__(self, path: Path = DEVICES_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._dirty = False
        # mac -> {"active", "ap", "band", "ev": [[ts, kind, …]], "sig": [[bucket, sum, n]]}
        self.devices: dict[str, dict[str, Any]] = {}
        self._load()

    # ------------------------------------------------------------ persistence
    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, ValueError) as err:
            _LOGGER.warning("Could not read %s: %s", self._path, err)
            return
        if isinstance(raw.get("devices"), dict):
            self.devices = raw["devices"]

    def save(self, force: bool = False) -> None:
        with self._lock:
            if not (self._dirty or force):
                return
            payload = json.dumps({"devices": self.devices}, separators=(",", ":"))
            self._dirty = False
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, self._path)
        except OSError as err:
            _LOGGER.warning("Could not write %s: %s", self._path, err)

    # ------------------------------------------------------------ recording
    def record(
        self,
        hosts: list[dict[str, Any]],
        wlan_clients: dict[str, dict[str, Any]],
        now: float | None = None,
    ) -> list[tuple[str, str]]:
        """Update all devices; returns online/offline changes as ``[(mac, "on"|"off")]``."""
        now = int(now or time.time())
        changes: list[tuple[str, str]] = []
        with self._lock:
            for host in hosts:
                mac = host.get("mac")
                if not mac:
                    continue
                d = self.devices.setdefault(mac, {"ev": [], "sig": []})
                active = bool(host.get("active"))
                client = wlan_clients.get(mac) if active else None
                ap = client.get("ap") if client else None
                band = client.get("band") if client else None

                previous = d.get("active")
                if previous is None:
                    d["active"] = active  # first sight: no event
                elif previous != active:
                    d["active"] = active
                    d["ev"].append([now, "on", ap] if active else [now, "off"])
                    changes.append((mac, "on" if active else "off"))
                elif active and ap:
                    if d.get("ap") and d["ap"] != ap:
                        d["ev"].append([now, "roam", d["ap"], ap, band])
                    elif d.get("ap") == ap and d.get("band") and band and d["band"] != band:
                        d["ev"].append([now, "band", d["band"], band, ap])
                if ap:
                    d["ap"], d["band"] = ap, band
                if client and client.get("signal") is not None:
                    self._add_signal(d, now, client["signal"])
                self._prune(d, now)
            self._dirty = True
        return changes

    @staticmethod
    def _add_signal(d: dict[str, Any], now: int, signal: int) -> None:
        bucket = now // SIGNAL_BUCKET * SIGNAL_BUCKET
        sig = d["sig"]
        if sig and sig[-1][0] == bucket:
            sig[-1][1] += signal
            sig[-1][2] += 1
        else:
            sig.append([bucket, signal, 1])

    @staticmethod
    def _prune(d: dict[str, Any], now: int) -> None:
        cutoff_ev = now - EVENT_DAYS * 86400
        if d["ev"] and d["ev"][0][0] < cutoff_ev:
            d["ev"] = [e for e in d["ev"] if e[0] >= cutoff_ev]
        if len(d["ev"]) > MAX_EVENTS:
            del d["ev"][: len(d["ev"]) - MAX_EVENTS]
        cutoff_sig = now - SIGNAL_DAYS * 86400
        if d["sig"] and d["sig"][0][0] < cutoff_sig:
            d["sig"] = [s for s in d["sig"] if s[0] >= cutoff_sig]

    # ------------------------------------------------------------ queries
    def roams(self, mac: str, since: float) -> int:
        d = self.devices.get(mac) or {}
        return sum(1 for e in d.get("ev", []) if e[1] == "roam" and e[0] >= since)

    def avg_signal(self, mac: str, since: float) -> float | None:
        d = self.devices.get(mac) or {}
        total = count = 0
        for bucket, s, n in d.get("sig", []):
            if bucket >= since:
                total += s
                count += n
        return round(total / count, 1) if count else None

    def bands_seen(self, mac: str) -> set[str]:
        d = self.devices.get(mac) or {}
        bands = {e[3] for e in d.get("ev", []) if e[1] == "band" and e[3]}
        bands |= {e[2] for e in d.get("ev", []) if e[1] == "band" and e[2]}
        bands |= {e[4] for e in d.get("ev", []) if e[1] == "roam" and len(e) > 4 and e[4]}
        if d.get("band"):
            bands.add(d["band"])
        return bands

    def history(self, mac: str, now: float | None = None) -> dict[str, Any]:
        now = now or time.time()
        d = self.devices.get(mac) or {}
        events = list(d.get("ev", []))
        return {
            "events": events,
            "signal": [[b, round(s / n)] for b, s, n in d.get("sig", []) if n],
            "active": d.get("active"),
            "ap": d.get("ap"),
            "band": d.get("band"),
            "roams_24h": self.roams(mac, now - 86400),
            "pingpong": self.roams(mac, now - 86400) >= PINGPONG_ROAMS,
        }
