"""Demo mode with synthetic data (``FRITZHUB_DEMO=1``).

Used for UI development and README screenshots – no FRITZ!Box required.
"""

from __future__ import annotations

import io
import math
import posixpath
import queue
import random
import struct
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .box import BoxError, FritzBox
from .config import BoxConfig, BoxStore
from .nas import EOF, NasError, _QueueReader, norm

MASTER = "192.168.178.1"
REPEATERS = {
    "192.168.178.30": ("FRITZ!Repeater 6000", "Repeater OG", "LAN"),
    "192.168.178.31": ("FRITZ!Repeater 3000 AX", "Repeater Garten", "WLAN"),
}

CLIENTS = [
    # name, model, interface, parent-ip, band
    ("iPhone-Anna", None, "802.11", MASTER, "5 GHz"),
    ("Pixel-8-Tom", None, "802.11", "192.168.178.30", "5 GHz"),
    ("MacBook-Pro", None, "802.11", "192.168.178.30", "5 GHz"),
    ("Arbeits-PC", None, "Ethernet", MASTER, None),
    ("homeassistant", None, "Ethernet", MASTER, None),
    ("Synology-NAS", None, "Ethernet", MASTER, None),
    ("LG-webOS-TV", None, "Ethernet", "192.168.178.30", None),
    ("PlayStation-5", None, "Ethernet", "192.168.178.30", None),
    ("Sonos-Kueche", None, "802.11", MASTER, "2,4 GHz"),
    ("Echo-Dot", None, "802.11", MASTER, "2,4 GHz"),
    ("Shelly-Plug-Garage", None, "802.11", "192.168.178.31", "2,4 GHz"),
    ("ESP-Wetterstation", None, "802.11", "192.168.178.31", "2,4 GHz"),
    ("Mähroboter", None, "802.11", "192.168.178.31", "2,4 GHz"),
    ("iPad-Kinder", None, "802.11", "192.168.178.30", "5 GHz"),
    ("Brother-Drucker", None, "802.11", MASTER, "2,4 GHz"),
    ("Galaxy-Tab", None, "802.11", MASTER, "5 GHz"),
    ("Hue-Bridge", None, "Ethernet", MASTER, None),
]
OFFLINE = ["Laptop-Gast", "Kindle", "Nintendo-Switch", "Alter-Router"]


# realistic vendor prefixes for the demo clients (index in CLIENTS -> OUI);
# phones/tablets without entry use randomized "private" addresses like in reality
DEMO_OUI = {
    1: "3C:28:6D", 2: "F0:18:98", 4: "B8:27:EB", 5: "00:11:32", 6: "A8:23:FE",
    7: "00:D9:D1", 8: "48:A6:B8", 9: "F0:81:73", 10: "E8:DB:84", 11: "A4:CF:12", 12: "80:7D:3A",
    14: "3C:2A:F4", 16: "00:17:88",
}


def _mac(seed: int) -> str:
    rnd = random.Random(seed)
    tail = [f"{rnd.randint(0, 255):02X}" for _ in range(6)]
    prefix = DEMO_OUI.get(seed)
    if prefix:
        return prefix + ":" + ":".join(tail[3:])
    if seed < len(CLIENTS):
        tail[0] = f"{(int(tail[0], 16) & 0xFC) | 0x02:02X}"  # locally administered = private MAC
    else:
        tail[0] = f"{int(tail[0], 16) & 0xFC:02X}"
    return ":".join(tail)


