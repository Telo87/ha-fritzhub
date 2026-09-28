"""aiohttp web server: REST API + static single page app (served via ingress)."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import posixpath
import queue
import threading
from pathlib import Path
from typing import Any
from urllib.parse import quote

import qrcode
import qrcode.image.svg
from aiohttp import web

from . import __version__
from .audio import to_playable_wav
from .box import BoxError, FritzBox
from .config import BoxConfig, Options
from .discovery import discover
from .hub import Hub
from .nas import EOF, NasError

_LOGGER = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
INGRESS_PROXY = "172.30.32.2"

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
@web.middleware
async def guard(request: web.Request, handler):
    options: Options = request.app["options"]
    if not options.allow_all and request.remote != INGRESS_PROXY:
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
        "firmware": dev.get("NewSoftwareVersion"),
        "router": box.is_router,
    }


@routes.post("/api/boxes/test")
async def box_test(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    password = data.get("password")
    if data.get("copy_from"):
        src = hub.store.get(data["copy_from"])
        if src:
            data["username"] = data.get("username") or src.username
            password = src.password
    elif not password and data.get("id"):
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
    # "copy credentials from another box" – typical for mesh repeaters
    if data.get("copy_from"):
        src = hub.store.get(data["copy_from"])
        if src:
            data["username"] = data.get("username") or src.username
            data["password"] = src.password
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


@routes.post("/api/hosts/wol")
async def host_wol(request: web.Request) -> web.Response:
    hub = _hub(request)
    data = await _json(request)
    box = hub.box(data.get("box") or (hub.routers() or hub.active_boxes())[0].cfg.id)
    await hub.run(box.wake_on_lan, data["mac"])
    return _ok()


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
        hub.run(box.calls, days), hub.run(box.deflections), return_exceptions=True
    )
    if isinstance(result[0], Exception):
        raise result[0]
    return _ok(
        {
            "calls": result[0],
            "deflections": [] if isinstance(result[1], Exception) else result[1],
        }
    )


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
    disposition = "attachment" if request.query.get("inline") != "1" else "inline"
    resp = web.StreamResponse(
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
            "Content-Type": "application/octet-stream",
        }
    )
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


# -------------------------------------------------------------------- system
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
def create_app(options: Options) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=1024**3)
    app["options"] = options
    if os.environ.get("FRITZHUB_DEMO") == "1":
        from .demo import DemoBox, DemoNas, demo_discover, demo_store

        _LOGGER.warning("Demo mode – showing synthetic data")
        hub = Hub(options, store=demo_store(), box_cls=DemoBox, nas_cls=DemoNas)
        app["discover"] = demo_discover
        app["test_box"] = lambda cfg, _verify: {"model": "FRITZ!Repeater 1200 AX", "firmware": "7.58"}
    else:
        hub = Hub(options)
        app["discover"] = discover
        app["test_box"] = _test_box
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
