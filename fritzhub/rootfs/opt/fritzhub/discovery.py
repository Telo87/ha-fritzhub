"""Auto discovery of FRITZ!Box / FRITZ!Repeater devices.

Two strategies are combined:
1. SSDP (UPnP multicast) – fast, finds all AVM devices that answer M-SEARCH.
2. A /24 scan of the local subnet(s) for the TR-064 port 49000 – catches
   devices that have UPnP status messages disabled.
Every candidate is verified by reading its ``tr64desc.xml``.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import xml.etree.ElementTree as ET
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

SSDP_ADDR = ("239.255.255.250", 1900)
SSDP_TARGETS = (
    "urn:dslforum-org:device:InternetGatewayDevice:1",
    "urn:dslforum-org:device:LANDevice:1",
    "upnp:rootdevice",
)
TR064_PORT = 49000


class _SSDPProtocol(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.found: set[str] = set()

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        text = data.decode(errors="ignore").lower()
        if "avm" in text or "fritz" in text or "tr64desc" in text:
            self.found.add(addr[0])


async def _ssdp_search(timeout: float = 3.0) -> set[str]:
    loop = asyncio.get_running_loop()
    try:
        transport, protocol = await loop.create_datagram_endpoint(
            _SSDPProtocol, local_addr=("0.0.0.0", 0), family=socket.AF_INET
        )
    except OSError as err:
        _LOGGER.warning("SSDP not available: %s", err)
        return set()
    try:
        sock = transport.get_extra_info("socket")
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        for _ in range(2):
            for st in SSDP_TARGETS:
                msg = (
                    "M-SEARCH * HTTP/1.1\r\n"
                    f"HOST: {SSDP_ADDR[0]}:{SSDP_ADDR[1]}\r\n"
                    'MAN: "ssdp:discover"\r\n'
                    "MX: 2\r\n"
                    f"ST: {st}\r\n\r\n"
                )
                transport.sendto(msg.encode(), SSDP_ADDR)
            await asyncio.sleep(0.3)
        await asyncio.sleep(timeout)
    finally:
        transport.close()
    return protocol.found


def _local_networks() -> list[ipaddress.IPv4Network]:
    """Best effort: /24 networks of the host's primary IPv4 addresses."""
    ips: set[str] = set()
    for target in ("192.0.2.1", "8.8.8.8"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((target, 80))
                ips.add(s.getsockname()[0])
        except OSError:
            pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    nets = set()
    for ip in ips:
        addr = ipaddress.ip_address(ip)
        if addr.is_loopback or not addr.is_private or ip.startswith("172.30."):
            continue  # skip loopback and the internal hassio network
        nets.add(ipaddress.ip_network(f"{ip}/24", strict=False))
    return sorted(nets)


async def _port_open(ip: str, port: int, timeout: float = 0.7) -> bool:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout)
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    try:
        await writer.wait_closed()
    except OSError:
        pass
    return True


async def _scan_networks(networks: list[ipaddress.IPv4Network]) -> set[str]:
    sem = asyncio.Semaphore(96)
    found: set[str] = set()

    async def check(ip: str) -> None:
        async with sem:
            if await _port_open(ip, TR064_PORT):
                found.add(ip)

    await asyncio.gather(*(check(str(h)) for net in networks for h in net.hosts()))
    return found


def _parse_desc(xml_text: str) -> dict[str, Any] | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    def find(tag: str) -> str | None:
        for el in root.iter():
            if el.tag.split("}")[-1] == tag and el.text:
                return el.text.strip()
        return None

    manufacturer = find("manufacturer") or ""
    if "avm" not in manufacturer.lower():
        return None
    return {
        "name": find("friendlyName"),
        "model": find("modelName"),
        "manufacturer": manufacturer,
        "firmware": find("Display"),
    }


async def _probe(session: aiohttp.ClientSession, host: str) -> dict[str, Any] | None:
    url = f"http://{host}:{TR064_PORT}/tr64desc.xml"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=4)) as resp:
            if resp.status != 200:
                return None
            data = _parse_desc(await resp.text())
    except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError):
        return None
    if data:
        data["host"] = host
    return data


async def discover(scan_subnet: bool = True) -> list[dict[str, Any]]:
    candidates: set[str] = set()
    tasks = [_ssdp_search()]
    networks = _local_networks() if scan_subnet else []
    if networks:
        _LOGGER.info("Scanning %s", ", ".join(str(n) for n in networks))
        tasks.append(_scan_networks(networks))
    for result in await asyncio.gather(*tasks, return_exceptions=True):
        if isinstance(result, set):
            candidates |= result
        else:
            _LOGGER.warning("Discovery step failed: %s", result)
    # Default hostname of every FRITZ!Box
    try:
        candidates.add(socket.gethostbyname("fritz.box"))
    except OSError:
        pass

    async with aiohttp.ClientSession() as session:
        results = await asyncio.gather(*(_probe(session, ip) for ip in candidates))
    devices = {d["host"]: d for d in results if d}
    return sorted(
        devices.values(), key=lambda d: tuple(int(p) for p in d["host"].split("."))
    )
