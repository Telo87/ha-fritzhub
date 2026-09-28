"""Synchronous wrapper around one FRITZ!Box / FRITZ!Repeater (TR-064).

All methods are blocking (fritzconnection uses ``requests``) and are executed
by the web server in a thread pool.
"""

from __future__ import annotations

import logging
import threading
import time
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
import urllib3
from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import FritzConnectionException
from fritzconnection.lib.fritzhosts import FritzHosts
from requests.auth import HTTPDigestAuth

from .config import BoxConfig

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_LOGGER = logging.getLogger(__name__)

CALL_TYPES = {
    1: "incoming",
    2: "missed",
    3: "outgoing",
    9: "active_incoming",
    10: "rejected",
    11: "active_outgoing",
}


def format_firmware(display: str | None) -> str | None:
    """FRITZ!OS version without the hardware prefix.

    ``272.08.40`` / ``272.08.40-136743`` (hardware.major.minor[-build]) -> ``8.40``
    """
    if not display:
        return None
    parts = display.split("-")[0].split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{int(parts[1])}.{parts[2]}"
    return display


class BoxError(Exception):
    """Error that is shown to the user."""


def _int(value: Any, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _bool(value: Any) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _xml_items(xml_text: str, tag: str) -> list[dict[str, str]]:
    """Return all ``<tag>`` elements of an XML document as flat dicts."""
    root = ET.fromstring(xml_text)
    items = []
    for element in root.iter(tag):
        items.append({child.tag: (child.text or "").strip() for child in element})
    return items


def usernames(fc: FritzConnection) -> list[tuple[str, bool]]:
    """User names of a box as ``[(name, last_logged_in)]`` – works without login."""
    try:
        xml_text = fc.call_action("LANConfigSecurity1", "X_AVM-DE_GetUserList")[
            "NewX_AVM-DE_UserList"
        ]
        root = ET.fromstring(xml_text)
    except (FritzConnectionException, requests.RequestException, KeyError, ET.ParseError):
        return []
    return [
        ((node.text or "").strip(), node.attrib.get("last_user") == "1")
        for node in root
        if node.tag == "Username" and (node.text or "").strip()
    ]


def fetch_usernames(host: str, port: int | None = None, use_tls: bool = False) -> list[str]:
    try:
        fc = FritzConnection(address=host, port=port, timeout=8, use_tls=use_tls)
    except (FritzConnectionException, requests.RequestException, OSError) as err:
        raise BoxError(f"Keine Verbindung zu {host}: {err}") from err
    users = usernames(fc)
    # last logged-in user first
    return [name for name, _ in sorted(users, key=lambda u: not u[1])]


class FritzBox:
    def __init__(self, cfg: BoxConfig, verify_ssl: bool = False) -> None:
        self.cfg = cfg
        self.verify_ssl = verify_ssl
        self._fc: FritzConnection | None = None
        self._lock = threading.RLock()
        self._services: set[str] = set()
        self._static: dict[str, Any] = {}
        self.last_error: str | None = None
        self.last_ok: float | None = None
        self.resolved_user: str | None = cfg.username or None

    # ------------------------------------------------------------------ core
    @property
    def fc(self) -> FritzConnection:
        with self._lock:
            if self._fc is None:
                _LOGGER.debug("Connecting to %s", self.cfg.host)
                try:
                    self._fc = FritzConnection(
                        address=self.cfg.host,
                        port=self.cfg.port,
                        user=self.cfg.username or None,
                        password=self.cfg.password or None,
                        timeout=12,
                        use_tls=self.cfg.use_tls,
                    )
                except (FritzConnectionException, requests.RequestException, OSError) as err:
                    raise BoxError(f"Keine Verbindung zu {self.cfg.host}: {err}") from err
                self._services = set(self._fc.services)
                if not self.cfg.username and self.cfg.password:
                    self._apply_default_user(self._fc)
            return self._fc

    def _apply_default_user(self, fc: FritzConnection) -> None:
        """Pick the user name when none is configured.

        Since FRITZ!OS 7.24 every login needs a user name. fritzconnection only
        falls back to the *last logged-in* user – mesh clients often have a
        single auto-generated user (``fritz1234``) that never logged in, so we
        also accept the only existing user.
        """
        users = usernames(fc)
        user = next((name for name, last in users if last), None)
        if user is None and len(users) == 1:
            user = users[0][0]
        if user is None:
            return
        _LOGGER.debug("%s: using user name %s", self.cfg.host, user)
        self.resolved_user = user
        # same approach as fritzconnection's own FritzConnection._reset_user()
        fc.session.auth = HTTPDigestAuth(user, self.cfg.password)
        fc.soaper.user = user
        fc.soaper.session = fc.session
        fc.device_manager.session = fc.session

    def reset(self) -> None:
        with self._lock:
            self._fc = None
            self._static = {}

    def has(self, service: str) -> bool:
        _ = self.fc
        return service in self._services

    def call(self, service: str, action: str, **kwargs: Any) -> dict[str, Any]:
        with self._lock:
            try:
                result = self.fc.call_action(service, action, **kwargs)
            except FritzConnectionException as err:
                raise BoxError(f"{service}.{action}: {err}") from err
            except (requests.RequestException, OSError) as err:
                self._fc = None  # force reconnect next time
                raise BoxError(f"Verbindung zu {self.cfg.host} verloren: {err}") from err
        self.last_ok = time.time()
        return result

    def try_call(self, service: str, action: str, **kwargs: Any) -> dict[str, Any]:
        """Like :meth:`call` but returns ``{}`` when the service is missing or fails."""
        if not self.has(service):
            return {}
        try:
            return self.call(service, action, **kwargs)
        except BoxError as err:
            _LOGGER.debug("%s: %s", self.cfg.host, err)
            return {}

    def fetch(self, url: str, **kwargs: Any) -> requests.Response:
        """Fetch a (lua) URL handed out by the box."""
        try:
            resp = requests.get(url, timeout=20, verify=self.verify_ssl, **kwargs)
            resp.raise_for_status()
        except requests.RequestException as err:
            raise BoxError(f"Download fehlgeschlagen: {err}") from err
        return resp

    @property
    def is_router(self) -> bool:
        return self.has("WANCommonIFC1") and (
            self.has("WANPPPConnection1") or self.has("WANIPConn1")
        )

    # ------------------------------------------------------------- overview
    def info(self) -> dict[str, Any]:
        if not self._static:
            dev = self.try_call("DeviceInfo1", "GetInfo")
            self._static = {
                "model": dev.get("NewModelName") or self.fc.modelname,
                "serial": dev.get("NewSerialNumber"),
                "hardware": dev.get("NewHardwareVersion"),
                "manufacturer": dev.get("NewManufacturerName"),
                "description": dev.get("NewDescription"),
            }
        dev = self.try_call("DeviceInfo1", "GetInfo")
        ui = self.try_call("UserInterface1", "GetInfo")
        return {
            **self._static,
            "firmware": format_firmware(dev.get("NewSoftwareVersion")),
            "uptime": _int(dev.get("NewUpTime")),
            "update_available": _bool(ui.get("NewUpgradeAvailable")),
            "update_version": format_firmware(ui.get("NewX_AVM-DE_Version")) or None,
            "update_info_url": ui.get("NewX_AVM-DE_InfoURL") or None,
            "is_router": self.is_router,
            "services": {
                "wan": self.is_router,
                "hosts": self.has("Hosts1"),
                "phone": self.has("X_AVM-DE_OnTel1"),
                "tam": self.has("X_AVM-DE_TAM1"),
                "wlan": any(self.has(f"WLANConfiguration{i}") for i in range(1, 5)),
                "hostfilter": self.has("X_AVM-DE_HostFilter1"),
                "storage": self.has("X_AVM-DE_Storage1"),
            },
        }

    def wan(self) -> dict[str, Any] | None:
        if not self.is_router:
            return None
        link = self.try_call("WANCommonIFC1", "GetCommonLinkProperties")
        addon = self.try_call("WANCommonIFC1", "GetAddonInfos")

        status, uptime, conn_type = None, None, None
        ppp = self.try_call("WANPPPConnection1", "GetInfo")
        if ppp.get("NewConnectionStatus") == "Connected":
            status, uptime, conn_type = "Connected", _int(ppp.get("NewUptime")), "PPPoE"
            ext_ip = ppp.get("NewExternalIPAddress")
        else:
            ip = self.try_call("WANIPConn1", "GetStatusInfo")
            status = ip.get("NewConnectionStatus") or ppp.get("NewConnectionStatus")
            uptime = _int(ip.get("NewUptime"))
            conn_type = "IP"
            ext_ip = self.try_call("WANIPConn1", "GetExternalIPAddress").get(
                "NewExternalIPAddress"
            )
        ipv6 = self.try_call("WANIPConn1", "X_AVM_DE_GetExternalIPv6Address")
        prefix = self.try_call("WANIPConn1", "X_AVM_DE_GetIPv6Prefix")

        dsl: dict[str, Any] | None = None
        if self.has("WANDSLInterfaceConfig1"):
            d = self.try_call("WANDSLInterfaceConfig1", "GetInfo")
            if d:
                dsl = {
                    "status": d.get("NewStatus"),
                    "down_kbit": _int(d.get("NewDownstreamCurrRate")),
                    "up_kbit": _int(d.get("NewUpstreamCurrRate")),
                    "down_max_kbit": _int(d.get("NewDownstreamMaxRate")),
                    "up_max_kbit": _int(d.get("NewUpstreamMaxRate")),
                    "down_snr": (_int(d.get("NewDownstreamNoiseMargin"), 0) or 0) / 10,
                    "up_snr": (_int(d.get("NewUpstreamNoiseMargin"), 0) or 0) / 10,
                    "down_attenuation": (_int(d.get("NewDownstreamAttenuation"), 0) or 0) / 10,
                    "up_attenuation": (_int(d.get("NewUpstreamAttenuation"), 0) or 0) / 10,
                }

        return {
            "access_type": link.get("NewWANAccessType"),
            "link_status": link.get("NewPhysicalLinkStatus"),
            "status": status,
            "connected": status == "Connected",
            "connection_type": conn_type,
            "uptime": uptime,
            "external_ip": ext_ip or None,
            "external_ipv6": ipv6.get("NewExternalIPv6Address") or None,
            "ipv6_prefix": (
                f"{prefix['NewIPv6Prefix']}/{prefix.get('NewPrefixLength')}"
                if prefix.get("NewIPv6Prefix")
                else None
            ),
            "max_down_bit": _int(link.get("NewLayer1DownstreamMaxBitRate")),
            "max_up_bit": _int(link.get("NewLayer1UpstreamMaxBitRate")),
            # current throughput in bytes/s
            "rate_down": _int(addon.get("NewByteReceiveRate"), 0),
            "rate_up": _int(addon.get("NewByteSendRate"), 0),
            "total_down": _int(addon.get("NewX_AVM_DE_TotalBytesReceived64"))
            or _int(addon.get("NewTotalBytesReceived")),
            "total_up": _int(addon.get("NewX_AVM_DE_TotalBytesSent64"))
            or _int(addon.get("NewTotalBytesSent")),
            "dns": [
                s.strip()
                for s in (addon.get("NewDNSServer1"), addon.get("NewDNSServer2"))
                if s and s.strip()
            ],
            "dsl": dsl,
        }

    # ------------------------------------------------------------------ WLAN
    def wlan_services(self) -> list[int]:
        return [i for i in range(1, 5) if self.has(f"WLANConfiguration{i}")]

    def wlan(self) -> list[dict[str, Any]]:
        indices = self.wlan_services()
        result = []
        for i in indices:
            svc = f"WLANConfiguration{i}"
            info = self.try_call(svc, "GetInfo")
            if not info:
                continue
            assoc = self.try_call(svc, "GetTotalAssociations")
            band = info.get("NewX_AVM-DE_FrequencyBand")
            channel = _int(info.get("NewChannel"))
            if not band:
                band = "2400" if channel and channel <= 14 else "5000"
            band_label = {"2400": "2,4 GHz", "5000": "5 GHz", "6000": "6 GHz"}.get(
                str(band), f"{band} MHz"
            )
            is_guest = len(indices) >= 3 and i == indices[-1]
            result.append(
                {
                    "index": i,
                    "enabled": _bool(info.get("NewEnable")),
                    "status": info.get("NewStatus"),
                    "ssid": info.get("NewSSID"),
                    "channel": channel,
                    "standard": info.get("NewStandard"),
                    "security": info.get("NewBeaconType"),
                    "band": band_label,
                    "guest": is_guest,
                    "clients": _int(assoc.get("NewTotalAssociations"), 0),
                }
            )
        return result

    def wlan_set_enable(self, index: int, enable: bool) -> None:
        self.call(f"WLANConfiguration{index}", "SetEnable", NewEnable=int(enable))

    def wlan_credentials(self, index: int) -> dict[str, Any]:
        svc = f"WLANConfiguration{index}"
        info = self.call(svc, "GetInfo")
        keys = self.call(svc, "GetSecurityKeys")
        return {
            "ssid": info.get("NewSSID"),
            "password": keys.get("NewKeyPassphrase"),
            "security": info.get("NewBeaconType"),
        }

    def wlan_update(self, index: int, ssid: str | None, password: str | None) -> None:
        svc = f"WLANConfiguration{index}"
        if ssid:
            self.call(svc, "SetSSID", NewSSID=ssid)
        if password:
            if not 8 <= len(password) <= 63:
                raise BoxError("Das WLAN-Passwort muss 8–63 Zeichen lang sein.")
            keys = self.call(svc, "GetSecurityKeys")
            self.call(
                svc,
                "SetSecurityKeys",
                NewWEPKey0=keys.get("NewWEPKey0", ""),
                NewWEPKey1=keys.get("NewWEPKey1", ""),
                NewWEPKey2=keys.get("NewWEPKey2", ""),
                NewWEPKey3=keys.get("NewWEPKey3", ""),
                NewPreSharedKey=keys.get("NewPreSharedKey", ""),
                NewKeyPassphrase=password,
            )

    # ----------------------------------------------------------------- hosts
    def hosts(self) -> list[dict[str, Any]]:
        if not self.has("Hosts1"):
            return []
        with self._lock:
            fh = FritzHosts(fc=self.fc)
            try:
                raw = fh.get_hosts_attributes()
            except Exception as err:  # noqa: BLE001 - older firmware
                _LOGGER.debug("get_hosts_attributes failed (%s), falling back", err)
                raw = None
            if raw is None:
                try:
                    basic = fh.get_hosts_info()
                except Exception as err:  # noqa: BLE001
                    raise BoxError(f"Geräteliste nicht abrufbar: {err}") from err
                return [
                    {
                        "name": h.get("name"),
                        "ip": h.get("ip"),
                        "mac": (h.get("mac") or "").upper(),
                        "active": bool(h.get("status")),
                        "interface": h.get("interface_type") or "",
                        "speed": None,
                        "guest": False,
                        "wan_blocked": None,
                        "model": None,
                        "port": None,
                    }
                    for h in basic
                ]
        hosts = []
        for h in raw:
            disallow = h.get("X_AVM-DE_Disallow")
            hosts.append(
                {
                    "name": h.get("X_AVM-DE_FriendlyName") or h.get("HostName"),
                    "ip": h.get("IPAddress") or None,
                    "mac": (h.get("MACAddress") or "").upper(),
                    "active": _bool(h.get("Active")),
                    "interface": h.get("InterfaceType") or "",
                    "speed": _int(h.get("X_AVM-DE_Speed")),
                    "guest": _bool(h.get("X_AVM-DE_Guest")),
                    "vpn": _bool(h.get("X_AVM-DE_VPN")),
                    "wan_blocked": None if disallow is None else _bool(disallow),
                    "model": h.get("X_AVM-DE_Model") or None,
                    "port": h.get("X_AVM-DE_Port") or None,
                    "meshable": _bool(h.get("X_AVM-DE_IsMeshable")),
                }
            )
        return hosts

    def wake_on_lan(self, mac: str) -> None:
        self.call("Hosts1", "X_AVM-DE_WakeOnLANByMACAddress", NewMACAddress=mac)

    def set_wan_access(self, ip: str, blocked: bool) -> None:
        self.call(
            "X_AVM-DE_HostFilter1",
            "DisallowWANAccessByIP",
            NewIPv4Address=ip,
            NewDisallow=int(blocked),
        )

    # -------------------------------------------------------------- topology
    def mesh(self) -> dict[str, Any]:
        with self._lock:
            try:
                data = FritzHosts(fc=self.fc).get_mesh_topology()
            except Exception as err:  # noqa: BLE001
                raise BoxError(f"Mesh-Topologie nicht verfügbar: {err}") from err
        return parse_mesh(data)

    # ----------------------------------------------------------------- phone
    def calls(self, days: int = 30) -> list[dict[str, Any]]:
        if not self.has("X_AVM-DE_OnTel1"):
            return []
        url = self.call("X_AVM-DE_OnTel1", "GetCallList")["NewCallListURL"]
        xml_text = self.fetch(f"{url}&days={int(days)}").text
        calls = []
        for c in _xml_items(xml_text, "Call"):
            ctype = _int(c.get("Type"), 0)
            outgoing = ctype in (3, 11)
            calls.append(
                {
                    "id": _int(c.get("Id")),
                    "type": CALL_TYPES.get(ctype, "unknown"),
                    "number": c.get("Called") if outgoing else c.get("Caller"),
                    "own_number": (c.get("CallerNumber") if outgoing else c.get("CalledNumber"))
                    or (c.get("Caller") if outgoing else c.get("Called")),
                    "name": c.get("Name") or None,
                    "device": c.get("Device") or None,
                    "date": c.get("Date"),
                    "duration": c.get("Duration"),
                    "has_recording": bool(c.get("Path")),
                }
            )
        return calls

    def deflections(self) -> list[dict[str, Any]]:
        if not self.has("X_AVM-DE_OnTel1"):
            return []
        try:
            xml_text = self.call("X_AVM-DE_OnTel1", "GetDeflections")["NewDeflectionList"]
        except (BoxError, KeyError):
            return []
        return [
            {
                "id": _int(d.get("DeflectionId")),
                "enabled": _bool(d.get("Enable")),
                "type": d.get("Type"),
                "number": d.get("Number") or None,
                "target": d.get("DeflectionToNumber") or None,
                "mode": d.get("Mode"),
            }
            for d in _xml_items(xml_text, "Item")
        ]

    def set_deflection(self, deflection_id: int, enable: bool) -> None:
        self.call(
            "X_AVM-DE_OnTel1",
            "SetDeflectionEnable",
            NewDeflectionId=int(deflection_id),
            NewEnable=int(enable),
        )

    # ------------------------------------------------------ answering machine
    def tams(self) -> list[dict[str, Any]]:
        if not self.has("X_AVM-DE_TAM1"):
            return []
        xml_text = self.call("X_AVM-DE_TAM1", "GetList").get("NewTAMList", "")
        if not xml_text:
            return []
        result = []
        for t in _xml_items(xml_text, "Item"):
            if not _bool(t.get("Display", "1")):
                continue
            result.append(
                {
                    "index": _int(t.get("Index"), 0),
                    "name": t.get("Name") or f"Anrufbeantworter {_int(t.get('Index'), 0) + 1}",
                    "enabled": _bool(t.get("Enable")),
                }
            )
        return result

    def _tam_message_list(self, tam: int) -> tuple[str, list[dict[str, str]]]:
        url = self.call("X_AVM-DE_TAM1", "GetMessageList", NewIndex=int(tam))["NewURL"]
        xml_text = self.fetch(url).text
        return url, _xml_items(xml_text, "Message")

    def tam_messages(self, tam: int) -> list[dict[str, Any]]:
        _, messages = self._tam_message_list(tam)
        return [
            {
                "index": _int(m.get("Index")),
                "tam": _int(m.get("Tam"), tam),
                "number": m.get("Number") or None,
                "name": m.get("Name") or None,
                "called": m.get("Called") or None,
                "date": m.get("Date"),
                "duration": m.get("Duration"),
                "new": _bool(m.get("New")),
                "has_audio": bool(m.get("Path")),
            }
            for m in messages
        ]

    def tam_audio(self, tam: int, message: int) -> bytes:
        url, messages = self._tam_message_list(tam)
        path = next(
            (m.get("Path") for m in messages if _int(m.get("Index")) == int(message)), None
        )
        if not path:
            raise BoxError("Nachricht nicht gefunden.")
        parsed = urlparse(url)
        sid = parse_qs(parsed.query).get("sid", [""])[0]
        sep = "&" if "?" in path else "?"
        audio_url = f"{parsed.scheme}://{parsed.netloc}{path}{sep}sid={sid}"
        return self.fetch(audio_url).content

    def tam_mark(self, tam: int, message: int, read: bool = True) -> None:
        self.call(
            "X_AVM-DE_TAM1",
            "MarkMessage",
            NewIndex=int(tam),
            NewMessageIndex=int(message),
            NewMarkedAsRead=int(read),
        )

    def tam_delete(self, tam: int, message: int) -> None:
        self.call(
            "X_AVM-DE_TAM1", "DeleteMessage", NewIndex=int(tam), NewMessageIndex=int(message)
        )

    def tam_set_enable(self, tam: int, enable: bool) -> None:
        self.call("X_AVM-DE_TAM1", "SetEnable", NewIndex=int(tam), NewEnable=int(enable))

    # ---------------------------------------------------------------- system
    def reboot(self) -> None:
        self.call("DeviceConfig1", "Reboot")
        self.reset()

    def reconnect(self) -> None:
        if not self.is_router:
            raise BoxError("Dieses Gerät hat keine Internetverbindung.")
        svc = "WANPPPConnection1" if self.try_call("WANPPPConnection1", "GetInfo").get(
            "NewConnectionStatus"
        ) == "Connected" else "WANIPConn1"
        self.call(svc, "ForceTermination")

    def device_log(self) -> list[str]:
        log = self.try_call("DeviceInfo1", "GetDeviceLog").get("NewDeviceLog", "")
        return [line for line in log.splitlines() if line.strip()]


# --------------------------------------------------------------------- mesh
def parse_mesh(data: dict[str, Any]) -> dict[str, Any]:
    """Turn the AVM mesh JSON into a simple ``{nodes, links}`` graph."""
    nodes: list[dict[str, Any]] = []
    links: dict[str, dict[str, Any]] = {}
    iface_owner: dict[str, str] = {}
    iface_info: dict[str, dict[str, Any]] = {}

    for node in data.get("nodes", []):
        uid = node.get("uid")
        role = node.get("mesh_role") or "unknown"
        macs = {(node.get("device_mac_address") or "").upper()}
        for iface in node.get("node_interfaces", []):
            iface_owner[iface.get("uid")] = uid
            iface_info[iface.get("uid")] = iface
            if iface.get("mac_address"):
                macs.add(iface["mac_address"].upper())
        nodes.append(
            {
                "id": uid,
                "name": node.get("device_name") or node.get("device_mac_address") or uid,
                "mac": (node.get("device_mac_address") or "").upper(),
                "macs": sorted(m for m in macs if m),
                "role": role,
                "meshed": bool(node.get("is_meshed")),
                "infrastructure": role in ("master", "slave"),
                "model": node.get("device_model") or None,
                "manufacturer": node.get("device_manufacturer") or None,
                "firmware": node.get("device_firmware_version") or None,
            }
        )

    for node in data.get("nodes", []):
        for iface in node.get("node_interfaces", []):
            for link in iface.get("node_links", []):
                if link.get("state") != "CONNECTED":
                    continue
                luid = link.get("uid")
                if luid in links:
                    continue
                i1 = iface_info.get(link.get("node_interface_1_uid"), {})
                i2 = iface_info.get(link.get("node_interface_2_uid"), {})
                links[luid] = {
                    "id": luid,
                    "source": link.get("node_1_uid"),
                    "target": link.get("node_2_uid"),
                    "type": link.get("type") or iface.get("type"),
                    "rate_rx": link.get("cur_data_rate_rx"),
                    "rate_tx": link.get("cur_data_rate_tx"),
                    "max_rx": link.get("max_data_rate_rx"),
                    "max_tx": link.get("max_data_rate_tx"),
                    "iface_source": i1.get("name"),
                    "iface_target": i2.get("name"),
                    "ssid": i1.get("ssid") or i2.get("ssid") or None,
                    "band": _band_from_iface(i1.get("name")) or _band_from_iface(i2.get("name")),
                }
    return {"nodes": nodes, "links": list(links.values())}


def _band_from_iface(name: str | None) -> str | None:
    if not name:
        return None
    if ":2G" in name:
        return "2,4 GHz"
    if ":5G" in name:
        return "5 GHz"
    if ":6G" in name:
        return "6 GHz"
    return None
