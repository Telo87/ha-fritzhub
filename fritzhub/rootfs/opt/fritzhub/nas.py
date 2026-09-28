"""FRITZ!NAS access via FTP(S).

The FRITZ!Box exposes its NAS (internal memory and USB storage) via FTP.
FTPS (explicit TLS) is tried first and plain FTP is used as a fallback.
Requirements on the box: *Heimnetz > Speicher (NAS) > FTP-Zugriff aktiviert*
and the configured user needs the permission *Zugang zu NAS-Inhalten*.
"""

from __future__ import annotations

import ftplib
import logging
import posixpath
import queue
import re
import ssl
import threading
from datetime import datetime
from typing import Any, Callable

from .config import BoxConfig

_LOGGER = logging.getLogger(__name__)

_EOF = object()


class NasError(Exception):
    """Error shown to the user."""


def norm(path: str) -> str:
    # normpath keeps a leading "//" (POSIX special case), so strip slashes first
    path = posixpath.normpath("/" + (path or "").strip().lstrip("/"))
    return "/" if path in (".", "//") else path


class FritzNas:
    def __init__(self, cfg: BoxConfig) -> None:
        self.cfg = cfg
        self._tls_ok: bool | None = None  # remember whether FTPS works

    def _connect(self) -> ftplib.FTP:
        errors = []
        modes = [True, False] if self._tls_ok is not False else [False]
        for tls in modes:
            try:
                if tls:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    ftp: ftplib.FTP = ftplib.FTP_TLS(context=ctx, timeout=20)
                else:
                    ftp = ftplib.FTP(timeout=20)
                ftp.encoding = "utf-8"
                ftp.connect(self.cfg.host, 21)
                if tls:
                    ftp.auth()  # type: ignore[attr-defined]
                ftp.login(self.cfg.username or "anonymous", self.cfg.password or "")
                if tls:
                    ftp.prot_p()  # type: ignore[attr-defined]
                self._tls_ok = tls
                return ftp
            except ftplib.error_perm as err:
                errors.append(str(err))
                if str(err).startswith("530"):
                    raise NasError(
                        "Anmeldung am FRITZ!NAS fehlgeschlagen – hat der Benutzer "
                        "die Berechtigung 'Zugang zu NAS-Inhalten'?"
                    ) from err
            except (OSError, ftplib.Error, EOFError) as err:
                errors.append(str(err))
        raise NasError(
            "FRITZ!NAS nicht erreichbar. Ist der FTP-Zugriff in der FRITZ!Box "
            f"aktiviert? ({'; '.join(errors)})"
        )

    def _run(self, func: Callable[[ftplib.FTP], Any]) -> Any:
        ftp = self._connect()
        try:
            return func(ftp)
        except ftplib.error_perm as err:
            raise NasError(str(err)) from err
        except (OSError, ftplib.Error, EOFError) as err:
            raise NasError(f"FTP-Fehler: {err}") from err
        finally:
            try:
                ftp.quit()
            except Exception:  # noqa: BLE001
                ftp.close()

    # --------------------------------------------------------------- listing
    def list(self, path: str) -> list[dict[str, Any]]:
        path = norm(path)

        def op(ftp: ftplib.FTP) -> list[dict[str, Any]]:
            entries = []
            try:
                for name, facts in ftp.mlsd(path, facts=["type", "size", "modify"]):
                    kind = facts.get("type", "")
                    if kind in ("cdir", "pdir") or name in (".", ".."):
                        continue
                    modified = None
                    if facts.get("modify"):
                        try:
                            modified = datetime.strptime(
                                facts["modify"][:14], "%Y%m%d%H%M%S"
                            ).isoformat()
                        except ValueError:
                            pass
                    entries.append(
                        {
                            "name": name,
                            "dir": kind == "dir",
                            "size": int(facts["size"]) if facts.get("size") else None,
                            "modified": modified,
                        }
                    )
            except ftplib.error_perm as err:
                if not str(err).startswith("500") and not str(err).startswith("502"):
                    raise
                lines: list[str] = []
                ftp.retrlines(f"LIST {path}", lines.append)
                entries = [e for e in (_parse_list_line(line) for line in lines) if e]
            entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
            return entries

        return self._run(op)

    # -------------------------------------------------------------- transfer
    def download(
        self, path: str, chunks: "queue.Queue[Any]", cancel: threading.Event
    ) -> None:
        """Stream a file into ``chunks`` (runs in a worker thread)."""
        path = norm(path)

        def put(item: Any) -> None:
            while True:
                if cancel.is_set():
                    raise NasError("Download abgebrochen")
                try:
                    chunks.put(item, timeout=1)
                    return
                except queue.Full:
                    continue

        def op(ftp: ftplib.FTP) -> None:
            ftp.retrbinary(f"RETR {path}", put, blocksize=64 * 1024)

        try:
            self._run(op)
        except Exception as err:  # noqa: BLE001
            if not cancel.is_set():
                put(err)
        finally:
            if not cancel.is_set():
                put(_EOF)

    def size(self, path: str) -> int | None:
        def op(ftp: ftplib.FTP) -> int | None:
            ftp.voidcmd("TYPE I")
            return ftp.size(norm(path))

        try:
            return self._run(op)
        except NasError:
            return None

    def upload(self, path: str, chunks: "queue.Queue[Any]") -> None:
        path = norm(path)
        reader = _QueueReader(chunks)
        self._run(lambda ftp: ftp.storbinary(f"STOR {path}", reader, blocksize=64 * 1024))

    # ------------------------------------------------------------ management
    def mkdir(self, path: str) -> None:
        self._run(lambda ftp: ftp.mkd(norm(path)))

    def rename(self, src: str, dst: str) -> None:
        self._run(lambda ftp: ftp.rename(norm(src), norm(dst)))

    def delete(self, path: str, is_dir: bool) -> None:
        path = norm(path)
        if path == "/":
            raise NasError("Das Wurzelverzeichnis kann nicht gelöscht werden.")

        def rm_tree(ftp: ftplib.FTP, target: str) -> None:
            for entry in _list_raw(ftp, target):
                child = posixpath.join(target, entry["name"])
                if entry["dir"]:
                    rm_tree(ftp, child)
                else:
                    ftp.delete(child)
            ftp.rmd(target)

        self._run(lambda ftp: rm_tree(ftp, path) if is_dir else ftp.delete(path))


