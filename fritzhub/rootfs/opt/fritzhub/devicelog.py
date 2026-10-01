"""Per-device history: online/offline changes, roaming between access points
and signal strength over time.

Stored in /data/devices.json (bounded: events 14 days, signal 3 days,
online/offline changes and FritzHub's own running time 400 days – for the
online-time evaluation over freely chosen periods).
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
PRESENCE_DAYS = 400  # online/offline changes ("pw") and coverage ("up")
MAX_PRESENCE = 20000
UP_GAP = 900  # longer gaps between polls = FritzHub (or Home Assistant) was not running


class DeviceLog:
    def __init__(self, path: Path = DEVICES_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._dirty = False
        # mac -> {"active", "ap", "band", "first", "ev": [[ts, kind, …]],
        #         "sig": [[bucket, sum, n]], "pw": [[ts, 1|0]]}
        self.devices: dict[str, dict[str, Any]] = {}
        # periods in which FritzHub recorded: [[start, end]] – outside of them the
        # state of a device is unknown (not "offline")
        self.up: list[list[int]] = []
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
        if isinstance(raw.get("up"), list):
            self.up = raw["up"]
        self._migrate()

    def _migrate(self) -> None:
        """Data from before 1.11: long-term on/off list and coverage from the events."""
        earliest = None
        for d in self.devices.values():
            stamps = [e[0] for e in d.get("ev", [])] + [b[0] for b in d.get("sig", [])]
            if "pw" not in d:
                d["pw"] = [[e[0], 1 if e[1] == "on" else 0] for e in d.get("ev", []) if e[1] in ("on", "off")]
            if "first" not in d and stamps:
                d["first"] = min(stamps)
            if stamps:
                earliest = min(earliest or stamps[0], min(stamps))
        if not self.up and earliest:
            # assume FritzHub ran continuously since the first recorded data
            self.up = [[int(earliest), int(time.time())]]

    def save(self, force: bool = False) -> None:
        with self._lock:
            if not (self._dirty or force):
                return
            payload = json.dumps({"devices": self.devices, "up": self.up}, separators=(",", ":"))
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
            if self.up and 0 <= now - self.up[-1][1] <= UP_GAP:
                self.up[-1][1] = now
            else:
                self.up.append([now, now])
            if self.up[0][1] < now - PRESENCE_DAYS * 86400:
                self.up = [u for u in self.up if u[1] >= now - PRESENCE_DAYS * 86400]
            for host in hosts:
                mac = host.get("mac")
                if not mac:
                    continue
                d = self.devices.setdefault(mac, {"ev": [], "sig": [], "pw": [], "first": now})
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
                    d.setdefault("pw", []).append([now, 1 if active else 0])
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
        pw = d.get("pw")
        if pw and (pw[0][0] < now - PRESENCE_DAYS * 86400 or len(pw) > MAX_PRESENCE):
            d["pw"] = [x for x in pw if x[0] >= now - PRESENCE_DAYS * 86400][-MAX_PRESENCE:]
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

    def uptime(self, mac: str, start: float, end: float) -> dict[str, Any]:
        """Online periods and recorded ("known") periods of a device in [start, end].

        Daily totals are computed in the browser, in the viewer's time zone.
        """
        start, end = int(start), int(min(end, time.time()))
        with self._lock:
            d = self.devices.get(mac)
            if not d or end <= start:
                return {"online": [], "known": [], "first": d.get("first") if d else None}
            pw = sorted(d.get("pw", []))
            up = [list(u) for u in self.up]
            active = bool(d.get("active"))
            first = d.get("first") or start
        # state before the first change is the opposite of that change
        state = (not pw[0][1]) if pw else active
        on_periods: list[list[int]] = []
        t = 0
        for ts, val in pw:
            if bool(val) == state:
                continue
            if state:
                on_periods.append([t, ts])
            else:
                t = ts
            state = bool(val)
        if state:
            on_periods.append([t, end])
        known = _intersect(up, [[max(start, int(first)), end]])
        return {"online": _intersect(on_periods, known), "known": known, "first": first}

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


def _intersect(a: list[list[int]], b: list[list[int]]) -> list[list[int]]:
    """Intersection of two sorted lists of [start, end] intervals."""
    out: list[list[int]] = []
    i = j = 0
    a, b = sorted(a), sorted(b)
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if hi > lo:
            out.append([int(lo), int(hi)])
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out
