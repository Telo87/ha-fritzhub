"""Vendor lookup by MAC address (OUI).

Uses Wireshark's ``manuf`` file (derived from the IEEE registry), which is
downloaded once while building the add-on image. Lookups are fully offline.
"""

from __future__ import annotations

import gzip
import logging
import os
import re
import threading
from pathlib import Path

_LOGGER = logging.getLogger(__name__)

MANUF_FILE = Path(os.environ.get("FRITZHUB_MANUF", "/usr/share/fritzhub/manuf.gz"))
_HEX = re.compile(r"[^0-9A-F]")
_SUFFIX = re.compile(
    r"[\s,.]+(inc|incorporated|ltd|limited|llc|l\.l\.c|gmbh|ag|se|sa|s\.a|s\.p\.a|spa|bv|b\.v|nv|"
    r"co|corp|corporation|company|plc|pty|oy|ab|as|kg|srl|sas|kft|group|holdings?)\.?$",
    re.IGNORECASE,
)


def clean_vendor(name: str) -> str:
    """Readable vendor name: "Apple, Inc." -> "Apple", "AVM Audiovisuelles … GmbH" -> "AVM"."""
    name = re.sub(r"\(.*?\)", "", name).strip()
    name = name.split(",")[0].strip()
    previous = None
    while previous != name:
        previous = name
        name = _SUFFIX.sub("", name).strip(" ,.")
    words = name.split()
    # long names starting with an acronym (AVM Audiovisuelles …) -> acronym
    if len(words) > 3 and words[0].isupper() and len(words[0]) >= 2:
        return words[0]
    return name or previous


class VendorDB:
    def __init__(self, path: Path = MANUF_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()
        # hex prefix (6, 7 or 9 digits) -> (short name, full name)
        self._blocks: dict[int, dict[str, tuple[str, str]]] | None = None

    def _load(self) -> dict[int, dict[str, tuple[str, str]]]:
        blocks: dict[int, dict[str, tuple[str, str]]] = {6: {}, 7: {}, 9: {}}
        try:
            opener = gzip.open if self._path.suffix == ".gz" else open
            with opener(self._path, "rt", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if not line.strip() or line.startswith("#"):
                        continue
                    parts = [p.strip() for p in line.rstrip("\n").split("\t") if p.strip()]
                    if len(parts) < 2:
                        continue
                    block, _, bits = parts[0].partition("/")
                    digits = {"": 6, "24": 6, "28": 7, "36": 9}.get(bits)
                    if digits is None:
                        continue
                    prefix = _HEX.sub("", block.upper())[:digits]
                    blocks[digits][prefix] = (parts[1], parts[2] if len(parts) > 2 else parts[1])
        except FileNotFoundError:
            _LOGGER.info("No vendor database at %s – vendor lookup disabled", self._path)
        except OSError as err:
            _LOGGER.warning("Could not read vendor database: %s", err)
        else:
            _LOGGER.debug("Loaded %d vendor prefixes", sum(len(b) for b in blocks.values()))
        return blocks

    @property
    def blocks(self) -> dict[int, dict[str, tuple[str, str]]]:
        with self._lock:
            if self._blocks is None:
                self._blocks = self._load()
            return self._blocks

    def lookup(self, mac: str | None) -> dict[str, object] | None:
        """``{"vendor", "vendor_full", "private"}`` or ``None`` for invalid MACs."""
        digits = _HEX.sub("", (mac or "").upper())
        if len(digits) != 12:
            return None
        # locally administered bit set -> randomized ("private") address, no vendor
        if int(digits[1], 16) & 0x2:
            return {"vendor": None, "vendor_full": None, "private": True}
        for size in (9, 7, 6):  # most specific block first
            hit = self.blocks[size].get(digits[:size])
            if hit:
                return {"vendor": clean_vendor(hit[1]), "vendor_full": hit[1], "private": False}
        return {"vendor": None, "vendor_full": None, "private": False}


vendors = VendorDB()