class _QueueReader:
    """File-like object that ``storbinary`` reads from, fed by the web handler."""

    def __init__(self, chunks: "queue.Queue[Any]") -> None:
        self._chunks = chunks
        self._buffer = b""
        self._eof = False

    def read(self, size: int = -1) -> bytes:
        while not self._eof and (size < 0 or len(self._buffer) < size):
            item = self._chunks.get()
            if item is _EOF:
                self._eof = True
                break
            self._buffer += item
        if size < 0:
            data, self._buffer = self._buffer, b""
        else:
            data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data


EOF = _EOF

_LIST_RE = re.compile(
    r"^(?P<perm>[\-dl][rwxsStT\-]{9})\s+\S+\s+\S+\s+\S+\s+(?P<size>\d+)\s+"
    r"(?P<date>\w{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))\s+(?P<name>.+)$"
)


def _parse_list_line(line: str) -> dict[str, Any] | None:
    match = _LIST_RE.match(line)
    if not match:
        return None
    name = match["name"]
    if name in (".", ".."):
        return None
    if match["perm"].startswith("l") and " -> " in name:
        name = name.split(" -> ")[0]
    return {
        "name": name,
        "dir": match["perm"].startswith("d"),
        "size": int(match["size"]),
        "modified": None,
    }


def _list_raw(ftp: ftplib.FTP, path: str) -> list[dict[str, Any]]:
    try:
        return [
            {"name": n, "dir": f.get("type") == "dir"}
            for n, f in ftp.mlsd(path, facts=["type"])
            if f.get("type") not in ("cdir", "pdir") and n not in (".", "..")
        ]
    except ftplib.error_perm:
        lines: list[str] = []
        ftp.retrlines(f"LIST {path}", lines.append)
        return [e for e in (_parse_list_line(line) for line in lines) if e]
