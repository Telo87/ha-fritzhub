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
        self._mlsd: bool | None = None  # remember whether MLSD is supported
        self._encoding = "utf-8"  # file name encoding the server really uses

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
                ftp.encoding = self._encoding
                ftp.connect(self.cfg.host, 21)
                if tls:
                    ftp.auth()  # type: ignore[attr-defined]
                ftp.login(self.cfg.username or "anonymous", self.cfg.password or "")
                if tls:
                    ftp.prot_p()  # type: ignore[attr-defined]
                self._tls_ok = tls
                self._negotiate_encoding(ftp)
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
            entries = self._listdir(ftp, path)
            entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
            return entries

        return self._run(op)

    def _negotiate_encoding(self, ftp: ftplib.FTP) -> None:
        """The FRITZ!Box announces UTF8 but uses Latin-1 until "OPTS UTF8 ON"."""
        if self._encoding != "utf-8":
            return
        try:
            ftp.sendcmd("OPTS UTF8 ON")
        except ftplib.Error:
            self._encoding = ftp.encoding = "latin-1"

    def _decode_listing(self, ftp: ftplib.FTP, data: bytes) -> list[str]:
        """Decode a LIST response; switch to Latin-1 if the server isn't really UTF-8."""
        try:
            text = data.decode(self._encoding)
        except UnicodeDecodeError:
            _LOGGER.info("FTP server sends Latin-1 file names – switching encoding")
            self._encoding = ftp.encoding = "latin-1"
            text = data.decode("latin-1")
        return [line for line in text.splitlines() if line.strip()]

    def _has_mlsd(self, ftp: ftplib.FTP) -> bool:
        """MLSD only if the server announces MLST (the FRITZ!Box does not)."""
        if self._mlsd is None:
            try:
                self._mlsd = "MLST" in ftp.sendcmd("FEAT").upper()
            except ftplib.Error:
                self._mlsd = False
        return self._mlsd

    def _listdir(self, ftp: ftplib.FTP, path: str) -> list[dict[str, Any]]:
        if self._has_mlsd(ftp):
            try:
                return _mlsd_entries(ftp, path)
            except ftplib.error_perm:
                self._mlsd = False  # announced but not usable – fall back to LIST
        # CWD + plain LIST: path arguments of LIST break on names with spaces
        ftp.cwd(path)
        raw: list[bytes] = []
        ftp.retrbinary("LIST", raw.append)
        lines = self._decode_listing(ftp, b"".join(raw))
        entries = [e for e in (_parse_list_line(line) for line in lines) if e]
        if lines and not entries:
            _LOGGER.warning("Unbekanntes LIST-Format: %r", lines[:3])
        return entries

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
            for entry in self._listdir(ftp, target):
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

# Unix style: "drwxr-xr-x 1 owner group 4096 Sep 28 12:00 name" – the number of
# columns between permissions and size differs between servers, so allow 1–3.
_UNIX_RE = re.compile(
    r"^(?P<perm>[\-dlcbps][rwxsStT\-]{9})\S*\s+(?:\S+\s+){1,3}?(?P<size>\d+)\s+"
    r"(?P<mon>[A-Za-z]{3})\s+(?P<day>\d{1,2})\s+(?P<time>\d{1,2}:\d{2}|\d{4})\s(?P<name>.+)$"
)
# MS-DOS style: "09-28-26  12:00PM  <DIR>  name" / "09-28-26  12:00PM  1234 name"
_DOS_RE = re.compile(
    r"^(?P<date>\d{2}-\d{2}-\d{2,4})\s+(?P<time>\d{1,2}:\d{2}[AP]M)\s+"
    r"(?:(?P<dir><DIR>)|(?P<size>\d+))\s+(?P<name>.+)$"
)
_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1
)}


def _unix_date(mon: str, day: str, time_or_year: str) -> str | None:
    month = _MONTHS.get(mon.lower())
    if not month:
        return None
    try:
        if ":" in time_or_year:
            hour, minute = (int(x) for x in time_or_year.split(":"))
            now = datetime.now()
            stamp = datetime(now.year, month, int(day), hour, minute)
            if stamp > now:  # "Dec 31 23:00" seen in January belongs to last year
                stamp = stamp.replace(year=now.year - 1)
        else:
            stamp = datetime(int(time_or_year), month, int(day))
    except ValueError:
        return None
    return stamp.isoformat()


def _parse_list_line(line: str) -> dict[str, Any] | None:
    line = line.rstrip("\r\n")
    match = _UNIX_RE.match(line)
    if match:
        name = match["name"]
        if match["perm"].startswith("l") and " -> " in name:
            name = name.split(" -> ")[0]
        entry = {
            "name": name,
            "dir": match["perm"].startswith("d"),
            "size": int(match["size"]),
            "modified": _unix_date(match["mon"], match["day"], match["time"]),
        }
    else:
        match = _DOS_RE.match(line)
        if not match:
            return None
        try:
            fmt = "%m-%d-%y %I:%M%p" if len(match["date"]) == 8 else "%m-%d-%Y %I:%M%p"
            modified = datetime.strptime(f"{match['date']} {match['time']}", fmt).isoformat()
        except ValueError:
            modified = None
        entry = {
            "name": match["name"],
            "dir": bool(match["dir"]),
            "size": int(match["size"]) if match["size"] else None,
            "modified": modified,
        }
    return None if entry["name"] in (".", "..") else entry


def _mlsd_entries(ftp: ftplib.FTP, path: str) -> list[dict[str, Any]]:
    entries = []
    # no facts argument: "OPTS MLST ..." is rejected by some servers (501)
    for name, facts in ftp.mlsd(path):
        kind = facts.get("type", "")
        if kind in ("cdir", "pdir") or name in (".", ".."):
            continue
        modified = None
        if facts.get("modify"):
            try:
                modified = datetime.strptime(facts["modify"][:14], "%Y%m%d%H%M%S").isoformat()
            except ValueError:
                pass
        entries.append(
            {
                "name": name,
                "dir": kind == "dir",
                "size": int(facts["size"]) if facts.get("size", "").isdigit() else None,
                "modified": modified,
            }
        )
    return entries
