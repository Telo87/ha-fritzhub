"""Persistent statistics: throughput history, data volume and "last seen".

The FRITZ!Box only knows byte counters since the last reconnect and has no
"last seen" timestamp via TR-064, so FritzHub records these itself and keeps
them in /data/stats.json (survives restarts and updates).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .config import DATA_DIR

_LOGGER = logging.getLogger(__name__)

STATS_FILE = DATA_DIR / "stats.json"
HISTORY_DAYS = 7
VOLUME_DAYS = 400  # keep daily volume for ~13 months
RANGES = {"24h": (86400, 300), "7d": (7 * 86400, 1800)}  # span, bucket size (s)


class Stats:
    def __init__(self, path: Path = STATS_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._dirty = False
        self.data: dict[str, Any] = {"history": {}, "volume": {}, "seen": {}, "since": time.time()}
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
        for key in ("history", "volume", "seen"):
            if isinstance(raw.get(key), dict):
                self.data[key] = raw[key]
        self.data["since"] = raw.get("since") or self.data["since"]

    def save(self, force: bool = False) -> None:
        with self._lock:
            if not (self._dirty or force):
                return
            payload = json.dumps(self.data, separators=(",", ":"))
            self._dirty = False
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, self._path)
        except OSError as err:
            _LOGGER.warning("Could not write %s: %s", self._path, err)

    # ------------------------------------------------------------- throughput
    def record_rate(self, box_id: str, ts: float, down: int, up: int) -> None:
        """Add a sample (bytes/s) to the per-minute history."""
        minute = int(ts) // 60 * 60
        with self._lock:
            hist = self.data["history"].setdefault(box_id, [])
            if hist and hist[-1][0] == minute:
                hist[-1][1] += down
                hist[-1][2] += up
                hist[-1][3] += 1
            else:
                hist.append([minute, down, up, 1])
                cutoff = minute - HISTORY_DAYS * 86400
                while hist and hist[0][0] < cutoff:
                    hist.pop(0)
            self._dirty = True

    def history(self, box_id: str, range_key: str, now: float | None = None) -> list[list[int]]:
        """Averaged ``[ts, down, up]`` (bytes/s) for ``24h`` or ``7d``."""
        span, bucket = RANGES[range_key]
        now = now or time.time()
        buckets: dict[int, list[int]] = {}
        with self._lock:
            for minute, down, up, n in self.data["history"].get(box_id, []):
                if minute < now - span:
                    continue
                b = buckets.setdefault(minute // bucket * bucket, [0, 0, 0])
                b[0] += down
                b[1] += up
                b[2] += n
        return [[ts, round(d / n), round(u / n)] for ts, (d, u, n) in sorted(buckets.items()) if n]

    # ------------------------------------------------------------ data volume
    def record_volume(self, box_id: str, total_down: int | None, total_up: int | None,
                      today: date | None = None) -> None:
        """Accumulate the growth of the box's byte counters per day."""
        if total_down is None or total_up is None:
            return
        day = (today or date.today()).isoformat()
        with self._lock:
            vol = self.data["volume"].setdefault(box_id, {"days": {}, "last": None})
            last = vol.get("last")
            vol["last"] = [total_down, total_up]
            self._dirty = True
            if not last:
                return  # first sample – nothing to compare with yet
            # counters restart at 0 after a reconnect / reboot of the box
            d_down = total_down - last[0] if total_down >= last[0] else total_down
            d_up = total_up - last[1] if total_up >= last[1] else total_up
            entry = vol["days"].setdefault(day, [0, 0])
            entry[0] += d_down
            entry[1] += d_up
            if len(vol["days"]) > VOLUME_DAYS:
                for old in sorted(vol["days"])[: len(vol["days"]) - VOLUME_DAYS]:
                    del vol["days"][old]

    def volume(self, box_id: str, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        with self._lock:
            days = dict(self.data["volume"].get(box_id, {}).get("days", {}))
        month = today.strftime("%Y-%m")
        prev = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        months: dict[str, list[int]] = {}
        for day, (down, up) in days.items():
            m = months.setdefault(day[:7], [0, 0])
            m[0] += down
            m[1] += up
        recent = sorted(days)[-31:]
        return {
            "today": days.get(today.isoformat(), [0, 0]),
            "month": months.get(month, [0, 0]),
            "prev_month": months.get(prev, [0, 0]),
            "days": [[d, *days[d]] for d in recent],
            "months": [[m, *months[m]] for m in sorted(months)[-13:]],
            "since": min(days) if days else None,
        }

    # ------------------------------------------------------------- last seen
    def mark_seen(self, hosts: list[dict[str, Any]], now: float | None = None) -> None:
        now = int(now or time.time())
        with self._lock:
            seen = self.data["seen"]
            for h in hosts:
                mac = h.get("mac")
                if not mac or not h.get("active"):
                    continue
                entry = seen.setdefault(mac, {"first": now})
                entry["last"] = now
            self._dirty = True

    def seen(self, mac: str) -> dict[str, int] | None:
        return self.data["seen"].get(mac)

    @property
    def since(self) -> float:
        return float(self.data["since"])

