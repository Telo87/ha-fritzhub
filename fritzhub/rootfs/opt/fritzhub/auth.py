"""Optional direct access: own port, username/password, remembered sessions.

Home Assistant ingress stays the default way in. When ``direct_access`` is
enabled, FritzHub additionally listens on ``direct_port`` and asks for a login.
Sessions are random tokens in an HttpOnly cookie; only their SHA-256 hash is
stored (``/data/sessions.json``), so they survive add-on restarts. Changing
username or password invalidates all sessions.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from pathlib import Path

from .config import DATA_DIR

_LOGGER = logging.getLogger(__name__)

COOKIE = "fritzhub_session"
REMEMBER_DAYS = 365          # "Angemeldet bleiben", extended while in use
SESSION_HOURS = 12           # without "Angemeldet bleiben"
MAX_FAILS = 5                # failed logins per address …
FAIL_WINDOW = 600            # … within 10 minutes
LOCK_SECONDS = 300           # lead to a 5-minute lock
MIN_PASSWORD = 8


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Auth:
    def __init__(self, username: str, password: str, path: Path | None = None) -> None:
        self.username = username
        self._password = password
        # fingerprint of the credentials: sessions from other credentials are void
        self._fp = hashlib.sha256(f"{username}\0{password}".encode()).hexdigest()[:16]
        self._path = path or DATA_DIR / "sessions.json"
        self._lock = threading.Lock()
        self._sessions: dict[str, dict] = {}
        self._fails: dict[str, list[float]] = {}
        self._locked: dict[str, float] = {}
        self._load()

    # ------------------------------------------------------------ storage
    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = {}
        except (OSError, ValueError) as err:
            _LOGGER.warning("Could not read %s: %s", self._path, err)
            raw = {}
        now = time.time()
        self._sessions = {
            k: v for k, v in (raw.items() if isinstance(raw, dict) else [])
            if isinstance(v, dict) and v.get("fp") == self._fp and v.get("exp", 0) > now
        }

    def _save(self) -> None:
        try:
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._sessions), encoding="utf-8")
            tmp.replace(self._path)
        except OSError as err:
            _LOGGER.warning("Could not write %s: %s", self._path, err)

    # -------------------------------------------------------------- login
    def locked(self, ip: str) -> int:
        """Seconds until ``ip`` may try again (0 = not locked)."""
        until = self._locked.get(ip, 0)
        return max(0, int(until - time.time() + 0.999))

    def check(self, ip: str, username: str, password: str) -> bool:
        if self.locked(ip):
            return False
        ok = hmac.compare_digest(username.encode(), self.username.encode()) & hmac.compare_digest(
            password.encode(), self._password.encode()
        )
        now = time.time()
        if ok:
            self._fails.pop(ip, None)
            return True
        fails = [t for t in self._fails.get(ip, []) if now - t < FAIL_WINDOW] + [now]
        self._fails[ip] = fails
        if len(fails) >= MAX_FAILS:
            self._locked[ip] = now + LOCK_SECONDS
            self._fails.pop(ip, None)
            _LOGGER.warning("Direktzugriff: zu viele Fehlversuche von %s – 5 Minuten gesperrt", ip)
        return False

    # ----------------------------------------------------------- sessions
    def create(self, remember: bool, agent: str = "") -> tuple[str, int | None]:
        """New session → (token, cookie max-age or None for a browser session)."""
        token = secrets.token_urlsafe(32)
        now = time.time()
        life = REMEMBER_DAYS * 86400 if remember else SESSION_HOURS * 3600
        with self._lock:
            self._sessions[_hash(token)] = {
                "fp": self._fp, "exp": now + life, "remember": remember,
                "created": int(now), "agent": agent[:120],
            }
            self._save()
        return token, (life if remember else None)

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        now = time.time()
        with self._lock:
            s = self._sessions.get(_hash(token))
            if not s or s.get("fp") != self._fp:
                return False
            if s["exp"] <= now:
                self._sessions.pop(_hash(token), None)
                self._save()
                return False
            # sliding expiry for remembered sessions (written at most once a day)
            if s.get("remember") and s["exp"] < now + REMEMBER_DAYS * 86400 - 86400:
                s["exp"] = now + REMEMBER_DAYS * 86400
                self._save()
        return True

    def revoke(self, token: str | None) -> None:
        if not token:
            return
        with self._lock:
            if self._sessions.pop(_hash(token), None) is not None:
                self._save()

    def count(self) -> int:
        return len(self._sessions)
