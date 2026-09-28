"""aiohttp web server: REST API + static single page app (served via ingress)."""

from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
import os
import posixpath
import queue
import threading
from pathlib import Path
from typing import Any
from urllib.parse import quote

import qrcode
import qrcode.image.svg
import aiohttp
from aiohttp import web

from . import __version__
from .audio import to_playable_wav
from .auth import COOKIE, MIN_PASSWORD, Auth
from .box import BoxError, FritzBox, fetch_usernames, format_firmware
from .config import BoxConfig, Options
from .discovery import discover
from .hub import Hub
from .nas import EOF, NasError

_LOGGER = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PROXY = "172.30.32.2"
TOKEN_HEADER = "X-FritzHub-Token"
# reachable without login on the direct-access port (app shell + login itself)
OPEN_PATHS = {"/", "/api/login", "/api/session"}

routes = web.RouteTableDef()


def _hub(request: web.Request) -> Hub:
    return request.app["hub"]


def _ok(data: Any = None) -> web.Response:
    return web.json_response({"ok": True, "data": data})


async def _json(request: web.Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except ValueError as err:
        raise web.HTTPBadRequest(text="Ungültiges JSON") from err
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="Ungültige Anfrage")
    return data


# ---------------------------------------------------------------- middleware
def _is_direct(request: web.Request) -> bool:
    """Request came in on the direct-access port (not via ingress)."""
    if not request.app.get("auth") or request.transport is None:
        return False
    sock = request.transport.get_extra_info("sockname")
    return bool(sock) and sock[1] == request.app["options"].direct_port


def _token(request: web.Request) -> str | None:
    # header: works in iframes where the browser blocks cookies;
    # ?t=: for plain links (audio, downloads, previews)
    return (
        request.headers.get(TOKEN_HEADER)
        or request.cookies.get(COOKIE)
        or (request.query.get("t") if request.method == "GET" else None)
    )


@web.middleware
async def guard(request: web.Request, handler):
    options: Options = request.app["options"]
    if _is_direct(request):
        request["direct"] = True
        open_path = request.path in OPEN_PATHS or request.path.startswith("/static/")
        if not open_path and not request.app["auth"].valid(_token(request)):
            return web.json_response({"ok": False, "error": "Bitte anmelden.", "login": True}, status=401)
    elif not options.allow_all and request.remote != INGRESS_PROXY:
        return web.Response(status=403, text="Nur über Home Assistant Ingress erreichbar.")
    try:
        response = await handler(request)
        if request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response
    except (BoxError, NasError) as err:
        return web.json_response({"ok": False, "error": str(err)}, status=502)
    except web.HTTPException as err:
        if request.path.startswith("/api/") and err.status >= 400:
            return web.json_response(
                {"ok": False, "error": err.text or err.reason}, status=err.status
            )
        raise
    except Exception as err:  # noqa: BLE001
        _LOGGER.exception("Unhandled error on %s", request.path)
        return web.json_response({"ok": False, "error": f"Interner Fehler: {err}"}, status=500)


# -------------------------------------------------------------------- static
@routes.get("/")
async def index(request: web.Request) -> web.StreamResponse:
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace("{{VERSION}}", __version__)
    return web.Response(
        text=html, content_type="text/html", headers={"Cache-Control": "no-cache"}
    )


# ------------------------------------------------------------- direct access
@routes.get("/api/session")
async def session(request: web.Request) -> web.Response:
    if not request.get("direct"):
        return _ok({"direct": False, "authenticated": True})
    auth: Auth = request.app["auth"]
    return _ok({"direct": True, "authenticated": auth.valid(_token(request)), "user": auth.username})