class DemoBox(FritzBox):
    _names: dict[str, str] = {}
    _barring: list[dict[str, Any]] = [{"uid": 1, "name": "Gewinnspiel-Hotline", "number": "01371234567"}]
    _started = time.time()

    def __init__(self, cfg: BoxConfig, verify_ssl: bool = False) -> None:
        super().__init__(cfg, verify_ssl)
        self.router = cfg.host == MASTER
        self.started = time.time() - (random.randint(3, 40) * 86400)
        guest = [4] if self.router else [3]
        self._wlan = {1: True, 2: True, **{g: False for g in guest}}
        self._blocked: set[str] = {"192.168.178.34"}
        now = datetime.now()
        self._messages = {
            0: [
                {"index": 3, "number": "0171 2345678", "name": "Mama", "date": now - timedelta(hours=2), "sec": 38, "new": True},
                {"index": 2, "number": "030 1234567", "name": None, "date": now - timedelta(days=1, hours=3), "sec": 12, "new": True},
                {"index": 1, "number": "0221 998877", "name": "Zahnarztpraxis Dr. Weber", "date": now - timedelta(days=4), "sec": 25, "new": False},
            ]
        }
        self._tam_enabled = {0: True, 1: False}
        self._defl = [
            {"id": 0, "enabled": False, "type": "fromAll", "number": None, "target": "0171 2345678", "mode": "eImmediately"},
            {"id": 1, "enabled": True, "type": "fromNumber", "number": "0800 1234567", "target": "Anrufbeantworter", "mode": "eShortDelayed"},
        ]

    # overrides -----------------------------------------------------------
    @property
    def fc(self):  # type: ignore[override]
        raise BoxError("Demo")

    def has(self, service: str) -> bool:
        if service.startswith(("WAN", "X_AVM-DE_OnTel", "X_AVM-DE_TAM", "X_AVM-DE_HostFilter", "Hosts")):
            return self.router
        return True

    @property
    def is_router(self) -> bool:
        return self.router

    def info(self) -> dict[str, Any]:
        model = "FRITZ!Box 7590 AX" if self.router else REPEATERS.get(
            self.cfg.host, ("FRITZ!Powerline 1260",)
        )[0]
        return {
            "model": model,
            "serial": "A1B2C3D4E5F6" if self.router else "R9Q8P7O6N5M4",
            "hardware": model,
            "manufacturer": "AVM",
            "description": model,
            "firmware": "8.02" if self.router else "7.58",
            "uptime": int(time.time() - self.started),
            "update_available": not self.router,
            "update_version": None if self.router else "8.00",
            "update_info_url": None,
            "is_router": self.router,
            "services": {
                "wan": self.router, "hosts": self.router, "phone": self.router, "tam": self.router,
                "wlan": True, "hostfilter": self.router, "storage": self.router,
            },
        }

    def wan(self) -> dict[str, Any] | None:
        if not self.router:
            return None
        t = time.time()
        down = max(0, 3_200_000 + 2_600_000 * math.sin(t / 97) + random.randint(-900_000, 1_800_000))
        up = max(0, 420_000 + 300_000 * math.sin(t / 61 + 1) + random.randint(-150_000, 250_000))
        return {
            "access_type": "DSL", "link_status": "Up", "status": "Connected", "connected": True,
            "connection_type": "PPPoE", "uptime": int(t - self.started) - 3600,
            "external_ip": "93.184.216.34", "external_ipv6": "2003:e1:bf3a:4c00::1",
            "ipv6_prefix": "2003:e1:bf3a:4c00::/56",
            "max_down_bit": 250_000_000, "max_up_bit": 40_000_000,
            "rate_down": int(down), "rate_up": int(up),
            "total_down": 842_000_000_000, "total_up": 96_400_000_000,
            "dns": ["217.237.150.51", "217.237.148.22"],
            "dsl": {"status": "Up", "down_kbit": 250_000, "up_kbit": 40_000,
                    "down_max_kbit": 292_560, "up_max_kbit": 46_720,
                    "down_snr": 9.0, "up_snr": 11.0, "down_attenuation": 12.0, "up_attenuation": 11.0},
        }

    def wlan(self) -> list[dict[str, Any]]:
        counts = {
            MASTER: (5, 3), "192.168.178.30": (0, 4), "192.168.178.31": (3, 0),
        }.get(self.cfg.host, (1, 1))
        result = []
        for idx, on in self._wlan.items():
            guest = idx == max(self._wlan)
            band = "2,4 GHz" if idx == 1 else "5 GHz"
            result.append({
                "index": idx, "enabled": on, "status": "Up" if on else "Disabled",
                "ssid": "FRITZ!Box Gastzugang" if guest else "Mein-Heimnetz",
                "channel": {MASTER: (1, 36), "192.168.178.30": (1, 100)}.get(self.cfg.host, (6, 36))[0 if (idx == 1 or guest) else 1],
                "auto_channel": self.cfg.host != "192.168.178.30",
                "possible_channels": list(range(1, 14)) if (idx == 1 or guest) else [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140],
                "standard": "ax", "security": "11i",
                "band": "2,4 GHz" if guest else band, "guest": guest,
                "clients": 0 if (guest or not on) else counts[idx - 1] if idx <= 2 else 0,
            })
        return result

    def wlan_uplink(self) -> dict[str, Any] | None:
        if self.router or REPEATERS.get(self.cfg.host, ("", "", "LAN"))[2] == "LAN":
            return None
        signal = int(52 + 8 * math.sin(time.time() / 120) + random.uniform(-3, 3))
        link = {"band": "5 GHz", "channel": 36, "width": 80, "standard": "ax", "signal": signal,
                "speed_tx": int(signal * 11), "speed_rx": int(signal * 10), "max_tx": 1201, "max_rx": 1201,
                "ssid": "Mein-Heimnetz", "bssid": "3C:A6:2F:00:00:02", "mlo": None}
        return {**link, "links": [link]}

    def wlan_clients(self, bands: list[dict[str, Any]]) -> list[dict[str, Any]]:
        signals = {"Mähroboter": 14, "Shelly-Plug-Garage": 29, "ESP-Wetterstation": 38, "Brother-Drucker": 47,
                   "Echo-Dot": 55, "Sonos-Kueche": 61, "Pixel-8-Tom": 66}
        result = []
        for i, (name, _model, iface, parent, band) in enumerate(CLIENTS):
            if parent != self.cfg.host or iface == "Ethernet":
                continue
            signal = signals.get(name, 70 + (i * 7) % 28)
            result.append({"mac": _mac(i), "ip": None, "signal": signal,
                           "speed": max(6, int(signal * (12 if band == "5 GHz" else 3))),
                           "band": band, "guest": False})
        return result

    def wlan_set_enable(self, index: int, enable: bool) -> None:
        self._wlan[index] = enable

    def wlan_credentials(self, index: int) -> dict[str, Any]:
        guest = index == max(self._wlan)
        return {"ssid": "FRITZ!Box Gastzugang" if guest else "Mein-Heimnetz",
                "password": "Willkommen-2026" if guest else "geheim-geheim-123", "security": "11i"}

    def wlan_update(self, index: int, ssid: str | None, password: str | None) -> None:
        return None

    def set_host_name(self, mac: str, name: str) -> None:
        DemoBox._names[mac.upper()] = name

    def hosts(self) -> list[dict[str, Any]]:
        hosts = []
        for i, (name, model, iface, _parent, _band) in enumerate(CLIENTS):
            ip = f"192.168.178.{20 + i if i < 10 else 40 + i}"
            hosts.append({
                "name": DemoBox._names.get(_mac(i), name), "ip": ip, "mac": _mac(i), "active": True, "interface": iface,
                "speed": 1000 if iface == "Ethernet" else None, "guest": False, "vpn": False,
                "wan_blocked": ip in self._blocked, "model": model, "port": None, "meshable": False,
            })
        for ip, (model, name, _kind) in REPEATERS.items():
            hosts.append({"name": name, "ip": ip, "mac": _mac(hash(ip) % 1000), "active": True,
                          "interface": "Ethernet", "speed": 1000, "guest": False, "vpn": False,
                          "wan_blocked": False, "model": model, "port": None, "meshable": True})
        if time.time() - DemoBox._started > 40:
            hosts.append({"name": DemoBox._names.get("D2:4E:91:3A:77:10", "Galaxy-S24"), "ip": "192.168.178.66",
                          "mac": "D2:4E:91:3A:77:10", "active": True, "interface": "802.11", "speed": None,
                          "guest": True, "vpn": False, "wan_blocked": False, "model": None, "port": None,
                          "meshable": False})
        for i, name in enumerate(OFFLINE):
            hosts.append({"name": DemoBox._names.get(_mac(100 + i), name), "ip": f"192.168.178.{80 + i}", "mac": _mac(100 + i), "active": False,
                          "interface": "", "speed": None, "guest": i == 0, "vpn": False,
                          "wan_blocked": False, "model": None, "port": None, "meshable": False})
        return hosts

    def set_wan_access(self, ip: str, blocked: bool) -> None:
        (self._blocked.add if blocked else self._blocked.discard)(ip)

    def mesh(self) -> dict[str, Any]:
        if not self.router:
            raise BoxError("Nur der Mesh Master liefert die Topologie.")
        nodes = [{"id": "n-master", "name": "FRITZ!Box 7590 AX", "mac": "3C:A6:2F:00:00:01",
                  "macs": ["3C:A6:2F:00:00:01"], "role": "master", "meshed": True, "infrastructure": True,
                  "model": "FRITZ!Box 7590 AX", "manufacturer": "AVM", "firmware": "8.02"}]
        links = []
        for ip, (model, name, kind) in REPEATERS.items():
            nid = f"n-{ip}"
            mac = _mac(hash(ip) % 1000)
            nodes.append({"id": nid, "name": name, "mac": mac, "macs": [mac], "role": "slave", "meshed": True,
                          "infrastructure": True, "model": model, "manufacturer": "AVM", "firmware": "7.58"})
            rate = (100_000 if ip == "192.168.178.30" else 1_000_000) if kind == "LAN" else 1_201_000
            links.append({"id": f"l-{ip}", "source": "n-master", "target": nid, "type": kind,
                          "rate_rx": rate, "rate_tx": rate if kind == "LAN" else 960_000,
                          "max_rx": rate, "max_tx": rate, "iface_source": None, "iface_target": None,
                          "ssid": None, "band": "5 GHz" if kind == "WLAN" else None})
        for i, (name, _model, iface, parent, band) in enumerate(CLIENTS):
            nid = f"c-{i}"
            mac = _mac(i)
            nodes.append({"id": nid, "name": name, "mac": mac, "macs": [mac], "role": "unknown",
                          "meshed": False, "infrastructure": False, "model": None, "manufacturer": None,
                          "firmware": None})
            wl = iface != "Ethernet"
            rate = random.choice([144_000, 286_000, 573_000, 866_000, 1_201_000]) if wl else 1_000_000
            if band == "2,4 GHz":
                rate = random.choice([72_000, 144_000, 173_000])
            links.append({"id": f"lc-{i}", "source": "n-master" if parent == MASTER else f"n-{parent}",
                          "target": nid, "type": "WLAN" if wl else "LAN", "rate_rx": rate, "rate_tx": rate,
                          "max_rx": rate, "max_tx": rate, "iface_source": None, "iface_target": None,
                          "ssid": None, "band": band})
        return {"nodes": nodes, "links": links}

    def calls(self, days: int = 30) -> list[dict[str, Any]]:
        rnd = random.Random(42)
        people = [("Mama", "0171 2345678"), (None, "030 1234567"), ("Büro Klaus", "0211 445566"),
                  ("Zahnarztpraxis Dr. Weber", "0221 998877"), (None, "0800 1234567"), ("Oma & Opa", "05241 12345"),
                  ("Pizzeria Bella", "0521 334455")]
        calls = []
        now = datetime.now()
        t = now - timedelta(minutes=37)
        for i in range(60):
            name, number = rnd.choice(people)
            kind = rnd.choices(["incoming", "outgoing", "missed", "rejected"], [5, 5, 2, 0.4])[0]
            dur = 0 if kind in ("missed", "rejected") else rnd.randint(0, 45)
            calls.append({"id": i, "type": kind, "number": number, "own_number": "0521 987654",
                          "name": name, "device": rnd.choice(["FRITZ!Fon C6", "Wohnzimmer", "Anrufbeantworter"]) if kind != "outgoing" else "FRITZ!Fon C6",
                          "date": t.strftime("%d.%m.%y %H:%M"), "duration": f"{dur // 60}:{dur % 60:02d}",
                          "has_recording": False})
            t -= timedelta(hours=rnd.uniform(1, 14))
            if (now - t).days > days:
                break
        return calls

    def call_barring(self) -> list[dict[str, Any]]:
        return list(DemoBox._barring)

    def call_barring_add(self, number: str, name: str | None = None) -> int:
        uid = max([b["uid"] for b in DemoBox._barring] + [0]) + 1
        DemoBox._barring.append({"uid": uid, "name": name or number, "number": number})
        return uid

    def call_barring_delete(self, uid: int) -> None:
        DemoBox._barring[:] = [b for b in DemoBox._barring if b["uid"] != uid]

    def deflections(self) -> list[dict[str, Any]]:
        return self._defl

    def set_deflection(self, deflection_id: int, enable: bool) -> None:
        self._defl[deflection_id]["enabled"] = enable

    def tams(self) -> list[dict[str, Any]]:
        return [{"index": 0, "name": "Anrufbeantworter", "enabled": self._tam_enabled[0]},
                {"index": 1, "name": "Büro-AB", "enabled": self._tam_enabled[1]}]

    def tam_messages(self, tam: int) -> list[dict[str, Any]]:
        return [{"index": m["index"], "tam": tam, "number": m["number"], "name": m["name"], "called": "0521 987654",
                 "date": m["date"].strftime("%d.%m.%y %H:%M"), "duration": f"0:{max(1, m['sec'] // 60):02d}",
                 "new": m["new"], "has_audio": True} for m in self._messages.get(tam, [])]

    def tam_audio(self, tam: int, message: int) -> bytes:
        # 3 s G.711 µ-law test tone – exercises the converter in audio.py
        rate, samples = 8000, 8000 * 3
        data = bytearray()
        for n in range(samples):
            v = int(9000 * math.sin(2 * math.pi * (440 + 80 * math.sin(n / 3000)) * n / rate))
            data.append(_lin2ulaw(v))
        header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 7, 1,
                             rate, rate, 1, 8, b"data", len(data))
        return header + bytes(data)

    def tam_mark(self, tam: int, message: int, read: bool = True) -> None:
        for m in self._messages.get(tam, []):
            if m["index"] == message:
                m["new"] = not read

    def tam_delete(self, tam: int, message: int) -> None:
        self._messages[tam] = [m for m in self._messages.get(tam, []) if m["index"] != message]

    def tam_set_enable(self, tam: int, enable: bool) -> None:
        self._tam_enabled[tam] = enable

    def reboot(self) -> None:
        self._reboot_at = time.time()
        self._reboot_len = random.uniform(15, 35)

    def ping(self, timeout: float = 2.0) -> bool:
        started = getattr(self, "_reboot_at", None)
        if started is None:
            return True
        elapsed = time.time() - started
        return not 4 < elapsed < 4 + self._reboot_len

    def reconnect(self) -> None:
        return None

    def device_log(self) -> list[str]:
        now = datetime.now()
        entries = ["Internetverbindung wurde erfolgreich hergestellt. IP-Adresse: 93.184.216.34",
                   "WLAN-Gerät hat sich neu angemeldet (5 GHz), iPhone-Anna",
                   "Anmeldung der Benutzerin homeassistant an der FRITZ!Box-Benutzeroberfläche.",
                   "Mesh-Repeater 'Repeater OG' ist verbunden (LAN).",
                   "DSL antwortet (Down: 250000 kbit/s, Up: 40000 kbit/s)."]
        return [f"{(now - timedelta(minutes=17 * i)).strftime('%d.%m.%y %H:%M:%S')} {entries[i % len(entries)]}"
                for i in range(25)]


