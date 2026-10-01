"""Tests for the device history (roaming, online/offline) and watched devices."""

import asyncio

from fritzhub.config import BoxStore, Options, Settings
from fritzhub.devicelog import DeviceLog
from fritzhub.hub import Hub
from fritzhub.stats import Stats

MAC = "AA:BB:CC:00:00:01"


def _host(active=True):
    return [{"mac": MAC, "name": "Handy", "ip": "192.168.0.50", "active": active}]


def _client(ap, band="5 GHz", signal=60):
    return {MAC: {"ap": ap, "band": band, "signal": signal}}


def test_devicelog_roaming_band_and_online_events(tmp_path):
    log = DeviceLog(tmp_path / "devices.json")
    assert log.record(_host(), _client("Box"), now=1000) == []  # first sight: no event
    log.record(_host(), _client("Box"), now=1030)
    log.record(_host(), _client("Repeater"), now=1060)  # roam
    log.record(_host(), _client("Repeater", "2,4 GHz"), now=1090)  # band change
    assert log.record(_host(False), {}, now=1120) == [(MAC, "off")]
    assert log.record(_host(True), _client("Box"), now=1500) == [(MAC, "on")]  # reconnect is no roam
    kinds = [e[1] for e in log.devices[MAC]["ev"]]
    assert kinds == ["roam", "band", "off", "on"]
    assert log.devices[MAC]["ev"][0][2:4] == ["Box", "Repeater"]
    assert log.roams(MAC, since=0) == 1
    assert log.bands_seen(MAC) >= {"5 GHz", "2,4 GHz"}


def test_devicelog_signal_average_and_persistence(tmp_path):
    path = tmp_path / "devices.json"
    log = DeviceLog(path)
    for i, sig in enumerate((20, 30, 40)):
        log.record(_host(), _client("Box", signal=sig), now=6000 + i * 30)
    assert log.avg_signal(MAC, since=0) == 30.0
    log.save()
    again = DeviceLog(path)
    assert again.history(MAC, now=6100)["signal"] == [[6000, 30]]


def test_pingpong_flag(tmp_path):
    log = DeviceLog(tmp_path / "devices.json")
    log.record(_host(), _client("A"), now=0)
    for k in range(1, 8):
        log.record(_host(), _client("A" if k % 2 == 0 else "B"), now=k * 600)
    hist = log.history(MAC, now=8 * 600)
    assert hist["roams_24h"] == 7 and hist["pingpong"] is True


class _Pub:
    available = True

    def __init__(self):
        self.calls = []

    async def fire_event(self, event, data):
        self.calls.append(event)

    async def call_service(self, service, data):
        self.calls.append(service)

    async def close(self):
        pass


def _hub(tmp_path, **settings):
    hub = Hub(Options(), store=BoxStore(tmp_path / "boxes.json"), stats=Stats(tmp_path / "stats.json"),
              settings=Settings(tmp_path / "settings.json"), devlog=DeviceLog(tmp_path / "devices.json"))
    hub.settings.update({"watched_devices": [MAC], **settings})
    hub.publisher = _Pub()
    hub._hosts_cache = (0, _host())
    return hub


def _run_watch(hub, steps):
    """steps: [(timestamp, [(mac, 'on'|'off')])] – returns published calls."""
    async def run():
        for now, changes in steps:
            hub._track_watched(changes, now)
            await asyncio.sleep(0)
            await asyncio.sleep(0)
    asyncio.run(run())
    return hub.publisher.calls


def test_watch_short_dropout_no_alert(tmp_path):
    hub = _hub(tmp_path)
    calls = _run_watch(hub, [(0, [(MAC, "off")]), (60, []), (120, [(MAC, "on")]), (400, [])])
    assert calls == []


def test_watch_offline_and_back_online(tmp_path):
    hub = _hub(tmp_path, notify_persistent=True)
    calls = _run_watch(hub, [(0, [(MAC, "off")]), (179, []), (181, [])])
    assert "fritzhub_device_offline" in calls and "persistent_notification.create" in calls
    calls.clear()
    _run_watch(hub, [(900, [(MAC, "on")])])
    assert "fritzhub_device_online" in calls


def test_watch_alarm_can_be_disabled(tmp_path):
    hub = _hub(tmp_path, watch_alarm=False)
    assert _run_watch(hub, [(0, [(MAC, "off")]), (400, []), (900, [(MAC, "on")])]) == []


def test_unwatched_device_is_ignored(tmp_path):
    hub = _hub(tmp_path)
    hub.settings.update({"watched_devices": []})
    assert _run_watch(hub, [(0, [(MAC, "off")]), (400, [])]) == []


def test_uptime_periods(tmp_path):
    log = DeviceLog(tmp_path / "devices.json")
    host = {"mac": "AA:BB:CC:00:00:01", "active": True}
    t0 = 1_000_000
    # FritzHub runs from t0 to t0+1000 (polls every 10 s), device goes offline at 400, back at 700
    for t in range(t0, t0 + 1001, 10):
        host["active"] = not (t0 + 400 <= t < t0 + 700)
        log.record([host], {}, now=t)
    # gap: FritzHub not running until t0+5000, device online all the time afterwards
    for t in range(t0 + 5000, t0 + 6001, 10):
        log.record([host], {}, now=t)
    import time as _time
    orig = _time.time
    _time.time = lambda: t0 + 6000
    try:
        r = log.uptime("AA:BB:CC:00:00:01", t0, t0 + 6000)
    finally:
        _time.time = orig
    assert r["known"] == [[t0, t0 + 1000], [t0 + 5000, t0 + 6000]]
    # offline 400..700, the unknown gap is not counted as online or offline
    assert r["online"] == [[t0, t0 + 400], [t0 + 700, t0 + 1000], [t0 + 5000, t0 + 6000]]


def test_uptime_migration(tmp_path):
    import json
    path = tmp_path / "devices.json"
    path.write_text(json.dumps({"devices": {"AA": {"active": True, "ev": [[100, "off"], [200, "on", "Box"]], "sig": []}}}))
    log = DeviceLog(path)
    assert log.devices["AA"]["pw"] == [[100, 0], [200, 1]]
    assert log.devices["AA"]["first"] == 100
    assert log.up and log.up[0][0] == 100