@routes.post("/api/login")
async def login(request: web.Request) -> web.Response:
    if not request.get("direct"):
        raise web.HTTPNotFound()
    auth: Auth = request.app["auth"]
    ip = request.remote or "?"
    wait = auth.locked(ip)
    if wait:
        raise web.HTTPTooManyRequests(text=f"Zu viele Fehlversuche – bitte in {max(1, round(wait / 60))} Min. erneut versuchen.")
    data = await _json(request)
    if not auth.check(ip, str(data.get("username", "")), str(data.get("password", ""))):
        await asyncio.sleep(1)  # slows down guessing
        if auth.locked(ip):
            raise web.HTTPTooManyRequests(text="Zu viele Fehlversuche – bitte in 5 Min. erneut versuchen.")
        raise web.HTTPUnauthorized(text="Benutzername oder Passwort falsch.")
    token, max_age = auth.create(bool(data.get("remember", True)), request.headers.get("User-Agent", ""))
    _LOGGER.info("Direktzugriff: Anmeldung von %s", ip)
    response = _ok({"token": token})
    response.set_cookie(COOKIE, token, max_age=max_age, httponly=True, samesite="Lax", path="/")
    return response


@routes.post("/api/logout")
async def logout(request: web.Request) -> web.Response:
    if request.get("direct"):
        request.app["auth"].revoke(_token(request))
    response = _ok()
    response.del_cookie(COOKIE, path="/")
    return response


# --------------------------------------------------------------------- boxes
@routes.get("/api/overview")
async def overview(request: web.Request) -> web.Response:
    return _ok(_hub(request).overview())


@routes.post("/api/refresh")
async def refresh(request: web.Request) -> web.Response:
    await _hub(request).poll()
    return _ok(_hub(request).overview())


def _test_box(cfg: BoxConfig, verify_ssl: bool) -> dict[str, Any]:
    box = FritzBox(cfg, verify_ssl)
    try:
        # a harmless call that needs authentication
        dev = box.call("DeviceInfo1", "GetInfo")
    except BoxError as err:
        if "Keine Verbindung" in str(err):
            raise
        raise BoxError(
            f"Anmeldung fehlgeschlagen – Benutzername/Passwort prüfen. ({err})"
        ) from err
    return {
        "model": dev.get("NewModelName") or box.fc.modelname,
        "firmware": format_firmware(dev.get("NewSoftwareVersion")),
        "router": box.is_router,
        "user": box.resolved_user,
    }


async def _apply_copy_from(request: web.Request, data: dict[str, Any]) -> None:
    """"Copy credentials from another box" – typical for mesh repeaters.

    The password is taken over. The user name only if it exists on the target:
    mesh clients usually have their own auto-generated user (``fritz1234``),
    which is then picked automatically (empty user name).
    """
    src = _hub(request).store.get(data.get("copy_from") or "")
    if not src:
        return
    data["password"] = src.password
    if data.get("username"):
        return
    try:
        users = await asyncio.to_thread(
            request.app["usernames"],
            str(data.get("host", "")).strip(),
            int(data["port"]) if data.get("port") else None,
            bool(data.get("use_tls")),
        )
    except BoxError:
        users = []
    data["username"] = src.username if src.username in users else ""


@routes.get("/api/boxes/users")
async def box_users(request: web.Request) -> web.Response:
    host = request.query.get("host", "").strip()
    if not host:
        raise web.HTTPBadRequest(text="Adresse fehlt.")
    port = int(request.query["port"]) if request.query.get("port") else None
    users = await asyncio.to_thread(
        request.app["usernames"], host, port, request.query.get("tls") == "1"
    )
    return _ok(users)