def _lin2ulaw(sample: int) -> int:
    bias, clip = 0x84, 32635
    sign = 0x80 if sample < 0 else 0
    sample = min(abs(sample), clip) + bias
    exponent = 7
    for exp in range(7, -1, -1):
        if sample & (0x80 << exp):
            exponent = exp
            break
    mantissa = (sample >> (exponent + 3)) & 0x0F
    return ~(sign | (exponent << 4) | mantissa) & 0xFF


class DemoNas:
    """In-memory file system."""

    _files: dict[str, bytes] = {}
    _dirs: set[str] = set()
    _lock = threading.Lock()

    def __init__(self, cfg: BoxConfig) -> None:
        self.cfg = cfg
        if not self._dirs:
            for d in ("/", "/FRITZ", "/FRITZ/mediabox", "/USB-Stick", "/USB-Stick/Fotos", "/USB-Stick/Musik", "/USB-Stick/Backups"):
                self._dirs.add(d)
            for f, size in (("/USB-Stick/Fotos/Urlaub-2026.jpg", 2_400_000), ("/USB-Stick/Fotos/Garten.png", 830_000),
                            ("/USB-Stick/Musik/Playlist.mp3", 5_600_000), ("/USB-Stick/Backups/homeassistant.tar", 42_000_000),
                            ("/USB-Stick/Rechnung-Strom.pdf", 180_000), ("/FRITZ/mediabox/readme.txt", 1_200)):
                self._files[f] = b"\0" * min(size, 4096)
            # real content so the preview can be tried out in demo mode
            repo = Path(__file__).resolve().parents[3]
            for target, source in (("/USB-Stick/Fotos/Garten.png", repo / "icon.png"),
                                   ("/USB-Stick/Fotos/Urlaub-2026.jpg", repo / "logo.png")):
                if source.exists():
                    self._files[target] = source.read_bytes()
            self._files["/USB-Stick/Rechnung-Strom.pdf"] = _demo_pdf()
            self._files["/FRITZ/mediabox/readme.txt"] = (
                "FRITZ!NAS – Mediabox\n\nDieser Ordner enthält Medien für die FRITZ!Box-Mediaserver-Funktion.\n"
            ).encode()
            self._files["/USB-Stick/Einkaufsliste.md"] = "# Einkauf\n\n- Milch\n- Brot\n- Kaffee\n".encode()

    def list(self, path: str) -> list[dict[str, Any]]:
        path = norm(path)
        if path not in self._dirs:
            raise NasError(f"550 {path}: Verzeichnis nicht gefunden")
        out = [{"name": posixpath.basename(d), "dir": True, "size": None, "modified": None}
               for d in self._dirs if d != "/" and posixpath.dirname(d) == path]
        out += [{"name": posixpath.basename(f), "dir": False, "size": len(b) * 97 if len(b) == 4096 else len(b),
                 "modified": (datetime.now() - timedelta(days=len(f))).isoformat()}
                for f, b in self._files.items() if posixpath.dirname(f) == path]
        return sorted(out, key=lambda e: (not e["dir"], e["name"].lower()))

    def size(self, path: str) -> int | None:
        return len(self._files.get(norm(path), b""))

    def download(self, path: str, chunks: "queue.Queue[Any]", cancel: threading.Event) -> None:
        data = self._files.get(norm(path))
        chunks.put(NasError("550 Datei nicht gefunden") if data is None else data)
        chunks.put(EOF)

    def upload(self, path: str, chunks: "queue.Queue[Any]") -> None:
        reader = _QueueReader(chunks)
        buf = io.BytesIO()
        while True:
            block = reader.read(65536)
            if not block:
                break
            buf.write(block)
        self._files[norm(path)] = buf.getvalue()

    def mkdir(self, path: str) -> None:
        self._dirs.add(norm(path))

    def rename(self, src: str, dst: str) -> None:
        src, dst = norm(src), norm(dst)
        if src in self._files:
            self._files[dst] = self._files.pop(src)
        elif src in self._dirs:
            for d in [d for d in self._dirs if d == src or d.startswith(src + "/")]:
                self._dirs.discard(d)
                self._dirs.add(dst + d[len(src):])
            for f in [f for f in self._files if f.startswith(src + "/")]:
                self._files[dst + f[len(src):]] = self._files.pop(f)

    def delete(self, path: str, is_dir: bool) -> None:
        path = norm(path)
        if is_dir:
            for d in [d for d in self._dirs if d == path or d.startswith(path + "/")]:
                self._dirs.discard(d)
            for f in [f for f in self._files if f.startswith(path + "/")]:
                self._files.pop(f)
        else:
            self._files.pop(path, None)


