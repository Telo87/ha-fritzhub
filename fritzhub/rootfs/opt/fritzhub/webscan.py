"""Find devices in the home network that offer a web interface.

For every online device the usual web ports are probed. A port only counts
if an HTTP(S) request returns an HTML page (or asks for a login), so open
ports of other services are not mistaken for a web interface.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

# (port, scheme) – in order of preference for the "primary" link. Plain HTTP
# first: local devices use self-signed certificates, so HTTPS links would show
# a browser warning every time.
PORTS: list[tuple[int, str]] = [
    (80, "http"), (443, "https"), (8080, "http"), (8443, "https"), (5000, "http"),
    (5001, "https"), (8123, "http"), (8000, "http"), (8081, "http"), (8888, "http"),
]
_TITLE = re.compile(rb"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


async def _port_open(ip: str, port: int, timeout: float = 0.8) -> bool:
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


def _url(ip: str, port: int, scheme: str) -> str:
    default = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    return f"{scheme}://{ip}/" if default else f"{scheme}://{ip}:{port}/"


async def _probe(session: aiohttp.ClientSession, ip: str, port: int, scheme: str) -> dict[str, Any] | None:
    url = _url(ip, port, scheme)
    try:
        async with session.get(
            url, ssl=False, allow_redirects=True, max_redirects=3,
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            if resp.status == 404 or resp.status >= 500:
                return None
            login = resp.status in (401, 403)
            if not login and "html" not in resp.headers.get("Content-Type", "").lower():
                return None  # an API or file server, not a web interface
            body = await resp.content.read(65536)
    except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeError, ValueError, OSError):
        return None
    title = None
    match = _TITLE.search(body)
    if match:
        title = html.unescape(match.group(1).decode("utf-8", "replace"))
        title = re.sub(r"\s+", " ", title).strip()[:80] or None
    return {"url": url, "port": port, "scheme": scheme, "title": title, "login": login}


# HTTPS port -> matching HTTP port of the same web server
_TWINS = {443: 80, 8443: 8080, 5001: 5000}


def _dedupe(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """List every web interface once.

    The HTTPS twin of an HTTP port (443/80, 8443/8080, 5001/5000) is dropped
    when both answer alike – also when the page has no title. Otherwise
    interfaces with the same title count as one.
    """
    by_port = {e["port"]: e for e in entries}
    seen_titles: set[str] = set()
    result = []
    for e in entries:
        twin = by_port.get(_TWINS.get(e["port"], -1))
        if twin is not None and twin["title"] == e["title"]:
            continue
        if e["title"]:
            if e["title"] in seen_titles:
                continue
            seen_titles.add(e["title"])
        result.append(e)
    return result


async def scan(hosts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """``{ip: [web interfaces, preferred first]}`` for the given (online) hosts."""
    ips = sorted({h["ip"] for h in hosts if h.get("ip") and h.get("active")})
    sem = asyncio.Semaphore(96)
    found: dict[str, list[dict[str, Any]]] = {}

    async with aiohttp.ClientSession(headers={"User-Agent": "FritzHub"}) as session:

        async def check(ip: str, port: int, scheme: str) -> None:
            async with sem:
                if not await _port_open(ip, port):
                    return
                result = await _probe(session, ip, port, scheme)
            if result:
                found.setdefault(ip, []).append(result)

        await asyncio.gather(*(check(ip, port, scheme) for ip in ips for port, scheme in PORTS))

    order = {port: i for i, (port, _) in enumerate(PORTS)}
    for ip, entries in found.items():
        entries.sort(key=lambda e: order.get(e["port"], 99))
        found[ip] = _dedupe(entries)
    _LOGGER.info("Web interfaces: %d of %d devices", len(found), len(ips))
    return found