@routes.post("/api/boxes/test")
async def box_test(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    if data.get("copy_from"):
        await _apply_copy_from(request, data)
    password = data.get("password")
    if not password and data.get("id"):
        stored = hub.store.get(data["id"])
        password = stored.password if stored else ""
    cfg = BoxConfig(
        host=str(data.get("host", "")).strip(),
        username=str(data.get("username", "")).strip(),
        password=password or "",
        port=int(data["port"]) if data.get("port") else None,
        use_tls=bool(data.get("use_tls")),
    )
    if not cfg.host:
        raise web.HTTPBadRequest(text="Adresse fehlt.")
    return _ok(await asyncio.to_thread(request.app["test_box"], cfg, hub.options.verify_ssl))


@routes.post("/api/boxes")
async def box_save(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    if not str(data.get("host", "")).strip():
        raise web.HTTPBadRequest(text="Adresse fehlt.")
    if data.get("copy_from"):
        await _apply_copy_from(request, data)
    cfg = hub.store.upsert(data)
    hub.config_changed(cfg.id)
    return _ok(cfg.public())


@routes.delete("/api/boxes/{box_id}")
async def box_delete(request: web.Request) -> web.Response:
    hub = _hub(request)
    if not hub.store.delete(request.match_info["box_id"]):
        raise web.HTTPNotFound(text="Unbekannte Box.")
    hub.config_changed(request.match_info["box_id"])
    return _ok()


@routes.post("/api/discover")
async def box_discover(request: web.Request) -> web.Response:
    hub = _hub(request)
    devices = await request.app["discover"]()
    configured = {c.host: c.id for c in hub.store.all()}
    for d in devices:
        d["configured"] = d["host"] in configured
    return _ok(devices)


# --------------------------------------------------------------------- hosts
@routes.get("/api/hosts")
async def hosts(request: web.Request) -> web.Response:
    force = request.query.get("force") == "1"
    return _ok(await _hub(request).hosts(force))


@routes.get("/api/topology")
async def topology(request: web.Request) -> web.Response:
    force = request.query.get("force") == "1"
    return _ok(await _hub(request).topology(force))


@routes.get("/api/devices/{mac}/history")
async def device_history(request: web.Request) -> web.Response:
    hub = _hub(request)
    mac = request.match_info["mac"].upper()
    return _ok(await asyncio.to_thread(hub.devlog.history, mac))


@routes.post("/api/watch")
async def device_watch(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    mac = str(data.get("mac") or "").upper()
    if not mac:
        raise web.HTTPBadRequest(text="MAC-Adresse fehlt.")
    watched = set(hub.settings.get("watched_devices") or [])
    (watched.add if data.get("watched") else watched.discard)(mac)
    await asyncio.to_thread(hub.settings.update, {"watched_devices": sorted(watched)})
    return _ok({"watched": sorted(watched)})


@routes.get("/api/netcheck")
async def netcheck(request: web.Request) -> web.Response:
    hub = _hub(request)
    if not hub._hosts_cache:
        await hub.hosts()
    return _ok(hub.netcheck())


@routes.get("/api/webscan")
async def webscan_status(request: web.Request) -> web.Response:
    hub = _hub(request)
    return _ok({"running": hub.webscan_running, "last": hub.last_webscan or None,
                "devices": len(hub.web_uis)})


@routes.post("/api/webscan")
async def webscan_start(request: web.Request) -> web.Response:
    hub = _hub(request)
    if not hub._hosts_cache:
        await hub.hosts()
    hub.start_webscan()
    return _ok({"running": hub.webscan_running, "last": hub.last_webscan or None})


@routes.post("/api/hosts/rename")
async def host_rename(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    name = str(data.get("name") or "").strip()
    if not name or len(name) > 63:
        raise web.HTTPBadRequest(text="Der Name muss 1–63 Zeichen lang sein.")
    routers = hub.routers()
    if not routers:
        raise BoxError("Keine Router-Box verfügbar.")
    await hub.run(routers[0].set_host_name, str(data["mac"]), name)
    hub._hosts_cache = None
    hub._mesh_cache = None
    return _ok({"name": name})


@routes.post("/api/hosts/wan")
async def host_wan(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    routers = hub.routers()
    if not routers:
        raise BoxError("Keine Router-Box verfügbar.")
    await hub.run(routers[0].set_wan_access, data["ip"], bool(data.get("blocked")))
    hub._hosts_cache = None
    return _ok()


# ---------------------------------------------------------------------- wlan
@routes.post("/api/wlan/{box_id}/{index}/enable")
async def wlan_enable(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    await hub.run(box.wlan_set_enable, int(request.match_info["index"]), bool(data["enabled"]))
    await hub.poll()
    return _ok()


def _wifi_qr(ssid: str, password: str, security: str | None) -> str:
    def esc(value: str) -> str:
        for ch in "\\;,:\"":
            value = value.replace(ch, "\\" + ch)
        return value

    kind = "nopass" if not password or (security or "").lower() == "none" else "WPA"
    payload = f"WIFI:T:{kind};S:{esc(ssid)};P:{esc(password or '')};;"
    img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage, border=1)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


@routes.get("/api/wlan/{box_id}/{index}/credentials")
async def wlan_credentials(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    creds = await hub.run(box.wlan_credentials, int(request.match_info["index"]))
    creds["qr"] = _wifi_qr(creds["ssid"] or "", creds["password"] or "", creds["security"])
    return _ok(creds)


@routes.post("/api/wlan/{box_id}/{index}")
async def wlan_update(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    await hub.run(
        box.wlan_update,
        int(request.match_info["index"]),
        (data.get("ssid") or "").strip() or None,
        data.get("password") or None,
    )
    await hub.poll()
    return _ok()


# --------------------------------------------------------------------- phone
@routes.get("/api/calls/{box_id}")
async def calls(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    days = max(1, min(int(request.query.get("days", "30")), 365))
    result = await asyncio.gather(
        hub.run(box.calls, days), hub.run(box.deflections), hub.run(box.call_barring),
        return_exceptions=True,
    )
    if isinstance(result[0], Exception):
        raise result[0]
    return _ok(
        {
            "calls": result[0],
            "deflections": [] if isinstance(result[1], Exception) else result[1],
            "barring": [] if isinstance(result[2], Exception) else result[2],
            "barring_error": str(result[2]) if isinstance(result[2], Exception) else None,
        }
    )


@routes.post("/api/callbarring/{box_id}")
async def barring_add(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    uid = await hub.run(box.call_barring_add, str(data.get("number") or ""), data.get("name") or None)
    return _ok({"uid": uid})


@routes.delete("/api/callbarring/{box_id}/{uid}")
async def barring_delete(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    await hub.run(box.call_barring_delete, int(request.match_info["uid"]))
    return _ok()


@routes.post("/api/deflections/{box_id}/{deflection_id}")
async def deflection_toggle(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    await hub.run(box.set_deflection, int(request.match_info["deflection_id"]), bool(data["enabled"]))
    return _ok()


@routes.get("/api/tam/{box_id}")
async def tam_list(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    tams = await hub.run(box.tams)
    for tam in tams:
        try:
            tam["messages"] = await hub.run(box.tam_messages, tam["index"])
        except BoxError as err:
            tam["messages"] = []
            tam["error"] = str(err)
    return _ok(tams)


@routes.post("/api/tam/{box_id}/{tam}/enable")
async def tam_enable(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    await hub.run(box.tam_set_enable, int(request.match_info["tam"]), bool(data["enabled"]))
    return _ok()


@routes.get("/api/tam/{box_id}/{tam}/{msg}/audio")
async def tam_audio(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    raw = await hub.run(box.tam_audio, int(request.match_info["tam"]), int(request.match_info["msg"]))
    audio, mime = await asyncio.to_thread(to_playable_wav, raw)
    headers = {"Cache-Control": "private, max-age=300"}
    if request.query.get("download") == "1":
        headers["Content-Disposition"] = (
            f'attachment; filename="nachricht_{request.match_info["msg"]}.wav"'
        )
    return web.Response(body=audio, content_type=mime, headers=headers)


@routes.post("/api/tam/{box_id}/{tam}/{msg}/read")
async def tam_mark(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    data = await _json(request)
    await hub.run(
        box.tam_mark,
        int(request.match_info["tam"]),
        int(request.match_info["msg"]),
        bool(data.get("read", True)),
    )
    return _ok()


@routes.delete("/api/tam/{box_id}/{tam}/{msg}")
async def tam_delete(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    await hub.run(box.tam_delete, int(request.match_info["tam"]), int(request.match_info["msg"]))
    return _ok()


# ----------------------------------------------------------------------- NAS
def _nas(request: web.Request):
    hub = _hub(request)
    box_id = request.match_info["box_id"]
    hub.box(box_id)
    return hub.nas[box_id]


@routes.get("/api/nas/{box_id}/list")
async def nas_list(request: web.Request) -> web.Response:
    nas = _nas(request)
    return _ok(await asyncio.to_thread(nas.list, request.query.get("path", "/")))


# Content types for the preview. Anything that could run script in our
# (ingress) origin is served as plain text or sandboxed.
_TEXT_EXT = {
    "txt", "log", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "ini", "conf", "cfg",
    "sh", "py", "js", "ts", "css", "html", "htm", "sql", "toml", "properties", "nfo", "srt",
}


def _preview_headers(name: str) -> dict[str, str]:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in _TEXT_EXT:
        return {"Content-Type": "text/plain; charset=utf-8"}
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    headers = {"Content-Type": mime}
    if mime == "image/svg+xml":
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    return headers


@routes.get("/api/nas/{box_id}/download")
async def nas_download(request: web.Request) -> web.StreamResponse:
    nas = _nas(request)
    path = request.query.get("path", "")
    if not path or path.endswith("/"):
        raise web.HTTPBadRequest(text="Pfad fehlt.")
    size = await asyncio.to_thread(nas.size, path)
    chunks: queue.Queue = queue.Queue(maxsize=32)
    cancel = threading.Event()
    worker = threading.Thread(target=nas.download, args=(path, chunks, cancel), daemon=True)
    worker.start()

    # Wait for the first chunk so that errors can still be sent as JSON
    first = await asyncio.to_thread(chunks.get)
    if isinstance(first, Exception):
        cancel.set()
        raise first

    name = posixpath.basename(path)
    inline = request.query.get("inline") == "1"
    headers = {
        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(name)}",
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
    }
    if inline:
        headers.update(_preview_headers(name))
    resp = web.StreamResponse(headers=headers)
    if size is not None:
        resp.content_length = size
    await resp.prepare(request)
    try:
        item = first
        while item is not EOF:
            if isinstance(item, Exception):
                _LOGGER.warning("NAS download aborted: %s", item)
                break
            await resp.write(item)
            item = await asyncio.to_thread(chunks.get)
        await resp.write_eof()
    except (ConnectionResetError, asyncio.CancelledError):
        cancel.set()
        raise
    finally:
        cancel.set()
    return resp


@routes.post("/api/nas/{box_id}/upload")
async def nas_upload(request: web.Request) -> web.Response:
    nas = _nas(request)
    directory = request.query.get("path", "/")
    reader = await request.multipart()
    uploaded = []
    while True:
        part = await reader.next()
        if part is None:
            break
        if not part.filename:
            continue
        filename = posixpath.basename(part.filename.replace("\\", "/"))
        target = posixpath.join(directory, filename)
        chunks: queue.Queue = queue.Queue(maxsize=32)
        loop = asyncio.get_running_loop()
        job = loop.run_in_executor(None, nas.upload, target, chunks)
        try:
            while True:
                data = await part.read_chunk(256 * 1024)
                if not data:
                    break
                while True:
                    if job.done():
                        break
                    try:
                        chunks.put_nowait(data)
                        break
                    except queue.Full:
                        await asyncio.sleep(0.02)
                if job.done():
                    break
        finally:
            while not job.done():
                try:
                    chunks.put_nowait(EOF)
                    break
                except queue.Full:
                    await asyncio.sleep(0.02)
        await job  # re-raises NasError
        uploaded.append(filename)
    return _ok(uploaded)


@routes.post("/api/nas/{box_id}/mkdir")
async def nas_mkdir(request: web.Request) -> web.Response:
    nas = _nas(request)
    data = await _json(request)
    await asyncio.to_thread(nas.mkdir, data["path"])
    return _ok()


@routes.post("/api/nas/{box_id}/rename")
async def nas_rename(request: web.Request) -> web.Response:
    nas = _nas(request)
    data = await _json(request)
    await asyncio.to_thread(nas.rename, data["from"], data["to"])
    return _ok()


@routes.post("/api/nas/{box_id}/delete")
async def nas_delete(request: web.Request) -> web.Response:
    nas = _nas(request)
    data = await _json(request)
    await asyncio.to_thread(nas.delete, data["path"], bool(data.get("dir")))
    return _ok()


# --------------------------------------------------------------- settings
def _settings_payload(hub: Hub) -> dict[str, Any]:
    from .oui import vendors

    devices = []
    for entry in hub.stats.new_devices:
        vendor = vendors.lookup(entry.get("mac")) or {}
        devices.append({**entry, "vendor": vendor.get("vendor"), "private": vendor.get("private", False)})
    hosts = {h["mac"]: h for h in (hub._hosts_cache[1] if hub._hosts_cache else [])}
    watched = [
        {"mac": mac, "name": (hosts.get(mac) or {}).get("name"), "active": (hosts.get(mac) or {}).get("active"),
         "ip": (hosts.get(mac) or {}).get("ip"), "last_seen": (hub.stats.seen(mac) or {}).get("last")}
        for mac in hub.settings.get("watched_devices") or []
    ]
    return {
        "settings": dict(hub.settings.data),
        "watched": watched,
        "new_devices": devices,
        "ha_available": hub.publisher.available,
        "tracking_since": hub.stats.since,
    }


@routes.get("/api/settings")
async def settings_get(request: web.Request) -> web.Response:
    return _ok(_settings_payload(_hub(request)))


@routes.post("/api/settings")
async def settings_set(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    await asyncio.to_thread(hub.settings.update, data)
    return _ok(_settings_payload(hub))


@routes.post("/api/settings/test-notification")
async def settings_test(request: web.Request) -> web.Response:
    hub = _hub(request)
    sample = {
        "name": "Testgerät (FritzHub)", "ip": "192.168.178.99", "mac": "00:00:5E:00:53:01",
        "vendor": "Beispiel GmbH", "connected_to": "FRITZ!Box", "band": "5 GHz",
    }
    try:
        await hub.notify_new_device(sample)
    except (RuntimeError, aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise BoxError(str(err)) from err
    return _ok()


# ------------------------------------------------------------- statistics
@routes.get("/api/history/{box_id}")
async def history(request: web.Request) -> web.Response:
    hub = _hub(request)
    box_id = request.match_info["box_id"]
    hub.box(box_id)
    range_key = request.query.get("range", "1h")
    if range_key == "1h":
        return _ok([list(p) for p in hub.history.get(box_id, [])])
    if range_key not in ("24h", "7d"):
        raise web.HTTPBadRequest(text="Unbekannter Zeitraum.")
    return _ok(await asyncio.to_thread(hub.stats.history, box_id, range_key))


@routes.get("/api/volume/{box_id}")
async def volume(request: web.Request) -> web.Response:
    hub = _hub(request)
    box_id = request.match_info["box_id"]
    hub.box(box_id)
    return _ok(await asyncio.to_thread(hub.stats.volume, box_id))


# -------------------------------------------------------------------- system
@routes.get("/api/system/ping")
async def system_ping(request: web.Request) -> web.Response:
    """Reachability of all boxes – used to follow reboots live."""
    hub = _hub(request)
    boxes = hub.active_boxes()
    results = await asyncio.gather(*(hub.run(b.ping) for b in boxes))
    return _ok({b.cfg.id: ok for b, ok in zip(boxes, results, strict=True)})


@routes.post("/api/system/reboot-all")
async def system_reboot_all(request: web.Request) -> web.Response:
    """Reboot every reachable box – repeaters first, the mesh master last.

    Otherwise the repeaters would become unreachable (their traffic runs
    through the master) before they received the command.
    """
    hub = _hub(request)
    roles = hub._mesh_roles

    def rank(box: FritzBox) -> int:
        role = roles.get(box.cfg.id)
        info = hub.state.get(box.cfg.id, {}).get("info") or {}
        if role == "master" or (role is None and info.get("is_router")):
            return 2
        return 0 if role == "slave" else 1

    boxes = sorted(
        (b for b in hub.active_boxes() if hub.state.get(b.cfg.id, {}).get("online")), key=rank
    )
    results = []
    for box in boxes:
        name = box.cfg.name or box.cfg.host
        try:
            await hub.run(box.reboot)
            results.append({"name": name, "ok": True})
        except BoxError as err:
            results.append({"name": name, "ok": False, "error": str(err)})
    return _ok(results)


@routes.post("/api/system/{box_id}/{action}")
async def system_action(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    action = request.match_info["action"]
    if action == "reboot":
        await hub.run(box.reboot)
    elif action == "reconnect":
        await hub.run(box.reconnect)
    else:
        raise web.HTTPNotFound(text="Unbekannte Aktion.")
    return _ok()


@routes.get("/api/system/{box_id}/log")
async def system_log(request: web.Request) -> web.Response:
    hub = _hub(request)
    box = hub.box(request.match_info["box_id"])
    return _ok(await hub.run(box.device_log))


# ----------------------------------------------------------------------- app
def _direct_auth(options: Options) -> Auth | None:
    if not options.direct_access:
        return None
    if not options.direct_username or len(options.direct_password or "") < MIN_PASSWORD:
        _LOGGER.error(
            "Direktzugriff ist eingeschaltet, aber Benutzername fehlt oder das Passwort hat weniger als %d Zeichen – "
            "Direktzugriff bleibt aus.", MIN_PASSWORD,
        )
        return None
    if options.direct_port == options.port:
        _LOGGER.error("Direktzugriff: Port %d ist bereits belegt – bitte einen anderen wählen.", options.direct_port)
        return None
    return Auth(options.direct_username, options.direct_password)


def create_app(options: Options) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=1024**3)
    app["options"] = options
    app["auth"] = _direct_auth(options)
    if os.environ.get("FRITZHUB_DEMO") == "1":
        from .demo import DemoBox, DemoNas, demo_discover, demo_store, demo_webscan, seed_demo_devices, seed_demo_stats

        _LOGGER.warning("Demo mode – showing synthetic data")
        hub = Hub(options, store=demo_store(), box_cls=DemoBox, nas_cls=DemoNas)
        seed_demo_stats(hub)
        seed_demo_devices(hub)
        hub.webscan_fn = demo_webscan
        app["discover"] = demo_discover
        app["test_box"] = lambda cfg, _verify: {"model": "FRITZ!Repeater 1200 AX", "firmware": "7.58", "user": cfg.username or "fritz1234"}
        app["usernames"] = lambda host, _port, _tls: ["fritz1234"] if host != "192.168.178.1" else ["homeassistant"]
    else:
        hub = Hub(options)
        app["discover"] = discover
        app["test_box"] = _test_box
        app["usernames"] = fetch_usernames
    app["hub"] = hub

    async def on_startup(_app: web.Application) -> None:
        await hub.start()

    async def on_cleanup(_app: web.Application) -> None:
        await hub.stop()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.add_routes(routes)
    app.router.add_static("/static", STATIC, append_version=False)
    return app