def _demo_pdf() -> bytes:
    """Minimal one-page PDF with a line of text."""
    text = b"BT /F1 24 Tf 72 740 Td (Stromrechnung 2026 - Demo) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def demo_store() -> BoxStore:
    store = BoxStore(Path(tempfile.gettempdir()) / "fritzhub-demo-boxes.json")
    if not store.all():
        store.upsert({"host": MASTER, "name": "FRITZ!Box", "username": "homeassistant", "password": "demo"})
        for ip, (_model, name, _k) in REPEATERS.items():
            store.upsert({"host": ip, "name": name, "username": "homeassistant", "password": "demo"})
    return store


async def demo_discover() -> list[dict[str, Any]]:
    import asyncio

    await asyncio.sleep(1.5)
    devices = [{"host": MASTER, "name": "FRITZ!Box 7590 AX", "model": "FRITZ!Box 7590 AX", "manufacturer": "AVM", "firmware": "8.02"}]
    devices += [{"host": ip, "name": m, "model": m, "manufacturer": "AVM", "firmware": "7.58"} for ip, (m, _n, _k) in REPEATERS.items()]
    devices.append({"host": "192.168.178.32", "name": "FRITZ!Powerline 1260", "model": "FRITZ!Powerline 1260", "manufacturer": "AVM", "firmware": "7.57"})
    return devices


