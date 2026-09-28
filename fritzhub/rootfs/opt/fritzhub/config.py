"""Add-on options and persistent box storage."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

_LOGGER = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("FRITZHUB_DATA", "/data"))
OPTIONS_FILE = DATA_DIR / "options.json"
BOXES_FILE = DATA_DIR / "boxes.json"


@dataclass
class Options:
    scan_interval: int = 10
    publish_sensors: bool = True
    verify_ssl: bool = False
    log_level: str = "info"
    port: int = int(os.environ.get("FRITZHUB_PORT", "8099"))
    # Only the Supervisor ingress proxy may talk to us (we run on the host network).
    # Set FRITZHUB_ALLOW_ALL=1 for local development.
    allow_all: bool = os.environ.get("FRITZHUB_ALLOW_ALL") == "1"


def load_options() -> Options:
    opts = Options()
    try:
        raw = json.loads(OPTIONS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return opts
    except (OSError, ValueError) as err:
        _LOGGER.warning("Could not read %s: %s", OPTIONS_FILE, err)
        return opts
    for key in ("scan_interval", "publish_sensors", "verify_ssl", "log_level"):
        if key in raw:
            setattr(opts, key, raw[key])
    return opts


@dataclass
class BoxConfig:
    host: str
    username: str = ""
    password: str = ""
    name: str = ""
    port: int | None = None
    use_tls: bool = False
    enabled: bool = True
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])

    def public(self) -> dict:
        """Representation that is safe to send to the browser (no password)."""
        data = asdict(self)
        data.pop("password")
        data["has_password"] = bool(self.password)
        return data

    @property
    def slug(self) -> str:
        base = self.name or self.host
        return re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_") or self.id


class BoxStore:
    """Thread-safe JSON store for configured boxes (lives in /data)."""

    def __init__(self, path: Path = BOXES_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._boxes: dict[str, BoxConfig] = {}
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, ValueError) as err:
            _LOGGER.error("Could not read %s: %s", self._path, err)
            return
        known = set(BoxConfig.__dataclass_fields__)
        for item in raw.get("boxes", []):
            box = BoxConfig(**{k: v for k, v in item.items() if k in known})
            self._boxes[box.id] = box

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"boxes": [asdict(b) for b in self._boxes.values()]}, indent=2),
            encoding="utf-8",
        )
        os.chmod(tmp, 0o600)
        tmp.replace(self._path)

    def all(self) -> list[BoxConfig]:
        with self._lock:
            return list(self._boxes.values())

    def get(self, box_id: str) -> BoxConfig | None:
        with self._lock:
            return self._boxes.get(box_id)

    def upsert(self, data: dict) -> BoxConfig:
        with self._lock:
            box_id = data.get("id")
            existing = self._boxes.get(box_id) if box_id else None
            if existing is None:
                box = BoxConfig(host=str(data["host"]).strip())
            else:
                box = existing
            for key in ("host", "username", "name"):
                if key in data and data[key] is not None:
                    setattr(box, key, str(data[key]).strip())
            # Empty password on edit means "keep the stored one"
            if data.get("password"):
                box.password = str(data["password"])
            if "port" in data:
                box.port = int(data["port"]) if data["port"] else None
            for key in ("use_tls", "enabled"):
                if key in data:
                    setattr(box, key, bool(data[key]))
            self._boxes[box.id] = box
            self._save()
            return box

    def delete(self, box_id: str) -> bool:
        with self._lock:
            if self._boxes.pop(box_id, None) is None:
                return False
            self._save()
            return True


SETTINGS_FILE = DATA_DIR / "settings.json"
DEFAULT_SETTINGS: dict = {
    "new_device_alarm": True,  # notify when an unknown device joins the network
    "notify_persistent": True,  # show a notification in Home Assistant
    "notify_service": "",  # optional push, e.g. "notify.mobile_app_iphone"
}


class Settings:
    """Settings changed in the web UI (add-on options stay in options.json)."""

    def __init__(self, path: Path = SETTINGS_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        self.data = dict(DEFAULT_SETTINGS)
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            self.data.update({k: v for k, v in raw.items() if k in DEFAULT_SETTINGS})
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as err:
            _LOGGER.warning("Could not read %s: %s", self._path, err)

    def get(self, key: str):
        return self.data.get(key, DEFAULT_SETTINGS.get(key))

    def update(self, values: dict) -> dict:
        with self._lock:
            for key, value in values.items():
                if key not in DEFAULT_SETTINGS:
                    continue
                default = DEFAULT_SETTINGS[key]
                self.data[key] = bool(value) if isinstance(default, bool) else str(value or "").strip()
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            tmp.replace(self._path)
            return dict(self.data)
