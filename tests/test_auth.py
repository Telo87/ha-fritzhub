"""Direct access: login, sessions, lockout and the access guard."""

import asyncio
import socket

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from fritzhub.auth import Auth
from fritzhub.config import Options
from fritzhub.server import guard, login, logout, session

from fritzhub import auth as auth_mod


def test_login_and_sessions(tmp_path):
    a = Auth("admin", "geheim123", tmp_path / "s.json")
    assert not a.check("1.2.3.4", "admin", "falsch")
    assert a.check("1.2.3.4", "admin", "geheim123")
    token, max_age = a.create(remember=True)
    assert max_age == auth_mod.REMEMBER_DAYS * 86400
    assert a.valid(token) and not a.valid("x") and not a.valid(None)
    _, age = a.create(remember=False)
    assert age is None
    # sessions survive a restart …
    assert Auth("admin", "geheim123", tmp_path / "s.json").valid(token)
    # … but not a password change
    assert not Auth("admin", "anderes123", tmp_path / "s.json").valid(token)
    a.revoke(token)
    assert not a.valid(token)


def test_lockout(tmp_path):
    a = Auth("admin", "geheim123", tmp_path / "s.json")
    for _ in range(auth_mod.MAX_FAILS):
        assert not a.check("9.9.9.9", "admin", "nope")
    assert a.locked("9.9.9.9") > 0
    # locked even with the right password; other addresses unaffected
    assert not a.check("9.9.9.9", "admin", "geheim123")
    assert a.check("8.8.8.8", "admin", "geheim123")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_guard(tmp_path):
    async def run():
        port = _free_port()
        opts = Options(direct_access=True, direct_port=port, direct_password="geheim123", port=1)
        app = web.Application(middlewares=[guard])
        app["options"] = opts
        app["auth"] = Auth("admin", "geheim123", tmp_path / "s.json")

        async def secret(_request):
            return web.json_response({"ok": True, "data": 42})

        app.router.add_get("/api/session", session)
        app.router.add_post("/api/login", login)
        app.router.add_post("/api/logout", logout)
        app.router.add_get("/api/secret", secret)
        client = TestClient(TestServer(app, port=port))
        await client.start_server()
        try:
            r = await client.get("/api/secret")
            assert r.status == 401 and (await r.json())["login"]
            r = await client.get("/api/session")
            assert (await r.json())["data"] == {"direct": True, "authenticated": False, "user": "admin"}
            r = await client.post("/api/login", json={"username": "admin", "password": "falsch"})
            assert r.status == 401
            r = await client.post("/api/login", json={"username": "admin", "password": "geheim123", "remember": True})
            token = (await r.json())["data"]["token"]
            client.session.cookie_jar.clear()  # iframe without cookies: header must suffice
            r = await client.get("/api/secret", headers={"X-FritzHub-Token": token})
            assert r.status == 200
            r = await client.get(f"/api/secret?t={token}")
            assert r.status == 200
            await client.post("/api/logout", headers={"X-FritzHub-Token": token})
            r = await client.get("/api/secret", headers={"X-FritzHub-Token": token})
            assert r.status == 401
        finally:
            await client.close()

        # without direct access only the ingress proxy gets in
        app2 = web.Application(middlewares=[guard])
        app2["options"] = Options()
        app2["auth"] = None
        app2.router.add_get("/api/session", session)
        client = TestClient(TestServer(app2))
        await client.start_server()
        try:
            r = await client.get("/api/session")
            assert r.status == 403
        finally:
            await client.close()

    asyncio.run(run())