def seed_demo_stats(hub) -> None:
    """Fill history, data volume and "last seen" so all views show something."""
    stats = hub.stats
    master = next((c for c in hub.store.all() if c.host == MASTER), None)
    if master is None or stats.data["history"].get(master.id):
        return
    now = int(time.time())
    rnd = random.Random(7)
    hist = []
    for minute in range(now - 7 * 86400, now, 60):
        hour = datetime.fromtimestamp(minute).hour
        # evening peak, quiet night
        load = 0.15 + 0.85 * max(0.0, math.sin((hour - 6) / 24 * 2 * math.pi)) ** 2
        down = int((1_000_000 + 6_000_000 * load) * rnd.uniform(0.5, 1.6))
        up = int((150_000 + 600_000 * load) * rnd.uniform(0.5, 1.6))
        hist.append([minute // 60 * 60, down * 6, up * 6, 6])
    stats.data["history"][master.id] = hist
    days = {}
    today = datetime.now().date()
    for back in range(70, -1, -1):
        day = today - timedelta(days=back)
        factor = 1.4 if day.weekday() >= 5 else 1.0
        days[day.isoformat()] = [int(rnd.uniform(18, 42) * factor * 1e9), int(rnd.uniform(2, 6) * factor * 1e9)]
    stats.data["volume"][master.id] = {"days": days, "last": None}
    stats.data["since"] = now - 45 * 86400
    for i, _name in enumerate(OFFLINE):
        if i < 3:
            stats.data["seen"][_mac(100 + i)] = {"first": now - 44 * 86400, "last": now - (i * 19 + 2) * 86400 - 3600}


async def demo_webscan(hosts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Fake web interfaces for a few demo devices."""
    import asyncio

    await asyncio.sleep(2)
    fake = {
        "homeassistant": [("http", 8123, "Home Assistant", False)],
        "Synology-NAS": [("https", 5001, "Synology DiskStation", True), ("http", 5000, "Synology DiskStation", True)],
        "Brother-Drucker": [("http", 80, "Brother HL-L2350DW", False)],
        "Hue-Bridge": [("http", 80, "hue personal wireless lighting", False)],
        "Shelly-Plug-Garage": [("http", 80, "Shelly Plug S", False)],
        "ESP-Wetterstation": [("http", 80, None, False)],
        "Repeater OG": [("http", 80, "FRITZ!Repeater 6000", True)],
        "Repeater Garten": [("http", 80, "FRITZ!Repeater 3000 AX", True)],
    }
    found = {}
    for h in hosts:
        for scheme, port, title, login in fake.get(h.get("name"), []):
            default = (scheme, port) in (("http", 80), ("https", 443))
            url = f"{scheme}://{h['ip']}/" if default else f"{scheme}://{h['ip']}:{port}/"
            found.setdefault(h["ip"], []).append({"url": url, "port": port, "scheme": scheme, "title": title, "login": login})
    return found
