"""Tests for the web interface detection."""

import asyncio

import aiohttp
from aiohttp import web

from fritzhub.webscan import _dedupe, _probe, _url


def test_url_default_ports():
    assert _url("192.168.0.5", 80, "http") == "http://192.168.0.5/"
    assert _url("192.168.0.5", 443, "https") == "https://192.168.0.5/"
    assert _url("192.168.0.5", 5000, "http") == "http://192.168.0.5:5000/"


def test_dedupe_same_interface_http_https():
    entries = [
        {"url": "http://x/", "title": "FRITZ!Box"},
        {"url": "https://x/", "title": "FRITZ!Box"},
        {"url": "http://x:8080/", "title": None},
    ]
    assert [e["url"] for e in _dedupe(entries)] == ["http://x/", "http://x:8080/"]


async def _serve(handler):
    app = web.Application()
    app.router.add_get("/", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, port


def _probe_with(handler):
    async def run():
        runner, port = await _serve(handler)
        try:
            async with aiohttp.ClientSession() as session:
                return await _probe(session, "127.0.0.1", port, "http")
        finally:
            await runner.cleanup()

    return asyncio.run(run())


def test_probe_html_page_with_title():
    async def page(_request):
        return web.Response(text="<html><head><title> Shelly &amp; Co\n Plug </title></head></html>",
                            content_type="text/html")

    result = _probe_with(page)
    assert result["title"] == "Shelly & Co Plug" and result["login"] is False


def test_probe_login_required_counts():
    async def page(_request):
        return web.Response(status=401, text="auth")

    assert _probe_with(page)["login"] is True


def test_probe_ignores_apis_and_404():
    async def api(_request):
        return web.json_response({"ok": True})

    async def missing(_request):
        return web.Response(status=404, text="<html></html>", content_type="text/html")

    assert _probe_with(api) is None
    assert _probe_with(missing) is None
